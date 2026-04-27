from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def credentials_path() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return base / "envelope" / "credentials.json"
    xdg = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if xdg:
        return Path(xdg) / "envelope" / "credentials.json"
    return Path.home() / ".config" / "envelope" / "credentials.json"


def load_credentials() -> dict[str, Any] | None:
    path = credentials_path()
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def save_credentials(envelope_url: str, api_key: str) -> None:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(
        {"envelope_url": envelope_url.rstrip("/"), "api_key": api_key},
        indent=2,
        sort_keys=True,
    )
    path.write_text(body + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def delete_credentials() -> bool:
    path = credentials_path()
    try:
        path.unlink()
        return True
    except OSError:
        return False
