"""Mathematical context for a target line (spec §9.1): assumptions, definitions, bindings, facts.

The context is rebuilt from the active lines before the target on every call, so results never
depend on hidden state in the worker. Since v2.2 there is no problem card: assumptions ("m > 0",
"n \\in \\mathbb{Z}^{+}", "\\psi(x) \\ne 0") and function declarations ("\\Psi(x,t)") are lines,
recognised by their shape whether or not the line is marked as given.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .ir import CONSTANTS, RELATION_HEADS, CasIncomplete, CasUnreadable, CasUnsupported, Env, ir_symbols, is_node, to_sympy


def is_relation(e: Any) -> bool:
    return is_node(e) and e[0] in RELATION_HEADS


@dataclass
class Fact:
    line_id: str
    seg_index: int
    ir: Any
    status: str
    role: str
    order: int  # document position; larger = more recent
    is_definition: bool = False


@dataclass
class Context:
    env: Env
    facts: list[Fact] = field(default_factory=list)
    line_status: dict[str, str] = field(default_factory=dict)
    line_unverified: dict[str, list[str]] = field(default_factory=dict)
    known_names: set[str] = field(default_factory=set)
    def_names: set[str] = field(default_factory=set)
    parent_id: str | None = None


def _is_symbol_ir(e: Any) -> bool:
    return isinstance(e, str)


def _apply_target(lhs: Any) -> tuple[str, list[str]] | None:
    """[Apply, f, x, t] with distinct symbol arguments -> ("f", ["x", "t"])."""
    if is_node(lhs) and lhs[0] == "Apply":
        args = lhs[2:]
        if all(isinstance(a, str) for a in args) and len(set(args)) == len(args):
            return lhs[1], list(args)
    return None


def register_definition(ir: Any, line_id: str, ctx: Context) -> bool:
    env = ctx.env
    if not (is_node(ir) and ir[0] == "Equal" and ir[2] is not None):
        return False
    lhs, rhs = ir[1], ir[2]
    try:
        app = _apply_target(lhs)
        if app:
            name, args = app
            if not args:
                args = env.functions.get(name, [])
            if not args:
                return False
            body = to_sympy(rhs, env)
            env.fn_defs[name] = (sp.Lambda(tuple(env.sym(a) for a in args), body), line_id)
            ctx.def_names.add(name)
            return True
        if _is_symbol_ir(lhs):
            env.sym_defs[lhs] = (to_sympy(rhs, env), line_id)
            ctx.def_names.add(lhs)
            return True
    except (CasUnsupported, CasUnreadable, CasIncomplete, TypeError, ValueError):
        return False
    return False


def register_binding(ir: Any, line_id: str, ctx: Context, result: dict) -> None:
    """Bindings come only from ok segments that uniquely express unknown = expr (spec §9.1)."""
    env = ctx.env
    if not (is_node(ir) and ir[0] == "Equal" and ir[2] is not None):
        return
    lhs, rhs = ir[1], ir[2]
    try:
        app = _apply_target(lhs)
        if app and result.get("method") == "sub":
            name, args = app
            if not args:
                args = env.functions.get(name, [])
            if name in env.fn_defs or not args:
                return
            env.fn_defs[name] = (sp.Lambda(tuple(env.sym(a) for a in args), to_sympy(rhs, env)), line_id)
            return
        if _is_symbol_ir(lhs):
            name = lhs
            if name in env.sym_defs or name in env.independent or name in env.functions:
                return
            if name in ir_symbols(rhs):
                return
            env.sym_defs[name] = (to_sympy(rhs, env), line_id)
    except (CasUnsupported, CasUnreadable, CasIncomplete, TypeError, ValueError):
        return


def _flatten(ir: Any) -> list[Any]:
    if is_node(ir) and ir[0] == "And":
        return [p for a in ir[1:] for p in _flatten(a)]
    return [ir]


# ---------------------------------------------------------------- declarations

SET_KINDS = {
    "PositiveIntegers": "positive_integer",
    "NaturalNumbers": "nonnegative_integer",
    "Integers": "integer",
    "Reals": "real",
}


def function_declaration(ir: Any) -> tuple[str, list[str]] | None:
    """A formula that is only f(x, t) with distinct variables declares f."""
    if is_node(ir) and ir[0] == "Apply" and len(ir) > 2:
        args = ir[2:]
        if all(isinstance(a, str) and a not in CONSTANTS for a in args) and len(set(args)) == len(args):
            return ir[1], list(args)
    return None


def _var(e: Any) -> bool:
    return isinstance(e, str) and e not in CONSTANTS


def _assumption(ir: Any) -> dict | None:
    if not is_node(ir) or len(ir) != 3:
        return None
    h, a, b = ir
    if h == "Element" and _var(a) and b in SET_KINDS:
        return {"symbol": a, "kind": SET_KINDS[b]}
    if h == "NotEqual" and b == 0 and (_var(a) or (is_node(a) and a[0] == "Apply")):
        return {"symbol": a, "kind": "nonzero"} if _var(a) else {"kind": "nonzero", "expr": a}
    if (h, b) in (("Greater", 0), ("GreaterEqual", 0)) and _var(a):
        return {"symbol": a, "kind": "positive" if h == "Greater" else "nonnegative"}
    if (h, a) in (("Less", 0), ("LessEqual", 0)) and _var(b):
        return {"symbol": b, "kind": "positive" if h == "Less" else "nonnegative"}
    return None


def assumptions_of(ir: Any) -> list[dict] | None:
    """The assumptions a formula states, or None when it is not purely assumptions.

    Recognised: x > 0, x >= 0 (either way round), x != 0, f(x) != 0, x in a number set,
    lo <= x <= hi, and comma lists of these.
    """
    one = _assumption(ir)
    if one is not None:
        return [one]
    if not (is_node(ir) and ir[0] == "And"):
        return None
    parts = ir[1:]
    if len(parts) == 2 and all(is_node(p) and p[0] in ("Less", "LessEqual") for p in parts):
        (_, lo, x1), (_, x2, hi) = parts
        if _var(x1) and x1 == x2:
            return [{"symbol": x1, "kind": "interval", "lower": lo, "upper": hi}]
    out: list[dict] = []
    for p in parts:
        a = _assumption(p)
        if a is None:
            return None
        out.append(a)
    return out


def declaration_kind(ir: Any) -> str | None:
    """"FUNCTION" or "ASSUMPTION" for a declaring formula, else None."""
    if function_declaration(ir):
        return "FUNCTION"
    if assumptions_of(ir) is not None:
        return "ASSUMPTION"
    return None


def _declare(lines: list[dict], env: Env) -> set[tuple[str, int]]:
    """Registers every declaration in the lines; returns the (line id, segment) pairs that declare."""
    found: set[tuple[str, int]] = set()
    assumptions: list[dict] = []
    for line in lines:
        for i, seg in enumerate(line.get("segments") or []):
            if seg.get("type") != "math" or seg.get("notation") == "continuation":
                continue
            fn = function_declaration(seg["expr"])
            if fn:
                env.functions.setdefault(fn[0], fn[1])
                env.independent |= set(fn[1])
                found.add((line["id"], i))
                continue
            stated = assumptions_of(seg["expr"])
            if stated is not None:
                assumptions += stated
                found.add((line["id"], i))
    for a in assumptions:
        if "symbol" in a and a["kind"] != "interval":
            env.assumptions[a["symbol"]] = a["kind"]
    for a in assumptions:
        try:
            if a["kind"] == "interval":
                lo = to_sympy(a["lower"], env, subst=False) if a["lower"] is not None else -sp.oo
                hi = to_sympy(a["upper"], env, subst=False) if a["upper"] is not None else sp.oo
                env.intervals[a["symbol"]] = (lo, hi)
            elif "expr" in a:
                env.nonzero.append(to_sympy(a["expr"], env, subst=False))
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            pass
    return found


def build_context(lines: list[dict], parent_id: str | None) -> Context:
    env = Env()
    ctx = Context(env=env, parent_id=parent_id)
    declaring = _declare(lines, env)

    order = 0
    for line in lines:
        lid = line["id"]
        ctx.line_status[lid] = line.get("status") or "unknown"
        ctx.line_unverified[lid] = list(line.get("unverified_ancestors") or [])
        results = {r["segment_index"]: r for r in line.get("segment_results") or []}
        for i, seg in enumerate(line.get("segments") or []):
            if seg.get("type") != "math" or (lid, i) in declaring:
                continue
            ir = seg["expr"]
            if line.get("role") == "premise" and seg.get("notation") != "continuation" and not is_relation(ir):
                continue  # "a particle in a box of width $L$": a given line's bare symbols state nothing
            ctx.known_names |= ir_symbols(ir)
            r = results.get(i, {})
            status = r.get("status") or line.get("status") or "unknown"
            is_def = line.get("role") == "definition" or r.get("reason") == "DEFINITION"
            if is_def:
                register_definition(ir, lid, ctx)
            elif status == "ok":
                register_binding(ir, lid, ctx, r)
            if seg.get("notation") == "continuation":
                # continuation segments are expressions, used only as parents of later continuations
                ctx.facts.append(Fact(lid, i, ir, status, line.get("role", "step"), order, is_def))
                continue
            for part in _flatten(ir):
                ctx.facts.append(Fact(lid, i, part, status, line.get("role", "step"), order, is_def))
        order += 1
    return ctx
