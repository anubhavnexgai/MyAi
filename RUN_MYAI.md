# Running MyAi

## Quick Start

```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Start MyAi
cd MyAi
.venv\Scripts\activate
python -m app.main --web-only
```

Open **http://localhost:8001**

## Health Check

```bash
curl http://localhost:8001/health
```

## Flags

| Flag | Effect |
|------|--------|
| `--web-only` | Web UI only, no Slack (recommended for personal use) |
| (no flag) | Web UI + Slack Socket Mode (requires SLACK_* in .env) |

## Environment Variables

See [.env.example](.env.example) for all options.

## Troubleshooting

See [SETUP_GUIDE.md](SETUP_GUIDE.md#troubleshooting).
