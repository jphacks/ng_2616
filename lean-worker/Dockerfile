# Math Notebook lean-worker (ADR 0008): the pinned Lean project with Mathlib's cache, its REPL, and
# the FastAPI checker. Non-root UID 10001; compose.yaml drops capabilities and sets no-new-privileges.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    ELAN_HOME=/opt/elan PATH=/opt/elan/bin:$PATH
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --create-home app \
  && mkdir -p /opt/elan /app && chown 10001:10001 /opt/elan /app
USER 10001:10001
WORKDIR /app

# toolchain from lean-toolchain, then Mathlib's prebuilt cache and the REPL (the slow, cached layer)
COPY --chown=10001:10001 lean/lean-toolchain lean/lakefile.toml lean/lake-manifest.json lean/
RUN curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh | sh -s -- -y --default-toolchain none \
  && cd lean && lake exe cache get && lake build repl

COPY --chown=10001:10001 pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY --chown=10001:10001 lean_worker ./lean_worker

ENV LEAN_PROJECT_DIR=/app/lean
EXPOSE 8100
CMD ["/app/.venv/bin/uvicorn", "lean_worker.main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
