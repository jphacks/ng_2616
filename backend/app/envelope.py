"""ApiResponse envelope shared with the frontend (spec §5)."""

import uuid
from typing import Any

from fastapi.responses import JSONResponse


def ok(data: Any, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        {"ok": True, "request_id": str(uuid.uuid4()), "data": data},
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )


def fail(code: str, message: str, status_code: int, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        {"ok": False, "request_id": str(uuid.uuid4()), "error": {"code": code, "message": message, "retryable": retryable}},
        status_code=status_code,
        headers={"Cache-Control": "private, no-store"},
    )
