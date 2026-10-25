"""Worker configuration. The CAS rules themselves are packages/cas-core, unchanged."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # local: loopback development, where the key is optional; anything else requires it
    app_env: Literal["local", "preview", "production"] = "local"
    # shared secret with the Next.js gateway's CAS_WORKER_KEY (checked whenever it is set)
    cas_worker_key: str = ""
    # spec §9.3: five seconds per check, the same budget the browser worker had
    check_timeout_s: float = 5.0
    # processes checking in parallel; each holds its own SymPy
    pool_size: int = 2
    # how long a request waits for a free process before answering CAS_BUSY
    queue_wait_s: float = 3.0
    # SymPy caches grow; replace a process after this many checks
    restart_after: int = 500


@lru_cache
def get_settings() -> Settings:
    return Settings()
