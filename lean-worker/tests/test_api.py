"""HTTP behaviour without Lean: the worker key, and a REPL that answers like Lean does."""

import pytest
from fastapi.testclient import TestClient

from lean_worker.main import create_app
from lean_worker.settings import get_settings
from lean_worker.source import marker

KEY = "k" * 48


class FakeRepl:
    """Accepts every step (its marker runs) and closes the goal; #print axioms is standard."""

    ready = True
    last_error = None

    def start(self):
        pass

    def kill(self):
        pass

    def run(self, source, timeout_s, then=None):
        infos = []
        for i, ln in enumerate(source.splitlines()):
            if "⟪mn:" in ln:
                step = int(ln.split("⟪mn:")[1].split("⟫")[0])
                infos.append({"severity": "info", "pos": {"line": i + 1, "column": 2}, "data": marker(step)})
        axioms = {"messages": [{"severity": "info", "data": "'mn_goal' depends on axioms: [propext]"}]}
        return {"env": 1, "messages": infos}, axioms


@pytest.fixture(autouse=True)
def fresh_settings():
    # settings are cached; the next test module must not inherit this one's environment
    yield
    get_settings.cache_clear()


def client(monkeypatch, **env) -> TestClient:
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    return TestClient(create_app(repl=FakeRepl(), warm=False))


def check(c: TestClient, headers=None):
    return c.post("/check", json={"statement": "True", "steps": ["trivial"]}, headers=headers or {})


def test_local_development_needs_no_key(monkeypatch):
    r = check(client(monkeypatch, APP_ENV="local", LEAN_WORKER_KEY=""))
    assert r.status_code == 200
    assert r.json()["data"]["state"] == "proved"


def test_outside_local_a_worker_without_a_key_refuses_to_check(monkeypatch):
    r = check(client(monkeypatch, APP_ENV="production", LEAN_WORKER_KEY=""))
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "LEAN_KEY_NOT_CONFIGURED"


def test_a_configured_key_is_required(monkeypatch):
    c = client(monkeypatch, APP_ENV="production", LEAN_WORKER_KEY=KEY)
    assert check(c).status_code == 403
    assert check(c, {"x-lean-key": "wrong"}).status_code == 403
    assert check(c, {"x-lean-key": KEY}).status_code == 200


def test_health_is_public_and_says_whether_lean_is_ready(monkeypatch):
    r = client(monkeypatch, APP_ENV="production", LEAN_WORKER_KEY=KEY).get("/health")
    assert r.status_code == 200
    assert r.json()["data"]["lean_ready"] is True
