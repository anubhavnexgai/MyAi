#!/usr/bin/env bash
#
# MyAi via Docker — true one-command install
# Requires: Docker Desktop (Mac/Windows) or docker + docker compose (Linux)
#
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}   MyAi via Docker${NC}"
echo -e "${BOLD}   One container start. No Python, no Ollama install.${NC}"
echo -e "${BOLD}============================================================${NC}"
echo ""

if ! command -v docker &>/dev/null; then
    echo -e "${YELLOW}[!] Docker not found.${NC}"
    echo "    Install Docker Desktop from https://docker.com/products/docker-desktop"
    exit 1
fi

if ! docker info &>/dev/null; then
    echo -e "${YELLOW}[!] Docker daemon not running.${NC}"
    echo "    Start Docker Desktop and try again."
    exit 1
fi
echo -e "${GREEN}[OK]${NC} Docker is running"

# Detect compose command (V1 vs V2)
if docker compose version &>/dev/null; then
    COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE="docker-compose"
else
    echo -e "${YELLOW}[!] docker compose not found.${NC}"
    echo "    Install Docker Desktop or run: pip install docker-compose"
    exit 1
fi

echo ""
echo -e "[BUILD] Building MyAi image (first time only, ~2 min)..."
$COMPOSE build --quiet myai

echo ""
echo -e "[START] Starting Ollama + pulling models (first time ~5 GB download)..."
$COMPOSE up -d ollama model-puller

echo -e "[WAIT] Waiting for models to finish downloading..."
$COMPOSE wait model-puller

echo ""
echo -e "[START] Starting MyAi..."
$COMPOSE up -d myai

echo ""
echo -e "${GREEN}[READY]${NC} MyAi is running!"
echo ""
echo -e "${BOLD}   Open http://localhost:8001 in your browser${NC}"
echo ""
echo -e "   Logs:  $COMPOSE logs -f myai"
echo -e "   Stop:  $COMPOSE down"
echo ""
