# Math Notebook backend. Non-root UID 10001, no-new-privileges and dropped capabilities are set
# in compose.yaml (spec §17.2).
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home app \
  && mkdir -p /var/lib/math-notebook && chown 10001:10001 /var/lib/math-notebook
USER 10001:10001
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
