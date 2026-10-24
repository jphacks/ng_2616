import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.pdf.compiler import CompileError, compile_report
from app.reports_api import app
from app.settings import get_settings

KEY = "test-compiler-key-which-has-more-than-43-characters"
OWNER = "00000000-0000-4000-8000-000000000001"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("BACKEND_API_KEY", KEY)
    get_settings.cache_clear()
    with TestClient(app) as client:
        yield client
    get_settings.cache_clear()


def test_compiler_requires_both_internal_key_and_owner(client, monkeypatch):
    compile_mock = AsyncMock(return_value=b"%PDF-1.7\nexample")
    monkeypatch.setattr("app.reports_api.compile_report", compile_mock)
    assert client.post("/api/v1/reports/compile", json={"tex": "x"}).status_code == 403
    assert client.post("/api/v1/reports/compile", headers={"X-API-Key": KEY}, json={"tex": "x"}).status_code == 401
    compile_mock.assert_not_called()


def test_pdf_is_binary_and_never_cached(client, monkeypatch):
    monkeypatch.setattr("app.reports_api.compile_report", AsyncMock(return_value=b"%PDF-1.7\nexample"))
    response = client.post("/api/v1/reports/compile", headers={"X-API-Key": KEY, "X-User-Id": OWNER}, json={"tex": "x"})
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")
    assert response.headers["cache-control"] == "private, no-store"


def test_failed_compilation_does_not_expose_source_or_logs(client, monkeypatch):
    monkeypatch.setattr("app.reports_api.compile_report", AsyncMock(side_effect=CompileError("TEX_COMPILE_FAILED")))
    response = client.post("/api/v1/reports/compile", headers={"X-API-Key": KEY, "X-User-Id": OWNER}, json={"tex": "PRIVATE SOURCE"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "TEX_COMPILE_FAILED"
    assert "PRIVATE SOURCE" not in response.text


def test_input_limit_and_invalid_body(client):
    assert client.post("/api/v1/reports/compile", content=b"x" * (2 * 1024 * 1024 + 1)).status_code == 413
    response = client.post(
        "/api/v1/reports/compile", headers={"X-API-Key": KEY, "X-User-Id": OWNER}, json={"tex": "", "unexpected": "PRIVATE"}
    )
    assert response.status_code == 400
    assert "PRIVATE" not in response.text


def test_unavailable_compiler(monkeypatch):
    monkeypatch.setenv("LUALATEX_COMMAND", "not-a-real-lualatex-command")
    with pytest.raises(CompileError, match="TEX_COMPILER_UNAVAILABLE"):
        asyncio.run(compile_report("hello"))
