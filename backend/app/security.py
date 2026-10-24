"""Internal authentication between the Next.js gateway and this service (spec §4.2).

The gateway validates the user's JWT with Supabase and forwards only a server-held API key and
the validated user id. This service never sees browser credentials.
"""

import hmac
import uuid

from fastapi import Depends, Header, HTTPException, status

from .settings import Settings, get_settings


def _error(code: str, message: str, http: int) -> HTTPException:
    return HTTPException(status_code=http, detail={"code": code, "message": message, "retryable": False})


def require_internal(
    x_api_key: str = Header(default=""),
    x_user_id: str = Header(default=""),
    settings: Settings = Depends(get_settings),
) -> str:
    """Returns the trusted owner id for the request."""
    expected = settings.backend_api_key
    if not expected or not hmac.compare_digest(x_api_key.encode(), expected.encode()):
        raise _error("BACKEND_KEY_INVALID", "invalid internal key", status.HTTP_403_FORBIDDEN)
    try:
        return str(uuid.UUID(x_user_id))
    except ValueError as e:
        raise _error("AUTH_REQUIRED", "missing user id", status.HTTP_401_UNAUTHORIZED) from e
