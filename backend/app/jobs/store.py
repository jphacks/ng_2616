"""SQLite job store (spec §7.2). Stage 1 defines the schema and interface; the dispatcher lands in Stage 2.

Rules to implement:
- persist owner, kind, idempotency key, input digest, payload, state, phase, timestamps, result/error
  before returning 202; unique(owner, kind, key); same key + input returns the same job, changed
  input returns 409
- states: queued -> running -> succeeded/failed; queued/running -> cancelled; queued -> expired
- queue wait <= 30 s; per-kind execution limits; results kept 1 h, dedup keys 24 h
- on restart, running jobs fail with WORKER_RESTARTED (never auto-rerun paid work)
- concurrency: 2 LLM calls, 1 Lean, 4 unfinished per user, 32 waiting overall
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
create table if not exists jobs (
  id text primary key,
  owner text not null,
  kind text not null,
  idempotency_key text not null,
  input_digest text not null,
  payload text not null,
  meta text not null,
  state text not null check (state in ('queued','running','succeeded','failed','cancelled','expired')),
  phase text not null default 'queued',
  created_at text not null,
  started_at text,
  finished_at text,
  expires_at text not null,
  result text,
  error text,
  unique (owner, kind, idempotency_key)
);
create index if not exists jobs_owner_state on jobs (owner, state);
create index if not exists jobs_state_created on jobs (state, created_at);
"""


class JobStore:
    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(SCHEMA)
            # a restart never resumes external work that may already have been paid for
            db.execute("update jobs set state='failed', error='{\"code\":\"WORKER_RESTARTED\"}' where state='running'")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=5)
        db.execute("pragma journal_mode=wal")
        db.execute("pragma busy_timeout=5000")
        return db
