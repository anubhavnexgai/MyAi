@echo off
title MyAi Personal Agent
echo.
echo ============================================================
echo   MyAi -- Personal AI Agent
echo ============================================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install from https://python.org
    pause
    exit /b 1
)

:: Check Ollama
ollama --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Ollama not found. Install from https://ollama.com
    pause
    exit /b 1
)

:: Check venv
if not exist ".venv\Scripts\python.exe" (
    echo [SETUP] Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -e .
) else (
    call .venv\Scripts\activate.bat
)

:: Check .env
if not exist ".env" (
    echo [SETUP] No .env found. Running first-time setup...
    python setup.py
)

:: Pull models if needed
echo [CHECK] Verifying Ollama models...
ollama list | findstr "qwen2.5:7b" >nul 2>&1
if errorlevel 1 (
    echo [PULL] Downloading qwen2.5:7b (~4.7 GB)...
    ollama pull qwen2.5:7b
)
ollama list | findstr "nomic-embed-text" >nul 2>&1
if errorlevel 1 (
    echo [PULL] Downloading nomic-embed-text...
    ollama pull nomic-embed-text
)

:: Check if Ollama is serving
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo [START] Starting Ollama in background...
    start /min "Ollama" ollama serve
    timeout /t 3 /nobreak >nul
)

:: Start MyAi
echo.
echo [START] Launching MyAi...
echo         Open http://localhost:8001 in your browser
echo         Press Ctrl+C to stop
echo.
python -m app.main --web-only
