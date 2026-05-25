# MyAi Setup Guide

Follow these steps to get MyAi running on your machine. Takes ~15 minutes.

---

## Prerequisites

| Requirement | How to get it |
|-------------|---------------|
| Python 3.11+ | [python.org](https://python.org) |
| Ollama | [ollama.com](https://ollama.com) |
| ~8 GB disk | For the LLM model + embeddings |

---

## Step 1: Install Ollama & Pull Models

```bash
# After installing Ollama, start it:
ollama serve

# In another terminal, pull the required models:
ollama pull qwen2.5:7b       # Main LLM (~4.7 GB)
ollama pull nomic-embed-text  # Embeddings (~274 MB)

# Optional: vision model
ollama pull llava:7b          # For describe_image/describe_screen
```

---

## Step 2: Clone & Install MyAi

```bash
git clone https://github.com/anubhavnexgai/MyAi.git
cd MyAi

# Create virtual environment
python -m venv .venv

# Activate it
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install (core only — lightweight)
pip install -e .

# OR install with all features (WhatsApp, vision, browser, system info)
pip install -e ".[full]"
```

---

## Step 3: Run Setup

```bash
python setup.py
```

This will:
- Ask for your name, email, and role
- Create your `.env` configuration
- Set up the workspace directories

---

## Step 4: Start MyAi

You need **2 terminals**:

### Terminal 1: Ollama
```bash
ollama serve
```

### Terminal 2: MyAi
```bash
cd MyAi
.venv\Scripts\activate   # or source .venv/bin/activate
python -m app.main --web-only
```

---

## Step 5: Open the Web UI

Go to **http://localhost:8001**

On first visit:
1. Create your admin account (email + password)
2. Start chatting!

---

## Optional Features

### WhatsApp (via Twilio)

1. Create a free [Twilio account](https://www.twilio.com/try-twilio)
2. Set up WhatsApp Sandbox in Twilio Console
3. Add to `.env`:
   ```
   TWILIO_ACCOUNT_SID=your_sid
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_WHATSAPP_NUMBER=+14155238886
   ```
4. Expose your server: `ngrok http 8001`
5. Set Twilio webhook to: `https://<ngrok-url>/whatsapp/webhook`

### Browser Automation

```bash
pip install playwright
playwright install chromium
```

### Slack Integration

```bash
pip install -e ".[slack]"
```

Then configure `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.env`, and run without `--web-only`.

### Microsoft 365 (Calendar, Email, Files)

Configure `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID` in `.env`. See Azure App Registration docs.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Connection refused" on chat | Make sure `ollama serve` is running |
| Slow responses | Try a smaller model: set `OLLAMA_MODEL=qwen2.5:3b` in `.env` |
| WhatsApp not working | Check Twilio webhook URL matches your ngrok URL |
| "pyautogui not installed" | Run `pip install -e ".[full]"` |
| Vision tools fail | Run `ollama pull llava:7b` |

---

## Updating

```bash
git pull
pip install -e .
# Restart the server
```

---

## Remote Access (Mobile)

```bash
ngrok http 8001
# Access MyAi from phone at the ngrok HTTPS URL
```
