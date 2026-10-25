"""Tests for integral algebraic rewrites such as partial fraction decomposition."""

from cas_core.api import verify


def test_definite_integral_partial_fractions():
    # Line 1: \int_2^3 \frac{1}{x(x+1)} dx
    c_ir = ["Integrate", ["Divide", 1, ["Multiply", "x", ["Add", "x", 1]]], ["Tuple", "x", 2, 3]]
    # Line 2: = \int_2^3 (\frac{1}{x} - \frac{1}{x+1}) dx
    w_ir = ["Integrate", ["Subtract", ["Divide", 1, "x"], ["Divide", 1, ["Add", "x", 1]]], ["Tuple", "x", 2, 3]]

    payload = {
        "parent_id": "L1",
        "lines": [{
            "id": "L1",
            "role": "step",
            "status": "ok",
            "segments": [{"type": "math", "expr": c_ir, "notation": "plain"}],
            "unverified_ancestors": [],
            "segment_results": [{"segment_index": 0, "status": "ok"}],
        }],
        "target": {
            "id": "L2",
            "role": "step",
            "segments": [{"type": "math", "expr": w_ir, "notation": "continuation"}],
        },
    }

    res = verify(payload)
    assert res["status"] == "ok"
    assert res["goal"] == "EXPRESSION_EQUIVALENCE"
    assert res["method"] == "sym"


def test_definite_integral_wrong_partial_fractions():
    # Line 1: \int_2^3 \frac{1}{x(x+1)} dx
    c_ir = ["Integrate", ["Divide", 1, ["Multiply", "x", ["Add", "x", 1]]], ["Tuple", "x", 2, 3]]
    # Line 2 (wrong sign): = \int_2^3 (\frac{1}{x} + \frac{1}{x+1}) dx
    w_wrong = ["Integrate", ["Add", ["Divide", 1, "x"], ["Divide", 1, ["Add", "x", 1]]], ["Tuple", "x", 2, 3]]

    payload = {
        "parent_id": "L1",
        "lines": [{
            "id": "L1",
            "role": "step",
            "status": "ok",
            "segments": [{"type": "math", "expr": c_ir, "notation": "plain"}],
            "unverified_ancestors": [],
            "segment_results": [{"segment_index": 0, "status": "ok"}],
        }],
        "target": {
            "id": "L2",
            "role": "step",
            "segments": [{"type": "math", "expr": w_wrong, "notation": "continuation"}],
        },
    }

    res = verify(payload)
    assert res["status"] == "wrong"
