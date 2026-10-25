"""Graph lines (spec in packages/contracts/src/graph.ts) -> a PNG drawn by matplotlib.

Fixed drawing code only: formulas arrive as validated MathJSON, become SymPy by an operator
whitelist (never sympify/parse_expr/eval), and are evaluated with numpy. Nothing the model
writes is run as code.
"""

from __future__ import annotations

import base64
import io
import json
from typing import Any

import matplotlib
import numpy as np
import sympy as sp

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from .ir import is_node  # noqa: E402

GRAPH_VERSION = "1"

# samples per curve, per side of a grid, per side of a surface
N_CURVE = 600
N_GRID = 240
N_SURFACE = 70
N_VECTOR = 21

DPI = 150
SIZE_2D = (6.4, 4.0)
SIZE_3D = (6.4, 4.8)
INK = "#1a2030"
COLORS = ["#4f46e5", "#c2410c", "#15803d", "#b45309", "#0e7490", "#be185d", "#52607a", "#7c3aed"]


class GraphError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ------------------------------------------------------------------ MathJSON -> SymPy


_UNARY = {
    "Sqrt": sp.sqrt,
    "Abs": sp.Abs,
    "Sin": sp.sin,
    "Cos": sp.cos,
    "Tan": sp.tan,
    "Exp": sp.exp,
    "Ln": sp.log,
}
_CONSTANTS = {"Pi": sp.pi, "ExponentialE": sp.E, "ImaginaryUnit": sp.I}
_RELATIONS = {"Less": sp.Lt, "LessEqual": sp.Le, "Greater": sp.Gt, "GreaterEqual": sp.Ge}


def to_expr(e: Any, names: dict[str, sp.Expr]):
    """Convert one formula; every name must be an axis variable, a parameter or a constant."""
    if isinstance(e, bool):
        raise GraphError("IR_INVALID", "unexpected boolean")
    if isinstance(e, int):
        return sp.Integer(e)
    if isinstance(e, float):
        return sp.Float(e)
    if isinstance(e, str):
        if e in _CONSTANTS:
            return _CONSTANTS[e]
        name = "hbar" if e == "Hbar" else e
        if name in names:
            return names[name]
        raise GraphError("UNKNOWN_SYMBOL", f"{name} has no value: give it a constant or use an axis variable")
    if not is_node(e):
        raise GraphError("IR_INVALID", "malformed formula")
    h, args = e[0], e[1:]

    def c(x):
        return to_expr(x, names)

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
        return sp.Pow(c(args[0]), c(args[1]))
    if h in _UNARY:
        return _UNARY[h](c(args[0]))
    if h == "Equal":
        # an implicit curve F(x, y) = G(x, y) is drawn where F - G = 0
        return c(args[0]) - c(args[1])
    if h in _RELATIONS:
        return _RELATIONS[h](c(args[0]), c(args[1]))
    if h == "And":
        return sp.And(*[c(a) for a in args])
    if h == "Apply":
        raise GraphError("UNSUPPORTED", f"write {args[0]} out as a formula: graphs cannot use notebook functions by name")
    raise GraphError("UNSUPPORTED", f"graphs cannot draw {h}")


def _names(spec: dict, variables: list[str]) -> tuple[dict[str, sp.Expr], list[sp.Symbol]]:
    syms = [sp.Symbol(v, real=True) for v in variables]
    names: dict[str, sp.Expr] = {v: s for v, s in zip(variables, syms, strict=True)}
    for k, val in (spec.get("constants") or {}).items():
        if k not in names:
            names[k] = sp.nsimplify(val) if float(val).is_integer() else sp.Float(val)
    names.setdefault("hbar", sp.Integer(1))
    return names, syms


def _fn(series: dict, slot: str, spec: dict, variables: list[str]):
    formula = (series.get("formulas") or {}).get(slot)
    if not formula:
        raise GraphError("IR_INVALID", f"{series['type']} needs {slot}")
    names, syms = _names(spec, variables)
    expr = to_expr(formula["expr"], names)
    f = sp.lambdify(syms, expr, modules="numpy")

    def call(*arrays):
        with np.errstate(all="ignore"):
            out = f(*arrays)
        shape = np.broadcast(*arrays).shape if arrays else ()
        return np.broadcast_to(np.asarray(out), shape)

    return call, expr


def _part(values, part: str):
    v = np.asarray(values)
    if np.iscomplexobj(v):
        if part == "im":
            v = v.imag
        elif part == "abs":
            v = np.abs(v)
        elif part == "abs2":
            v = np.abs(v) ** 2
        else:
            v = v.real
    elif part == "abs":
        v = np.abs(v)
    elif part == "abs2":
        v = np.abs(v) ** 2
    elif part == "im":
        v = np.zeros_like(v, dtype=float)
    # a copy: the values may be a read-only broadcast view
    v = np.array(v, dtype=float)
    v[~np.isfinite(v)] = np.nan
    return v


def _bool(values, shape):
    out = np.broadcast_to(np.asarray(values, dtype=bool), shape)
    return out


def _span(r):
    return np.linspace(float(r[0]), float(r[1]), N_CURVE)


def _break_poles(y: np.ndarray) -> np.ndarray:
    """Lift the pen where a curve leaps across most of its visible range (tan x at pi/2), so no wall is drawn."""
    lim = _robust_limits([y])
    if lim is None or y.size < 3:
        return y
    jump = np.abs(np.diff(y)) > 0.8 * (lim[1] - lim[0])
    if not jump.any():
        return y
    out = y.copy()
    out[1:][jump] = np.nan
    return out


def _robust_limits(values: list[np.ndarray]):
    """A range that shows the curve without letting a pole (tan x, 1/x) flatten it."""
    flat = np.concatenate([v[np.isfinite(v)].ravel() for v in values if v.size]) if values else np.array([])
    if flat.size == 0:
        return None
    lo, hi = np.percentile(flat, [2, 98])
    full_lo, full_hi = float(flat.min()), float(flat.max())
    span = hi - lo
    # keep the true extremes unless they sit far beyond the bulk of the values
    if full_hi - hi <= 2 * max(span, 1e-12):
        hi = full_hi
    if lo - full_lo <= 2 * max(span, 1e-12):
        lo = full_lo
    if hi - lo < 1e-9:
        pad = max(abs(hi), 1.0) * 0.5
        return lo - pad, hi + pad
    pad = (hi - lo) * 0.06
    return lo - pad, hi + pad


# ------------------------------------------------------------------ drawing


def _label(text: str | None) -> str | None:
    if not text:
        return None
    return text


def _draw_2d(ax, spec: dict) -> list[np.ndarray]:
    xr = spec["axes"]["x"]["range"]
    yr = spec["axes"]["y"].get("range")
    ys: list[np.ndarray] = []
    grid_y = yr or xr
    for i, s in enumerate(spec["series"]):
        color = COLORS[i % len(COLORS)]
        label = _label(s.get("label"))
        t = s["type"]
        part = s.get("part", "re")
        if t == "function":
            f, _ = _fn(s, "y", spec, ["x"])
            x = _span(xr)
            y = _part(f(x), part)
            ys.append(y)
            ax.plot(x, _break_poles(y), color=color, lw=1.8, label=label)
        elif t in ("parametric", "polar"):
            p = s["params"][0]
            tt = _span(p["range"])
            if t == "parametric":
                fx, _ = _fn(s, "x", spec, [p["name"]])
                fy, _ = _fn(s, "y", spec, [p["name"]])
                x, y = _part(fx(tt), part), _part(fy(tt), part)
            else:
                fr, _ = _fn(s, "r", spec, [p["name"]])
                r = _part(fr(tt), part)
                x, y = r * np.cos(tt), r * np.sin(tt)
            ys.append(y)
            ax.plot(x, y, color=color, lw=1.8, label=label)
        elif t in ("implicit", "contour", "region"):
            gx = np.linspace(float(xr[0]), float(xr[1]), N_GRID)
            gy = np.linspace(float(grid_y[0]), float(grid_y[1]), N_GRID)
            X, Y = np.meshgrid(gx, gy)
            slot = "z" if t == "contour" else "f"
            f, expr = _fn(s, slot, spec, ["x", "y"])
            if t == "region":
                if not isinstance(expr, sp.logic.boolalg.Boolean) and not isinstance(expr, sp.core.relational.Relational):
                    raise GraphError("IR_INVALID", "a region needs an inequality such as x^2 + y^2 < 1")
                mask = _bool(f(X, Y), X.shape)
                if not mask.any():
                    raise GraphError("EMPTY", "the region is empty in this range")
                ax.contourf(X, Y, mask.astype(float), levels=[0.5, 1.5], colors=[color], alpha=0.28)
                ax.contour(X, Y, mask.astype(float), levels=[0.5], colors=[color], linewidths=1.2)
                if label:
                    ax.plot([], [], color=color, lw=6, alpha=0.4, label=label)
            elif t == "implicit":
                Z = _part(f(X, Y), part)
                if not np.isfinite(Z).any() or np.nanmin(Z) > 0 or np.nanmax(Z) < 0:
                    raise GraphError("EMPTY", "the curve does not pass through this range")
                ax.contour(X, Y, Z, levels=[0], colors=[color], linewidths=1.8)
                if label:
                    ax.plot([], [], color=color, lw=1.8, label=label)
            else:
                Z = _part(f(X, Y), part)
                if not np.isfinite(Z).any():
                    raise GraphError("EMPTY", "no finite values in this range")
                if s.get("filled", True):
                    cs = ax.contourf(X, Y, Z, levels=20, cmap="viridis")
                    ax.figure.colorbar(cs, ax=ax, shrink=0.85, label=label)
                else:
                    cs = ax.contour(X, Y, Z, levels=12, cmap="viridis")
                    ax.clabel(cs, fontsize=7)
            ys.append(gy)
        elif t == "vector_field":
            gx = np.linspace(float(xr[0]), float(xr[1]), N_VECTOR)
            gy = np.linspace(float(grid_y[0]), float(grid_y[1]), N_VECTOR)
            X, Y = np.meshgrid(gx, gy)
            fu, _ = _fn(s, "u", spec, ["x", "y"])
            fv, _ = _fn(s, "v", spec, ["x", "y"])
            U, V = _part(fu(X, Y), part), _part(fv(X, Y), part)
            if not (np.isfinite(U) & np.isfinite(V)).any():
                raise GraphError("EMPTY", "no finite vectors in this range")
            ax.quiver(X, Y, U, V, color=color, angles="xy", pivot="mid", width=0.004, label=label)
            ys.append(gy)
        elif t == "points":
            pts = np.asarray(s.get("points") or [], dtype=float)
            if pts.size == 0:
                raise GraphError("EMPTY", "no points")
            ax.scatter(pts[:, 0], pts[:, 1], color=color, s=18, zorder=3, label=label)
            ys.append(pts[:, 1])
        else:
            raise GraphError("IR_INVALID", f"{t} is not a 2D series")
    return ys


def _draw_3d(ax, spec: dict) -> list[np.ndarray]:
    xr = spec["axes"]["x"]["range"]
    yr = spec["axes"]["y"].get("range") or xr
    zs: list[np.ndarray] = []
    for i, s in enumerate(spec["series"]):
        color = COLORS[i % len(COLORS)]
        label = _label(s.get("label"))
        t = s["type"]
        part = s.get("part", "re")
        if t == "surface":
            gx = np.linspace(float(xr[0]), float(xr[1]), N_SURFACE)
            gy = np.linspace(float(yr[0]), float(yr[1]), N_SURFACE)
            X, Y = np.meshgrid(gx, gy)
            f, _ = _fn(s, "z", spec, ["x", "y"])
            Z = _part(f(X, Y), part)
            if not np.isfinite(Z).any():
                raise GraphError("EMPTY", "no finite values in this range")
            # one surface gets a height colour map; several are told apart by colour
            look = {"cmap": "viridis"} if len(spec["series"]) == 1 else {"color": color}
            ax.plot_surface(X, Y, Z, linewidth=0, antialiased=True, alpha=0.92, rstride=1, cstride=1, **look)
            zs.append(Z)
        elif t == "parametric_surface":
            pu, pv = s["params"][0], s["params"][1]
            gu = np.linspace(float(pu["range"][0]), float(pu["range"][1]), N_SURFACE)
            gv = np.linspace(float(pv["range"][0]), float(pv["range"][1]), N_SURFACE)
            U, V = np.meshgrid(gu, gv)
            names = [pu["name"], pv["name"]]
            fx, _ = _fn(s, "x", spec, names)
            fy, _ = _fn(s, "y", spec, names)
            fz, _ = _fn(s, "z", spec, names)
            X, Y, Z = _part(fx(U, V), part), _part(fy(U, V), part), _part(fz(U, V), part)
            if not np.isfinite(Z).any():
                raise GraphError("EMPTY", "no finite values for these parameters")
            ax.plot_surface(X, Y, Z, color=color, linewidth=0, antialiased=True, alpha=0.85, shade=True)
            zs.append(Z)
        elif t == "curve3d":
            p = s["params"][0]
            tt = _span(p["range"])
            fx, _ = _fn(s, "x", spec, [p["name"]])
            fy, _ = _fn(s, "y", spec, [p["name"]])
            fz, _ = _fn(s, "z", spec, [p["name"]])
            x, y, z = _part(fx(tt), part), _part(fy(tt), part), _part(fz(tt), part)
            ax.plot(x, y, z, color=color, lw=1.8, label=label)
            zs.append(z)
        elif t == "points3d":
            pts = np.asarray(s.get("points") or [], dtype=float)
            if pts.size == 0:
                raise GraphError("EMPTY", "no points")
            ax.scatter(pts[:, 0], pts[:, 1], pts[:, 2], color=color, s=16, label=label)
            zs.append(pts[:, 2])
        else:
            raise GraphError("IR_INVALID", f"{t} is not a 3D series")
    return zs


def _style(ax, three_d: bool, filled: bool):
    ax.tick_params(colors=INK, labelsize=8)
    for side in ("top", "right") if not three_d else ():
        ax.spines[side].set_visible(False)
    # a filled colour map is its own background: grid lines would only cut through it
    if not three_d and not filled:
        ax.grid(True, color="#d6d8de", linewidth=0.6)
        ax.axhline(0, color="#9aa0ad", linewidth=0.8, zorder=0)
        ax.axvline(0, color="#9aa0ad", linewidth=0.8, zorder=0)


def _figure(spec: dict):
    three_d = spec["kind"] == "3d"
    fig = plt.figure(figsize=SIZE_3D if three_d else SIZE_2D, dpi=DPI)
    if three_d:
        ax = fig.add_subplot(111, projection="3d")
        view = spec.get("view") or {}
        ax.view_init(elev=float(view.get("elev", 25)), azim=float(view.get("azim", -60)))
        values = _draw_3d(ax, spec)
        ax.set_xlim(*spec["axes"]["x"]["range"])
        if spec["axes"]["y"].get("range"):
            ax.set_ylim(*spec["axes"]["y"]["range"])
        z_axis = spec["axes"].get("z") or {}
        if z_axis.get("range"):
            ax.set_zlim(*z_axis["range"])
        else:
            lim = _robust_limits(values)
            if lim:
                ax.set_zlim(*lim)
        ax.set_zlabel(z_axis.get("label") or "z", color=INK)
    else:
        ax = fig.add_subplot(111)
        values = _draw_2d(ax, spec)
        ax.set_xlim(*spec["axes"]["x"]["range"])
        if spec["axes"]["y"].get("range"):
            ax.set_ylim(*spec["axes"]["y"]["range"])
        else:
            lim = _robust_limits(values)
            if lim is None:
                raise GraphError("EMPTY", "nothing to draw in this range")
            ax.set_ylim(*lim)
        if spec.get("aspect") == "equal":
            ax.set_aspect("equal", adjustable="datalim")
    ax.set_xlabel(spec["axes"]["x"].get("label") or "x", color=INK)
    ax.set_ylabel(spec["axes"]["y"].get("label") or "y", color=INK)
    _style(ax, three_d, any(x["type"] == "contour" and x.get("filled", True) for x in spec["series"]))
    handles, labels = ax.get_legend_handles_labels()
    if labels:
        ax.legend(fontsize=8, frameon=False)
    if not any(np.isfinite(v).any() for v in values if np.asarray(v).size):
        raise GraphError("EMPTY", "nothing to draw in this range")
    fig.tight_layout()
    return fig


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=DPI, facecolor="white")
    return buf.getvalue()


def _plain_labels(spec: dict) -> dict:
    """The same graph with every label as plain text, for labels matplotlib cannot read as mathtext."""
    out = json.loads(json.dumps(spec))
    for axis in out["axes"].values():
        if axis.get("label"):
            axis["label"] = axis["label"].replace("$", "")
    for s in out["series"]:
        if s.get("label"):
            s["label"] = s["label"].replace("$", "")
    return out


def _draw(spec: dict) -> dict:
    fig = _figure(spec)
    try:
        data = _png(fig)
        width, height = (int(round(v * DPI)) for v in fig.get_size_inches())
    finally:
        plt.close(fig)
    return {"ok": True, "png": base64.b64encode(data).decode("ascii"), "width": width, "height": height}


def render(spec: dict) -> dict:
    """Draw one graph: {ok, png (base64), width, height} or {ok: False, code, message}."""
    try:
        try:
            return _draw(spec)
        except ValueError:
            # most often a label that is not valid mathtext; anything else fails again below
            plt.close("all")
            return _draw(_plain_labels(spec))
    except GraphError as e:
        plt.close("all")
        return {"ok": False, "code": e.code, "message": e.message}
    except (KeyError, IndexError, TypeError) as e:
        plt.close("all")
        return {"ok": False, "code": "IR_INVALID", "message": f"malformed graph: {e}"}
    except (ValueError, ZeroDivisionError, OverflowError, sp.SympifyError) as e:
        plt.close("all")
        return {"ok": False, "code": "DRAW_FAILED", "message": str(e)[:300]}


def render_json(spec_json: str) -> str:
    """The worker's entry point: JSON in, JSON out."""
    try:
        spec = json.loads(spec_json)
    except json.JSONDecodeError:
        return json.dumps({"ok": False, "code": "IR_INVALID", "message": "not JSON"})
    return json.dumps(render(spec))


def versions() -> dict:
    return {"graph": GRAPH_VERSION, "matplotlib": matplotlib.__version__, "numpy": np.__version__, "sympy": sp.__version__}
