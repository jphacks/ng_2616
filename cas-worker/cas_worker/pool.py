"""A few long-lived processes running cas_core.api.verify (the browser ran one Pyodide worker per tab).

A check that runs past its budget cannot be interrupted inside SymPy, so its process is killed and
replaced, exactly as the browser controller terminated its Web Worker. Startup never counts toward
a check's budget.
"""

from __future__ import annotations

import multiprocessing as mp
import queue
import threading
import time
from multiprocessing.connection import Connection
from typing import Any

_ctx = mp.get_context("spawn")


class CasBusy(Exception):
    pass


class CasTimeout(Exception):
    pass


class CasFailed(Exception):
    pass


def _serve(conn: Connection) -> None:
    # imports happen here, in the child, so the parent never loads SymPy
    from cas_core import api

    conn.send(("ready", api.versions()))
    while True:
        try:
            payload = conn.recv()
        except EOFError:
            return
        try:
            proof = api.verify(payload)
            # the browser dropped this before display; never send a server traceback out
            proof.pop("_trace", None)
            conn.send(("ok", proof))
        except Exception as e:  # noqa: BLE001 - any failure is reported, the process lives on
            conn.send(("error", type(e).__name__))


class _Proc:
    def __init__(self) -> None:
        self.conn, child = _ctx.Pipe()
        self.proc = _ctx.Process(target=_serve, args=(child,), daemon=True)
        self.proc.start()
        child.close()
        self.uses = 0
        kind, self.versions = self.conn.recv()
        if kind != "ready":
            raise CasFailed("worker did not start")

    def kill(self) -> None:
        self.proc.kill()
        self.proc.join(5)
        self.conn.close()


class CasPool:
    def __init__(self, size: int, timeout_s: float, queue_wait_s: float, restart_after: int) -> None:
        self.size = size
        self.timeout_s = timeout_s
        self.queue_wait_s = queue_wait_s
        self.restart_after = restart_after
        self.idle: queue.Queue[_Proc] = queue.Queue()
        self.versions: dict[str, str] = {}
        self.ready = threading.Event()

    def start(self) -> None:
        for _ in range(self.size):
            p = _Proc()
            self.versions = p.versions
            self.idle.put(p)
        self.ready.set()

    def _replace(self, old: _Proc) -> None:
        # off the request thread: the caller already has its answer
        def run() -> None:
            old.kill()
            self.idle.put(_Proc())

        threading.Thread(target=run, daemon=True).start()

    def verify(self, payload: dict[str, Any]) -> tuple[dict[str, Any], float]:
        try:
            p = self.idle.get(timeout=self.queue_wait_s)
        except queue.Empty as e:
            raise CasBusy from e
        started = time.perf_counter()
        try:
            p.conn.send(payload)
            if not p.conn.poll(self.timeout_s):
                self._replace(p)
                p = None
                raise CasTimeout
            kind, value = p.conn.recv()
        except (EOFError, OSError) as e:
            if p is not None:
                self._replace(p)
                p = None
            raise CasFailed("worker exited") from e
        finally:
            if p is not None:
                p.uses += 1
                if p.uses >= self.restart_after:
                    self._replace(p)
                else:
                    self.idle.put(p)
        elapsed_ms = (time.perf_counter() - started) * 1000
        if kind != "ok":
            raise CasFailed(value)
        return value, elapsed_ms

    def stop(self) -> None:
        while True:
            try:
                self.idle.get_nowait().kill()
            except queue.Empty:
                return
