"""Worker entry point. The browser CAS controller calls verify_json() with validated IR only.

Payload:
  {"problem": Problem, "lines": [ContextLine], "target": Target, "parent_id": str | None}
ContextLine:
  {"id", "role", "segments": [InputSegment], "status", "unverified_ancestors": [id],
   "segment_results": [{"segment_index", "status", "reason"?, "method"?, "goal"?}]}
Returns the Proof fields the CAS owns; the controller adds input_hash, mock and cas versions.
"""

from __future__ import annotations

import json
import time
import traceback

import sympy

from . import RULES_VERSION
from .checks import SegResult, verify_segment
from .context import build_context
from .hints import hints_for

ORDER = ("wrong", "unknown", "ok", "none")


def _seg_dict(index: int, r: SegResult) -> dict:
    d = {
        "segment_index": index,
        "status": r.status,
        "goal": r.goal,
        "method": r.method,
        "reason": r.reason,
        "category": r.category,
        "conditions": r.conditions,
        "evidence": r.evidence,
        "source_line_id": r.source_line_id,
    }
    return {k: v for k, v in d.items() if v is not None}


def verify(payload: dict) -> dict:
    t0 = time.perf_counter()
    try:
        ctx = build_context(payload["problem"], payload.get("lines") or [], payload.get("parent_id"))
        target = payload["target"]
        results: list[tuple[int, SegResult]] = []
        for i, seg in enumerate(target.get("segments") or []):
            if seg.get("type") != "math":
                continue
            results.append((i, verify_segment(seg["expr"], seg.get("notation", "plain"), target.get("role", "step"), ctx)))
        if not results:
            primary = SegResult("none", reason="TEXT_ONLY")
        else:
            agg = next(s for s in ORDER if any(r.status == s for _, r in results))
            primary = next(r for _, r in results if r.status == agg)
        depends: set[str] = set()
        for _, r in results:
            depends |= r.depends_on
            if r.source_line_id:
                depends.add(r.source_line_id)
        depends.discard("problem")
        depends.discard(target.get("id"))
        unverified: set[str] = set()
        for d in depends:
            if ctx.line_status.get(d) == "unknown":
                unverified.add(d)
            unverified |= set(ctx.line_unverified.get(d, []))
        proof = {
            "status": primary.status,
            "goal": primary.goal,
            "method": primary.method,
            "reason": primary.reason,
            "category": primary.category,
            "conditions": [c for _, r in results for c in r.conditions],
            "evidence": primary.evidence,
            "hints": hints_for(primary.category, primary.source_line_id) if primary.status == "wrong" else [],
            "segment_results": [_seg_dict(i, r) for i, r in results],
            "depends_on": sorted(depends),
            "depends_on_unverified": bool(unverified),
            "unverified_ancestors": sorted(unverified),
        }
    except Exception as e:  # noqa: BLE001 - any engine failure is an honest unknown, never a red error
        proof = {
            "status": "unknown",
            "reason": "CAS_ERROR",
            "conditions": [f"{type(e).__name__}: {e}"[:300]],
            "evidence": [],
            "hints": [],
            "segment_results": [],
            "depends_on": [],
            "depends_on_unverified": False,
            "unverified_ancestors": [],
            "_trace": traceback.format_exc()[-2000:],
        }
    proof = {k: v for k, v in proof.items() if v is not None}
    proof["elapsed_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    proof["rules_version"] = RULES_VERSION
    return proof


def verify_json(payload_json: str) -> str:
    return json.dumps(verify(json.loads(payload_json)))


def versions() -> dict:
    import mpmath

    return {"sympy": sympy.__version__, "mpmath": mpmath.__version__, "rules": RULES_VERSION}
