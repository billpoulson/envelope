"""Unit tests for SQLite backup path helpers and backup file validation."""

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.services.backup_db import database_url_to_sqlite_path, validate_sqlite_backup_file


class DatabaseUrlToSqlitePathTests(unittest.TestCase):
    def test_windows_absolute_drive(self) -> None:
        p = database_url_to_sqlite_path("sqlite+aiosqlite:///C:/tmp/envelope.db")
        self.assertEqual(p, "C:/tmp/envelope.db")

    def test_unix_absolute_four_slash_form(self) -> None:
        """Absolute Unix paths use sqlite:////abs (four slashes); regex-only parsers strip the leading /."""
        p = database_url_to_sqlite_path("sqlite+aiosqlite:////tmp/envelope.db")
        self.assertEqual(p, "/tmp/envelope.db")

    def test_relative_becomes_absolute(self) -> None:
        p = database_url_to_sqlite_path("sqlite+aiosqlite:///./data/envelope.db")
        self.assertIsNotNone(p)
        assert p is not None
        self.assertTrue(os.path.isabs(p))
        self.assertTrue(p.endswith(os.path.join("data", "envelope.db")))

    def test_memory_url_returns_none(self) -> None:
        self.assertIsNone(database_url_to_sqlite_path("sqlite+aiosqlite:///:memory:"))

    def test_non_sqlite_returns_none(self) -> None:
        self.assertIsNone(database_url_to_sqlite_path("postgresql://localhost/db"))


class ValidateSqliteBackupFileTests(unittest.TestCase):
    def _minimal_envelope_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE bundle_groups (id INTEGER PRIMARY KEY);
            CREATE TABLE bundles (id INTEGER PRIMARY KEY);
            CREATE TABLE secrets (id INTEGER PRIMARY KEY);
            CREATE TABLE api_keys (id INTEGER PRIMARY KEY);
            """
        )

    def test_accepts_valid_file(self) -> None:
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            conn = sqlite3.connect(path)
            try:
                self._minimal_envelope_tables(conn)
                conn.commit()
            finally:
                conn.close()
            validate_sqlite_backup_file(path)
        finally:
            Path(path).unlink(missing_ok=True)

    def test_rejects_missing_required_table(self) -> None:
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            conn = sqlite3.connect(path)
            try:
                conn.execute("CREATE TABLE bundle_groups (id INTEGER PRIMARY KEY)")
                conn.execute("CREATE TABLE bundles (id INTEGER PRIMARY KEY)")
                conn.execute("CREATE TABLE secrets (id INTEGER PRIMARY KEY)")
                conn.commit()
            finally:
                conn.close()
            with self.assertRaises(ValueError) as ctx:
                validate_sqlite_backup_file(path)
            self.assertIn("api_keys", str(ctx.exception))
        finally:
            Path(path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
