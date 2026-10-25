"""Worker configuration. The Lean project (toolchain, Mathlib, REPL) is pinned in ../lean."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

HERE = Path(__file__).resolve().parent

# The part of Mathlib proofs run in: school and first-year analysis (reals, |x|, finite sums,
# parity, primes, factorials) and the standard tactics. All of Mathlib needs several GB of memory
# and minutes to load on a laptop; a server with room for it can set LEAN_IMPORTS=Mathlib.
DEFAULT_IMPORTS = ",".join(
    [
        "Mathlib.Basic.Real.Basic",
        "Mathlib.Algebra.Order.AbsoluteValue.Basic",
        "Mathlib.Algebra.Order.Field.Basic",
        "Mathlib.Algebra.BigOperators.Intervals",
        "Mathlib.Algebra.Group.Even",
        "Mathlib.Data.Nat.Factorial.Basic",
        "Mathlib.Data.Nat.Prime.Basic",
        "Mathlib.Data.Int.GCD",
        "Mathlib.Tactic.Linarith",
        "Mathlib.Tactic.Positivity",
        "Mathlib.Tactic.Ring",
        "Mathlib.Tactic.FieldSimp",
        "Mathlib.Tactic.NormNum",
        "Mathlib.Tactic.GCongr",
        "Mathlib.Tactic.Bound",
        "Mathlib.Tactic.Use",
    ]
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # spec §17.3 names; LEAN_PROJECT_DIR holds lakefile.toml and the built .lake
    lean_project_dir: str = str(HERE.parent / "lean")
    lake_path: str = "lake"
    # comma list of modules every check starts from
    lean_imports: str = DEFAULT_IMPORTS
    # local: loopback development, where the key is optional; anything else requires it
    app_env: Literal["local", "preview", "production"] = "local"
    # shared secret with the Next.js gateway (checked whenever it is set)
    lean_worker_key: str = ""
    # spec §14.4: twenty seconds per check
    check_timeout_s: float = 20.0
    import_timeout_s: float = 600.0
    # the REPL keeps every environment it made; start a fresh one now and then
    restart_after: int = 200

    @property
    def project(self) -> Path:
        return Path(self.lean_project_dir)

    @property
    def imports(self) -> list[str]:
        # an empty LEAN_IMPORTS= (as in .env.example) means the default set
        return [m.strip() for m in (self.lean_imports or DEFAULT_IMPORTS).split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
