"""MyAi First-Run Setup — Interactive setup for new users.

Run with: python setup.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
ENV_FILE = ROOT / ".env"
ENV_EXAMPLE = ROOT / ".env.example"
WORKSPACE = ROOT / "app" / "workspace"
DATA_DIR = ROOT / "data"


def bold(text: str) -> str:
    return f"\033[1m{text}\033[0m"


def green(text: str) -> str:
    return f"\033[92m{text}\033[0m"


def yellow(text: str) -> str:
    return f"\033[93m{text}\033[0m"


def main():
    print()
    print(bold("=" * 60))
    print(bold("  MyAi — Personal AI Agent Setup"))
    print(bold("=" * 60))
    print()

    # Step 1: Check Ollama
    print(bold("[1/5] Checking Ollama..."))
    ollama_path = shutil.which("ollama")
    if not ollama_path:
        print(yellow("  WARNING: 'ollama' not found in PATH."))
        print("  Install from: https://ollama.com")
        print("  MyAi needs Ollama running locally for the LLM.")
        print()
    else:
        print(green(f"  Found: {ollama_path}"))
        print()

    # Step 2: Collect user info
    print(bold("[2/5] Your Identity"))
    print("  (This personalizes your AI assistant)")
    print()
    name = input("  Your name: ").strip()
    email = input("  Your email: ").strip()
    role = input("  Your role (e.g. 'Software Engineer at Acme'): ").strip()
    phone = input("  Your phone (with country code, e.g. +919876543210, or leave blank): ").strip()
    print()

    # Step 3: Create .env
    print(bold("[3/5] Creating .env configuration..."))
    if ENV_FILE.exists():
        overwrite = input("  .env already exists. Overwrite? [y/N]: ").strip().lower()
        if overwrite != "y":
            print("  Skipping .env creation.")
            print()
        else:
            _create_env(name, email, role, phone)
    else:
        _create_env(name, email, role, phone)
    print()

    # Step 4: Initialize workspace
    print(bold("[4/5] Setting up workspace..."))
    _setup_workspace(name, email, role)
    print()

    # Step 5: Create data directories
    print(bold("[5/5] Creating data directories..."))
    (DATA_DIR / "uploads").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "chroma").mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "journal").mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "diary").mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "skills" / "_staging").mkdir(parents=True, exist_ok=True)
    print(green("  Done."))
    print()

    # Pull Ollama models
    print(bold("Next steps:"))
    print()
    print("  1. Pull Ollama models (if not already done):")
    print("     ollama pull qwen2.5:7b")
    print("     ollama pull nomic-embed-text")
    print()
    print("  2. (Optional) For vision features:")
    print("     ollama pull llava:7b")
    print()
    print("  3. Start Ollama in a terminal:")
    print("     ollama serve")
    print()
    print("  4. Run MyAi:")
    print("     python -m app.main --web-only")
    print()
    print("  5. Open in browser:")
    print(f"     http://localhost:8001")
    print()
    print(green(bold("Setup complete!")))
    print()


def _create_env(name: str, email: str, role: str, phone: str):
    lines = ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
    replacements = {
        "MYAI_USER_NAME=Your Name": f"MYAI_USER_NAME={name}" if name else None,
        "MYAI_USER_EMAIL=you@example.com": f"MYAI_USER_EMAIL={email}" if email else None,
        "MYAI_USER_PHONE=+919876543210": f"MYAI_USER_PHONE={phone}" if phone else "MYAI_USER_PHONE=",
        "MYAI_USER_ROLE=Software Engineer": f"MYAI_USER_ROLE={role}" if role else None,
    }
    output = []
    for line in lines:
        replaced = False
        for old, new in replacements.items():
            if line.strip() == old and new:
                output.append(new)
                replaced = True
                break
        if not replaced:
            output.append(line)

    ENV_FILE.write_text("\n".join(output) + "\n", encoding="utf-8")
    print(green("  .env created."))


def _setup_workspace(name: str, email: str, role: str):
    user_md = WORKSPACE / "user.md"
    content = f"""# User

**Name:** {name or '(not set)'}
**Email:** {email or '(not set)'}
**Role:** {role or '(not set)'}

## Working style

- (Edit this file to tell MyAi about your preferences)
- (Example: "I prefer concise responses" or "Always use bullet points")

## Environment

- **OS:** {sys.platform}
- **Python:** {sys.version.split()[0]}
- **LLM:** Ollama (local)

## Things to remember

(This section is appended to by the dreaming/diary loop. Do not delete user
edits above this line.)

<!-- DREAMING_APPEND_BELOW -->
"""
    user_md.write_text(content, encoding="utf-8")
    print(green(f"  Workspace initialized: {user_md}"))


if __name__ == "__main__":
    main()
