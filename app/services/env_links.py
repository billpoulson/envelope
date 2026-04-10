"""Opaque env download links: random token in URL, only SHA-256 stored."""

from __future__ import annotations

import hashlib
import secrets


def new_env_link_token() -> tuple[str, str]:
    """Return (raw_token_for_url, sha256_hex_for_storage)."""
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return raw, digest


def token_sha256_hex(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
