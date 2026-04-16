"""Unit tests for database adapter registry and backend classes (no PostgreSQL required)."""

from __future__ import annotations

import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from cryptography.fernet import Fernet


class BundlesBulkUpsertDelegationTests(unittest.IsolatedAsyncioTestCase):
    """``app.services.bundles.bulk_upsert_bundle_secrets`` delegates to ``get_database_adapter()``."""

    async def test_delegates_to_adapter(self) -> None:
        from app.services.bundles import bulk_upsert_bundle_secrets

        mock_ad = MagicMock()
        mock_ad.bulk_upsert_bundle_secrets = AsyncMock()
        sess = MagicMock()
        rows = [("k", "v", True)]
        with patch("app.db.get_database_adapter", return_value=mock_ad):
            await bulk_upsert_bundle_secrets(sess, 42, rows)
        mock_ad.bulk_upsert_bundle_secrets.assert_called_once_with(sess, 42, rows)

    async def test_empty_rows_does_not_call_adapter(self) -> None:
        from app.services.bundles import bulk_upsert_bundle_secrets

        with patch("app.db.get_database_adapter") as m_get:
            await bulk_upsert_bundle_secrets(MagicMock(), 1, [])
        m_get.assert_not_called()


class GetAdapterForEngineTests(unittest.TestCase):
    """``get_adapter_for_engine`` dispatches on ``engine.dialect.name``."""

    def test_returns_sqlite_adapter(self) -> None:
        from app.database.backends.sqlite import SqliteDatabaseAdapter
        from app.database.registry import get_adapter_for_engine

        eng = MagicMock()
        eng.dialect.name = "sqlite"
        self.assertIsInstance(get_adapter_for_engine(eng), SqliteDatabaseAdapter)

    def test_returns_postgresql_adapter(self) -> None:
        from app.database.backends.postgresql import PostgresqlDatabaseAdapter
        from app.database.registry import get_adapter_for_engine

        eng = MagicMock()
        eng.dialect.name = "postgresql"
        self.assertIsInstance(get_adapter_for_engine(eng), PostgresqlDatabaseAdapter)

    def test_unsupported_dialect_raises(self) -> None:
        from app.database.registry import get_adapter_for_engine

        eng = MagicMock()
        eng.dialect.name = "mysql"
        with self.assertRaises(NotImplementedError) as ctx:
            get_adapter_for_engine(eng)
        self.assertIn("mysql", str(ctx.exception))


class DatabaseAdapterProtocolTests(unittest.TestCase):
    """Runtime-checkable protocol matches concrete adapters."""

    def test_sqlite_matches_protocol(self) -> None:
        from app.database.backends.sqlite import SqliteDatabaseAdapter
        from app.database.database_adapter import DatabaseAdapter

        self.assertIsInstance(SqliteDatabaseAdapter(), DatabaseAdapter)

    def test_postgresql_matches_protocol(self) -> None:
        from app.database.backends.postgresql import PostgresqlDatabaseAdapter
        from app.database.database_adapter import DatabaseAdapter

        self.assertIsInstance(PostgresqlDatabaseAdapter(), DatabaseAdapter)


class SupportsHttpBackupTests(unittest.TestCase):
    def test_sqlite_true(self) -> None:
        from app.database.backends.sqlite import SqliteDatabaseAdapter

        self.assertTrue(SqliteDatabaseAdapter().supports_http_backup())

    def test_postgresql_false(self) -> None:
        from app.database.backends.postgresql import PostgresqlDatabaseAdapter

        self.assertFalse(PostgresqlDatabaseAdapter().supports_http_backup())


class PostgresqlAdapterMigrationTests(unittest.TestCase):
    def test_run_migrations_noop_does_not_touch_connection(self) -> None:
        from app.database.backends.postgresql import PostgresqlDatabaseAdapter

        sync_conn = MagicMock()
        PostgresqlDatabaseAdapter().run_migrations_after_create_all(sync_conn)
        sync_conn.execute.assert_not_called()


class SqliteAdapterBulkUpsertTests(unittest.IsolatedAsyncioTestCase):
    """Exercise ``SqliteDatabaseAdapter.bulk_upsert_bundle_secrets`` on an isolated in-memory engine."""

    def setUp(self) -> None:
        os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
        from app.config import get_settings

        get_settings.cache_clear()

    def tearDown(self) -> None:
        from app.config import get_settings

        get_settings.cache_clear()

    async def test_merge_last_wins_same_key(self) -> None:
        from sqlalchemy import func, select
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        from app.database.backends.sqlite import SqliteDatabaseAdapter
        from app.models import Base, Bundle, BundleGroup, Secret

        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        adapter = SqliteDatabaseAdapter()

        async with factory() as session:
            g = BundleGroup(name="reg-g", slug="reg-g")
            session.add(g)
            await session.flush()
            b = Bundle(name="reg-b", slug="reg-b", group_id=g.id)
            session.add(b)
            await session.flush()
            bid = b.id
            await session.commit()

        async with factory() as session:
            await adapter.bulk_upsert_bundle_secrets(
                session,
                bid,
                [("KEY", "a", True), ("KEY", "b", True)],
            )
            await session.commit()

        async with factory() as session:
            n = (
                await session.execute(
                    select(func.count()).select_from(Secret).where(Secret.bundle_id == bid)
                )
            ).scalar_one()
            self.assertEqual(n, 1)
            row = (
                await session.execute(select(Secret).where(Secret.key_name == "KEY"))
            ).scalar_one()
            self.assertTrue(row.is_secret)
            self.assertNotEqual(row.value_ciphertext, "b")

        await engine.dispose()

    async def test_empty_rows_noop(self) -> None:
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

        from app.database.backends.sqlite import SqliteDatabaseAdapter
        from app.models import Base

        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        adapter = SqliteDatabaseAdapter()
        async with factory() as session:
            await adapter.bulk_upsert_bundle_secrets(session, 1, [])
        await engine.dispose()
