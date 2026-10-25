"""IR (MathJSON) -> SymPy by operator dispatch (spec §6). Never sympify/parse_expr/eval."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy as sp
from sympy.core.function import AppliedUndef

HBAR = sp.Symbol("hbar", positive=True)
CONSTANTS: dict[str, sp.Expr] = {
    "Pi": sp.pi,
    "ExponentialE": sp.E,
    "ImaginaryUnit": sp.I,
    "Hbar": HBAR,
    "Infinity": sp.oo,
}
INEQUALITIES = {"Less", "LessEqual", "Greater", "GreaterEqual", "NotEqual"}
RELATION_HEADS = {"Equal", "EqualChain", "And", "Or", "Element"} | INEQUALITIES
NUMBER_SETS = {"PositiveIntegers", "Integers", "NaturalNumbers", "Reals"}


class CasUnsupported(Exception):
    def __init__(self, reason: str = "UNSUPPORTED", detail: str = ""):
        super().__init__(detail or reason)
        self.reason = reason
        self.detail = detail


class CasUnreadable(Exception):
    pass


class CasIncomplete(Exception):
    pass


@dataclass
class Rel:
    """A converted relation. op: Equal | EqualAny | Less | ... | And."""

    op: str
    lhs: Any = None
    rhs: Any = None
    parts: list[Rel] = field(default_factory=list)

    def diff(self) -> sp.Expr:
        return sp.sympify(self.lhs) - sp.sympify(self.rhs)


@dataclass
class Env:
    assumptions: dict[str, str] = field(default_factory=dict)
    intervals: dict[str, tuple[sp.Expr, sp.Expr]] = field(default_factory=dict)
    functions: dict[str, list[str]] = field(default_factory=dict)
    fn_defs: dict[str, tuple[sp.Lambda, str]] = field(default_factory=dict)
    sym_defs: dict[str, tuple[sp.Expr, str]] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)
    nonzero: list[sp.Expr] = field(default_factory=list)
    independent: set[str] = field(default_factory=set)
    used: set[str] = field(default_factory=set)
    _cache: dict[str, sp.Symbol] = field(default_factory=dict)

    def sym(self, name: str) -> sp.Symbol:
        if name in self._cache:
            return self._cache[name]
        kind = self.assumptions.get(name)
        if kind == "positive":
            s = sp.Symbol(name, positive=True)
        elif kind == "nonnegative":
            s = sp.Symbol(name, nonnegative=True)
        elif kind == "nonzero":
            s = sp.Symbol(name, real=True, nonzero=True)
        elif kind == "positive_integer":
            s = sp.Symbol(name, integer=True, positive=True)
        elif kind == "nonnegative_integer":
            s = sp.Symbol(name, integer=True, nonnegative=True)
        elif kind == "integer":
            s = sp.Symbol(name, integer=True)
        else:
            s = sp.Symbol(name, real=True)
        self._cache[name] = s
        return s

    def is_parameter(self, name: str) -> bool:
        return self.assumptions.get(name) not in (None, "real") or name == "hbar"


def is_node(e: Any) -> bool:
    return isinstance(e, list) and len(e) > 0 and isinstance(e[0], str)


def walk_ir(e: Any):
    yield e
    if is_node(e) and e[0] != "Unparsed":
        for a in e[1:]:
            yield from walk_ir(a)


def ir_has(e: Any, heads: set[str]) -> bool:
    return any(is_node(x) and x[0] in heads for x in walk_ir(e))


def ir_symbols(e: Any) -> set[str]:
    """Symbol names and function names mentioned anywhere (bound variables included)."""
    out: set[str] = set()
    for x in walk_ir(e):
        if isinstance(x, str) and x not in CONSTANTS and x not in NUMBER_SETS and x not in ("both", "left", "right"):
            out.add(x)
    return out


def to_sympy(e: Any, env: Env, subst: bool = True, dvars: tuple[str, ...] = (), masked: frozenset[str] = frozenset()):
    """Convert an IR expression. Raises CasUnsupported / CasUnreadable / CasIncomplete."""
    if e is None:
        raise CasIncomplete()
    if isinstance(e, bool):
        raise CasUnsupported("IR_INVALID")
    if isinstance(e, int):
        return sp.Integer(e)
    if isinstance(e, float):
        raise CasUnsupported("IR_INVALID", "floating-point number")
    if isinstance(e, str):
        if e in CONSTANTS:
            return CONSTANTS[e]
        name = env.aliases.get(e, e)
        if subst and name not in masked and name in env.sym_defs:
            expr, line_id = env.sym_defs[name]
            env.used.add(line_id)
            return expr
        return env.sym(name)
    if not is_node(e):
        raise CasUnsupported("IR_INVALID")

    h, args = e[0], e[1:]

    def c(x, extra_dvars: tuple[str, ...] = (), mask: frozenset[str] = masked):
        return to_sympy(x, env, subst, dvars + extra_dvars, mask)

    if h == "Unreadable":
        raise CasUnreadable()
    if h == "Unparsed":
        raise CasUnsupported("UNPARSED")
    if h == "Add":
        return sp.Add(*[c(a) for a in args])
    if h == "Multiply":
        return sp.Mul(*[c(a) for a in args])
    if h == "Subtract":
        return c(args[0]) - c(args[1])
    if h == "Divide":
        return c(args[0]) / c(args[1])
    if h == "Negate":
        return -c(args[0])
    if h == "Power":
        base, ex = c(args[0]), args[1]
        if isinstance(ex, int):
            return base**ex
        exc = c(ex)
        if exc.is_integer:
            return base**exc
        raise CasUnsupported("UNSUPPORTED", "non-integer exponent")
    if h == "Sqrt":
        return sp.sqrt(c(args[0]))
    if h == "Abs":
        return sp.Abs(c(args[0]))
    if h == "Sin":
        return sp.sin(c(args[0]))
    if h == "Cos":
        return sp.cos(c(args[0]))
    if h == "Tan":
        return sp.tan(c(args[0]))
    if h == "ArcTan":
        return sp.atan(c(args[0]))
    if h == "ArcSin":
        return sp.asin(c(args[0]))
    if h == "ArcCos":
        return sp.acos(c(args[0]))
    if h == "Exp":
        return sp.exp(c(args[0]))
    if h == "Ln":
        return sp.log(c(args[0]))
    if h == "Apply":
        return _apply(args[0], [c(a) for a in args[1:]], env, subst, dvars, masked)
    if h == "Prime":
        inner, order = args[0], args[1]
        fname = inner[1]
        if len(inner) > 3:
            raise CasUnsupported("UNSUPPORTED", "prime of a multivariate function")
        if len(inner) == 3:
            point = c(inner[2])
        else:
            decl = env.functions.get(fname)
            point = env.sym(decl[0]) if decl and len(decl) == 1 else env.sym(dvars[-1] if dvars else "x")
        u = sp.Dummy("u", real=True)
        if subst and fname in env.fn_defs:
            lam, line_id = env.fn_defs[fname]
            env.used.add(line_id)
            fexpr = resubstitute(lam(u), env, masked)
        else:
            fexpr = sp.Function(fname)(u)
        return sp.diff(fexpr, u, int(order)).subs(u, point)
    if h in ("D", "PartialD"):
        var = args[1]
        inner = c(args[0], (var,))
        return sp.Derivative(inner, env.sym(var)).doit()
    if h in ("Integrate", "Evaluate"):
        tup = args[1]
        var, lo, hi = tup[1], tup[2], tup[3]
        if lo is None or hi is None:
            raise CasUnsupported("UNSUPPORTED", "indefinite integral")
        inner_mask = masked | {var}
        body = c(args[0], mask=inner_mask)
        v = env.sym(var)
        lo_s, hi_s = c(lo), c(hi)
        if lo_s.has(sp.oo, -sp.oo) or hi_s.has(sp.oo, -sp.oo):
            raise CasUnsupported("UNSUPPORTED", "infinite interval")
        if h == "Integrate":
            return sp.Integral(body, (v, lo_s, hi_s))
        return body.subs(v, hi_s) - body.subs(v, lo_s)
    if h == "Sum":
        raise CasUnsupported("UNSUPPORTED", "infinite or symbolic sums")
    if h == "Limit":
        raise CasUnsupported("UNSUPPORTED", "limits")
    if h == "Set":
        return sp.FiniteSet(*[c(a) for a in args])
    if h == "PlusMinus":
        raise CasUnsupported("UNSUPPORTED", "± outside an equation")
    raise CasUnsupported("UNSUPPORTED", f"operator {h}")


def resubstitute(expr, env: Env, masked: frozenset[str] = frozenset()):
    """Apply symbol bindings registered after a definition was stored (e.g. B = 0 after ψ = A sin kx + B cos kx)."""
    for _ in range(3):
        reps = {}
        for s in getattr(expr, "free_symbols", set()):
            name = getattr(s, "name", None)
            if name in env.sym_defs and name not in masked:
                value, line_id = env.sym_defs[name]
                if value != s:
                    reps[s] = value
                    env.used.add(line_id)
        if not reps:
            return expr
        expr = expr.xreplace(reps)
    return expr


def _apply(name: str, args: list, env: Env, subst: bool, dvars: tuple[str, ...], masked: frozenset[str]):
    if not args:
        if subst and name in env.sym_defs and name not in env.functions and name not in env.fn_defs:
            expr, line_id = env.sym_defs[name]
            env.used.add(line_id)
            return expr
        decl = env.functions.get(name)
        if decl:
            args = [env.sym(v) for v in decl]
        elif name in env.fn_defs:
            args = [env.sym(str(v)) for v in env.fn_defs[name][0].variables]
        elif dvars:
            args = [env.sym(v) for v in dvars]
        else:
            raise CasUnsupported("UNSUPPORTED", f"undeclared function {name}")
    if subst and name in env.fn_defs:
        lam, line_id = env.fn_defs[name]
        if len(lam.variables) != len(args):
            raise CasUnsupported("UNSUPPORTED", f"{name} takes {len(lam.variables)} arguments")
        env.used.add(line_id)
        return resubstitute(lam(*args), env, masked)
    return sp.Function(name)(*args)


def to_rel(e: Any, env: Env, subst: bool = True) -> Rel | None:
    if not is_node(e):
        return None
    h, args = e[0], e[1:]
    if h == "Equal":
        lhs, rhs = args
        if rhs is None:
            raise CasIncomplete()
        if is_node(rhs) and rhs[0] == "PlusMinus":
            pm = rhs[1:]
            center = to_sympy(pm[0], env, subst) if len(pm) == 2 else sp.Integer(0)
            off = to_sympy(pm[-1], env, subst)
            return Rel("EqualAny", to_sympy(lhs, env, subst), [center - off, center + off])
        return Rel("Equal", to_sympy(lhs, env, subst), to_sympy(rhs, env, subst))
    if h in INEQUALITIES:
        return Rel(h, to_sympy(args[0], env, subst), to_sympy(args[1], env, subst))
    if h == "And":
        parts = [to_rel(a, env, subst) for a in args]
        if any(p is None for p in parts):
            raise CasUnsupported("UNSUPPORTED", "list of non-relations")
        return Rel("And", parts=parts)  # type: ignore[arg-type]
    if h in ("EqualChain", "Or", "Element"):
        raise CasUnsupported("UNSUPPORTED", f"{h} verification")
    return None


def undefined_functions(expr) -> set[str]:
    try:
        return {str(f.func) for f in sp.sympify(expr).atoms(AppliedUndef)}
    except (TypeError, sp.SympifyError):
        return set()


def rel_exprs(rel: Rel) -> list:
    if rel.op == "And":
        return [x for p in rel.parts for x in rel_exprs(p)]
    if rel.op == "EqualAny":
        return [rel.lhs, *rel.rhs]
    return [rel.lhs, rel.rhs]


def rel_free_symbols(rel: Rel) -> set[sp.Symbol]:
    out: set[sp.Symbol] = set()
    for x in rel_exprs(rel):
        out |= {s for s in sp.sympify(x).free_symbols if isinstance(s, sp.Symbol)}
    return out


def rel_functions(rel: Rel) -> set[str]:
    out: set[str] = set()
    for x in rel_exprs(rel):
        out |= undefined_functions(x)
    return out
