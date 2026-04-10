"""SQLite snapshot and restore helpers for disaster recovery."""

from __future__ import annotations

import os
import re
import sqlite3
import tempfile
from pathlib import Path

from app.db import get_engine, init_db, reset_engine

# Core tables that must exist (older backups may lack optional tables added later; init_db creates missing ones).
_REQUIRED_TABLES = frozenset(
    {
        "bundle_groups",
        "bundles",
        "secrets",
        "api_keys",
    }
)


def database_url_to_sqlite_path(database_url: str) -> str | None:
    """Return filesystem path for sqlite+aiosqlite URL, or None if not a file-backed SQLite URL."""
    if not database_url.startswith("sqlite"):
        return None
    m = re.match(r"sqlite\+aiosqlite:///+(.*)", database_url)
    if not m:
        return None
    path = m.group(1)
    if path in (":memory:",):
        return None
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        return path
    return os.path.abspath(path)


def validate_sqlite_backup_file(path: str | Path) -> None:
    """Raise ValueError if file is not a valid Envelope SQLite backup."""
    p = Path(path)
    if not p.is_file():
        raise ValueError("not a file")
    conn = sqlite3.connect(str(p))
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        if not row or row[0] != "ok":
            raise ValueError("SQLite integrity_check failed")
        found = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        missing = _REQUIRED_TABLES - found
        if missing:
            raise ValueError(f"missing required tables: {sorted(missing)}")
    finally:
        conn.close()


async def snapshot_sqlite_bytes() -> bytes:
    """Consistent online copy of the configured SQLite database using SQLite backup API."""
    import sqlite3 as _sqlite3

    engine = get_engine()
    async with engine.connect() as conn:
        raw = await conn.get_raw_connection()
        driver = raw.driver_connection
        fd, tmp = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        dest = _sqlite3.connect(tmp)
        try:
            await driver.backup(dest)
        finally:
            dest.close()
        try:
            with open(tmp, "rb") as f:
                return f.read()
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass


async def replace_sqlite_database(*, new_content: bytes) -> None:
    """
    Validate bytes as SQLite backup, atomically replace the configured DB file.
    Disposes the global async engine first so the file is not open on Windows.
    """
    from app.config import get_settings

    settings = get_settings()
    path = database_url_to_sqlite_path(settings.database_url)
    if not path:
        raise ValueError("restore is only supported for file-backed SQLite databases")

    parent = Path(path).parent
    parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(suffix=".db", dir=str(parent))
    os.close(fd)
    try:
        with open(tmp_path, "wb") as f:
            f.write(new_content)
        validate_sqlite_backup_file(tmp_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    get_engine()
    await reset_engine()

    try:
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    get_engine()
    await init_db()
