# MyAi — Project Conventions

## Architecture

MyAi is a personal AI agent powered by local Ollama LLM. It uses:
- **aiohttp** for the HTTP/WebSocket server (port 8001)
- **Ollama** for LLM inference and embeddings (qwen2.5:7b + nomic-embed-text)
- **SQLite** (async via aiosqlite) for conversations, auth, analytics
- **ChromaDB** for RAG vector search
- **Workspace markdown files** for persona identity, soul rules, and user facts

## Message Processing Pipeline

```
User input → Pre-intercept regex (email, reminder, app launch, file open)
           → AgentHub router (if configured)
           → NexgAI agents (if configured)
           → Ollama LLM with 32 tool definitions
           → Tool execution (sandboxed via FileAccessService + GuardrailsService)
           → Journal entry (JSONL append)
           → Response via WebSocket/Slack/WhatsApp
```

## Key Conventions

- **All user identity comes from .env** via `settings.myai_user_name`, `settings.myai_user_email`, etc. Never hardcode user names, emails, or phone numbers.
- **Workspace files** (`app/workspace/`) are hot-reloaded via watchdog. Edit identity.md, soul.md, or user.md and the agent picks up changes immediately.
- **Tool execution is sandboxed**: `FileAccessService` checks `config/permissions.yaml` before any file op. `GuardrailsService` blocks destructive keywords.
- **Pre-intercepts** in `main.py` handle critical actions (email, reminder, app launch) with regex before the LLM — because small LLMs fake tool calls.
- **Optional integrations** (Slack, Twilio, Graph, NexgAI, AgentHub) are all gated with `.is_configured` checks and graceful degradation.
- **Async everywhere**: all I/O is async. Database, HTTP calls, tool execution — all use `await`.

## File Structure

- `app/agent/core.py` — AgentCore: routing + LLM chat loop
- `app/agent/tools.py` — ToolRegistry: 32 tool implementations
- `app/agent/prompts.py` — System prompts + tool definitions (dynamic, reads from settings)
- `app/agent/intercepts.py` — Pre-intercept regex handlers
- `app/agent/persona.py` — PersonaLoader: composes system prompt from workspace markdown
- `app/main.py` — Server entry point, WebSocket handler, all HTTP routes
- `app/config.py` — Settings (from .env) + PermissionsConfig (from YAML)
- `app/services/` — 30+ service modules (each is a singleton or stateless)
- `app/workspace/` — Persona files, journals, diaries (hot-reloaded)

## Testing

```bash
pytest tests/ -v
```

## Do NOT

- Hardcode paths, usernames, or credentials in source files
- Add heavyweight dependencies to the core `dependencies` list (use `[full]` optional)
- Import Slack/Twilio at module level without try/except guards
- Break the pre-intercept → LLM fallback pipeline order
- Modify workspace journal/diary files programmatically outside the journal/diary services
