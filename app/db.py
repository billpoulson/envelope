import os
import re
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import Base

_engine = None
_session_factory = None


async def reset_engine(engine=None) -> None:
    """Dispose the async engine and clear singletons so the DB file can be replaced (e.g. restore)."""
    global _engine, _session_factory
    to_close = engine if engine is not None else _engine
    if to_close is not None:
        await to_close.dispose()
    _engine = None
    _session_factory = None


def _ensure_sqlite_parent_dir(database_url: str) -> None:
    if not database_url.startswith("sqlite"):
        return
    m = re.match(r"sqlite\+aiosqlite:///+(.*)", database_url)
    if not m:
        return
    path = m.group(1)
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        abs_path = path
    else:
        abs_path = os.path.abspath(path)
    parent = os.path.dirname(abs_path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def get_engine():
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        _ensure_sqlite_parent_dir(settings.database_url)
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.debug,
        )
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


def get_session_factory():
    get_engine()
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


def _migrate_sqlite_secrets_is_secret(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "secrets" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("secrets")}
    if "is_secret" in cols:
        return
    sync_conn.execute(
        text("ALTER TABLE secrets ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 1")
    )


def _migrate_sqlite_api_keys_scopes(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "api_keys" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("api_keys")}
    if "scopes" not in cols:
        sync_conn.execute(text("ALTER TABLE api_keys ADD COLUMN scopes TEXT"))
        cols = {c["name"] for c in insp.get_columns("api_keys")}
    if "scope" in cols:
        sync_conn.execute(
            text(
                "UPDATE api_keys SET scopes = "
                "CASE scope WHEN 'admin' THEN '[\"admin\"]' "
                "WHEN 'read' THEN '[\"read:bundle:*\"]' "
                "ELSE '[\"read:bundle:*\"]' END "
                "WHERE scopes IS NULL OR TRIM(scopes) = ''"
            )
        )
        try:
            sync_conn.execute(text("ALTER TABLE api_keys DROP COLUMN scope"))
        except Exception:
            pass


def _migrate_sqlite_bundle_groups_slug(sync_conn) -> None:
    import re

    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundle_groups" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("bundle_groups")}
    if "slug" in cols:
        return
    sync_conn.execute(text("ALTER TABLE bundle_groups ADD COLUMN slug VARCHAR(128)"))
    rows = sync_conn.execute(text("SELECT id, name FROM bundle_groups")).fetchall()
    used: set[str] = set()

    def _slugify(raw: str) -> str:
        s = (raw or "project").lower().strip()
        s = re.sub(r"[^a-z0-9._-]+", "-", s)
        s = re.sub(r"-+", "-", s).strip("-") or "project"
        return s[:120]

    for rid, name in rows:
        base = _slugify(str(name))
        cand = base
        n = 0
        while cand.lower() in used:
            n += 1
            cand = f"{base}-{n}"[:128]
        used.add(cand.lower())
        sync_conn.execute(
            text("UPDATE bundle_groups SET slug = :slug WHERE id = :id"),
            {"slug": cand, "id": rid},
        )
    sync_conn.execute(
        text("CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_groups_slug ON bundle_groups(slug)")
    )


def _migrate_sqlite_bundles_group_id(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundles" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("bundles")}
    if "group_id" in cols:
        return
    sync_conn.execute(
        text(
            "ALTER TABLE bundles ADD COLUMN group_id INTEGER "
            "REFERENCES bundle_groups(id) ON DELETE SET NULL"
        )
    )


def _migrate_sqlite_bundle_stack_layer_keys(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundle_stack_layers" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("bundle_stack_layers")}
    if "keys_mode" not in cols:
        sync_conn.execute(
            text(
                "ALTER TABLE bundle_stack_layers ADD COLUMN keys_mode VARCHAR(16) "
                "NOT NULL DEFAULT 'all'"
            )
        )
    if "selected_keys_json" not in cols:
        sync_conn.execute(
            text("ALTER TABLE bundle_stack_layers ADD COLUMN selected_keys_json TEXT")
        )
    if "layer_label" not in cols:
        sync_conn.execute(
            text("ALTER TABLE bundle_stack_layers ADD COLUMN layer_label VARCHAR(256)")
        )
    if "aliases_json" not in cols:
        sync_conn.execute(text("ALTER TABLE bundle_stack_layers ADD COLUMN aliases_json TEXT"))


def _migrate_sqlite_bundles_stacks_project_environment(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundles" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("bundles")}
        if "project_environment_id" not in cols:
            sync_conn.execute(
                text(
                    "ALTER TABLE bundles ADD COLUMN project_environment_id INTEGER "
                    "REFERENCES project_environments(id) ON DELETE SET NULL"
                )
            )
            sync_conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_bundles_project_environment_id "
                    "ON bundles(project_environment_id)"
                )
            )
    if "bundle_stacks" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("bundle_stacks")}
        if "project_environment_id" not in cols:
            sync_conn.execute(
                text(
                    "ALTER TABLE bundle_stacks ADD COLUMN project_environment_id INTEGER "
                    "REFERENCES project_environments(id) ON DELETE SET NULL"
                )
            )
            sync_conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_bundle_stacks_project_environment_id "
                    "ON bundle_stacks(project_environment_id)"
                )
            )


def _migrate_sqlite_stack_env_links_slice(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "stack_env_links" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("stack_env_links")}
    if "through_layer_position" in cols:
        return
    sync_conn.execute(
        text("ALTER TABLE stack_env_links ADD COLUMN through_layer_position INTEGER")
    )
    sync_conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_stack_env_links_through_layer_position "
            "ON stack_env_links(through_layer_position)"
        )
    )


def _migrate_sqlite_bundles_stacks_scoped_names(sync_conn) -> None:
    """Allow duplicate bundle/stack display names across environments within a project."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    for table in ("bundles", "bundle_stacks"):
        if table not in insp.get_table_names():
            continue
        for idx in insp.get_indexes(table):
            if not idx.get("unique"):
                continue
            cols = idx.get("column_names") or []
            if cols == ["name"]:
                sync_conn.execute(text(f'DROP INDEX IF EXISTS "{idx["name"]}"'))
        sync_conn.execute(
            text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_scoped_group_name_env "
                f"ON {table}(group_id, name, ifnull(project_environment_id, 0)) "
                f"WHERE group_id IS NOT NULL"
            )
        )
        sync_conn.execute(
            text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table}_legacy_name "
                f"ON {table}(name) WHERE group_id IS NULL"
            )
        )


async def init_db() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if conn.engine.dialect.name == "sqlite":
            await conn.run_sync(_migrate_sqlite_secrets_is_secret)
            await conn.run_sync(_migrate_sqlite_bundles_group_id)
            await conn.run_sync(_migrate_sqlite_api_keys_scopes)
            await conn.run_sync(_migrate_sqlite_bundle_groups_slug)
            await conn.run_sync(_migrate_sqlite_bundle_stack_layer_keys)
            await conn.run_sync(_migrate_sqlite_stack_env_links_slice)
            await conn.run_sync(_migrate_sqlite_bundles_stacks_project_environment)
            await conn.run_sync(_migrate_sqlite_bundles_stacks_scoped_names)
