"""Context-aware suggestion engine for proactive MyAi UX.

Generates 2-3 follow-up suggestion strings based on:
  - The assistant's response text
  - The tool(s) that were called
  - The user's message

Used by the WebSocket handler to append clickable suggestions after every response.
"""
from __future__ import annotations

import re
from typing import List, Optional

_SUGGESTIONS: list[tuple[list[str], list[str]]] = [
    # (trigger keywords in response, suggestion texts)
    (["file", "folder", "directory", ".py", ".md", ".pdf", ".txt", ".csv", ".docx"],
     ["Open the latest file", "Search for a specific file", "Read this file"]),
    (["code", "python", "function", "def ", "class ", "import ", "```"],
     ["Explain this code", "Write tests for it", "Improve this code"]),
    (["git", "branch", "commit", "modified", "staged", "ahead"],
     ["Show the latest commit details", "List all changed files", "Check git log"]),
    (["email", "outlook", "drafted", "sent", "mail"],
     ["Send another email", "Check my inbox"]),
    (["screenshot", "screen", ".png", "captured", "image"],
     ["Describe what you see", "Take another screenshot"]),
    (["search", "result", "found", "http", "www."],
     ["Tell me more about the first result", "Search for something else"]),
    (["reminder", "set for", "remind"],
     ["Show all my reminders", "Set another reminder"]),
    (["cpu", "ram", "memory", "disk", "battery", "usage", "system"],
     ["What processes are using the most resources?", "Check disk space"]),
    (["clipboard", "copied", "pasted"],
     ["Write it to a file", "Search the web for this"]),
    (["launched", "opened", "notepad", "chrome", "calculator"],
     ["Take a screenshot", "Type something in it"]),
]


def get_suggestions(
    response_text: str,
    user_message: str = "",
    tool_names: Optional[List[str]] = None,
    max_suggestions: int = 3,
) -> List[str]:
    """Return 2-3 contextual suggestion strings based on response content."""
    if not response_text:
        return ["What can you do?", "Check system health"]

    resp_lower = response_text.lower()
    matched: List[str] = []

    for triggers, suggestions in _SUGGESTIONS:
        if any(t in resp_lower for t in triggers):
            for s in suggestions:
                if s not in matched:
                    matched.append(s)
                if len(matched) >= max_suggestions:
                    return matched

    # Fallback
    if not matched:
        matched = ["Tell me more", "What else can you help with?"]

    return matched[:max_suggestions]
