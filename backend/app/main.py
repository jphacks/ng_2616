"""FastAPI app factory. One container, one uvicorn worker, one job dispatcher (spec §7.2)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError

from .api.v1 import router
from .envelope import fail
from .jobs.store import JobStore
from .settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # Stage 2: open SQLite (WAL), fail jobs left running with WORKER_RESTARTED, start the dispatcher.
    app.state.jobs = JobStore(settings.job_db_path) if settings.app_env != "local" else None
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Math Notebook API", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.include_router(router)

    @app.exception_handler(HTTPException)
    async def http_error(_req: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "ERROR", "message": str(exc.detail)}
        return fail(detail.get("code", "ERROR"), detail.get("message", ""), exc.status_code, bool(detail.get("retryable")))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_req: Request, exc: RequestValidationError):
        return fail("INVALID_REQUEST", str(exc.errors()[:3]), 400)

    return app


app = create_app()
