"""Real Lean + Mathlib (spec L9). Skipped unless the pinned project in ../lean is built.

The two proof templates' theorems (frontend/src/core/presets.ts) are proved here with reviewed
proofs written one step per notebook line, the way a student writes them. This records kernel
acceptance of a correct proof separately from any model's ability to produce one.
"""

import pytest
from fastapi.testclient import TestClient

from lean_worker.main import create_app
from lean_worker.repl import Repl, repl_binary
from lean_worker.settings import get_settings

ODD_SUM = "∀ n : ℕ, ∑ k ∈ Finset.range n, (2 * k + 1) = n ^ 2"
ODD_SUM_PROOF = [
    "intro n",  # "Let n be a natural number."
    "induction n",  # "We use induction on n."
    "simp",  # "Base case n = 0: the sum is empty, so it is 0 = 0²."
    "rename_i k ih",  # "Assume 1 + 3 + ⋯ + (2k − 1) = k²."
    "rw [Finset.sum_range_succ, ih]",  # "Then the sum up to 2k + 1 is k² + (2k + 1)."
    "ring",  # "k² + 2k + 1 = (k + 1)²"
]

LIMIT = "∀ ε : ℝ, ε > 0 → ∃ δ : ℝ, δ > 0 ∧ ∀ x : ℝ, |x - 2| < δ → |x ^ 2 - 4| < ε"
LIMIT_PROOF = [
    "intro ε hε",  # "Let ε > 0."
    "refine ⟨min 1 (ε / 5), by positivity, ?_⟩",  # "Choose δ = min(1, ε/5)."
    "intro x hx",  # "Let x satisfy |x − 2| < δ."
    "have h1 : |x - 2| < 1 := lt_of_lt_of_le hx (min_le_left _ _)\nhave h2 : |x - 2| < ε / 5 := lt_of_lt_of_le hx (min_le_right _ _)",
    "have h3 : |x + 2| < 5 := by\n  rw [abs_lt] at h1 ⊢\n  constructor <;> linarith [h1.1, h1.2]",  # "So |x + 2| < 5."
    "calc |x ^ 2 - 4| = |x - 2| * |x + 2| := by rw [← abs_mul]; congr 1; ring\n"
    "  _ < ε / 5 * 5 := mul_lt_mul'' h2 h3 (abs_nonneg _) (abs_nonneg _)\n"
    "  _ = ε := by ring",  # "Hence |x² − 4| = |x − 2||x + 2| < (ε/5)·5 = ε."
]

built = repl_binary(get_settings().project).exists()
pytestmark = [pytest.mark.lean, pytest.mark.skipif(not built, reason="Lean project not built (see docs/DEVELOPMENT.md)")]


@pytest.fixture(scope="module")
def client():
    s = get_settings()
    repl = Repl(s.project, s.lake_path, s.import_timeout_s, s.restart_after, s.imports)
    repl.start()
    with TestClient(create_app(repl=repl, warm=False)) as c:
        yield c
    repl.kill()


def check(client: TestClient, statement: str, steps: list[str]) -> dict:
    r = client.post("/check", json={"statement": statement, "steps": steps})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def states(data: dict) -> list[str]:
    return [s["state"] for s in data["steps"]]


def test_health_reports_ready(client):
    data = client.get("/health").json()["data"]
    assert data["lean_ready"] is True
    assert data["toolchain"].startswith("v4.")


def test_induction_template_is_proved(client):
    data = check(client, ODD_SUM, ODD_SUM_PROOF)
    assert data["state"] == "proved", data
    assert states(data) == ["ok"] * len(ODD_SUM_PROOF)


def test_limit_template_is_proved(client):
    data = check(client, LIMIT, LIMIT_PROOF)
    assert data["state"] == "proved", data
    assert states(data) == ["ok"] * len(LIMIT_PROOF)


def test_a_proof_in_progress_is_incomplete_with_its_goal(client):
    data = check(client, LIMIT, LIMIT_PROOF[:3])
    assert data["state"] == "incomplete", data
    assert states(data) == ["ok", "ok", "ok"]
    assert "|x ^ 2 - 4| < ε" in data["goals"]


def test_a_wrong_step_fails_on_its_own_line(client):
    steps = [*ODD_SUM_PROOF[:5], "have h : k ^ 2 + (2 * k + 1) = (k + 1) ^ 2 + 1 := by ring", "ring"]
    data = check(client, ODD_SUM, steps)
    assert data["state"] == "failed", data
    assert states(data)[:5] == ["ok"] * 5
    assert states(data)[5] == "failed"


def test_empty_steps_are_skipped(client):
    data = check(client, ODD_SUM, ["intro n", "", "induction n", "simp", "", "rename_i k ih", "rw [Finset.sum_range_succ, ih]", "ring"])
    assert data["state"] == "proved", data
    assert states(data)[1] == "empty" and states(data)[4] == "empty"


def test_a_false_statement_is_never_proved(client):
    for steps in (["intro n", "omega"], ["intro n", "simp"], ["intro n", "decide"]):
        data = check(client, "∀ n : ℕ, n = 0", steps)
        assert data["state"] != "proved", (steps, data)


def test_sorry_and_escape_hatches_are_refused_before_lean_runs(client):
    for step in ("sorry", "exact sorry", "native_decide", "#eval 1", "set_option debug.skipKernelTC true in rfl"):
        data = check(client, "1 = 1", [step])
        assert data["state"] == "invalid" and data.get("rejected"), (step, data)


def test_a_statement_lean_cannot_read_is_invalid(client):
    data = check(client, "∀ n : ℕ, n = undefined_thing", ["intro n"])
    assert data["state"] == "invalid", data
    assert data["statement_error"]
