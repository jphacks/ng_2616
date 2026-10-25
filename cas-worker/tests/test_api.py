"""HTTP behaviour: the worker key, limits, and every shared CAS oracle case through real processes."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cas_worker.main import create_app, rules_digest
from cas_worker.pool import CasBusy, CasPool, CasTimeout
from cas_worker.settings import get_settings

KEY = "k" * 48
FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "json" / "cas-fixtures.json"
CASES = json.loads(FIXTURES.read_text(encoding="utf-8"))


class FakePool:
    """Answers without SymPy; `raises` makes the next check fail the way the real pool would."""

    def __init__(self, raises=None):
        self.raises = raises
        self.versions = {"sympy": "1.14.0", "mpmath": "1.4.1", "rules": "2.0.0"}
        import threading

        self.ready = threading.Event()
        self.ready.set()

    def start(self):
        pass

    def stop(self):
        pass

    def verify(self, payload):
        if self.raises:
            raise self.raises
        return {"status": "ok", "segment_results": []}, 1.0


def client_for(monkeypatch, pool, env="production", key=KEY):
    monkeypatch.setenv("APP_ENV", env)
    monkeypatch.setenv("CAS_WORKER_KEY", key)
    get_settings.cache_clear()
    return TestClient(create_app(pool=pool, warm=False))


BODY = {"lines": [], "target": {"id": "t", "role": "step", "segments": []}, "parent_id": None}


def test_health_reports_versions_and_the_bundle_digest(monkeypatch):
    with client_for(monkeypatch, FakePool()) as c:
        data = c.get("/health").json()["data"]
    assert data["cas_ready"] is True
    assert data["versions"]["sympy"] == "1.14.0"
    assert data["versions"]["digest"] == rules_digest() and len(rules_digest()) == 16


def test_verify_requires_the_key(monkeypatch):
    with client_for(monkeypatch, FakePool()) as c:
        assert c.post("/verify", json=BODY).status_code == 403
        assert c.post("/verify", json=BODY, headers={"x-cas-key": "wrong"}).status_code == 403
        r = c.post("/verify", json=BODY, headers={"x-cas-key": KEY})
    assert r.status_code == 200 and r.json()["data"]["proof"]["status"] == "ok"


def test_without_a_key_only_local_runs_checks(monkeypatch):
    with client_for(monkeypatch, FakePool(), key="") as c:
        assert c.post("/verify", json=BODY).json()["error"]["code"] == "CAS_KEY_NOT_CONFIGURED"
    with client_for(monkeypatch, FakePool(), env="local", key="") as c:
        assert c.post("/verify", json=BODY).status_code == 200


@pytest.mark.parametrize(("error", "status", "code"), [(CasBusy(), 429, "CAS_BUSY"), (CasTimeout(), 504, "CAS_TIMEOUT")])
def test_pool_failures_map_to_codes(monkeypatch, error, status, code):
    with client_for(monkeypatch, FakePool(raises=error)) as c:
        r = c.post("/verify", json=BODY, headers={"x-cas-key": KEY})
    assert r.status_code == status and r.json()["error"]["code"] == code


def test_malformed_and_oversized_input_is_refused(monkeypatch):
    with client_for(monkeypatch, FakePool()) as c:
        assert c.post("/verify", json={"target": {}}, headers={"x-cas-key": KEY}).status_code == 400
        big = {**BODY, "lines": [{"pad": "x" * 600_000}]}
        assert c.post("/verify", json=big, headers={"x-cas-key": KEY}).status_code == 413


@pytest.fixture(scope="module")
def real():
    pool = CasPool(size=2, timeout_s=5.0, queue_wait_s=10.0, restart_after=500)
    pool.start()
    yield pool
    pool.stop()


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_oracle_case_through_http(monkeypatch, real, case):
    with client_for(monkeypatch, real) as c:
        r = c.post("/verify", json=case["payload"], headers={"x-cas-key": KEY})
    assert r.status_code == 200, r.text
    proof = r.json()["data"]["proof"]
    assert proof["status"] == case["expect"]["status"], (case["id"], proof)
    assert "_trace" not in proof


def test_a_runaway_check_is_killed_and_the_process_replaced():
    pool = CasPool(size=1, timeout_s=0.001, queue_wait_s=10.0, restart_after=500)
    pool.start()
    try:
        with pytest.raises(CasTimeout):
            pool.verify(CASES[0]["payload"])
        pool.timeout_s = 5.0
        # the replacement process takes the slot back and checks normally
        proof, _ = pool.verify(CASES[0]["payload"])
        assert proof["status"] == CASES[0]["expect"]["status"]
    finally:
        pool.stop()
