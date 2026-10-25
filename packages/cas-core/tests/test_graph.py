"""Graph renderer: every series type draws, and bad graphs fail with a reason instead of a picture.

Needs numpy and matplotlib, which the browser's graph worker loads but the CAS does not:
    uv run --with numpy --with matplotlib pytest tests/test_graph.py
Set GRAPH_OUT to a folder to keep the PNGs for a look.
"""

import base64
import os

import pytest

pytest.importorskip("matplotlib")
pytest.importorskip("numpy")

from cas_core.graph import render, to_expr  # noqa: E402


def f(latex, expr):
    return {"latex": latex, "expr": expr}


def series(type_, formulas=None, params=None, **extra):
    return {"type": type_, "formulas": formulas or {}, "params": params or [], "part": extra.pop("part", "re"),
            "filled": extra.pop("filled", type_ == "region"), **extra}


def spec(kind, series_list, x=(-5, 5), y=None, z=None, constants=None, **extra):
    axes = {"x": {"label": "x", "range": list(x)}, "y": {"label": "y", **({"range": list(y)} if y else {})}}
    if kind == "3d":
        axes["z"] = {"label": "z", **({"range": list(z)} if z else {})}
    return {"v": 1, "kind": kind, "title": "", "axes": axes, "constants": constants or {}, "aspect": extra.pop("aspect", "auto"),
            **({"view": {"elev": 25, "azim": -60}} if kind == "3d" else {}), "series": series_list, **extra}


SIN_X = ["Sin", "x"]
X2 = ["Power", "x", 2]
Y2 = ["Power", "y", 2]
PSI = lambda n: ["Multiply", ["Sqrt", 2], ["Sin", ["Multiply", n, "Pi", "x"]]]  # noqa: E731

CASES = {
    "function_family": spec("2d", [series("function", {"y": f("", PSI(n))}, label=f"$n = {n}$") for n in (1, 2, 3)], x=(0, 1)),
    "function_pole": spec("2d", [series("function", {"y": f("", ["Tan", "x"])})], x=(-4, 4)),
    "function_constant": spec("2d", [series("function", {"y": f("", ["Multiply", "a", "x"])})], constants={"a": 0.5}),
    "complex_abs2": spec("2d", [series("function", {"y": f("", ["Exp", ["Multiply", "ImaginaryUnit", "x"]])}, part="abs2")]),
    "parametric": spec("2d", [series("parametric", {"x": f("", ["Cos", "t"]), "y": f("", ["Sin", ["Multiply", 2, "t"]])},
                                     [{"name": "t", "range": [0, 6.3]}])], x=(-1.5, 1.5), aspect="equal"),
    "polar": spec("2d", [series("polar", {"r": f("", ["Add", 1, ["Cos", "theta"]])}, [{"name": "theta", "range": [0, 6.3]}])],
                  x=(-1, 2.5)),
    "implicit": spec("2d", [series("implicit", {"f": f("", ["Equal", ["Add", X2, Y2], 4])})], x=(-3, 3), y=(-3, 3), aspect="equal"),
    "region": spec("2d", [series("region", {"f": f("", ["And", ["Less", ["Add", X2, Y2], 4], ["Greater", "y", "x"]])})],
                   x=(-3, 3), y=(-3, 3)),
    "contour": spec("2d", [series("contour", {"z": f("", ["Exp", ["Negate", ["Add", X2, Y2]]])}, filled=True)],
                    x=(-2, 2), y=(-2, 2)),
    "vector_field": spec("2d", [series("vector_field", {"u": f("", ["Negate", "y"]), "v": f("", "x")})], x=(-2, 2), y=(-2, 2)),
    "points": spec("2d", [series("points", points=[[0, 0], [1, 1], [2, 4], [3, 9]], label="data"),
                          series("function", {"y": f("", X2)})], x=(-0.5, 3.5)),
    "surface": spec("3d", [series("surface", {"z": f("", ["Multiply", ["Sin", "x"], ["Cos", "y"]])})], x=(-3, 3), y=(-3, 3)),
    "parametric_surface": spec("3d", [series("parametric_surface", {
        "x": f("", ["Multiply", ["Cos", "u"], ["Sin", "v"]]),
        "y": f("", ["Multiply", ["Sin", "u"], ["Sin", "v"]]),
        "z": f("", ["Cos", "v"]),
    }, [{"name": "u", "range": [0, 6.3]}, {"name": "v", "range": [0, 3.15]}])], x=(-1.2, 1.2), y=(-1.2, 1.2)),
    "curve3d": spec("3d", [series("curve3d", {"x": f("", ["Cos", "t"]), "y": f("", ["Sin", "t"]), "z": f("", ["Divide", "t", 5])},
                                  [{"name": "t", "range": [0, 18.9]}])], x=(-1.2, 1.2), y=(-1.2, 1.2)),
    "points3d": spec("3d", [series("points3d", points=[[0, 0, 0], [1, 0, 1], [0, 1, 2], [1, 1, 3]])], x=(-0.5, 1.5), y=(-0.5, 1.5)),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_every_series_type_draws(name):
    out = render(CASES[name])
    assert out["ok"], out
    png = base64.b64decode(out["png"])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert out["width"] > 500 and out["height"] > 300
    folder = os.environ.get("GRAPH_OUT")
    if folder:
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f"{name}.png"), "wb") as fh:
            fh.write(png)


def test_unknown_symbol_is_refused():
    out = render(spec("2d", [series("function", {"y": f("", ["Multiply", "k", "x"])})]))
    assert not out["ok"] and out["code"] == "UNKNOWN_SYMBOL" and "k" in out["message"]


def test_notebook_function_by_name_is_refused():
    out = render(spec("2d", [series("function", {"y": f("", ["Apply", "psi", "x"])})]))
    assert not out["ok"] and out["code"] == "UNSUPPORTED"


def test_operators_outside_the_whitelist_are_refused():
    out = render(spec("2d", [series("function", {"y": f("", ["Integrate", "x", ["Tuple", "x", 0, 1]])})]))
    assert not out["ok"] and out["code"] == "UNSUPPORTED"


def test_nothing_finite_is_empty():
    out = render(spec("2d", [series("function", {"y": f("", ["Sqrt", ["Negate", ["Add", X2, 1]]])})]))
    assert not out["ok"] and out["code"] == "EMPTY"


def test_implicit_curve_outside_the_range_is_empty():
    out = render(spec("2d", [series("implicit", {"f": f("", ["Equal", ["Add", X2, Y2], 100])})], x=(-1, 1), y=(-1, 1)))
    assert not out["ok"] and out["code"] == "EMPTY"


def test_a_3d_series_on_2d_axes_is_refused():
    out = render(spec("2d", [series("surface", {"z": f("", X2)})]))
    assert not out["ok"] and out["code"] == "IR_INVALID"


def test_mathtext_a_label_cannot_read_falls_back_to_plain_text():
    s = spec("2d", [series("function", {"y": f("", SIN_X)}, label="$\\notacommand{x}$")])
    assert render(s)["ok"]


def test_converter_never_evaluates_strings():
    import sympy as sp

    x = sp.Symbol("x", real=True)
    with pytest.raises(Exception, match="has no value"):
        to_expr("__import__('os')", {"x": x})
