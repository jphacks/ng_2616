"""Mathematical context for a target line (spec §9.1): assumptions, definitions, bindings, facts.

The context is rebuilt from the problem card and the active lines before the target on every
call, so results never depend on hidden state in the worker.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp

from .ir import CasIncomplete, CasUnreadable, CasUnsupported, Env, ir_symbols, is_node, to_sympy


@dataclass
class Fact:
    line_id: str  # "problem" for problem conditions
    seg_index: int
    ir: Any
    status: str
    role: str
    order: int  # document position; larger = more recent
    is_definition: bool = False


@dataclass
class Context:
    env: Env
    problem: dict
    facts: list[Fact] = field(default_factory=list)
    line_status: dict[str, str] = field(default_factory=dict)
    line_unverified: dict[str, list[str]] = field(default_factory=dict)
    known_names: set[str] = field(default_factory=set)
    def_names: set[str] = field(default_factory=set)
    problem_definitions: list[Any] = field(default_factory=list)
    parent_id: str | None = None
    unknowns: list[str] = field(default_factory=list)


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


def build_context(problem: dict, lines: list[dict], parent_id: str | None) -> Context:
    env = Env()
    ctx = Context(env=env, problem=problem, parent_id=parent_id, unknowns=list(problem.get("unknowns") or []))

    nonzero_ir: list[Any] = []
    for a in problem.get("assumptions") or []:
        if a["kind"] == "nonzero" and a.get("expr") is not None:
            nonzero_ir.append(a["expr"])
            continue
        env.assumptions[a["symbol"]] = a["kind"]
    for f in problem.get("functions") or []:
        env.functions[f["name"]] = list(f["args"])
        env.independent |= set(f["args"])
    if problem.get("independent_var"):
        env.independent.add(problem["independent_var"])
    for a in problem.get("assumptions") or []:
        if a["kind"] == "interval":
            try:
                lo = to_sympy(a.get("lower"), env, subst=False) if a.get("lower") is not None else -sp.oo
                hi = to_sympy(a.get("upper"), env, subst=False) if a.get("upper") is not None else sp.oo
                env.intervals[a["symbol"]] = (lo, hi)
            except (CasUnsupported, CasUnreadable, CasIncomplete):
                pass
    for e in nonzero_ir:
        try:
            env.nonzero.append(to_sympy(e, env, subst=False))
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            pass

    order = 0
    for d in problem.get("definitions") or []:
        ctx.problem_definitions.append(d)
        ctx.known_names |= ir_symbols(d)
        register_definition(d, "problem", ctx)
    for i, c in enumerate(problem.get("conditions") or []):
        ctx.known_names |= ir_symbols(c)
        for part in _flatten(c):
            ctx.facts.append(Fact("problem", i, part, "none", "premise", order))
        order += 1

    for line in lines:
        lid = line["id"]
        ctx.line_status[lid] = line.get("status") or "unknown"
        ctx.line_unverified[lid] = list(line.get("unverified_ancestors") or [])
        results = {r["segment_index"]: r for r in line.get("segment_results") or []}
        for i, seg in enumerate(line.get("segments") or []):
            if seg.get("type") != "math":
                continue
            ir = seg["expr"]
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
