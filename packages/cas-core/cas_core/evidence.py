"""Counterexample search, exact comparison and error classification (spec §9.3–9.4)."""

from __future__ import annotations

import itertools
import time
from collections.abc import Callable, Iterable
from typing import Any

import sympy as sp
from sympy.core.function import AppliedUndef

from .ir import Env, is_node, walk_ir

R = sp.Rational
SAMPLE_VALUES = [sp.Integer(0), sp.Integer(1), sp.Integer(-1), sp.Integer(2), sp.Integer(-2), sp.Integer(3), R(1, 2), R(-1, 2), R(1, 3)]
MAX_ASSIGNMENTS = 200
SEARCH_SECONDS = 1.0


def is_zero(e: Any) -> bool:
    """True only when the expression is provably zero; failure to simplify is not evidence."""
    try:
        e = sp.sympify(e)
    except (sp.SympifyError, TypeError):
        return False
    if e == 0:
        return True
    steps: list[Callable[[sp.Expr], sp.Expr]] = [
        sp.expand,
        lambda x: sp.cancel(sp.together(x)),
        lambda x: sp.expand(sp.powsimp(x, force=False)),
        sp.trigsimp,
        sp.simplify,
    ]
    cur = e
    for step in steps:
        try:
            cur2 = step(cur)
        except Exception:  # noqa: BLE001 - SymPy raises many internal error types
            continue
        if cur2 == 0:
            return True
        if cur2.is_zero is True:
            return True
    return False


def values_for(sym: sp.Symbol, env: Env) -> list[sp.Expr]:
    name = sym.name
    if name in env.intervals:
        lo, hi = env.intervals[name]
        pts: list[sp.Expr] = []
        if lo.is_finite:
            pts.append(lo)
        if hi.is_finite:
            pts.append(hi)
        if lo.is_finite and hi.is_finite:
            pts += [(lo + hi) / 2, lo + (hi - lo) / 3, lo + 2 * (hi - lo) / 3]
        pts += [v for v in SAMPLE_VALUES if (not lo.is_finite or v >= lo) and (not hi.is_finite or v <= hi)]
        vals = pts
    else:
        vals = list(SAMPLE_VALUES)
    if sym.is_integer:
        vals = [v for v in vals if v.is_integer]
    if sym.is_positive:
        vals = [v for v in vals if v > 0]
    elif sym.is_nonnegative:
        vals = [v for v in vals if v >= 0]
    if sym.is_nonzero:
        vals = [v for v in vals if v != 0]
    out: list[sp.Expr] = []
    for v in vals:
        if v not in out:
            out.append(v)
    return out or [sp.Integer(1)]


def ordered_symbols(syms: Iterable[sp.Symbol], env: Env) -> list[sp.Symbol]:
    # parameters (assumption-bearing) first, then the rest; deterministic by name
    return sorted(syms, key=lambda s: (0 if env.is_parameter(s.name) or s.is_positive else 1, s.name))


def assignments(syms: list[sp.Symbol], env: Env, value_fn=values_for):
    lists = [value_fn(s, env) for s in syms]
    for combo in itertools.islice(itertools.product(*lists), MAX_ASSIGNMENTS):
        yield dict(zip(syms, combo, strict=True))


def exact_value(expr: Any, assign: dict) -> sp.Expr | None:
    try:
        v = sp.sympify(expr).xreplace(assign)
        if isinstance(v, (sp.Integral, sp.Derivative)) or v.has(sp.Integral):
            v = v.doit()
        if v.has(sp.zoo, sp.nan, sp.oo, -sp.oo):
            return None
        if v.free_symbols:
            return None
        return v
    except Exception:  # noqa: BLE001
        return None


def differs(a: sp.Expr, b: sp.Expr) -> tuple[bool | None, bool]:
    """(True, approx) when a != b, (False, False) when equal, (None, _) when undecided."""
    d = a - b
    try:
        ds = sp.nsimplify(sp.simplify(d)) if not d.is_Number else d
    except Exception:  # noqa: BLE001
        ds = d
    if ds == 0 or ds.is_zero is True:
        return False, False
    if ds.is_zero is False and ds.is_number:
        return True, False
    try:
        v30 = complex(sp.N(d, 30))
        v60 = complex(sp.N(d, 60))
    except (TypeError, ValueError):
        return None, False
    if abs(v30) > 1e-20 and abs(v60 - v30) < abs(v30) * 1e-10:
        return True, True
    if abs(v30) < 1e-40 and abs(v60) < 1e-40:
        return None, False
    return None, False


def jetify(exprs: list[Any], env: Env) -> tuple[list[sp.Expr], dict]:
    """Replace undefined functions and their derivatives by fresh symbols (for sampling)."""
    exprs = [sp.sympify(e) for e in exprs]
    derivs: set = set()
    funcs: set = set()
    for e in exprs:
        derivs |= e.atoms(sp.Derivative)
        funcs |= e.atoms(AppliedUndef)
    mapping: dict = {}
    for i, d in enumerate(sorted(derivs, key=lambda d: (-d.derivative_count, sp.srepr(d)))):
        mapping[d] = sp.Symbol(f"J{i}d")
    nonzero = {sp.srepr(n) for n in env.nonzero}
    for i, f in enumerate(sorted(funcs, key=sp.srepr)):
        mapping[f] = sp.Symbol(f"J{i}f", nonzero=True) if sp.srepr(f) in nonzero else sp.Symbol(f"J{i}f")
    return [e.xreplace(mapping) for e in exprs], mapping


def latex_assignment(assign: dict, inverse: dict | None = None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in assign.items():
        key = inverse.get(k, k) if inverse else k
        out[sp.latex(key)] = sp.latex(v)
    return out


def search_counterexample(
    free: Iterable[sp.Symbol], env: Env, evaluate: Callable[[dict], tuple[sp.Expr, sp.Expr] | None]
) -> tuple[dict, sp.Expr, sp.Expr, bool] | tuple[None, int]:
    """Try assignments in spec order. Returns (assign, context_value, written_value, approx)
    on disagreement, else (None, agreement_count)."""
    syms = ordered_symbols(free, env)
    start = time.perf_counter()
    agree = 0
    for assign in assignments(syms, env):
        if time.perf_counter() - start > SEARCH_SECONDS:
            break
        vals = evaluate(assign)
        if vals is None:
            continue
        cv, wv = vals
        res, approx = differs(cv, wv)
        if res is True:
            return assign, cv, wv, approx
        if res is False:
            agree += 1
    return None, agree


# ---- classification (CAS-only, spec §9.4) ----

def _ir_head(e: Any) -> str | None:
    return e[0] if is_node(e) else None


def independent_symbols(exprs: Iterable[sp.Expr], env: Env) -> set[sp.Symbol]:
    if env.independent:
        return {env.sym(v) for v in env.independent}
    out: set[sp.Symbol] = set()
    for e in exprs:
        out |= {s for s in sp.sympify(e).free_symbols if not env.is_parameter(s.name)}
    return out


def classify_expressions(context: sp.Expr, written: sp.Expr, env: Env, c_ir: Any = None, w_ir: Any = None) -> str:
    if c_ir is not None and w_ir is not None and _ir_head(w_ir) == "Evaluate":
        integrals = [x for x in walk_ir(c_ir) if _ir_head(x) == "Integrate"]
        if integrals:
            return "INTEGRATION_TERM"
    indep = independent_symbols([context, written], env)
    try:
        if not is_zero(context):
            ratio = sp.simplify(written / context)
            if is_zero(ratio + 1):
                return "SIGN"
            if not (ratio.free_symbols & indep) and not ratio.has(sp.Derivative, AppliedUndef) and not is_zero(ratio - 1):
                return "COEFFICIENT"
        diff = sp.simplify(written - context)
        if not is_zero(diff) and not (diff.free_symbols & indep) and not diff.has(sp.Derivative, AppliedUndef):
            return "CONSTANT_TERM"
    except Exception:  # noqa: BLE001
        pass
    return "UNCLASSIFIED"


def denominators_ir(e: Any) -> list[Any]:
    out = []
    for x in walk_ir(e):
        if _ir_head(x) == "Divide":
            out.append(x[2])
        elif _ir_head(x) == "Power" and isinstance(x[2], int) and x[2] < 0:
            out.append(x[1])
    return out
