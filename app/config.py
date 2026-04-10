from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENVELOPE_", extra="ignore")

    master_key: str = ""  # Fernet key, url-safe base64
    database_url: str = "sqlite+aiosqlite:///./data/envelope.db"
    session_secret: str = ""
    initial_admin_key: str | None = None  # one-time bootstrap if DB has no keys
    debug: bool = False
    backup_enabled: bool = True
    restore_enabled: bool = False  # opt-in: POST restore replaces the SQLite file


@lru_cache
def get_settings() -> Settings:
    return Settings()
