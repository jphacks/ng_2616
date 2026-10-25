"""HTTP face of the worker: GET /health and POST /verify.

Only the Next.js gateway calls this, over a private network. It runs packages/cas-core on the
validated IR the browser used to hand its Pyodide worker, with the same five-second budget.
"""

import hashlib
import hmac
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cas_core
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .pool import CasBusy, CasFailed, CasPool, CasTimeout
from .settings import Settings, get_settings

MAX_BODY_BYTES = 512 * 1024


def ok(data: Any) -> JSONResponse:
    return JSONResponse({"ok": True, "request_id": str(uuid.uuid4()), "data": data}, headers={"Cache-Control": "private, no-store"})


def fail(code: str, message: str, status_code: int, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        {"ok": False, "request_id": str(uuid.uuid4()), "error": {"code": code, "message": message, "retryable": retryable}},
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


def rules_digest() -> str:
    """The digest packages/cas-core/build.mjs gives the browser bundle, so versions compare."""
    src = Path(cas_core.__file__).parent
    h = hashlib.sha256()
    for f in sorted(p.name for p in src.glob("*.py")):
        h.update(f.encode())
        h.update((src / f).read_text(encoding="utf-8").encode())
    return h.hexdigest()[:16]


class VerifyInput(BaseModel):
    # cas_core.api.verify reads these keys; their contents are IR, translated by dispatch, never eval
    model_config = ConfigDict(extra="allow")
    lines: list[dict[str, Any]]
    target: dict[str, Any]
    parent_id: str | None = None


def require_key(x_cas_key: str = Header(default=""), settings: Settings = Depends(get_settings)) -> None:
    expected = settings.cas_worker_key
    # off loopback development, a worker without a key would run anyone's checks: refuse instead
    if not expected and settings.app_env != "local":
        detail = {"code": "CAS_KEY_NOT_CONFIGURED", "message": "set CAS_WORKER_KEY outside APP_ENV=local"}
        raise HTTPException(status_code=503, detail=detail)
    if expected and not hmac.compare_digest(x_cas_key.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail={"code": "CAS_KEY_INVALID", "message": "invalid worker key"})


def create_app(pool: CasPool | None = None, warm: bool = True) -> FastAPI:
    settings = get_settings()
    # a pool handed in (tests) belongs to the caller, who starts and stops it
    owned = pool is None
    pool = pool or CasPool(settings.pool_size, settings.check_timeout_s, settings.queue_wait_s, settings.restart_after)
    digest = rules_digest()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if warm:
            threading.Thread(target=pool.start, daemon=True).start()
        yield
        if owned:
            pool.stop()

    app = FastAPI(title="Math Notebook CAS worker", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def bound_input(request: Request, call_next):
        if int(request.headers.get("content-length") or 0) > MAX_BODY_BYTES:
            return fail("PAYLOAD_TOO_LARGE", "CAS input too large", 413)
        return await call_next(request)

    @app.exception_handler(HTTPException)
    async def http_error(_req: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "ERROR", "message": str(exc.detail)}
        return fail(detail.get("code", "ERROR"), detail.get("message", ""), exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_req: Request, _exc: RequestValidationError):
        return fail("INVALID_REQUEST", "invalid CAS request", 400)

    @app.get("/health")
    def health():
        ready = pool.ready.is_set()
        return ok({"status": "ok", "cas_ready": ready, "versions": {**pool.versions, "digest": digest} if ready else None})

    @app.post("/verify", dependencies=[Depends(require_key)])
    def verify(body: VerifyInput):
        if not pool.ready.is_set():
            return fail("CAS_STARTING", "the checker is starting", 503, retryable=True)
        try:
            proof, elapsed_ms = pool.verify(body.model_dump())
        except CasBusy:
            return fail("CAS_BUSY", "the checker is busy", 429, retryable=True)
        except CasTimeout:
            return fail("CAS_TIMEOUT", "check exceeded its time budget", 504)
        except CasFailed:
            return fail("CAS_ERROR", "the check failed", 500, retryable=True)
        return ok({"proof": proof, "elapsed_ms": round(elapsed_ms, 1)})

    return app


app = create_app()
