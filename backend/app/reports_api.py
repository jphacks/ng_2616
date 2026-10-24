"""Dedicated compiler service. Does not switch handwriting/AI requests to Azure."""

import asyncio
import shutil
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from .envelope import fail
from .pdf.compiler import CompileError, compile_report
from .security import require_internal


@asynccontextmanager
async def lifespan(_app: FastAPI):
    seed = Path("/var/cache/luatex")
    cache = Path("/tmp/mn-texcache")
    if seed.is_dir() and not cache.exists():
        shutil.copytree(seed, cache)
    yield


app = FastAPI(title="Math Notebook LuaLaTeX compiler", docs_url=None, redoc_url=None, lifespan=lifespan)


class CompileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tex: str = Field(min_length=1, max_length=1024 * 1024)


@app.middleware("http")
async def bound_input(request: Request, call_next):
    # Bound streamed bodies even when Content-Length is missing or false.
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 2 * 1024 * 1024:
            return fail("PAYLOAD_TOO_LARGE", "report input too large", 413)
    request._body = bytes(data)
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store"
    return response


@app.exception_handler(HTTPException)
async def http_error(_request: Request, error: HTTPException):
    detail = error.detail if isinstance(error.detail, dict) else {}
    return fail(detail.get("code", "AUTH_REQUIRED"), detail.get("message", "request rejected"), error.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, _error: RequestValidationError):
    return fail("INVALID_REQUEST", "invalid report request", 400)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "service": "lualatex-compiler"}


@app.post("/api/v1/reports/compile")
async def compile_pdf(body: CompileInput, request: Request, _owner: str = Depends(require_internal)):
    task = asyncio.create_task(compile_report(body.tex))
    try:
        while not task.done():
            await asyncio.wait({task}, timeout=0.25)
            if await request.is_disconnected():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
                return Response(status_code=499)
        pdf = await task
    except CompileError as error:
        return fail(error.code, "report compilation did not complete", error.status, error.status in {429, 503, 504})
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="report.pdf"', "Cache-Control": "private, no-store"},
    )
