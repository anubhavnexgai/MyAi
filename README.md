# MyAi — Personal AI Agent

A locally-running personal AI agent powered by **Ollama**. Runs entirely on your machine — your data never leaves. Accessible via **Web UI**, **WhatsApp**, and **Slack**.

## Features

### Core
- **32 Tools** — File ops, email, WhatsApp, web search, vision, browser automation, reminders, and more
- **Local LLM** — Ollama (qwen2.5:7b default, swap any model)
- **Privacy-first** — All inference runs on your hardware, no API keys required for core features
- **Multi-conversation Chat** — Claude.ai-style threads with sidebar
- **Dark Obsidian UI** — Modern theme with Space Grotesk + Inter fonts

### Agent Capabilities
- **Personas** — Named agents (@sam for sales, @polly for scheduling) with separate identities
- **Memory & Dreaming** — Journaling + nightly consolidation extracts durable facts
- **Autonomous Goals** — `start_goal` decomposes and executes multi-step tasks
- **Vision** — Describe images and screen content via local LLaVA model
- **Skill Factory** — Create new tools on-the-fly from natural language
- **Computer Use** — Open apps, type text, press hotkeys
- **Browser Automation** — Navigate sites, search Google, extract content
- **Heartbeat** — Proactive scheduled ticks per persona

### Integrations (all optional)
- **WhatsApp** — Bidirectional messaging via Twilio
- **Email** — Draft and send via Outlook
- **Slack** — Full bot with slash commands
- **Microsoft 365** — Calendar, email, files via Graph API
- **NexgAI Platform** — Connect to 24+ enterprise agents

### Administration
- **Auth & RBAC** — 4-tier role hierarchy
- **Admin Dashboard** — Analytics, user management, system health
- **Self-Learning Loop** — Feedback-driven prompt refinements
- **Guardrails** — Policy-based security for all tool calls

## Quick Start

### Prerequisites

1. **Python 3.11+**
2. **Ollama** — Install from [ollama.com](https://ollama.com)

### One-Command Install

```bash
git clone https://github.com/anubhavnexgai/MyAi.git
cd MyAi

# Windows:
start.bat

# macOS / Linux:
chmod +x start.sh && ./start.sh
```

That's it. The script automatically:
1. Checks Python & Ollama (prompts to install if missing)
2. Creates virtual environment + installs dependencies
3. Auto-detects your name from the OS and creates `.env`
4. Starts Ollama and pulls required models (one-time ~5 GB download)
5. Launches MyAi and opens **http://localhost:8001** in your browser

### First Login

1. On first visit, you'll be prompted to create an admin account
2. Set your email, name, and password
3. Start chatting!

## Configuration

Copy `.env.example` to `.env` and edit:

```bash
cp .env.example .env
```

Key settings:
| Variable | Required | Description |
|----------|----------|-------------|
| `MYAI_USER_NAME` | Yes | Your name (personalizes responses) |
| `MYAI_USER_EMAIL` | Yes | Your email (for drafting emails) |
| `OLLAMA_MODEL` | No | Default: `qwen2.5:7b` |
| `MYAI_USER_PHONE` | No | For WhatsApp notifications |
| `TWILIO_*` | No | WhatsApp integration |
| `GRAPH_*` | No | Microsoft 365 integration |

See `.env.example` for all options.

## Architecture

```
Web UI (WebSocket)  →  Pre-intercepts (email/reminder/whatsapp)
WhatsApp (Twilio)   →  WhatsApp webhook
Slack (Socket Mode) →  Slash commands + DMs
                          ↓
                    AgentCore (hybrid routing)
                    ├── NexgAI agents (if configured)
                    ├── AgentHub gateway (if configured)
                    └── Ollama LLM + 32 tools (always available)
                          ↓
                    Tool execution (sandboxed)
                          ↓
                    Guardrails check → Response
```

## Optional: Vision

```bash
ollama pull llava:7b
# Now you can: "describe my screen", "what's in this image?"
```

## Optional: Browser Automation

```bash
pip install playwright
playwright install chromium
# Now you can: "browse github.com", "search for AI news"
```

## Optional: WhatsApp

1. Create a [Twilio account](https://www.twilio.com/try-twilio)
2. Set up WhatsApp Sandbox
3. Add to `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`
4. Start ngrok: `ngrok http 8001`
5. Set Twilio sandbox webhook to: `https://<ngrok-url>/whatsapp/webhook`

## Project Structure

```
myai/
├── app/
│   ├── main.py          # Server + WebSocket + routes
│   ├── config.py        # Settings from .env
│   ├── agent/           # Core agent logic + tools
│   ├── services/        # 30+ service modules
│   ├── auth/            # Auth + RBAC
│   ├── admin/           # Dashboard + analytics
│   ├── learning/        # Self-learning loop
│   ├── skills/          # Domain skills
│   ├── workspace/       # Persona files + memory
│   └── storage/         # Database layer
├── web/                 # Frontend (HTML/CSS/JS)
├── config/              # YAML policies + permissions
├── data/                # SQLite + ChromaDB + uploads
├── tests/               # Pytest suite
├── setup.py             # First-run setup script
├── .env.example         # Configuration template
└── pyproject.toml       # Python package definition
```

## License

MIT
