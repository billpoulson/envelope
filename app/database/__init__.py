"""Database adapters and registry (SQLAlchemy remains the ORM; see ``app.db`` module for engine)."""

from app.database.database_adapter import DatabaseAdapter
from app.database.registry import get_adapter_for_engine

__all__ = ["DatabaseAdapter", "get_adapter_for_engine"]
