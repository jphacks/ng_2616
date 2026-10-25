"""Source building and message reading, without Lean (messages shaped like the REPL's)."""

import pytest

from lean_worker.source import SourceRejected, axioms_ok, build, marker, read_messages


def info(line: int, data: str) -> dict:
    return {"severity": "info", "pos": {"line": line, "column": 2}, "data": data}


def error(line: int, data: str) -> dict:
    return {"severity": "error", "pos": {"line": line, "column": 2}, "data": data}


def test_build_indents_steps_and_adds_markers():
    src = build("∀ n : ℕ, n + 0 = n", ["intro n", "", "  simp\n  rfl"])
    lines = src.text.splitlines()
    assert lines[0] == "set_option autoImplicit false in theorem mn_goal : ∀ n : ℕ, n + 0 = n := by"
    assert lines[1] == "  intro n"
    assert lines[2] == f'  trace "{marker(0)}"'
    assert lines[3:5] == ["  simp", "  rfl"]
    assert src.ranges == [(2, 2), None, (4, 5)]
    assert src.markers == [3, None, 6]


def test_statement_on_several_lines_becomes_one():
    src = build("∀ n : ℕ,\n  n = n", [])
    assert src.text.splitlines()[0] == "set_option autoImplicit false in theorem mn_goal : ∀ n : ℕ, n = n := by"


@pytest.mark.parametrize(
    "step",
    [
        "sorry",
        "exact sorry",
        "admit",
        "native_decide",
        "#eval IO.println 1",
        "run_tac pure ()",
        "exact (by_elab pure (Lean.mkConst ``True))",
        "set_option debug.skipKernelTC true in simp",
        "open IO in rfl",
        "exact _root_.IO.println",
        "trace \"⟪mn:3⟫\"",
        "/- hidden -/ simp",
        "@[simp] theorem x : True := trivial",
    ],
)
def test_screening_rejects_anything_but_proof(step):
    with pytest.raises(SourceRejected):
        build("True", [step])


def test_screening_allows_ordinary_tactics():
    build(
        "∀ ε : ℝ, ε > 0 → ∃ δ : ℝ, δ > 0 ∧ ∀ x : ℝ, |x - 2| < δ → |x ^ 2 - 4| < ε",
        [
            "intro ε hε",
            "refine ⟨min 1 (ε / 5), by positivity, ?_⟩",
            "have h : |x - 2| < 1 := lt_of_lt_of_le hx (min_le_left _ _)",
            "nlinarith [abs_nonneg (x - 2), Finset.sum_range_succ (fun i => i) n]",
            "rw [Metric.ball] at h -- a comment",
        ],
    )


def test_comment_in_statement_is_rejected():
    with pytest.raises(SourceRejected):
        build("True -- := by trivial", [])


def test_all_steps_reached_and_no_goals_is_proved():
    src = build("True", ["trivial"])
    r = read_messages(src, [info(3, marker(0))])
    assert r.state == "proved"
    assert [s.state for s in r.steps] == ["ok"]


def test_unsolved_goals_at_by_is_incomplete():
    src = build("∀ n : ℕ, n = n", ["intro n"])
    r = read_messages(src, [info(3, marker(0)), error(1, "unsolved goals\nn : ℕ\n⊢ n = n")])
    assert r.state == "incomplete"
    assert r.goals == "n : ℕ\n⊢ n = n"
    assert r.steps[0].state == "ok"


def test_failing_step_is_mapped_and_later_steps_unchecked():
    src = build("∀ n : ℕ, n = n", ["intro n", "linarith", "rfl"])
    r = read_messages(src, [info(3, marker(0)), error(4, "linarith failed to find a contradiction")])
    assert r.state == "failed"
    assert [s.state for s in r.steps] == ["ok", "failed", "unchecked"]
    assert r.steps[1].messages == ["linarith failed to find a contradiction"]


def test_recovered_nested_failure_keeps_later_steps_checked():
    src = build("1 = 1", ["have h : (2 : ℕ) = 3 := by omega", "rfl"])
    r = read_messages(src, [error(2, "omega could not prove the goal"), info(3, marker(0)), info(5, marker(1))])
    assert [s.state for s in r.steps] == ["failed", "ok"]
    assert r.state == "failed"


def test_statement_error_is_invalid():
    src = build("x = 1", [])
    r = read_messages(src, [error(1, "unknown identifier 'x'")])
    assert r.state == "invalid"
    assert "unknown identifier" in (r.statement_error or "")


def test_step_whose_marker_never_ran_failed():
    src = build("True", ["simp", "trivial"])
    r = read_messages(src, [])
    assert [s.state for s in r.steps] == ["failed", "unchecked"]


def test_axioms():
    assert axioms_ok([{"severity": "info", "data": "'mn_goal' depends on axioms: [propext, Classical.choice, Quot.sound]"}])
    assert axioms_ok([{"severity": "info", "data": "'mn_goal' does not depend on any axioms"}])
    assert not axioms_ok([{"severity": "info", "data": "'mn_goal' depends on axioms: [propext, sorryAx]"}])
    assert not axioms_ok([{"severity": "info", "data": "'mn_goal' depends on axioms: [Lean.ofReduceBool]"}])
    assert not axioms_ok([])
