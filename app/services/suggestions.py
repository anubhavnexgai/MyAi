"""Context-aware suggestion engine for proactive MyAi UX.

Generates 2-3 follow-up suggestions that a real employee would actually
use in their workday — not tech demos, but actionable next steps.
"""
from __future__ import annotations

from typing import List, Optional

_SUGGESTIONS: list[tuple[list[str], list[str]]] = [
    (["file", "folder", "directory", "download", "document", ".pdf", ".docx"],
     ["Summarize this document", "Email it to my team", "Find related files"]),
    (["code", "python", "function", "def ", "class ", "bug", "error", "fix"],
     ["Explain this code", "Write tests for it", "Refactor it"]),
    (["git", "branch", "commit", "modified", "staged", "push", "pull request"],
     ["Draft a PR description", "Summarize changes for standup"]),
    (["email", "outlook", "drafted", "sent", "mail", "draft"],
     ["Draft another email", "Remind me to follow up in 1 hour"]),
    (["search", "result", "found", "article", "news", "trend", "http"],
     ["Summarize the key takeaways", "Draft a Slack message about this"]),
    (["reminder", "set for", "remind", "alarm"],
     ["What else do I need to do today?", "Set another reminder"]),
    (["cpu", "ram", "memory", "disk", "battery", "usage", "system"],
     ["Which apps are using the most resources?", "Free up some memory"]),
    (["meeting", "agenda", "standup", "sprint", "review", "calendar"],
     ["Draft meeting notes", "Send a follow-up email"]),
    (["launched", "opened", "notepad", "chrome", "app"],
     ["Help me draft something in it", "Take a screenshot"]),
    (["hello", "hi", "hey", "good morning", "how can i help"],
     ["Plan my day", "Catch me up on what I missed", "Draft a status update"]),
    (["clipboard", "copied", "pasted", "link"],
     ["Summarize this link", "Save it to a file"]),
    (["screenshot", "screen", "image", "captured"],
     ["Describe what's in it", "Share it with the team"]),
]


def get_suggestions(
    response_text: str,
    user_message: str = "",
    tool_names: Optional[List[str]] = None,
    max_suggestions: int = 3,
) -> List[str]:
    if not response_text:
        return ["Draft an email", "Help me plan my day"]

    resp_lower = response_text.lower()
    matched: List[str] = []

    for triggers, suggestions in _SUGGESTIONS:
        if any(t in resp_lower for t in triggers):
            for s in suggestions:
                if s not in matched:
                    matched.append(s)
                if len(matched) >= max_suggestions:
                    return matched

    if not matched:
        matched = ["Help me draft something", "What should I focus on today?"]

    return matched[:max_suggestions]
