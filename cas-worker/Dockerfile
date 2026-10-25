# Math Notebook cas-worker: packages/cas-core (the same rules the browser ran in Pyodide) behind
# FastAPI. Build context is the repository root (see Dockerfile.dockerignore). Non-root UID 10001;
# backend/compose.azure.yaml drops capabilities and sets no-new-privileges.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home app
WORKDIR /app
COPY cas-worker/pyproject.toml cas-worker/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY packages/cas-core/cas_core ./cas_core
COPY cas-worker/cas_worker ./cas_worker
USER 10001:10001
EXPOSE 8200
CMD ["/app/.venv/bin/uvicorn", "cas_worker.main:app", "--host", "0.0.0.0", "--port", "8200", "--workers", "1"]
