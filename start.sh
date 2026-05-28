#!/usr/bin/env bash
#
# MyAi — One-command installer + launcher
# Usage: ./start.sh
#
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}   MyAi — Personal AI Agent${NC}"
echo -e "${BOLD}   One-command installer + launcher${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# ── 1. CHECK PYTHON ──
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo -e "${YELLOW}[!] Python 3 not found.${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "    Install: brew install python3"
    elif [[ -f /etc/debian_version ]]; then
        echo "    Install: sudo apt install python3 python3-venv python3-pip"
    else
        echo "    Install from: https://python.org"
    fi
    exit 1
fi
PY_VER=$($PY --version 2>&1)
echo -e "${GREEN}[OK]${NC} $PY_VER"

# ── 2. CHECK / INSTALL OLLAMA ──
if ! command -v ollama &>/dev/null; then
    echo -e "${YELLOW}[!] Ollama not found. Installing...${NC}"
    curl -fsSL https://ollama.com/install.sh | sh
fi
echo -e "${GREEN}[OK]${NC} Ollama found"

# ── 3. CREATE VENV + INSTALL ──
if [ ! -f ".venv/bin/python" ] && [ ! -f ".venv/Scripts/python.exe" ]; then
    echo ""
    echo -e "[SETUP] Creating virtual environment..."
    $PY -m venv .venv
    source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate 2>/dev/null
    echo -e "[SETUP] Installing dependencies (2-3 min on first install)..."
    pip install -r requirements.txt -q
    echo -e "${GREEN}[OK]${NC} Dependencies installed"
else
    source .venv/bin/activate 2>/dev/null || source .venv/Scripts/activate 2>/dev/null
fi

# ── 4. AUTO-CREATE .ENV ──
if [ ! -f ".env" ]; then
    echo ""
    echo -e "[SETUP] Creating configuration..."
    UNAME=$(whoami)
    FULLNAME=$(getent passwd "$UNAME" 2>/dev/null | cut -d: -f5 | cut -d, -f1)
    [ -z "$FULLNAME" ] && FULLNAME="$UNAME"

    cp .env.example .env
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/MYAI_USER_NAME=Your Name/MYAI_USER_NAME=$FULLNAME/" .env
        sed -i '' "s/MYAI_USER_EMAIL=you@example.com/MYAI_USER_EMAIL=${UNAME}@localhost/" .env
        sed -i '' "s/MYAI_USER_ROLE=Software Engineer/MYAI_USER_ROLE=/" .env
        sed -i '' 's/MYAI_USER_PHONE=+919876543210/MYAI_USER_PHONE=/' .env
    else
        sed -i "s/MYAI_USER_NAME=Your Name/MYAI_USER_NAME=$FULLNAME/" .env
        sed -i "s/MYAI_USER_EMAIL=you@example.com/MYAI_USER_EMAIL=${UNAME}@localhost/" .env
        sed -i "s/MYAI_USER_ROLE=Software Engineer/MYAI_USER_ROLE=/" .env
        sed -i 's/MYAI_USER_PHONE=+919876543210/MYAI_USER_PHONE=/' .env
    fi
    echo -e "${GREEN}[OK]${NC} Config created for $FULLNAME"
fi

# ── 5. DATA DIRS ──
mkdir -p data/uploads data/chroma

# ── 6. START OLLAMA ──
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
    echo ""
    echo -e "[START] Starting Ollama..."
    ollama serve &>/dev/null &
    sleep 4
fi
echo -e "${GREEN}[OK]${NC} Ollama running"

# ── 7. PULL MODELS ──
echo ""
echo -e "[CHECK] Checking models..."
if ! ollama list 2>/dev/null | grep -q "qwen2.5:7b"; then
    echo -e "[PULL] Downloading qwen2.5:7b (4.7 GB, one-time)..."
    ollama pull qwen2.5:7b
fi
if ! ollama list 2>/dev/null | grep -q "nomic-embed-text"; then
    echo -e "[PULL] Downloading nomic-embed-text (274 MB, one-time)..."
    ollama pull nomic-embed-text
fi
echo -e "${GREEN}[OK]${NC} Models ready"

# ── 8. LAUNCH ──
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}   MyAi is starting...${NC}"
echo -e "${BOLD}   Opening http://localhost:8001 in your browser${NC}"
echo -e "${BOLD}   Press Ctrl+C to stop${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

# Open browser
(sleep 3 && {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open http://localhost:8001
    elif command -v xdg-open &>/dev/null; then
        xdg-open http://localhost:8001
    fi
}) &

# Start server
python -m app.main --web-only
