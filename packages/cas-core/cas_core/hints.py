"""Two-stage recovery hint templates (spec §10). Slots hold line references only, never answers."""

from __future__ import annotations

TEMPLATES: dict[str, tuple[str, str]] = {
    "INTEGRATION_TERM": (
        "Check that each term in the integrand has a corresponding term after integration.",
        "Match each integrand term to the expression inside this line's brackets.",
    ),
    "COEFFICIENT": (
        "Check the constant factor multiplying the expression.",
        "Check where the symbols from line {line} enter this expression.",
    ),
    "SIGN": (
        "Check the signs.",
        "Trace differentiation, transposition, or expansion from line {line}.",
    ),
    "CONSTANT_TERM": (
        "Check the term independent of the variable.",
        "Match the constant part of line {line} to this line.",
    ),
    "MISSING_SOLUTION": (
        "Check that all values satisfying the preceding line remain.",
        "Review whether taking roots or dividing removed a solution.",
    ),
    "EXTRA_SOLUTION": (
        "Check that this line's solutions satisfy the preceding line.",
        "Review whether squaring or multiplying introduced solutions.",
    ),
    "UNCLASSIFIED": (
        "Check each transformation separately.",
        "Split the step across two lines for comparison.",
    ),
}


def hints_for(category: str | None, source_line_id: str | None) -> list[dict]:
    cat = category if category in TEMPLATES else "UNCLASSIFIED"
    refs = [source_line_id] if source_line_id and source_line_id != "problem" else []
    slots = {"line": source_line_id} if refs else {}
    out = []
    for level, text in ((1, TEMPLATES[cat][0]), (2, TEMPLATES[cat][1])):
        out.append(
            {
                "level": level,
                "text": text.replace("line {line}", "the previous line") if not refs else text,
                "refs": refs,
                "template_id": f"{cat}.{level}",
                "slots": slots,
            }
        )
    return out
