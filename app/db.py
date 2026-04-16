import os
import re
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import Base

_engine = None
_session_factory = None
_cached_database_adapter = None


async def reset_engine(engine=None) -> None:
    """Dispose the async engine and clear singletons so the DB file can be replaced (e.g. restore)."""
    global _engine, _session_factory, _cached_database_adapter
    to_close = engine if engine is not None else _engine
    if to_close is not None:
        await to_close.dispose()
    _engine = None
    _session_factory = None
    _cached_database_adapter = None


def get_database_adapter():
    """Return the DatabaseAdapter for the current engine (cached until reset_engine)."""
    global _cached_database_adapter
    if _cached_database_adapter is None:
        from app.database.registry import get_adapter_for_engine

        _cached_database_adapter = get_adapter_for_engine(get_engine())
    return _cached_database_adapter


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


def _migrate_sqlite_api_keys_key_lookup_hmac(sync_conn) -> None:
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "api_keys" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("api_keys")}
    if "key_lookup_hmac" not in cols:
        sync_conn.execute(text("ALTER TABLE api_keys ADD COLUMN key_lookup_hmac VARCHAR(64)"))
    # Fast lookup + uniqueness for non-NULL values (SQLite allows multiple NULLs in UNIQUE)
    sync_conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_key_lookup_hmac "
            "ON api_keys(key_lookup_hmac)"
        )
    )


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


_RESERVED_STACK_SLUGS = frozenset({"new"})


def _derive_stack_slug_candidate(raw_name: str, used: set[str]) -> str:
    """Deterministic URL slug from a legacy stack name; avoids collisions within *used*."""
    import re

    s = raw_name.lower().strip()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-") or "stack"
    if s in _RESERVED_STACK_SLUGS:
        s = f"{s}-stack"
    base = s[:128]
    cand = base
    n = 2
    while cand in used:
        suf = f"-{n}"
        room = 128 - len(suf)
        cand = (base[:room] + suf) if room > 0 else suf[-128:]
        n += 1
    used.add(cand)
    return cand


def _migrate_sqlite_bundle_stacks_slug(sync_conn) -> None:
    """Add bundle_stacks.slug (URL identifier); backfill from name; add scoped unique indexes."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundle_stacks" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("bundle_stacks")}
    if "slug" not in cols:
        sync_conn.execute(text("ALTER TABLE bundle_stacks ADD COLUMN slug VARCHAR(128) DEFAULT ''"))

    r = sync_conn.execute(
        text(
            "SELECT id, name, group_id, project_environment_id FROM bundle_stacks "
            "WHERE slug IS NULL OR slug = ''"
        )
    )
    rows = list(r)
    if rows:
        groups: dict[tuple[int | None, int], set[str]] = {}
        r2 = sync_conn.execute(
            text(
                "SELECT group_id, project_environment_id, slug FROM bundle_stacks "
                "WHERE slug IS NOT NULL AND slug != ''"
            )
        )
        for row2 in r2:
            gid, peid, slug = row2[0], row2[1], row2[2]
            key = (gid, peid if peid is not None else -1)
            groups.setdefault(key, set()).add(slug)

        for row in rows:
            _id, name, gid, peid = row[0], row[1], row[2], row[3]
            key = (gid, peid if peid is not None else -1)
            used = groups.setdefault(key, set())
            slug = _derive_stack_slug_candidate(name, used)
            sync_conn.execute(
                text("UPDATE bundle_stacks SET slug = :slug WHERE id = :id"),
                {"slug": slug, "id": _id},
            )

    sync_conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_stacks_scoped_group_slug_env "
            "ON bundle_stacks(group_id, slug, ifnull(project_environment_id, 0)) "
            "WHERE group_id IS NOT NULL AND slug != ''"
        )
    )
    sync_conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bundle_stacks_legacy_slug "
            "ON bundle_stacks(slug) WHERE group_id IS NULL AND slug != ''"
        )
    )


def _migrate_sqlite_bundles_slug(sync_conn) -> None:
    """Add bundles.slug (URL identifier); backfill from name; add scoped unique indexes."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "bundles" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("bundles")}
    if "slug" not in cols:
        sync_conn.execute(text("ALTER TABLE bundles ADD COLUMN slug VARCHAR(128) DEFAULT ''"))

    r = sync_conn.execute(
        text(
            "SELECT id, name, group_id, project_environment_id FROM bundles "
            "WHERE slug IS NULL OR slug = ''"
        )
    )
    rows = list(r)
    if rows:
        groups: dict[tuple[int | None, int], set[str]] = {}
        r2 = sync_conn.execute(
            text(
                "SELECT group_id, project_environment_id, slug FROM bundles "
                "WHERE slug IS NOT NULL AND slug != ''"
            )
        )
        for row2 in r2:
            gid, peid, slug = row2[0], row2[1], row2[2]
            key = (gid, peid if peid is not None else -1)
            groups.setdefault(key, set()).add(slug)

        for row in rows:
            _id, name, gid, peid = row[0], row[1], row[2], row[3]
            key = (gid, peid if peid is not None else -1)
            used = groups.setdefault(key, set())
            slug = _derive_stack_slug_candidate(name, used)
            sync_conn.execute(
                text("UPDATE bundles SET slug = :slug WHERE id = :id"),
                {"slug": slug, "id": _id},
            )

    sync_conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bundles_scoped_group_slug_env "
            "ON bundles(group_id, slug, ifnull(project_environment_id, 0)) "
            "WHERE group_id IS NOT NULL AND slug != ''"
        )
    )
    sync_conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_bundles_legacy_slug "
            "ON bundles(slug) WHERE group_id IS NULL AND slug != ''"
        )
    )


def _migrate_sqlite_assign_environment_to_unassigned_bundles_stacks(sync_conn) -> None:
    """Assign project environments to bundles/stacks that were never tagged.

    Must not violate ``uq_*_scoped_group_slug_env``: same (group, slug) cannot appear twice in one env.
    A naive bulk UPDATE to the first environment can duplicate slug rows and crash startup.
    """
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "project_environments" not in insp.get_table_names():
        return

    def _assign_rows(
        table: str,
        *,
        slug_col: str,
    ) -> None:
        if table not in insp.get_table_names():
            return
        r = sync_conn.execute(
            text(
                f"SELECT id, group_id, {slug_col}, name FROM {table} "
                "WHERE project_environment_id IS NULL AND group_id IS NOT NULL "
                "ORDER BY id"
            )
        )
        rows = r.fetchall()
        for bid, gid, slug_raw, _name in rows:
            slug_val = (slug_raw or "").strip()
            env_rows = sync_conn.execute(
                text(
                    "SELECT id FROM project_environments WHERE group_id = :gid "
                    "ORDER BY sort_order ASC, id ASC"
                ),
                {"gid": gid},
            ).fetchall()
            if not env_rows:
                continue

            # Partial unique index only applies when slug != '' — multiple empty slugs per env OK.
            if not slug_val:
                pe_id = env_rows[0][0]
                sync_conn.execute(
                    text(
                        f"UPDATE {table} SET project_environment_id = :peid WHERE id = :bid"
                    ),
                    {"peid": pe_id, "bid": bid},
                )
                continue

            assigned = False
            for (pe_id,) in env_rows:
                conflict = sync_conn.execute(
                    text(
                        f"SELECT 1 FROM {table} WHERE group_id = :gid AND {slug_col} = :slug "
                        "AND project_environment_id = :peid AND id != :bid LIMIT 1"
                    ),
                    {"gid": gid, "slug": slug_val, "peid": pe_id, "bid": bid},
                ).scalar()
                if conflict is None:
                    sync_conn.execute(
                        text(
                            f"UPDATE {table} SET project_environment_id = :peid WHERE id = :bid"
                        ),
                        {"peid": pe_id, "bid": bid},
                    )
                    assigned = True
                    break

            if assigned:
                continue

            # Same slug already occupies every environment — disambiguate slug, then use first env.
            pe_first = env_rows[0][0]
            base = slug_val[:100]
            n = 2
            while n < 10000:
                cand = f"{base}-m{n}"[:128]
                conflict = sync_conn.execute(
                    text(
                        f"SELECT 1 FROM {table} WHERE group_id = :gid AND {slug_col} = :cand "
                        "AND project_environment_id = :peid LIMIT 1"
                    ),
                    {"gid": gid, "cand": cand, "peid": pe_first},
                ).scalar()
                if conflict is None:
                    sync_conn.execute(
                        text(
                            f"UPDATE {table} SET {slug_col} = :cand, project_environment_id = :peid "
                            "WHERE id = :bid"
                        ),
                        {"cand": cand, "peid": pe_first, "bid": bid},
                    )
                    break
                n += 1

    _assign_rows("bundles", slug_col="slug")
    _assign_rows("bundle_stacks", slug_col="slug")


def _migrate_cleanup_orphan_bundle_stack_layers(sync_conn) -> None:
    """Remove stack layer rows whose bundle no longer exists (legacy rows if FK cascade did not run)."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    tables = insp.get_table_names()
    if "bundle_stack_layers" not in tables or "bundles" not in tables:
        return
    sync_conn.execute(
        text(
            "DELETE FROM bundle_stack_layers WHERE NOT EXISTS "
            "(SELECT 1 FROM bundles WHERE bundles.id = bundle_stack_layers.bundle_id)"
        )
    )


def _migrate_sqlite_bundles_sort_order(sync_conn) -> None:
    """Per-environment display order for bundle lists (matches drag-and-drop in the admin UI)."""
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
    # Assign 0..n-1 per (group_id, project_environment_id) preserving former name order.
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


def _migrate_sqlite_oidc_drop_proxy_column(sync_conn) -> None:
    """Remove legacy proxy_admin_key_id from oidc_app_settings (OIDC links to existing keys per-user)."""
    from sqlalchemy import inspect, text

    insp = inspect(sync_conn)
    if "oidc_app_settings" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("oidc_app_settings")}
    if "proxy_admin_key_id" not in cols:
        return
    try:
        sync_conn.execute(text("ALTER TABLE oidc_app_settings DROP COLUMN proxy_admin_key_id"))
    except Exception:
        pass


def run_sqlite_migrations_after_create_all(sync_conn) -> None:
    """Incremental migrations for existing SQLite files (idempotent)."""
    _migrate_sqlite_secrets_is_secret(sync_conn)
    _migrate_sqlite_bundles_group_id(sync_conn)
    _migrate_sqlite_api_keys_scopes(sync_conn)
    _migrate_sqlite_api_keys_key_lookup_hmac(sync_conn)
    _migrate_sqlite_bundle_groups_slug(sync_conn)
    _migrate_sqlite_bundle_stack_layer_keys(sync_conn)
    _migrate_sqlite_stack_env_links_slice(sync_conn)
    _migrate_sqlite_bundles_stacks_project_environment(sync_conn)
    _migrate_sqlite_assign_environment_to_unassigned_bundles_stacks(sync_conn)
    _migrate_sqlite_bundles_stacks_scoped_names(sync_conn)
    _migrate_sqlite_bundle_stacks_slug(sync_conn)
    _migrate_sqlite_bundles_slug(sync_conn)
    _migrate_sqlite_bundles_sort_order(sync_conn)
    _migrate_sqlite_oidc_drop_proxy_column(sync_conn)


async def init_db() -> None:
    engine = get_engine()
    adapter = get_database_adapter()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_cleanup_orphan_bundle_stack_layers)
        await conn.run_sync(adapter.run_migrations_after_create_all)
