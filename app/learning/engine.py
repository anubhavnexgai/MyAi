"""Background learning engine that analyzes feedback and generates improvement suggestions."""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from app.config import settings
from app.services.ollama import OllamaClient
from app.storage.database import Database

# Where auto-applied learned rules live. Read by the persona loader and
# stitched into the system prompt on every turn.
LEARNED_RULES_PATH = Path("app/workspace/learned_rules.md")
LEARNED_RULES_MAX = 8  # cap so the prompt doesn't grow unboundedly

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT = """You are analyzing user feedback on an AI assistant's responses.
Below are question-answer pairs that users rated negatively (thumbs down).

For each pair, suggest how the assistant's system prompt could be improved to give better answers in the future. Be specific and concise.

Return a single paragraph describing the system prompt improvement. Do NOT repeat the questions or answers — just describe the change.

---
{qa_pairs}
---

System prompt improvement suggestion:"""


class LearningEngine:
    """Analyzes feedback and generates learning entries for admin review."""

    def __init__(self, database: Database, ollama: OllamaClient):
        self.db = database
        self.ollama = ollama
        self._last_run: str = ""  # ISO timestamp of last successful run

    async def run_cycle(self) -> dict:
        """Run one learning cycle. Returns summary of what was generated."""
        since = self._last_run or (datetime.utcnow() - timedelta(hours=settings.learning_interval_hours)).isoformat()
        self._last_run = datetime.utcnow().isoformat()

        summary = {
            "prompt_refinements": 0,
            "response_improvements": 0,
            "knowledge_expansions": 0,
        }

        # 1. Analyze negative feedback
        negatives = await self.db.get_negative_feedback_since(since)
        if negatives:
            await self._process_negative_feedback(negatives, summary)

        # 2. Find knowledge expansion candidates from positive feedback
        positives = await self.db.get_positive_feedback_since(since)
        if positives:
            await self._process_positive_feedback(positives, summary)

        # 3. Generate daily satisfaction snapshot
        await self._snapshot_satisfaction()

        total = sum(summary.values())
        if total:
            logger.info("Learning cycle complete: %s", summary)
        else:
            logger.debug("Learning cycle complete: no new entries generated")

        return summary

    async def _process_negative_feedback(self, feedback_list: list[dict], summary: dict) -> None:
        """Group negative feedback by source and generate learning entries."""
        local_feedback = [f for f in feedback_list if f.get("source") == "local"]
        nexgai_feedback = [f for f in feedback_list if f.get("source") == "nexgai"]

        # Local LLM: generate prompt refinement suggestions
        if len(local_feedback) >= settings.learning_min_negative_feedback:
            await self._suggest_prompt_refinement(local_feedback, summary)

        # NexgAI: group by agent and flag for admin review
        agents: dict[str, list[dict]] = {}
        for f in nexgai_feedback:
            agent = f.get("agent_name") or "unknown"
            agents.setdefault(agent, []).append(f)

        for agent_name, agent_feedback in agents.items():
            if len(agent_feedback) < 2:
                continue
            qa = "\n".join(
                f"Q: {f.get('user_query', '?')}\nA: {f.get('message_content', '?')[:300]}"
                for f in agent_feedback[:5]
            )
            await self.db.add_learning_entry({
                "id": str(uuid.uuid4()),
                "entry_type": "response_improvement",
                "source": "nexgai",
                "agent_name": agent_name,
                "trigger_feedback_ids": json.dumps([f["id"] for f in agent_feedback]),
                "original_query": qa[:500],
                "original_response": f"{len(agent_feedback)} negative feedback items for agent {agent_name}",
                "suggested_improvement": f"Review {agent_name} agent configuration in Agent Hub — users rated {len(agent_feedback)} responses negatively.",
            })
            summary["response_improvements"] += 1

    async def _suggest_prompt_refinement(self, feedback_list: list[dict], summary: dict) -> None:
        """Use Ollama to suggest system prompt improvements based on negative feedback."""
        qa_pairs = "\n\n".join(
            f"Q: {f.get('user_query', '(unknown)')}\nA: {f.get('message_content', '(unknown)')[:300]}"
            + (f"\nUser comment: {f['comment']}" if f.get("comment") else "")
            for f in feedback_list[:10]
        )

        prompt = ANALYSIS_PROMPT.format(qa_pairs=qa_pairs)

        try:
            result = await self.ollama.chat(messages=[
                {"role": "system", "content": "You are an AI prompt engineer."},
                {"role": "user", "content": prompt},
            ])
            suggestion = result.get("message", {}).get("content", "").strip()
            if not suggestion:
                return

            await self.db.add_learning_entry({
                "id": str(uuid.uuid4()),
                "entry_type": "prompt_refinement",
                "source": "local",
                "trigger_feedback_ids": json.dumps([f["id"] for f in feedback_list]),
                "original_query": qa_pairs[:500],
                "original_response": f"{len(feedback_list)} negatively-rated local LLM responses",
                "suggested_improvement": suggestion,
            })
            summary["prompt_refinements"] += 1

            # Auto-apply: append the refinement as a one-line rule to the
            # learned-rules file. The persona loader picks it up on the next
            # turn — no admin approval required.
            try:
                self._auto_apply_rule(suggestion, len(feedback_list))
            except Exception as e:
                logger.warning("Auto-apply failed (refinement still saved for review): %s", e)

        except Exception as e:
            logger.error("Prompt refinement generation failed: %s", e)

    def _auto_apply_rule(self, suggestion: str, num_feedback: int) -> None:
        """Distill the suggestion into a single rule line and append it.

        Safety guardrails:
          - Caps total active rules to LEARNED_RULES_MAX (rotates oldest out).
          - Strips multi-paragraph prose to one short sentence.
          - Skips obvious duplicates of existing rules.
          - Tags each rule with the date and feedback count so we can audit.
        """
        # Distill: take the first sentence/paragraph and trim hard
        cleaned = suggestion.strip()
        # Remove any leading "improvement suggestion:" prefix
        cleaned = re.sub(r"^(?:improvement|suggestion|suggested change)[: ]+",
                         "", cleaned, flags=re.IGNORECASE)
        # First sentence only, capped at 280 chars
        first_sentence = re.split(r"(?<=[.!?])\s+", cleaned, maxsplit=1)[0]
        rule = first_sentence.strip().rstrip(".") + "."
        if len(rule) > 280:
            rule = rule[:277].rstrip() + "..."
        if len(rule) < 12:
            return  # too short to be useful

        today = datetime.utcnow().strftime("%Y-%m-%d")
        new_line = f"- [{today}, n={num_feedback}] {rule}"

        LEARNED_RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
        existing = LEARNED_RULES_PATH.read_text(encoding="utf-8") if LEARNED_RULES_PATH.is_file() else ""

        # Dedupe — skip if the exact rule body already exists
        rule_body = rule.lower()
        for ln in existing.splitlines():
            if ln.lower().endswith(rule_body):
                logger.info("Auto-apply: rule already present, skipping")
                return

        # Build header if missing
        if not existing.strip():
            existing = (
                "# Learned rules\n\n"
                "_Auto-generated by the learning engine from negative-feedback "
                "analysis. The most recent rules are at the bottom. The persona "
                "loader stitches these into the system prompt._\n\n"
                "<!-- LEARNED_RULES_BELOW -->\n"
            )

        # Append the new rule
        if "<!-- LEARNED_RULES_BELOW -->" in existing:
            updated = existing.rstrip() + "\n" + new_line + "\n"
        else:
            updated = existing.rstrip() + "\n\n<!-- LEARNED_RULES_BELOW -->\n" + new_line + "\n"

        # Enforce cap by trimming the oldest rules above the cap
        marker = "<!-- LEARNED_RULES_BELOW -->"
        if marker in updated:
            head, body = updated.split(marker, 1)
            rule_lines = [ln for ln in body.splitlines() if ln.strip().startswith("-")]
            if len(rule_lines) > LEARNED_RULES_MAX:
                rule_lines = rule_lines[-LEARNED_RULES_MAX:]
                body = "\n".join(rule_lines) + "\n"
                updated = head + marker + "\n" + body

        LEARNED_RULES_PATH.write_text(updated, encoding="utf-8")
        logger.info("Auto-applied learned rule (active rules now capped at %d): %s",
                    LEARNED_RULES_MAX, rule[:120])

        # Invalidate persona cache so the next turn sees the new rule
        try:
            from app.agent.persona import get_persona_loader
            get_persona_loader().invalidate()
        except Exception:
            pass

    async def _process_positive_feedback(self, feedback_list: list[dict], summary: dict) -> None:
        """Identify highly-rated local LLM responses as knowledge expansion candidates."""
        for f in feedback_list:
            query = f.get("user_query", "")
            response = f.get("message_content", "")
            if not query or not response or len(response) < 50:
                continue

            await self.db.add_learning_entry({
                "id": str(uuid.uuid4()),
                "entry_type": "knowledge_expansion",
                "source": "local",
                "trigger_feedback_ids": json.dumps([f["id"]]),
                "original_query": query[:500],
                "original_response": response[:2000],
                "suggested_improvement": f"Add to knowledge base — user rated this response positively:\n\nQ: {query}\nA: {response[:500]}",
            })
            summary["knowledge_expansions"] += 1

    async def _snapshot_satisfaction(self) -> None:
        """Generate daily satisfaction snapshot."""
        today = datetime.utcnow().strftime("%Y-%m-%d")
        for source in ("local", "nexgai", "all"):
            src_filter = source if source != "all" else None
            stats = await self.db.get_feedback_stats(period_hours=24, source=src_filter)
            if stats["total"] > 0:
                await self.db.save_satisfaction_snapshot(today, source, stats)
