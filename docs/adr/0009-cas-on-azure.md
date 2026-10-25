# ADR 0009: The CAS can run on the Azure VM

**Status:** accepted (opt-in per deployment with `NEXT_PUBLIC_CAS_RUNTIME=azure`; Pyodide stays the default)

## Context
Spec §3.1 and §9.3 run the CAS in the browser: a Web Worker loads a pinned Pyodide, SymPy and the
`packages/cas-core` rules, and the main thread terminates it after 5 s. That costs every tab a
download of tens of MB and a startup of several seconds, and slower devices (iPad) pay the most.
The team is moving the heavy checkers to the Azure VM that already serves the LuaLaTeX compiler
and `lean-worker` (ADR 0007, ADR 0008), behind one Caddy on `compiler-private`.

## Decision
- **Same rules, same payload.** `cas-worker/` runs `packages/cas-core` unchanged, with SymPy and
  mpmath pinned to the versions Pyodide bundles. The browser sends the validated IR payload it gave
  its worker; the answer is the same Proof fields. Every shared CAS oracle case
  (`packages/contracts/json/cas-fixtures.json`) is tested through the worker's HTTP API.
- **Same budget.** A check has 5 s in a long-lived process; a check that runs over is killed and the
  process replaced, as the Web Worker was terminated. A small pool (2) serves all users; a request
  waits up to 3 s for a free process, then gets `CAS_BUSY`.
- **Through the gateway.** `POST /api/v1/cas/verify` and `GET /api/v1/cas/health` (Next.js) require
  a signed-in user and add `CAS_WORKER_KEY`; the browser never sees the worker's address or key.
  The route bypasses the job envelope: a check is small and frequent, not an AI job.
- **Same interface in the browser.** `RemoteCasController` implements the engine's `CasPort`, so
  the engine is unchanged. Its version string (`azure / sympy … / rules …+digest`) enters every
  input hash, so switching runtime rechecks each line once instead of trusting the other runtime.
- **Opt-in.** `getCas()` picks the runtime at build time from `NEXT_PUBLIC_CAS_RUNTIME`; without it,
  nothing changes (CI and e2e keep Pyodide). Capabilities report `cas_runtime: pyodide | azure`.

## Consequences
- Each check adds the round trip browser → Vercel function → VM. With Vercel's default US region
  and the VM in Japan East that is a few hundred ms; running the functions in Tokyo (`hnd1`) brings
  it close to the VM.
- The CAS is now shared: a heavy notebook can make others wait (`CAS_BUSY` is retried twice, then
  the line shows the CAS as unavailable). Raise `POOL_SIZE` and the service's CPUs together.
- Offline checking is gone in `azure` mode; Pyodide remains available by switching back.
- The worker sees only IR. `ir.py` translates it by operator dispatch and never evaluates strings;
  the container still has no network, no secrets, a read-only root and a 1 GB limit.
