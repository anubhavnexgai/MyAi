"""PauseService — global pause/resume gate for MyAi.

When paused:
  - AgentCore.process_message short-circuits with a "paused" message
    instead of calling Ollama.
  - Heartbeat loop skips its tick.
  - On the pause transition we ask Ollama to unload the model from VRAM
    (keep_alive: 0) so the user gets their GPU back for gaming / other work.

State is in-memory only — a server restart resumes by default.
"""
from __future__ import annotations

import logging
from datetime import datetime

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class PauseService:
    def __init__(self):
        self._paused = False
        self._paused_at: datetime | None = None
        self._reason: str = ""

    @property
    def is_paused(self) -> bool:
        return self._paused

    def state(self) -> dict:
        return {
            "paused": self._paused,
            "paused_at": self._paused_at.isoformat() if self._paused_at else None,
            "reason": self._reason,
        }

    async def pause(self, reason: str = "") -> dict:
        if self._paused:
            return self.state()
        self._paused = True
        self._paused_at = datetime.now()
        self._reason = reason or "user-paused"
        logger.info("MyAi paused (%s)", self._reason)

        # Best-effort: ask Ollama to unload the model from VRAM right away.
        # This is what actually frees up the GPU when the user wants to play
        # a game or run another GPU workload.
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(
                    f"{settings.ollama_base_url}/api/generate",
                    json={"model": settings.ollama_model, "keep_alive": 0},
                )
        except Exception as exc:
            logger.debug("Ollama unload ping failed (non-fatal): %s", exc)
        return self.state()

    def resume(self) -> dict:
        if not self._paused:
            return self.state()
        self._paused = False
        self._reason = ""
        logger.info("MyAi resumed")
        return self.state()


_singleton: PauseService | None = None


def get_pause() -> PauseService:
    global _singleton
    if _singleton is None:
        _singleton = PauseService()
    return _singleton
