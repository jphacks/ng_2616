"""Builds the Lean source for one check and reads Lean's messages back onto the steps.

The model writes the theorem's statement and one tactic snippet per notebook line; this module
never trusts either. Snippets are screened for anything that is not plain proof (commands,
metaprogramming, IO, sorry, options), indented into one `by` block so they cannot leave it, and
followed by a marker so the result can tell which steps Lean actually ran.
"""

import re
from dataclasses import dataclass, field

THEOREM = "mn_goal"
MAX_STATEMENT = 2000
MAX_STEP = 2000
MAX_STEPS = 64
MAX_TOTAL = 24000

# Words that have no place in a proof of a stated proposition: declarations and commands, options
# (debug.skipKernelTC would accept anything), metaprogramming, IO and every way to skip a goal.
_FORBIDDEN_WORDS = [
    "sorry", "admit", "axiom", "axioms", "native_decide", "ofReduceBool", "ofReduceNat", "trustCompiler",
    "implemented_by", "extern", "unsafe", "opaque", "partial",
    "run_tac", "run_cmd", "run_elab", "run_meta", "by_elab", "elab", "elab_rules", "macro", "macro_rules",
    "syntax", "notation", "infix", "infixl", "infixr", "prefix", "postfix", "declare_syntax_cat",
    "initialize", "builtin_initialize", "import", "open", "export", "namespace", "section", "universe",
    "set_option", "attribute", "instance", "def", "theorem", "lemma", "example", "abbrev", "structure",
    "class", "inductive", "mutual", "deriving", "variable",
    "IO", "EIO", "BaseIO", "System", "Lean", "Elab", "Meta", "Macro", "Syntax", "TacticM", "MetaM", "CoreM",
    "TermElabM", "CommandElabM", "unsafeIO", "unsafeBaseIO", "unsafeCast", "unsafeEIO", "dbg_trace", "dbgTrace",
    "dbgTraceIfShared", "panic", "Process", "FilePath", "FS", "debug",
]
_FORBIDDEN = re.compile(r"(?<![\w.'])(" + "|".join(map(re.escape, _FORBIDDEN_WORDS)) + r")(?![\w'])")
# commands (#eval, #exit), attributes, block comments, the worker's own step markers, and _root_
# (which would reach the forbidden namespaces past the word check)
_FORBIDDEN_TEXT = ("#", "@[", "/-", "-/", "⟪mn", "_root_")


class SourceRejected(ValueError):
    """The statement or a step contains something the worker does not run."""

    def __init__(self, where: str, detail: str):
        super().__init__(f"{where}: {detail}")
        self.where = where
        self.detail = detail


def screen(text: str, where: str, limit: int) -> None:
    if len(text) > limit:
        raise SourceRejected(where, f"longer than {limit} characters")
    for bad in _FORBIDDEN_TEXT:
        if bad in text:
            raise SourceRejected(where, f'"{bad}" is not allowed')
    m = _FORBIDDEN.search(text)
    if m:
        raise SourceRejected(where, f'"{m.group(1)}" is not allowed')


@dataclass
class Source:
    text: str
    # 1-based line ranges [first, last] of each step's own lines; None for an empty step
    ranges: list[tuple[int, int] | None]
    # 1-based line of each step's marker; None for an empty step
    markers: list[int | None]
    header_lines: int = 1


def marker(i: int) -> str:
    return f"⟪mn:{i}⟫"


def build(statement: str, steps: list[str]) -> Source:
    statement = statement.strip()
    if not statement:
        raise SourceRejected("statement", "empty")
    screen(statement, "statement", MAX_STATEMENT)
    if "--" in statement:
        raise SourceRejected("statement", "comments are not allowed")
    if len(steps) > MAX_STEPS:
        raise SourceRejected("steps", f"more than {MAX_STEPS} steps")
    for i, step in enumerate(steps):
        screen(step, f"step {i}", MAX_STEP)
    # a statement written over several lines is one line here, so messages on it are on line 1.
    # No auto-bound implicits: an unknown name must be an error, never a silently added variable
    # (it would change what the statement says).
    out = [f"set_option autoImplicit false in theorem {THEOREM} : {' '.join(statement.split())} := by"]
    ranges: list[tuple[int, int] | None] = []
    markers: list[int | None] = []
    for i, step in enumerate(steps):
        body = [ln.rstrip() for ln in step.strip("\n").splitlines() if ln.strip()]
        if not body:
            ranges.append(None)
            markers.append(None)
            continue
        # keep the snippet's own relative indentation, under the block's two spaces
        cut = min(len(ln) - len(ln.lstrip()) for ln in body)
        first = len(out) + 1
        out.extend("  " + ln[cut:] for ln in body)
        ranges.append((first, len(out)))
        out.append(f'  trace "{marker(i)}"')
        markers.append(len(out))
    text = "\n".join(out) + "\n"
    if len(text) > MAX_TOTAL:
        raise SourceRejected("steps", f"longer than {MAX_TOTAL} characters in all")
    return Source(text=text, ranges=ranges, markers=markers)


@dataclass
class StepResult:
    index: int
    state: str  # ok | failed | unchecked | empty
    messages: list[str] = field(default_factory=list)


@dataclass
class Reading:
    state: str  # proved | incomplete | failed | invalid
    steps: list[StepResult]
    goals: str | None = None
    statement_error: str | None = None


_UNSOLVED = "unsolved goals"


def _step_of(src: Source, line: int) -> int | None:
    for i, r in enumerate(src.ranges):
        if r and r[0] <= line <= r[1]:
            return i
    return None


def read_messages(src: Source, messages: list[dict]) -> Reading:
    """Maps the REPL's messages onto the steps; `messages` as the REPL returns them."""
    reached: set[int] = set()
    errors: dict[int, list[str]] = {}
    goals: str | None = None
    header_errors: list[str] = []
    for m in messages:
        data = str(m.get("data", ""))
        line = int((m.get("pos") or {}).get("line", 0))
        severity = m.get("severity")
        if severity == "info":
            for i, at in enumerate(src.markers):
                if at == line and marker(i) in data:
                    reached.add(i)
            continue
        if severity != "error":
            continue
        if line <= src.header_lines:
            # the block's leftover goals are reported at `by`; anything else there is the statement
            if data.startswith(_UNSOLVED):
                goals = data[len(_UNSOLVED) :].strip()
            else:
                header_errors.append(data)
            continue
        i = _step_of(src, line)
        if i is None:
            # a marker line: the step before it left Lean unable to go on
            i = next((k for k, at in enumerate(src.markers) if at == line), None)
        if i is None:
            header_errors.append(data)
            continue
        errors.setdefault(i, []).append(data)

    steps: list[StepResult] = []
    for i, r in enumerate(src.ranges):
        if r is None:
            steps.append(StepResult(i, "empty"))
        elif i in errors:
            steps.append(StepResult(i, "failed", errors[i][:3]))
        elif i in reached:
            steps.append(StepResult(i, "ok"))
        else:
            steps.append(StepResult(i, "unchecked"))
    # Lean stops a tactic block at a failing tactic: a step whose marker never ran failed, or was
    # never reached because an earlier one did
    first_stop = next((s.index for s in steps if s.state == "unchecked"), None)
    if first_stop is not None and not any(s.state == "failed" for s in steps[:first_stop]):
        steps[first_stop].state = "failed"
        if not steps[first_stop].messages:
            steps[first_stop].messages = ["Lean could not run this step"]
    if header_errors:
        return Reading("invalid", steps, goals, "\n".join(header_errors)[:2000])
    if any(s.state == "failed" for s in steps):
        return Reading("failed", steps, goals)
    if goals is not None:
        return Reading("incomplete", steps, goals)
    return Reading("proved", steps)


ALLOWED_AXIOMS = {"propext", "Classical.choice", "Quot.sound"}
_AXIOMS = re.compile(r"depends on axioms: \[([^\]]*)\]")


def axioms_ok(messages: list[dict]) -> bool:
    """`#print axioms` output: only Lean's three standard axioms (no sorryAx, no ofReduceBool)."""
    for m in messages:
        data = str(m.get("data", ""))
        if "does not depend on any axioms" in data:
            return True
        found = _AXIOMS.search(data)
        if found:
            used = {a.strip() for a in found.group(1).split(",") if a.strip()}
            return used <= ALLOWED_AXIOMS
    return False
