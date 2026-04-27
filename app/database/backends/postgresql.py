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


_LAST_ACCESS_COLUMNS = {
    "last_accessed_at": "TIMESTAMP WITH TIME ZONE",
    "last_accessed_usage_name": "VARCHAR(128)",
    "last_accessed_usage_kind": "VARCHAR(64)",
    "last_accessed_usage_run": "VARCHAR(256)",
    "last_accessed_ip": "VARCHAR(128)",
    "last_accessed_user_agent": "VARCHAR(512)",
}


def _migrate_postgresql_last_access_metadata(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    tables = set(insp.get_table_names())
    for table in ("api_keys", "bundle_env_links", "stack_env_links"):
        if table not in tables:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        for name, sql_type in _LAST_ACCESS_COLUMNS.items():
            if name not in cols:
                sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))


def _migrate_postgresql_mcp_approval_requests(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "mcp_approval_requests" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("mcp_approval_requests")}
    desired = {
        "updated_at": "TIMESTAMP WITH TIME ZONE",
        "status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "tool_name": "VARCHAR(128)",
        "arguments_encrypted": "BYTEA",
        "sanitized_arguments_json": "TEXT",
        "requester_api_key_id": "INTEGER",
        "requester_api_key_name": "VARCHAR(128)",
        "requester_scopes_json": "TEXT",
        "resource_type": "VARCHAR(64)",
        "resource_name": "VARCHAR(256)",
        "project_slug": "VARCHAR(128)",
        "environment_slug": "VARCHAR(64)",
        "decision_admin_api_key_id": "INTEGER",
        "decision_admin_api_key_name": "VARCHAR(128)",
        "decided_at": "TIMESTAMP WITH TIME ZONE",
        "decision_note": "TEXT",
        "result_json": "TEXT",
        "error": "TEXT",
    }
    for name, sql_type in desired.items():
        if name not in cols:
            sync_conn.execute(
                text(f"ALTER TABLE mcp_approval_requests ADD COLUMN {name} {sql_type}")
            )
    sync_conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_mcp_approval_requests_status_created_at "
            "ON mcp_approval_requests(status, created_at)"
        )
    )
    sync_conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_mcp_approval_requests_requester_api_key_id "
            "ON mcp_approval_requests(requester_api_key_id)"
        )
    )


class PostgresqlDatabaseAdapter:
    def run_migrations_after_create_all(self, sync_conn) -> None:
        _migrate_postgresql_bundles_sort_order(sync_conn)
        _migrate_postgresql_last_access_metadata(sync_conn)
        _migrate_postgresql_mcp_approval_requests(sync_conn)

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
