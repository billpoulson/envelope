"""Protocol for database-specific behavior (upserts, migrations) on top of SQLAlchemy."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from sqlalchemy.ext.asyncio import AsyncSession


@runtime_checkable
class DatabaseAdapter(Protocol):
    """Thin backend seam: not a second ORM — only dialect-specific operations."""

    def run_migrations_after_create_all(self, sync_conn) -> None:
        """Run legacy or dialect-specific DDL/data fixes after ``metadata.create_all``."""

    async def bulk_upsert_bundle_secrets(
        self,
        session: AsyncSession,
        bundle_id: int,
        rows: list[tuple[str, str, bool]],
    ) -> None:
        """Insert or merge secrets for a bundle (last wins per key_name)."""

    def supports_http_backup(self) -> bool:
        """Whether the admin HTTP database backup API applies to this deployment."""
