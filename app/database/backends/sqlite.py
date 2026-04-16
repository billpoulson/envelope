"""SQLite database adapter."""

from __future__ import annotations

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_fernet
from app.models import Secret
from app.services.bundles import encode_stored_value


class SqliteDatabaseAdapter:
    def run_migrations_after_create_all(self, sync_conn) -> None:
        from app.db import run_sqlite_migrations_after_create_all

        run_sqlite_migrations_after_create_all(sync_conn)

    async def bulk_upsert_bundle_secrets(
        self,
        session: AsyncSession,
        bundle_id: int,
        rows: list[tuple[str, str, bool]],
    ) -> None:
        if not rows:
            return
        fernet = get_fernet()
        for key_name, val, is_secret in rows:
            stored = encode_stored_value(fernet, val, is_secret)
            stmt = sqlite_insert(Secret).values(
                bundle_id=bundle_id,
                key_name=key_name,
                value_ciphertext=stored,
                is_secret=is_secret,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[Secret.bundle_id, Secret.key_name],
                set_=dict(
                    value_ciphertext=stmt.excluded.value_ciphertext,
                    is_secret=stmt.excluded.is_secret,
                ),
            )
            await session.execute(stmt)

    def supports_http_backup(self) -> bool:
        return True
