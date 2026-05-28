@echo off
setlocal enabledelayedexpansion
title MyAi via Docker
echo.
echo  ============================================================
echo     MyAi via Docker
echo     One container start. No Python, no Ollama install.
echo  ============================================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo  [!] Docker not found.
    echo      Install Docker Desktop from https://docker.com/products/docker-desktop
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo  [!] Docker daemon not running.
    echo      Start Docker Desktop and try again.
    pause
    exit /b 1
)
echo  [OK] Docker is running

echo.
echo  [BUILD] Building MyAi image (first time only, ~2 min)...
docker compose build --quiet myai

echo.
echo  [START] Starting Ollama + pulling models (first time ~5 GB download)...
docker compose up -d ollama model-puller

echo  [WAIT] Waiting for models to finish downloading...
docker compose wait model-puller

echo.
echo  [START] Starting MyAi...
docker compose up -d myai

echo.
echo  ============================================================
echo     MyAi is running!
echo     Open http://localhost:8001 in your browser
echo  ============================================================
echo.
echo     Logs:  docker compose logs -f myai
echo     Stop:  docker compose down
echo.
pause
