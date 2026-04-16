"""PostgreSQL database adapter (asyncpg)."""

from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_fernet
from app.models import Secret
from app.services.bundles import encode_stored_value


def _migrate_postgresql_bundles_sort_order(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundles" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("bundles")}
    if "sort_order" in cols:
        return
    sync_conn.execute(text("ALTER TABLE bundles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
    rows = sync_conn.execute(
        text(
            "SELECT id, group_id, project_environment_id, name FROM bundles "
            "ORDER BY COALESCE(group_id, 0), COALESCE(project_environment_id, 0), name"
        )
    ).fetchall()
    current_key = None
    i = 0
    for bid, gid, peid, _name in rows:
        key = (gid, peid)
        if key != current_key:
            current_key = key
            i = 0
        sync_conn.execute(
            text("UPDATE bundles SET sort_order = :so WHERE id = :id"),
            {"so": i, "id": bid},
        )
        i += 1


class PostgresqlDatabaseAdapter:
    def run_migrations_after_create_all(self, sync_conn) -> None:
        _migrate_postgresql_bundles_sort_order(sync_conn)

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
            stmt = pg_insert(Secret).values(
                bundle_id=bundle_id,
                key_name=key_name,
                value_ciphertext=stored,
                is_secret=is_secret,
            )
            stmt = stmt.on_conflict_do_update(
                constraint="uq_bundle_key",
                set_=dict(
                    value_ciphertext=stmt.excluded.value_ciphertext,
                    is_secret=stmt.excluded.is_secret,
                ),
            )
            await session.execute(stmt)

    def supports_http_backup(self) -> bool:
        return False
