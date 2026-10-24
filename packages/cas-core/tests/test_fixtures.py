"""Runs the shared CAS oracle cases (emitted by `pnpm contracts:emit`) through the rules."""

import json
from pathlib import Path

import pytest

from cas_core.api import verify

FIXTURES = Path(__file__).resolve().parents[2] / "contracts" / "json" / "cas-fixtures.json"
CASES = json.loads(FIXTURES.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_case(case):
    proof = verify(case["payload"])
    exp = case["expect"]
    keys = ("status", "goal", "method", "reason", "category", "conditions", "evidence", "unverified_ancestors")
    shown = json.dumps({k: proof.get(k) for k in keys}, ensure_ascii=False)[:1500]
    context = f"{case['id']} ({case['note']}): {shown}"
    assert proof["status"] == exp["status"], context
    for key in ("reason", "category", "method"):
        if key in exp:
            assert proof.get(key) == exp[key], context
    if "unverified_ancestors" in exp:
        assert proof["unverified_ancestors"] == exp["unverified_ancestors"], context
    for key in ("missing", "extra"):
        if key in exp:
            got = [x for ev in proof["evidence"] for x in ev.get(key, [])]
            assert got == exp[key], context
    if proof["status"] == "wrong":
        assert proof["evidence"], f"wrong without evidence: {context}"
        assert len(proof["hints"]) == 2, context
    assert "_trace" not in proof, proof.get("_trace")
