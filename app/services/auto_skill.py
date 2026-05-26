"""Auto-Skill Extraction — learns reusable tool chains from successful multi-tool turns.

Inspired by Hermes Agent's autonomous skill creation. After the agent completes
a turn with 2+ successful tool calls, this module:
  1. Checks if the chain is novel (not already in the H5 skill library)
  2. Builds a procedural hint from the tool sequence
  3. Saves it to a persistent file that H5 loads on next turn

No LLM call required — pure pattern extraction from observed tool_calls.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SKILLS_FILE = Path(__file__).parent.parent / "workspace" / "learned_skills.json"
MIN_CHAIN_LENGTH = 2
MAX_SKILLS = 50

_lock = threading.Lock()


def _load_skills() -> list[dict]:
    if not SKILLS_FILE.exists():
        return []
    try:
        return json.loads(SKILLS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_skills(skills: list[dict]):
    SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SKILLS_FILE.write_text(
        json.dumps(skills, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _chain_signature(tool_calls: list[dict]) -> str:
    return " -> ".join(tc.get("name", "?") for tc in tool_calls)


def _is_successful(tool_calls: list[dict]) -> bool:
    for tc in tool_calls:
        result = str(tc.get("result", "")).lower()[:100]
        if any(w in result for w in ("error", "failed", "denied", "not found", "blocked")):
            return False
    return True


def _build_hint(user_msg: str, tool_calls: list[dict]) -> str:
    steps = []
    for i, tc in enumerate(tool_calls, 1):
        name = tc.get("name", "?")
        args = tc.get("args", {})
        arg_summary = ", ".join(f"{k}" for k in args.keys()) if args else "no args"
        steps.append(f"{name}({arg_summary})")
    return f"For tasks like \"{user_msg[:60]}\": use {' then '.join(steps)}."


def _extract_keywords(user_msg: str) -> list[str]:
    stop = {"a", "an", "the", "my", "me", "i", "to", "in", "on", "at", "of",
            "and", "or", "for", "is", "it", "do", "can", "you", "what", "how",
            "show", "tell", "please", "now", "just", "also", "then", "from"}
    words = user_msg.lower().split()
    return [w for w in words if len(w) > 2 and w not in stop][:5]


def try_extract_skill(
    user_msg: str,
    tool_calls: list[dict[str, Any]],
    response: str,
) -> dict | None:
    """Attempt to extract a reusable skill from a successful multi-tool turn.

    Returns the saved skill dict if one was created, None otherwise.
    """
    if not tool_calls or len(tool_calls) < MIN_CHAIN_LENGTH:
        return None

    if not _is_successful(tool_calls):
        return None

    chain_sig = _chain_signature(tool_calls)

    with _lock:
        skills = _load_skills()

        # Check for duplicate chains
        for sk in skills:
            if sk.get("chain") == chain_sig:
                sk["use_count"] = sk.get("use_count", 0) + 1
                sk["last_used"] = datetime.now().isoformat()
                _save_skills(skills)
                return None  # already known, just bump count

        new_skill = {
            "id": f"auto_{len(skills)+1}_{int(datetime.now().timestamp())}",
            "chain": chain_sig,
            "hint": _build_hint(user_msg, tool_calls),
            "keywords": _extract_keywords(user_msg),
            "tools": [tc.get("name") for tc in tool_calls],
            "example_query": user_msg[:100],
            "created": datetime.now().isoformat(),
            "use_count": 1,
            "last_used": datetime.now().isoformat(),
        }

        skills.append(new_skill)

        # Cap at MAX_SKILLS — drop least-used
        if len(skills) > MAX_SKILLS:
            skills.sort(key=lambda s: s.get("use_count", 0))
            skills = skills[-MAX_SKILLS:]

        _save_skills(skills)
        logger.info("Auto-skill extracted: %s (%s)", chain_sig, new_skill["id"])
        return new_skill


def get_learned_skills(user_msg: str, top_k: int = 2) -> list[dict]:
    """Retrieve learned skills relevant to a user message (for H5 injection)."""
    if not SKILLS_FILE.exists():
        return []

    msg_lower = user_msg.lower()
    skills = _load_skills()

    scored = []
    for sk in skills:
        score = 0.0
        for kw in sk.get("keywords", []):
            if kw in msg_lower:
                score += 2.0
        # Boost frequently-used skills
        score += min(sk.get("use_count", 0) * 0.5, 3.0)
        if score > 0:
            scored.append((score, sk))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in scored[:top_k]]
