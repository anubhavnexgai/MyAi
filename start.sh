#!/usr/bin/env bash
set -e

echo ""
echo "============================================================"
echo "  MyAi -- Personal AI Agent"
echo "============================================================"
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python 3 not found. Install from https://python.org"
    exit 1
fi

# Check Ollama
if ! command -v ollama &>/dev/null; then
    echo "[ERROR] Ollama not found. Install from https://ollama.com"
    exit 1
fi

# Check venv
if [ ! -f ".venv/bin/python" ]; then
    echo "[SETUP] Creating virtual environment..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -e .
else
    source .venv/bin/activate
fi

# Check .env
if [ ! -f ".env" ]; then
    echo "[SETUP] No .env found. Running first-time setup..."
    python setup.py
fi

# Pull models if needed
echo "[CHECK] Verifying Ollama models..."
if ! ollama list 2>/dev/null | grep -q "qwen2.5:7b"; then
    echo "[PULL] Downloading qwen2.5:7b (~4.7 GB)..."
    ollama pull qwen2.5:7b
fi
if ! ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    echo "[PULL] Downloading nomic-embed-text..."
    ollama pull nomic-embed-text
fi

# Check if Ollama is serving
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
    echo "[START] Starting Ollama in background..."
    ollama serve &>/dev/null &
    sleep 3
fi

# Start MyAi
echo ""
echo "[START] Launching MyAi..."
echo "        Open http://localhost:8001 in your browser"
echo "        Press Ctrl+C to stop"
echo ""
python -m app.main --web-only
