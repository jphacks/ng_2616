from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import get_settings

KEY = "k" * 48
USER = "00000000-0000-4000-8000-000000000001"


def client(monkeypatch) -> TestClient:
    monkeypatch.setenv("BACKEND_API_KEY", KEY)
    get_settings.cache_clear()
    return TestClient(create_app())


def test_health_is_public(monkeypatch):
    r = client(monkeypatch).get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["data"]["status"] == "ok"
    assert r.headers["cache-control"] == "private, no-store"


def test_capabilities_requires_internal_key(monkeypatch):
    c = client(monkeypatch)
    assert c.get("/api/v1/capabilities").status_code == 403
    assert c.get("/api/v1/capabilities", headers={"x-api-key": "wrong", "x-user-id": USER}).status_code == 403
    r = c.get("/api/v1/capabilities", headers={"x-api-key": KEY, "x-user-id": USER})
    assert r.status_code == 200
    assert r.json()["data"]["cas_runtime"] == "pyodide"


def test_jobs_not_implemented_yet(monkeypatch):
    r = client(monkeypatch).post("/api/v1/recognize", headers={"x-api-key": KEY, "x-user-id": USER}, json={})
    assert r.status_code == 501
    assert r.json()["error"]["code"] == "FEATURE_DISABLED"
