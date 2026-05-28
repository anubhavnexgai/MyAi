FROM python:3.11-slim

WORKDIR /app

# System dependencies for some Python packages (Pillow, pyautogui-related, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app/ ./app/
COPY web/ ./web/
COPY config/ ./config/
COPY pyproject.toml .env.example ./

# Pre-create data dirs (volumes will override these but we want defaults)
RUN mkdir -p data/uploads data/chroma app/workspace/journal app/workspace/diary

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8001/health || exit 1

EXPOSE 8001

# Default env — user can override via docker-compose env_file or -e
ENV HOST=0.0.0.0 \
    PORT=8001 \
    OLLAMA_BASE_URL=http://ollama:11434 \
    OLLAMA_MODEL=qwen2.5:7b \
    OLLAMA_EMBED_MODEL=nomic-embed-text \
    DATABASE_PATH=data/miai.db \
    CHROMA_PATH=data/chroma \
    PYTHONUNBUFFERED=1

CMD ["python", "-m", "app.main", "--web-only"]
