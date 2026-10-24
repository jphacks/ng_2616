"""HTTP face of the worker: GET /health and POST /check (ADR 0008).

Only the Next.js gateway (later the FastAPI backend) calls this, over loopback or a private
network. It holds no secrets and calls no model: it answers whether Lean accepts a proof.
"""

import hmac
import json
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .repl import Repl, ReplTimeout, ReplUnavailable
from .settings import Settings, get_settings
from .source import MAX_STEPS, THEOREM, SourceRejected, axioms_ok, build, read_messages


def ok(data: Any) -> JSONResponse:
    return JSONResponse({"ok": True, "request_id": str(uuid.uuid4()), "data": data}, headers={"Cache-Control": "private, no-store"})


def fail(code: str, message: str, status_code: int, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        {"ok": False, "request_id": str(uuid.uuid4()), "error": {"code": code, "message": message, "retryable": retryable}},
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


def versions(project: Path) -> dict[str, str]:
    toolchain = "unknown"
    mathlib = "unknown"
    try:
        toolchain = (project / "lean-toolchain").read_text(encoding="utf-8").strip().split(":")[-1]
        manifest = json.loads((project / "lake-manifest.json").read_text(encoding="utf-8"))
        pkg = next(p for p in manifest.get("packages", []) if p.get("name") == "mathlib")
        mathlib = str(pkg.get("inputRev") or pkg.get("rev", "unknown"))
    except (OSError, ValueError, StopIteration):
        pass
    return {"toolchain": toolchain, "mathlib": mathlib}


class CheckInput(BaseModel):
    # the proposition after `theorem mn_goal :`, e.g. "∀ n : ℕ, n + 0 = n"
    statement: str = Field(min_length=1, max_length=2000)
    # one tactic snippet per notebook line, run in order in one `by` block ("" for a line with none)
    steps: list[str] = Field(default_factory=list, max_length=MAX_STEPS)


def require_key(x_lean_key: str = Header(default=""), settings: Settings = Depends(get_settings)) -> None:
    expected = settings.lean_worker_key
    if expected and not hmac.compare_digest(x_lean_key.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail={"code": "LEAN_KEY_INVALID", "message": "invalid worker key"})


def create_app(repl: Repl | None = None, warm: bool = True) -> FastAPI:
    settings = get_settings()
    state: dict[str, Any] = {
        "repl": repl or Repl(settings.project, settings.lake_path, settings.import_timeout_s, settings.restart_after, settings.imports)
    }

    def warm_up() -> None:
        try:
            state["repl"].start()
        except ReplUnavailable as e:
            print(f"[lean] not ready: {e}", flush=True)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if warm:
            threading.Thread(target=warm_up, daemon=True).start()
        yield
        state["repl"].kill()

    app = FastAPI(title="Math Notebook Lean worker", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.exception_handler(HTTPException)
    async def http_error(_req: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "ERROR", "message": str(exc.detail)}
        return fail(detail.get("code", "ERROR"), detail.get("message", ""), exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_req: Request, exc: RequestValidationError):
        return fail("INVALID_REQUEST", str(exc.errors()[:3]), 400)

    @app.get("/health")
    def health():
        r: Repl = state["repl"]
        return ok({"status": "ok", "lean_ready": r.ready, "error": r.last_error, **versions(settings.project)})

    @app.post("/check", dependencies=[Depends(require_key)])
    def check(body: CheckInput):
        started = time.monotonic()
        meta = versions(settings.project)
        try:
            src = build(body.statement, body.steps)
        except SourceRejected as e:
            return ok({"state": "invalid", "steps": [], "statement_error": str(e), "rejected": True, "elapsed_ms": 0, **meta})
        try:
            first, second = state["repl"].run(src.text, settings.check_timeout_s, then=f"#print axioms {THEOREM}")
        except ReplTimeout:
            return ok({"state": "timeout", "steps": [], "elapsed_ms": round((time.monotonic() - started) * 1000), **meta})
        except ReplUnavailable as e:
            return fail("LEAN_UNAVAILABLE", str(e), 503, retryable=True)
        if "messages" not in first and "message" in first:
            # the REPL refused the command itself (it never reached Lean's elaborator)
            return ok({"state": "invalid", "steps": [], "statement_error": str(first["message"])[:2000], "elapsed_ms": 0, **meta})
        reading = read_messages(src, first.get("messages", []))
        state_name = reading.state
        if state_name == "proved" and not axioms_ok((second or {}).get("messages", [])):
            # Lean took it, but only through sorry or an axiom outside Lean's standard three
            state_name = "failed"
        return ok(
            {
                "state": state_name,
                "steps": [{"index": s.index, "state": s.state, "messages": [m[:1500] for m in s.messages]} for s in reading.steps],
                "goals": reading.goals[:2000] if reading.goals else None,
                "statement_error": reading.statement_error,
                "elapsed_ms": round((time.monotonic() - started) * 1000),
                **meta,
            }
        )

    return app


app = create_app()
