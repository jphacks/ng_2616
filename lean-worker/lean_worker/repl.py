"""One Lean REPL process with Mathlib imported once and reused for every check (spec §14.4).

Checks run one at a time. A check that outlives its time limit kills the whole process tree; the
next check starts a fresh REPL (and pays for importing Mathlib again).
"""

import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


class ReplTimeout(Exception):
    pass


class ReplUnavailable(Exception):
    pass


def repl_binary(project: Path) -> Path:
    exe = "repl.exe" if sys.platform == "win32" else "repl"
    return project / ".lake" / "packages" / "REPL" / ".lake" / "build" / "bin" / exe


class Repl:
    def __init__(self, project: Path, lake: str, import_timeout_s: float, restart_after: int, imports: list[str]):
        self.project = project
        self.header = "\n".join(f"import {m}" for m in imports)
        self.lake = lake
        self.import_timeout_s = import_timeout_s
        self.restart_after = restart_after
        self.proc: subprocess.Popen[bytes] | None = None
        self.out: queue.Queue[dict | None] = queue.Queue()
        self.base_env: int | None = None
        self.used = 0
        self.lock = threading.Lock()
        self.last_error: str | None = None

    @property
    def ready(self) -> bool:
        return self.proc is not None and self.proc.poll() is None and self.base_env is not None

    def _spawn(self) -> None:
        binary = repl_binary(self.project)
        if not binary.exists():
            raise ReplUnavailable(f"REPL is not built: {binary} (run `lake build REPL` in {self.project})")
        kwargs: dict = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        self.proc = subprocess.Popen(
            [self.lake, "env", str(binary)],
            cwd=self.project,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            **kwargs,
        )
        self.out = queue.Queue()
        threading.Thread(target=self._read, args=(self.proc, self.out), daemon=True).start()

    @staticmethod
    def _read(proc: subprocess.Popen[bytes], out: "queue.Queue[dict | None]") -> None:
        # responses are JSON objects separated by blank lines
        buf: list[str] = []
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace")
            if line.strip():
                buf.append(line)
                continue
            if buf:
                text = "".join(buf)
                buf = []
                try:
                    out.put(json.loads(text))
                except json.JSONDecodeError:
                    out.put({"message": f"unreadable REPL output: {text[:200]}"})
        out.put(None)

    def _send(self, cmd: dict, timeout_s: float) -> dict:
        assert self.proc is not None and self.proc.stdin is not None
        try:
            self.proc.stdin.write((json.dumps(cmd, ensure_ascii=False) + "\n\n").encode("utf-8"))
            self.proc.stdin.flush()
        except OSError as e:
            self.kill()
            raise ReplUnavailable(f"REPL went away: {e}") from e
        try:
            res = self.out.get(timeout=timeout_s)
        except queue.Empty as e:
            self.kill()
            raise ReplTimeout() from e
        if res is None:
            self.kill()
            raise ReplUnavailable("REPL exited")
        return res

    def kill(self) -> None:
        proc, self.proc, self.base_env = self.proc, None, None
        if proc is None or proc.poll() is not None:
            return
        try:
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True, check=False)
            else:
                os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass

    def start(self) -> None:
        """Starts the REPL and imports Mathlib (tens of seconds); safe to call when already up."""
        with self.lock:
            self._ensure()

    def _ensure(self) -> None:
        if self.ready and self.used < self.restart_after:
            return
        self.kill()
        started = time.monotonic()
        try:
            self._spawn()
            res = self._send({"cmd": self.header}, self.import_timeout_s)
        except ReplTimeout as e:
            self.last_error = "importing Mathlib timed out"
            raise ReplUnavailable(self.last_error) from e
        except ReplUnavailable as e:
            self.last_error = str(e)
            raise
        errors = [m for m in res.get("messages", []) if m.get("severity") == "error"]
        if "env" not in res or errors:
            self.kill()
            self.last_error = f"importing Mathlib failed: {(errors[0].get('data') if errors else res)!s:.300}"
            raise ReplUnavailable(self.last_error)
        self.base_env = int(res["env"])
        self.used = 0
        self.last_error = None
        print(f"[lean] Mathlib imported in {time.monotonic() - started:.1f}s", flush=True)

    def run(self, source: str, timeout_s: float, then: str | None = None) -> tuple[dict, dict | None]:
        """Runs `source` on the Mathlib environment; `then` runs in the environment it produced."""
        with self.lock:
            self._ensure()
            self.used += 1
            first = self._send({"cmd": source, "env": self.base_env}, timeout_s)
            second = None
            if then is not None and "env" in first:
                second = self._send({"cmd": then, "env": first["env"]}, timeout_s)
            return first, second
