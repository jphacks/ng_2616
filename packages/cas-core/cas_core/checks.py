"""Goal selection and checks (spec §9.2–9.4, plus the v2.1 physics profile).

Status discipline (P-05): `ok` only with a symbolic proof or equal solution sets, `wrong` only with
a concrete assumption-valid counterexample or solution difference, otherwise `unknown` with a reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp
from sympy.core.function import AppliedUndef

from .context import Context, Fact, declaration_kind
from .evidence import (
    classify_expressions,
    denominators_ir,
    exact_value,
    is_zero,
    jetify,
    latex_assignment,
    search_counterexample,
)
from .ir import (
    CONSTANTS,
    INEQUALITIES,
    RELATION_HEADS,
    CasIncomplete,
    CasUnreadable,
    CasUnsupported,
    Rel,
    ir_has,
    ir_symbols,
    is_node,
    rel_free_symbols,
    rel_functions,
    to_rel,
    to_sympy,
    walk_ir,
)


@dataclass
class SegResult:
    status: str
    goal: str | None = None
    method: str | None = None
    reason: str | None = None
    category: str | None = None
    conditions: list[str] = field(default_factory=list)
    evidence: list[dict] = field(default_factory=list)
    source_line_id: str | None = None
    depends_on: set[str] = field(default_factory=set)


def _none(reason: str, goal: str | None = None) -> SegResult:
    return SegResult("none", goal=goal, reason=reason)


def _unknown(reason: str, goal: str | None = None, **kw: Any) -> SegResult:
    return SegResult("unknown", goal=goal, reason=reason, **kw)


def is_relation_ir(e: Any) -> bool:
    return is_node(e) and e[0] in RELATION_HEADS


def _doit(e: Any) -> sp.Expr:
    e = sp.sympify(e)
    try:
        return e.doit()
    except Exception:  # noqa: BLE001
        return e


def conv_expr(ir: Any, ctx: Context) -> tuple[sp.Expr, set[str]]:
    env = ctx.env
    saved, env.used = env.used, set()
    try:
        return to_sympy(ir, env), set(env.used)
    finally:
        env.used = saved


def conv_rel(ir: Any, ctx: Context) -> tuple[Rel | None, set[str]]:
    env = ctx.env
    saved, env.used = env.used, set()
    try:
        return to_rel(ir, env), set(env.used)
    finally:
        env.used = saved


# ---------------------------------------------------------------- entry point


def verify_segment(ir: Any, notation: str, role: str, ctx: Context, claim: str | None = None) -> SegResult:
    declares = declaration_kind(ir) if notation == "plain" else None
    if declares:
        return _none(declares, declares)
    if role == "premise":
        return _none("PREMISE", "PREMISE")
    if ir_has(ir, {"Unparsed"}):
        return _unknown("UNPARSED")
    if ir_has(ir, {"Unreadable"}):
        return _unknown("UNREADABLE")
    if is_node(ir) and ir[0] == "Equal" and ir[2] is None:
        return _unknown("INCOMPLETE", "EQUATION_FROM_CONTEXT")
    _setup_aliases(ir, ctx)
    try:
        d = definition_check(ir, role, ctx)
        if d is not None:
            return d
        if ir_has(ir, {"Sum", "Limit", "EqualChain", "Or"}):
            return _unknown("UNSUPPORTED")
        if notation == "continuation" or not is_relation_ir(ir):
            return expression_equivalence(ir, ctx)
        if ir[0] == "And":
            return and_target(ir, ctx)
        if claim == "identity" and ir[0] == "Equal":
            return completion_check(ir, ctx)
        return relation_target(ir, ctx)
    except CasUnreadable:
        return _unknown("UNREADABLE")
    except CasIncomplete:
        return _unknown("INCOMPLETE")
    except CasUnsupported as e:
        return _unknown("UNSUPPORTED", conditions=[e.detail] if e.detail else [])


def _setup_aliases(ir: Any, ctx: Context) -> None:
    """E_n -> E when E is already in context and n is a declared positive-integer index."""
    env = ctx.env
    env.aliases = {}
    for name in ir_symbols(ir):
        if name in ctx.known_names or "_" not in name:
            continue
        base, sub = name.split("_", 1)
        if base in ctx.known_names and env.assumptions.get(sub) == "positive_integer":
            env.aliases[name] = base


# ---------------------------------------------------------------- definitions


def _apply_target(lhs: Any) -> str | None:
    if is_node(lhs) and lhs[0] == "Apply":
        args = lhs[2:]
        if all(isinstance(a, str) for a in args) and len(set(args)) == len(args):
            return lhs[1]
    return None


def _rhs_has_undefined_functions(rhs: Any, ctx: Context, exclude: str) -> bool:
    for x in walk_ir(rhs):
        if is_node(x) and x[0] in ("Apply", "Prime"):
            name = x[1] if x[0] == "Apply" else x[1][1]
            if name != exclude and name not in ctx.env.fn_defs:
                return True
    return False


def _appears_in_derivative(name: str, ctx: Context) -> bool:
    for f in ctx.facts:
        for x in walk_ir(f.ir):
            if is_node(x) and x[0] in ("D", "PartialD", "Prime"):
                if any(is_node(y) and y[0] == "Apply" and y[1] == name for y in walk_ir(x)):
                    return True
    return False


def definition_check(ir: Any, role: str, ctx: Context) -> SegResult | None:
    if any(f.is_definition and _same_ir(ir, f.ir) for f in ctx.facts):
        return _none("DEFINITION", "DEFINITION")  # the definition written out again
    if not (is_node(ir) and ir[0] == "Equal"):
        return _unknown("UNSUPPORTED", "DEFINITION") if role == "definition" else None
    lhs, rhs = ir[1], ir[2]
    env = ctx.env
    fn = _apply_target(lhs)
    name = fn if fn else (lhs if isinstance(lhs, str) and lhs not in CONSTANTS else None)
    if name is None:
        return _unknown("UNSUPPORTED", "DEFINITION") if role == "definition" else None
    resolved = env.aliases.get(name, name)
    already = resolved in env.fn_defs or resolved in env.sym_defs
    if role == "definition":
        if already:
            return _unknown("UNSUPPORTED", "DEFINITION", conditions=["conflicting redefinition"])
        return _none("DEFINITION", "DEFINITION")
    if already or name in ir_symbols(rhs):
        return None
    if fn:
        if _rhs_has_undefined_functions(rhs, ctx, name):
            return _none("DEFINITION", "DEFINITION")  # an ansatz such as Ψ = ψ(x)φ(t)
        if _appears_in_derivative(name, ctx):
            return None  # a claimed solution of an earlier differential equation
        return _none("DEFINITION", "DEFINITION")
    if resolved in ctx.known_names or resolved in env.aliases.values():
        return None
    if not (ir_symbols(rhs) - set(CONSTANTS)):
        return None  # "x = 2" on its own is a claim with no source, not a definition
    return _none("DEFINITION", "DEFINITION")


def _same_ir(a: Any, b: Any) -> bool:
    return a == b


# ---------------------------------------------------------------- expressions


def _no_parent(goal: str, ctx: Context) -> SegResult:
    """Nothing to compare with. After a not-checkable line that is "cannot check", not "first line"."""
    if any(f.line_id == ctx.parent_id and ir_has(f.ir, {"Unparsed"}) for f in ctx.facts):
        return _unknown("PARENT_UNPARSED", goal)
    return _none("NO_PARENT", goal)


def _parent_expression(ctx: Context) -> tuple[Fact, Any] | None:
    by_line: dict[str, list[Fact]] = {}
    for f in ctx.facts:
        by_line.setdefault(f.line_id, []).append(f)
    order = sorted(by_line, key=lambda lid: max(x.order for x in by_line[lid]), reverse=True)
    if ctx.parent_id in by_line:
        order.remove(ctx.parent_id)
        order.insert(0, ctx.parent_id)
    for lid in order:
        facts = sorted(by_line[lid], key=lambda f: f.seg_index)
        last = facts[-1]
        e = last.ir
        if is_node(e) and e[0] == "Equal":
            if e[2] is not None:
                return last, e[2]
            continue
        if is_relation_ir(e):
            continue
        return last, e
    return None


def _domain_changes(c_ir: Any, written: sp.Expr, ctx: Context) -> list[str]:
    conds: list[str] = []
    for d_ir in denominators_ir(c_ir):
        try:
            d, _ = conv_expr(d_ir, ctx)
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            continue
        syms = list(d.free_symbols)
        if len(syms) != 1:
            continue
        v = syms[0]
        try:
            zs = sp.solveset(d, v, sp.S.Reals)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(zs, sp.FiniteSet):
            continue
        for z in zs:
            if v.name in ctx.env.intervals:
                lo, hi = ctx.env.intervals[v.name]
                if (z < lo) == sp.true or (z > hi) == sp.true:
                    continue
            wv = exact_value(written, {v: z})
            if wv is not None:
                c = f"{sp.latex(v)} \\neq {sp.latex(z)}"
                if c not in conds:
                    conds.append(c)
    return conds


def compare_values(
    C: sp.Expr, W: sp.Expr, ctx: Context, c_ir: Any = None, w_ir: Any = None, goal: str = "EXPRESSION_EQUIVALENCE",
    source: str | None = None,
) -> SegResult:
    env = ctx.env
    Cd, Wd = _doit(C), _doit(W)
    if is_zero(Wd - Cd):
        conds = _domain_changes(c_ir, Wd, ctx) if c_ir is not None else []
        if conds:
            return _unknown(
                "DOMAIN_CHANGED", goal, conditions=conds, source_line_id=source,
                evidence=[{"kind": "DOMAIN_CONDITION", "condition_latex": ", ".join(conds),
                           "summary": "Equal only where " + ", ".join(conds)}],
            )
        method = "eval" if (Cd.is_number and Wd.is_number) else "sym"
        return SegResult("ok", goal=goal, method=method, source_line_id=source)

    (eC, eW), mapping = jetify([Cd, Wd], env)
    inverse = {v: k for k, v in mapping.items()}
    free = eC.free_symbols | eW.free_symbols

    def ev(assign: dict):
        cv, wv = exact_value(eC, assign), exact_value(eW, assign)
        return None if cv is None or wv is None else (cv, wv)

    found = search_counterexample(free, env, ev)
    if found[0] is not None:
        assign, cv, wv, approx = found  # type: ignore[misc]
        constants = not free
        if constants:
            # two exact constants that differ: no variable to blame, so no coefficient/sign story
            category = "UNCLASSIFIED"
        else:
            category = _integration_category(c_ir, w_ir, ctx) or classify_expressions(Cd, Wd, env, c_ir, w_ir)
        where = ", ".join(f"{k} = {v}" for k, v in latex_assignment(assign, inverse).items())
        evidence = {
            "kind": "EXACT_MISMATCH" if constants else "COUNTEREXAMPLE",
            "assignment": latex_assignment(assign, inverse),
            "context_value": sp.latex(cv),
            "written_value": sp.latex(wv),
            "approx": bool(approx),
            "summary": f"At {where or 'these values'}, the expected value is {sp.latex(cv)} but this line gives {sp.latex(wv)}.",
        }
        return SegResult("wrong", goal=goal, method="cx", category=category, evidence=[evidence], source_line_id=source)
    agree = found[1]
    return _unknown("NUM_ONLY" if agree else "NO_EVIDENCE", goal, source_line_id=source)


def _integration_category(c_ir: Any, w_ir: Any, ctx: Context) -> str | None:
    """INTEGRATION_TERM only when the written primitive's derivative differs from the integrand."""
    if not (is_node(w_ir) and w_ir[0] == "Evaluate"):
        return None
    integrals = [x for x in walk_ir(c_ir)] if c_ir is not None else []
    integrals = [x for x in integrals if is_node(x) and x[0] == "Integrate"]
    if not integrals:
        return None
    try:
        var = w_ir[2][1]
        F, _ = conv_expr(w_ir[1], ctx)
        g, _ = conv_expr(integrals[0][1], ctx)
        v = ctx.env.sym(var)
        if not is_zero(sp.diff(F, v) - g):
            return "INTEGRATION_TERM"
    except (CasUnsupported, CasUnreadable, CasIncomplete, TypeError, IndexError):
        return None
    return None


def expression_equivalence(ir: Any, ctx: Context) -> SegResult:
    src = _parent_expression(ctx)
    if src is None:
        return _no_parent("EXPRESSION_EQUIVALENCE", ctx)
    fact, c_ir = src
    if ir_has(c_ir, {"Unparsed"}):
        return _unknown("PARENT_UNPARSED", "EXPRESSION_EQUIVALENCE")
    C, u1 = conv_expr(c_ir, ctx)
    W, u2 = conv_expr(ir, ctx)
    res = compare_values(C, W, ctx, c_ir, ir, "EXPRESSION_EQUIVALENCE", fact.line_id)
    res.depends_on |= {fact.line_id} | u1 | u2
    return res


# ---------------------------------------------------------------- relations


def constant_evaluation(ir: Any, ctx: Context) -> SegResult | None:
    """Exact constant comparison (spec §9.2 row 10), e.g. 1 + 1 = 2."""
    if ir[0] != "Equal":
        return None
    try:
        L, u1 = conv_expr(ir[1], ctx)
        R, u2 = conv_expr(ir[2], ctx)
    except CasUnsupported:
        return None  # e.g. x = ±2 is a solution set, handled by relation_compare
    Ld, Rd = _doit(L), _doit(R)
    if Ld.free_symbols or Rd.free_symbols or Ld.atoms(AppliedUndef) or Rd.atoms(AppliedUndef):
        return None
    res = compare_values(L, R, ctx, ir[1], ir[2], "CONSTANT_EVALUATION")
    res.depends_on |= u1 | u2
    return res


def _identity_sides(ir: Any, ctx: Context) -> tuple[sp.Expr, sp.Expr, set[str]] | None:
    if not (is_node(ir) and ir[0] == "Equal" and ir[2] is not None):
        return None
    try:
        L, u1 = conv_expr(ir[1], ctx)
        R, u2 = conv_expr(ir[2], ctx)
    except CasUnsupported:
        return None  # e.g. x = ±2 is a solution set, handled by relation_compare
    return L, R, u1 | u2


def identity_check(ir: Any, ctx: Context) -> SegResult | None:
    """Both sides equal as expressions, e.g. x^2 - 5x + 6 = (x - 2)(x - 3): true on its own,
    whatever the earlier lines say (comparing its solution set, all x, with theirs is meaningless)."""
    sides = _identity_sides(ir, ctx)
    if sides is None:
        return None
    L, R, used = sides
    if not is_zero(_doit(L) - _doit(R)):
        return None
    res = compare_values(L, R, ctx, ir[1], ir[2], "IDENTITY")
    res.depends_on |= used
    return res


def _is_name(e: Any) -> bool:
    return isinstance(e, str) or (is_node(e) and e[0] in ("Apply", "Prime"))


def completion_check(ir: Any, ctx: Context) -> SegResult:
    """A completed "LHS =": the student asked what LHS equals, so the claim is an identity.
    Follows-from-context steps still count; otherwise both sides must agree as expressions.
    "k =" or "ψ(x) =" (a name, not an expression) and lines with unknown functions keep the usual checks."""
    r = relation_target(ir, ctx)
    sides = _identity_sides(ir, ctx)
    if r.status == "ok" or sides is None or _is_name(ir[1]):
        return r
    L, R, used = sides
    Ld, Rd = _doit(L), _doit(R)
    if Ld.atoms(AppliedUndef, sp.Derivative) or Rd.atoms(AppliedUndef, sp.Derivative):
        return r
    res = compare_values(L, R, ctx, ir[1], ir[2], "IDENTITY")
    res.depends_on |= used
    return res


def relation_target(ir: Any, ctx: Context) -> SegResult:
    for check in (equation_from_context, constant_evaluation, identity_check, separation_check, solution_check):
        r = check(ir, ctx)
        if r is not None:
            return r
    return relation_compare(ir, ctx)


def and_target(ir: Any, ctx: Context) -> SegResult:
    listed = solution_list(list(ir[1:]), ctx)
    if listed is not None:
        return listed
    T, _ = conv_rel(ir, ctx)
    if T is not None and not rel_functions(T):
        r = system_compare(T, ctx)
        if r is not None:
            return r
    results = [relation_target(p, ctx) for p in ir[1:]]
    for status in ("wrong", "unknown"):
        for r in results:
            if r.status == status:
                return r
    oks = [r for r in results if r.status == "ok"]
    if not oks:
        return results[0]
    out = SegResult("ok", goal=oks[0].goal, method=oks[0].method, source_line_id=oks[0].source_line_id)
    for r in oks:
        out.conditions += [c for c in r.conditions if c not in out.conditions]
        out.depends_on |= r.depends_on
    return out


def _mentions_defined(lhs: Any, ctx: Context) -> bool:
    env = ctx.env
    for x in walk_ir(lhs):
        if is_node(x) and x[0] == "Apply" and x[1] in env.fn_defs:
            return True
        if is_node(x) and x[0] == "Prime" and x[1][1] in env.fn_defs:
            return True
    return isinstance(lhs, str) and lhs in env.sym_defs


def _at_own_variables(lhs: Any, ctx: Context) -> bool:
    if is_node(lhs) and lhs[0] == "Prime":
        lhs = lhs[1]
    if not (is_node(lhs) and lhs[0] == "Apply"):
        return False
    args = list(lhs[2:]) or ctx.env.functions.get(lhs[1], [])
    return bool(args) and all(isinstance(a, str) and a in ctx.env.independent for a in args)


def equation_from_context(ir: Any, ctx: Context) -> SegResult | None:
    """Value of a defined function/symbol/derivative (spec §9.2 row 7). Only identity claims:
    any free unknown left after substitution makes it a constraint, handled by relation_compare."""
    if ir[0] != "Equal" or not _mentions_defined(ir[1], ctx):
        return None
    env = ctx.env
    L, u1 = conv_expr(ir[1], ctx)
    R, u2 = conv_expr(ir[2], ctx)
    free = sp.sympify(L).free_symbols | sp.sympify(R).free_symbols
    # φ(t) = … or f(x) = … at the function's own variables is an identity claim (other symbols are
    # parameters); at specific points with unknowns left over (ψ(L) = 0) it is a constraint
    if not _at_own_variables(ir[1], ctx) and any(not (env.is_parameter(s.name) or s.name in env.independent) for s in free):
        return None
    res = compare_values(L, R, ctx, None, ir[2], "EQUATION_FROM_CONTEXT")
    res.depends_on |= u1 | u2
    if res.depends_on and not res.source_line_id:
        res.source_line_id = sorted(res.depends_on)[0]
    return res


def _dependence(expr: sp.Expr, ctx: Context) -> set[str]:
    return {s.name for s in sp.sympify(expr).free_symbols if s.name in ctx.env.independent}


def _ranked_facts(ctx: Context) -> list[Fact]:
    facts = [f for f in ctx.facts if not f.is_definition and f.status != "wrong" and is_relation_ir(f.ir)]
    return sorted(facts, key=lambda f: (f.line_id == ctx.parent_id, f.order), reverse=True)


def separation_check(ir: Any, ctx: Context) -> SegResult | None:
    if ir[0] != "Equal":
        return None
    lhs, rhs = ir[1], ir[2]

    def fresh(e: Any) -> bool:
        return isinstance(e, str) and e not in CONSTANTS and e not in ctx.known_names and e not in ctx.env.aliases

    if fresh(rhs):
        x_ir, const = lhs, rhs
    elif fresh(lhs):
        x_ir, const = rhs, lhs
    else:
        return None
    X, ux = conv_expr(x_ir, ctx)
    X = _doit(X)
    for f in _ranked_facts(ctx):
        try:
            S, us = conv_rel(f.ir, ctx)
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            continue
        if S is None or S.op != "Equal":
            continue
        A, B = _doit(S.lhs), _doit(S.rhs)
        va, vb = _dependence(A, ctx), _dependence(B, ctx)
        if not va or not vb or (va & vb):
            continue
        if is_zero(X - A) or is_zero(X - B):
            return SegResult(
                "ok", goal="SEPARATION_CONSTANT", method="sep", source_line_id=f.line_id,
                conditions=[f"{sp.latex(ctx.env.sym(const))} is a separation constant"],
                depends_on={f.line_id} | us | ux,
            )
    return None


def solution_check(ir: Any, ctx: Context) -> SegResult | None:
    """f(x) = explicit expression, checked by substitution into the latest differential
    equation for f (a particular solution: implication, labelled as such)."""
    if ir[0] != "Equal":
        return None
    lhs, rhs = ir[1], ir[2]
    if not (is_node(lhs) and lhs[0] == "Apply"):
        return None
    env = ctx.env
    name = lhs[1]
    if name in env.fn_defs:
        return None
    args = list(lhs[2:]) or env.functions.get(name, [])
    if not args or not all(isinstance(a, str) for a in args):
        return None
    R, ur = conv_expr(rhs, ctx)
    if sp.sympify(R).atoms(AppliedUndef):
        return None
    fn = sp.Function(name)
    for f in _ranked_facts(ctx):
        try:
            S, us = conv_rel(f.ir, ctx)
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            continue
        if S is None or S.op != "Equal":
            continue
        derivs = sp.sympify(S.lhs).atoms(sp.Derivative) | sp.sympify(S.rhs).atoms(sp.Derivative)
        if not any(getattr(d.expr, "func", None) == fn for d in derivs):
            continue
        lam = sp.Lambda(tuple(env.sym(a) for a in args), R)
        L2 = _doit(sp.sympify(S.lhs).subs(fn, lam))
        R2 = _doit(sp.sympify(S.rhs).subs(fn, lam))
        deps = {f.line_id} | us | ur
        if is_zero(L2 - R2):
            return SegResult("ok", goal="SOLUTION_CHECK", method="sub", source_line_id=f.line_id, depends_on=deps)
        (eL, eR), mapping = jetify([L2, R2], env)
        inverse = {v: k for k, v in mapping.items()}

        def ev(assign: dict, eL=eL, eR=eR):
            a, b = exact_value(eL, assign), exact_value(eR, assign)
            return None if a is None or b is None else (a, b)

        found = search_counterexample(eL.free_symbols | eR.free_symbols, env, ev)
        if found[0] is not None:
            assign, lv, rv, approx = found  # type: ignore[misc]
            category = classify_expressions(L2, R2, env)
            evidence = {
                "kind": "COUNTEREXAMPLE",
                "assignment": latex_assignment(assign, inverse),
                "context_value": sp.latex(lv),
                "written_value": sp.latex(rv),
                "approx": bool(approx),
                "summary": (
                    f"Substituting this line into the earlier equation gives {sp.latex(lv)} on the left "
                    f"but {sp.latex(rv)} on the right."
                ),
            }
            return SegResult("wrong", goal="SOLUTION_CHECK", method="cx", category=category, evidence=[evidence],
                             source_line_id=f.line_id, depends_on=deps)
        return _unknown("NUM_ONLY" if found[1] else "NO_EVIDENCE", "SOLUTION_CHECK", source_line_id=f.line_id,
                        depends_on=deps)
    return None


def _is_trivial(S: Rel) -> bool:
    if S.op != "Equal":
        return False
    try:
        return is_zero(_doit(S.lhs) - _doit(S.rhs))
    except Exception:  # noqa: BLE001
        return False


def relation_compare(ir: Any, ctx: Context) -> SegResult:
    T, ut = conv_rel(ir, ctx)
    if T is None:
        return _unknown("UNSUPPORTED")
    t_funcs = rel_functions(T)
    t_syms = {s.name for s in rel_free_symbols(T)}
    ranked: list[tuple[tuple, Fact, Rel, set[str]]] = []
    for f in ctx.facts:
        if f.is_definition or f.status == "wrong" or not is_relation_ir(f.ir):
            continue
        try:
            S, us = conv_rel(f.ir, ctx)
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            continue
        if S is None or S.op == "And" or _is_trivial(S):
            continue
        s_funcs = rel_functions(S)
        s_syms = {s.name for s in rel_free_symbols(S)}
        f_overlap = len(t_funcs & s_funcs)
        s_overlap = len(t_syms & s_syms)
        relevant = f_overlap > 0 if t_funcs else (s_overlap > 0 and not s_funcs)
        if not relevant:
            continue
        ranked.append(((f.line_id == ctx.parent_id, f_overlap, s_overlap, f.order), f, S, us))
    if not ranked:
        return _no_parent("SOLUTION_SET_EQUIVALENCE", ctx)
    ranked.sort(key=lambda r: r[0], reverse=True)
    fallback: SegResult | None = None
    for _, f, S, us in ranked:
        r = compare_relations(T, S, ctx)
        if r is None:
            continue
        r.depends_on |= {f.line_id} | us | ut
        r.source_line_id = f.line_id
        if r.status == "ok":
            return r
        if fallback is None:
            fallback = r
    return fallback or _unknown("NO_EVIDENCE", source_line_id=ranked[0][1].line_id, depends_on={ranked[0][1].line_id})


def compare_relations(T: Rel, S: Rel, ctx: Context) -> SegResult | None:
    eqs = ("Equal", "EqualAny")
    if T.op in eqs and S.op in eqs:
        if not (rel_functions(T) | rel_functions(S)):
            x = _pick_unknown(T, S, ctx)
            if x is not None:
                r = solution_set_compare(T, S, x, ctx)
                if r is not None:
                    return r
        if T.op == "Equal" and S.op == "Equal":
            return difference_compare(T, S, ctx)
        return None
    if T.op in INEQUALITIES | {"Equal"} and S.op in INEQUALITIES | {"Equal"}:
        x = _pick_unknown(T, S, ctx)
        if x is not None:
            return solution_set_compare(T, S, x, ctx)
    return None


def _pick_unknown(T: Rel, S: Rel, ctx: Context) -> sp.Symbol | None:
    env = ctx.env
    t_free = rel_free_symbols(T)
    if T.op in ("Equal", "EqualAny") and isinstance(T.lhs, sp.Symbol) and not env.is_parameter(T.lhs.name):
        return T.lhs
    cands = [s for s in t_free if not env.is_parameter(s.name) and s.name not in env.independent]
    if len(cands) == 1:
        return cands[0]
    cands = [s for s in t_free | rel_free_symbols(S) if not env.is_parameter(s.name)]
    if len(cands) == 1:
        return cands[0]
    return None


def _domain(x: sp.Symbol, ctx: Context) -> sp.Set:
    if x.name in ctx.env.intervals:
        lo, hi = ctx.env.intervals[x.name]
        return sp.Interval(lo, hi)
    if x.is_positive:
        return sp.Interval.open(0, sp.oo)
    if x.is_nonnegative:
        return sp.Interval(0, sp.oo)
    return sp.S.Reals


def _solve(rel: Rel, x: sp.Symbol, ctx: Context) -> sp.Set | None:
    dom = _domain(x, ctx)
    try:
        if rel.op == "Equal":
            s = sp.solveset(sp.together(_doit(rel.lhs) - _doit(rel.rhs)), x, dom)
        elif rel.op == "EqualAny":
            s = sp.Union(*[sp.solveset(_doit(rel.lhs) - _doit(r), x, dom) for r in rel.rhs])
        else:
            op = {"Less": sp.Lt, "LessEqual": sp.Le, "Greater": sp.Gt, "GreaterEqual": sp.Ge, "NotEqual": sp.Ne}[rel.op]
            s = sp.solveset(op(_doit(rel.lhs), _doit(rel.rhs)), x, dom)
    except Exception:  # noqa: BLE001
        return None
    if isinstance(s, sp.ConditionSet) or s.has(sp.ConditionSet):
        return None
    return s


def _candidates(s: sp.Set) -> tuple[list[sp.Expr], sp.Set | None] | None:
    """A set of the form {a, b, …} ∩ D, or a union of such pieces over one D (solveset's output for
    x² = y versus x = ±√y), as (candidates, D). A plain finite set has D = None."""
    if isinstance(s, sp.FiniteSet):
        return list(s), None
    if isinstance(s, sp.Intersection) and len(s.args) == 2:
        fin = [a for a in s.args if isinstance(a, sp.FiniteSet)]
        if len(fin) == 1:
            dom = s.args[1] if s.args[0] is fin[0] else s.args[0]
            return list(fin[0]), dom
        return None
    if isinstance(s, sp.Union):
        pieces = [_candidates(a) for a in s.args]
        if any(p is None for p in pieces):
            return None
        doms = {d for _, d in pieces if d is not None}  # type: ignore[misc]
        if len(doms) > 1:
            return None
        dom = next(iter(doms), None)
        elems: list[sp.Expr] = []
        for es, d in pieces:  # type: ignore[misc]
            if d is None and dom is not None and not all(dom.contains(e) == sp.true for e in es):
                return None  # a bare candidate outside D would change the set
            elems += es
        return elems, dom
    return None


def _same_candidates(A: sp.Set, B: sp.Set) -> bool:
    ca, cb = _candidates(A), _candidates(B)
    if ca is None or cb is None or ca[1] != cb[1]:
        return False
    a, b = ca[0], cb[0]
    return all(any(is_zero(p - q) for q in b) for p in a) and all(any(is_zero(q - p) for p in a) for q in b)


def _sets_equal(A: sp.Set, B: sp.Set) -> bool | None:
    if A == B:
        return True
    if _same_candidates(A, B):
        return True
    if isinstance(A, sp.FiniteSet) and isinstance(B, sp.FiniteSet):
        if len(A) != len(B):
            pass
        a_in_b = all(any(is_zero(a - b) for b in B) for a in A)
        b_in_a = all(any(is_zero(b - a) for a in A) for b in B)
        if a_in_b and b_in_a:
            return True
        if all(a.is_number for a in A) and all(b.is_number for b in B):
            return False
        return None
    try:
        e1 = sp.Complement(A, B).is_empty
        e2 = sp.Complement(B, A).is_empty
    except Exception:  # noqa: BLE001
        return None
    if e1 is True and e2 is True:
        return True
    if e1 is False or e2 is False:
        return False
    return None


def _transcendental_in(rel: Rel, x: sp.Symbol) -> bool:
    """Trig/exp/log of the unknown: solveset is slow there and rarely returns a comparable set."""
    kinds = (sp.sin, sp.cos, sp.tan, sp.exp, sp.log)
    for e in (rel.lhs, rel.rhs) if rel.op != "EqualAny" else (rel.lhs, *rel.rhs):
        for f in sp.sympify(e).atoms(*kinds):
            if f.has(x):
                return True
    return False


def solution_set_compare(T: Rel, S: Rel, x: sp.Symbol, ctx: Context) -> SegResult | None:
    Ts = None if _transcendental_in(T, x) else _solve(T, x, ctx)
    Ss = None if _transcendental_in(S, x) else _solve(S, x, ctx)
    return _compare_solution_sets(Ts, Ss, S, x, ctx)


def _compare_solution_sets(
    Ts: sp.Set | None, Ss: sp.Set | None, S: Rel, x: sp.Symbol, ctx: Context, goal: str = "SOLUTION_SET_EQUIVALENCE",
) -> SegResult | None:
    if Ts is not None and Ss is not None:
        eq = _sets_equal(Ts, Ss)
        if eq is True:
            return SegResult("ok", goal=goal, method="sets")
        if eq is False:
            if isinstance(Ts, sp.FiniteSet) and isinstance(Ss, sp.FiniteSet):
                missing = [s for s in Ss if not any(is_zero(s - t) for t in Ts)]
                extra = [t for t in Ts if not any(is_zero(t - s) for s in Ss)]
            else:
                missing, extra = _witnesses(Ts, Ss, x, ctx)
            category = "MISSING_SOLUTION" if missing else "EXTRA_SOLUTION"
            evidence = {
                "kind": "SOLUTION_DIFF",
                "missing": [sp.latex(m) for m in missing],
                "extra": [sp.latex(e) for e in extra],
                "summary": (f"Missing {sp.latex(x)} = {', '.join(sp.latex(m) for m in missing)}. " if missing else "")
                + (f"Extra {sp.latex(x)} = {', '.join(sp.latex(e) for e in extra)}." if extra else ""),
            }
            return SegResult("wrong", goal=goal, method="sets", category=category, evidence=[evidence])
    # implication only: every solution of this line satisfies the source, but not shown equivalent
    if isinstance(Ts, sp.FiniteSet) and len(Ts) > 0 and S is not None and S.op == "Equal":
        dS = _doit(S.lhs) - _doit(S.rhs)
        if all(is_zero(dS.subs(x, t)) for t in Ts):
            return _unknown("SUBSET_OF_SOLUTIONS", goal, conditions=["other solutions were not ruled out"])
    return None


def _single_unknown_equations(parts: list[Any], ctx: Context) -> tuple[list[Rel], sp.Symbol, set[str]] | None:
    """Equations that all constrain the same one unknown, e.g. x + 3 = 0, x + 4 = 0."""
    rels: list[Rel] = []
    used: set[str] = set()
    for p in parts:
        if not (is_node(p) and p[0] == "Equal" and p[2] is not None):
            return None
        try:
            r, u = conv_rel(p, ctx)
        except (CasUnsupported, CasUnreadable, CasIncomplete):
            return None
        if r is None or r.op not in ("Equal", "EqualAny") or rel_functions(r):
            return None
        rels.append(r)
        used |= u
    unknowns = [{s for s in rel_free_symbols(r) if not ctx.env.is_parameter(s.name)} for r in rels]
    if any(len(u) != 1 for u in unknowns) or len(set().union(*unknowns)) != 1:
        return None
    return rels, next(iter(unknowns[0])), used


def _union_solutions(rels: list[Rel], x: sp.Symbol, ctx: Context) -> sp.Set | None:
    sets = [None if _transcendental_in(r, x) else _solve(r, x, ctx) for r in rels]
    return None if any(s is None for s in sets) else sp.Union(*sets)


def solution_list(parts: list[Any], ctx: Context) -> SegResult | None:
    """Equations in one unknown listed on a line ("x + 3 = 0 または x + 4 = 0", "x = -3, x = -4")
    give its solutions: a disjunction, compared by the union of their solution sets."""
    if len(parts) < 2:
        return None
    found = _single_unknown_equations(parts, ctx)
    if found is None:
        return None
    rels, x, used = found
    Ts = _union_solutions(rels, x, ctx)
    if Ts is None:
        return None
    by_line: dict[str, list[Fact]] = {}
    for f in _ranked_facts(ctx):
        by_line.setdefault(f.line_id, []).append(f)
    for lid, facts in by_line.items():
        source = _single_unknown_equations([f.ir for f in facts], ctx) if len(facts) > 1 else None
        if source is not None:
            s_rels, sx, us = source
            S = None
        else:
            try:
                S, us = conv_rel(facts[0].ir, ctx)
            except (CasUnsupported, CasUnreadable, CasIncomplete):
                continue
            if S is None or S.op not in ("Equal", "EqualAny") or rel_functions(S) or _is_trivial(S):
                continue
            s_rels, sx = [S], x
        if sx != x or x not in set().union(*(rel_free_symbols(r) for r in s_rels)):
            continue
        r = _compare_solution_sets(Ts, _union_solutions(s_rels, x, ctx), S, x, ctx, "SOLUTION_LIST")
        if r is None:
            continue
        r.source_line_id = lid
        r.depends_on |= {lid} | us | used
        return r
    return _no_parent("SOLUTION_LIST", ctx)


def _witnesses(Ts: sp.Set, Ss: sp.Set, x: sp.Symbol, ctx: Context) -> tuple[list, list]:
    from .evidence import values_for

    missing, extra = [], []
    for v in values_for(x, ctx.env) + [sp.Integer(5), sp.Integer(-5), sp.Integer(10)]:
        in_t, in_s = Ts.contains(v), Ss.contains(v)
        if in_s == sp.true and in_t == sp.false:
            missing.append(v)
        elif in_t == sp.true and in_s == sp.false:
            extra.append(v)
        if missing or extra:
            break
    return missing, extra


def system_compare(T: Rel, ctx: Context) -> SegResult | None:
    unknowns = [p.lhs for p in T.parts if p.op == "Equal" and isinstance(p.lhs, sp.Symbol)]
    if not unknowns or len(unknowns) > 3:
        return None
    for f in sorted(ctx.facts, key=lambda f: (f.line_id == ctx.parent_id, f.order), reverse=True):
        group = [g for g in ctx.facts if g.line_id == f.line_id and g.seg_index == f.seg_index]
        if len(group) < 2 or f.is_definition or f.status == "wrong":
            continue
        try:
            S_parts = [conv_rel(g.ir, ctx)[0] for g in group]
            if any(p is None or p.op != "Equal" for p in S_parts) or any(p.op != "Equal" for p in T.parts):
                continue
            ts = sp.linsolve([p.lhs - p.rhs for p in T.parts], unknowns)
            ss = sp.linsolve([p.lhs - p.rhs for p in S_parts], unknowns)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            continue
        if ts == ss:
            return SegResult("ok", goal="SYSTEM_SOLUTION", method="solve", source_line_id=f.line_id, depends_on={f.line_id})
        if isinstance(ts, sp.FiniteSet) and isinstance(ss, sp.FiniteSet) and ts.is_finite_set and ss.is_finite_set:
            evidence = {"kind": "SOLUTION_DIFF", "missing": [sp.latex(s) for s in ss - ts], "extra": [sp.latex(s) for s in ts - ss],
                        "summary": f"The system's solution is {sp.latex(ss)}, but this line gives {sp.latex(ts)}."}
            return SegResult("wrong", goal="SYSTEM_SOLUTION", method="solve", category="UNCLASSIFIED", evidence=[evidence],
                             source_line_id=f.line_id, depends_on={f.line_id})
        return None
    return None


def _nonzero_factor(r: sp.Expr, ctx: Context) -> tuple[bool, list[str]]:
    conds: list[str] = []
    try:
        fr = sp.factor(r)
    except Exception:  # noqa: BLE001
        fr = r
    nonzero = {sp.srepr(n) for n in ctx.env.nonzero}
    for f in sp.Mul.make_args(fr):
        b, _ = f.as_base_exp()
        if b.is_number:
            if b == 0 or b.has(sp.zoo, sp.nan):
                return False, []
            continue
        if b.is_zero is False or b.func == sp.exp:
            continue
        if sp.srepr(b) in nonzero:
            c = f"{sp.latex(b)} \\neq 0"
            if c not in conds:
                conds.append(c)
            continue
        return False, []
    return True, conds


def difference_compare(T: Rel, S: Rel, ctx: Context) -> SegResult | None:
    goal = "EQUATION_EQUIVALENCE"
    dT = sp.expand(_doit(T.lhs) - _doit(T.rhs))
    dS = sp.expand(_doit(S.lhs) - _doit(S.rhs))
    if is_zero(dT - dS) or is_zero(dT + dS):
        return SegResult("ok", goal=goal, method="sym")
    if not is_zero(dS):
        try:
            r = sp.simplify(sp.cancel(sp.together(dT / dS)))
        except Exception:  # noqa: BLE001
            r = None
        if r is not None and not r.has(sp.Derivative) and not is_zero(r):
            ok, conds = _nonzero_factor(r, ctx)
            if ok:
                return SegResult("ok", goal=goal, method="scale", conditions=conds)
            simple = len(sp.Mul.make_args(sp.factor(r))) <= 3 and not r.has(sp.sin, sp.cos, sp.tan, sp.exp, sp.log)
            if simple:
                return _unknown("DOMAIN_CHANGED", goal, conditions=[f"{sp.latex(r)} \\neq 0"])
    return _counterexample_from_source(T, S, dT, dS, ctx)


def _counterexample_from_source(T: Rel, S: Rel, dT: sp.Expr, dS: sp.Expr, ctx: Context) -> SegResult | None:
    """Find values that satisfy the source relation but break this one."""
    env = ctx.env
    (eT, eS, eTl, eTr), mapping = jetify([dT, dS, _doit(T.lhs), _doit(T.rhs)], env)
    inverse = {v: k for k, v in mapping.items()}
    jets = sorted([s for s in eS.free_symbols if s.name.startswith("J")], key=lambda s: s.name)
    others = sorted([s for s in eS.free_symbols if not s.name.startswith("J") and not env.is_parameter(s.name)], key=lambda s: s.name)
    for j in jets + others:
        try:
            sols = sp.solve(eS, j)
        except Exception:  # noqa: BLE001
            continue
        if len(sols) != 1:
            continue
        sol = sols[0]
        R = eT.xreplace({j: sol})
        if is_zero(R):
            return None  # follows from the source, but not shown equivalent
        lhs, rhs = eTl.xreplace({j: sol}), eTr.xreplace({j: sol})

        def ev(assign: dict, lhs=lhs, rhs=rhs):
            a, b = exact_value(lhs, assign), exact_value(rhs, assign)
            return None if a is None or b is None else (a, b)

        found = search_counterexample(lhs.free_symbols | rhs.free_symbols, env, ev)
        if found[0] is None:
            return _unknown("NUM_ONLY" if found[1] else "NO_EVIDENCE", goal="EQUATION_EQUIVALENCE")
        assign, lv, rv, approx = found  # type: ignore[misc]
        full = dict(assign)
        jv = exact_value(sol, assign)
        if jv is not None:
            full[j] = jv
        evidence = {
            "kind": "COUNTEREXAMPLE",
            "assignment": latex_assignment(full, inverse),
            "context_value": sp.latex(lv),
            "written_value": sp.latex(rv),
            "approx": bool(approx),
            "summary": (
                f"With values that satisfy the earlier line, this line's left side is {sp.latex(lv)} "
                f"but its right side is {sp.latex(rv)}."
            ),
        }
        return SegResult("wrong", goal="EQUATION_EQUIVALENCE", method="cx", category=_classify_relation(T, S, ctx), evidence=[evidence])
    return None


def _classify_relation(T: Rel, S: Rel, ctx: Context) -> str:
    try:
        if is_zero(_doit(T.lhs) - _doit(S.lhs)):
            return classify_expressions(_doit(S.rhs), _doit(T.rhs), ctx.env)
        if is_zero(_doit(T.rhs) - _doit(S.rhs)):
            return classify_expressions(_doit(S.lhs), _doit(T.lhs), ctx.env)
    except Exception:  # noqa: BLE001
        pass
    return "UNCLASSIFIED"
