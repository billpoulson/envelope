"""Resolve DatabaseAdapter from engine dialect."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine

from app.database.backends.postgresql import PostgresqlDatabaseAdapter
from app.database.backends.sqlite import SqliteDatabaseAdapter
from app.database.database_adapter import DatabaseAdapter


def get_adapter_for_engine(engine: AsyncEngine) -> DatabaseAdapter:
    name = engine.dialect.name
    if name == "sqlite":
        return SqliteDatabaseAdapter()
    if name == "postgresql":
        return PostgresqlDatabaseAdapter()
    raise NotImplementedError(
        f"Unsupported database dialect {name!r}. "
        "Supported: sqlite (aiosqlite), postgresql (asyncpg)."
    )
