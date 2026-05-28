@echo off
title MyAi — Installing...
setlocal enabledelayedexpansion
echo.
echo  ============================================================
echo     MyAi — Personal AI Agent
echo     One-command installer + launcher
echo  ============================================================
echo.

:: ── 1. CHECK PYTHON ──
where python >nul 2>&1
if errorlevel 1 (
    echo  [!] Python not found. Downloading installer...
    echo.
    echo      Please install Python 3.11+ from https://python.org
    echo      IMPORTANT: Check "Add Python to PATH" during install.
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo  [OK] Python %PY_VER%

:: ── 2. CHECK / INSTALL OLLAMA ──
where ollama >nul 2>&1
if errorlevel 1 (
    echo  [!] Ollama not found. Downloading installer...
    echo.
    powershell -Command "& { Start-Process 'https://ollama.com/download/OllamaSetup.exe' }"
    echo      Install Ollama, then re-run this script.
    pause
    exit /b 1
)
echo  [OK] Ollama found

:: ── 3. CREATE VENV + INSTALL DEPS ──
if not exist ".venv\Scripts\python.exe" (
    echo.
    echo  [SETUP] Creating virtual environment...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    echo  [SETUP] Installing dependencies (this takes 2-3 min on first install)...
    pip install -r requirements.txt -q
    echo  [OK] Dependencies installed
) else (
    call .venv\Scripts\activate.bat
)

:: ── 4. AUTO-CREATE .ENV (no prompts) ──
if not exist ".env" (
    echo.
    echo  [SETUP] Creating configuration...

    :: Auto-detect user name from Windows
    set "UNAME=%USERNAME%"
    for /f "tokens=2*" %%a in ('net user "%USERNAME%" ^| findstr /B /C:"Full Name"') do set "FULLNAME=%%b"
    if "!FULLNAME!"=="" set "FULLNAME=!UNAME!"

    :: Create .env from template with auto-filled values
    powershell -Command "& { $content = Get-Content '.env.example' -Raw; $content = $content -replace 'MYAI_USER_NAME=Your Name', ('MYAI_USER_NAME=' + '!FULLNAME!'); $content = $content -replace 'MYAI_USER_EMAIL=you@example.com', ('MYAI_USER_EMAIL=' + '!UNAME!' + '@localhost'); $content = $content -replace 'MYAI_USER_ROLE=Software Engineer', 'MYAI_USER_ROLE='; $content = $content -replace 'MYAI_USER_PHONE=\+919876543210', 'MYAI_USER_PHONE='; Set-Content '.env' $content -Encoding UTF8 }"
    echo  [OK] Config created for !FULLNAME!
)

:: ── 5. CREATE DATA DIRS ──
if not exist "data\uploads" mkdir data\uploads
if not exist "data\chroma" mkdir data\chroma

:: ── 6. START OLLAMA IF NOT RUNNING ──
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [START] Starting Ollama...
    start /min "Ollama" ollama serve
    timeout /t 4 /nobreak >nul
)
echo  [OK] Ollama running

:: ── 7. PULL MODELS ──
echo.
echo  [CHECK] Checking models...
ollama list 2>nul | findstr "qwen2.5:7b" >nul 2>&1
if errorlevel 1 (
    echo  [PULL] Downloading qwen2.5:7b (4.7 GB, one-time)...
    ollama pull qwen2.5:7b
)
ollama list 2>nul | findstr "nomic-embed-text" >nul 2>&1
if errorlevel 1 (
    echo  [PULL] Downloading nomic-embed-text (274 MB, one-time)...
    ollama pull nomic-embed-text
)
echo  [OK] Models ready

:: ── 8. LAUNCH ──
echo.
echo  ============================================================
echo     MyAi is starting...
echo     Opening http://localhost:8001 in your browser
echo     Press Ctrl+C to stop
echo  ============================================================
echo.

:: Open browser after a short delay
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:8001"

:: Start server
python -m app.main --web-only
