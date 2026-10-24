"""Backend configuration (spec §17.3). Secrets come from the environment, never from requests."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["local", "preview", "production"] = "local"
    backend_api_key: str = Field(default="", min_length=0)
    llm_provider: Literal["gemini", "mock"] = "mock"
    llm_model: str = "gemini-3.8-flash"
    gemini_api_key: str = ""
    supabase_url: str = ""
    job_db_path: str = "/var/lib/math-notebook/jobs.sqlite3"
    enabled_features: str = ""
    build_id: str = "dev"

    @property
    def features(self) -> set[str]:
        return {f.strip() for f in self.enabled_features.split(",") if f.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
