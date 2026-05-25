FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[full]"

COPY . .

RUN mkdir -p data/chroma data/uploads

EXPOSE 8001

CMD ["python", "-m", "app.main", "--web-only"]
