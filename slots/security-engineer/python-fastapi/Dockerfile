FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=3000 \
    CONTRACT_DIR=/contract

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY pyproject.toml ./
COPY app ./app
COPY tests ./tests

# contract/ is needed at runtime for `migrate` and `seed`.
# Build from the repo root:  docker build -f slots/backend-developer/python-fastapi/Dockerfile .
# or bind-mount it:          -v "$PWD/contract:/contract:ro"

EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3000/health').status==200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
