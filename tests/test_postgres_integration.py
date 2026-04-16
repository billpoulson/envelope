"""PostgreSQL integration: run in isolation so settings/engine are not already bound to SQLite.

Example (empty database must exist)::

    docker run -d --name envelope-pg -e POSTGRES_PASSWORD=pass -p 5433:5432 postgres:16
    docker exec envelope-pg psql -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname = 'envelope_test'\" | grep -q 1 || docker exec envelope-pg psql -U postgres -c \"CREATE DATABASE envelope_test;\"
    set ENVELOPE_POSTGRES_TEST_URL=postgresql+asyncpg://postgres:pass@127.0.0.1:5433/envelope_test
    py -3.12 -m unittest tests.test_postgres_integration -v

Full ``python -m unittest discover`` skips this module when another test imported ``app`` first.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock
from uuid import uuid4

from cryptography.fernet import Fernet

_REASON: str | None = None
_PG = os.environ.get("ENVELOPE_POSTGRES_TEST_URL")
if not _PG:
    _REASON = "ENVELOPE_POSTGRES_TEST_URL not set"
elif any(name.startswith("app.") for name in sys.modules):
    _REASON = "run in isolation: py -3.12 -m unittest tests.test_postgres_integration -v"

if _REASON is None:
    os.environ["ENVELOPE_DATABASE_URL"] = _PG
    os.environ.setdefault("ENVELOPE_MASTER_KEY", Fernet.generate_key().decode())
    os.environ.setdefault("ENVELOPE_SESSION_SECRET", "test-session-secret-test-session-secret")
    os.environ["ENVELOPE_DEBUG"] = "true"

from sqlalchemy import delete, func, select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database.backends.postgresql import PostgresqlDatabaseAdapter  # noqa: E402
from app.db import get_database_adapter, get_engine, get_session_factory, init_db, reset_engine  # noqa: E402
from app.models import Bundle, BundleGroup, Secret  # noqa: E402
from app.services.bundles import bulk_upsert_bundle_secrets  # noqa: E402

if _REASON is None:
    get_settings.cache_clear()


@unittest.skipIf(_REASON is not None, _REASON or "")
class PostgresIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        await reset_engine()
        get_settings.cache_clear()
        await init_db()

    async def asyncTearDown(self) -> None:
        await reset_engine()
        get_settings.cache_clear()

    async def test_adapter_is_postgresql(self) -> None:
        self.assertIsInstance(get_database_adapter(), PostgresqlDatabaseAdapter)
        self.assertEqual(get_engine().dialect.name, "postgresql")

    def test_postgresql_run_migrations_is_noop(self) -> None:
        sync_conn = MagicMock()
        PostgresqlDatabaseAdapter().run_migrations_after_create_all(sync_conn)
        sync_conn.execute.assert_not_called()

    async def test_bulk_upsert_merges_on_conflict(self) -> None:
        tag = uuid4().hex[:12]
        factory = get_session_factory()
        async with factory() as session:
            g = BundleGroup(name=f"pg-int-{tag}", slug=f"pg-int-{tag}")
            session.add(g)
            await session.flush()
            gid = g.id
            b = Bundle(
                name="b1",
                slug="b1",
                group_id=gid,
            )
            session.add(b)
            await session.flush()
            bid = b.id
            await session.commit()

        async with factory() as session:
            await bulk_upsert_bundle_secrets(
                session,
                bid,
                [("K", "first", True), ("K", "second", True)],
            )
            await session.commit()

        async with factory() as session:
            r = await session.execute(
                select(func.count()).select_from(Secret).where(Secret.bundle_id == bid)
            )
            self.assertEqual(r.scalar_one(), 1)
            row = (
                await session.execute(select(Secret).where(Secret.bundle_id == bid, Secret.key_name == "K"))
            ).scalar_one()
            self.assertIn("second", row.value_ciphertext or "")

        async with factory() as session:
            await session.execute(delete(Secret).where(Secret.bundle_id == bid))
            await session.execute(delete(Bundle).where(Bundle.id == bid))
            await session.execute(delete(BundleGroup).where(BundleGroup.id == gid))
            await session.commit()
