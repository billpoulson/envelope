"""URL path helpers for ENVELOPE_ROOT_PATH (subpath behind a gateway)."""

from app.config import get_settings


def url_path(path: str) -> str:
    """Browser-visible path: applies configured root prefix (e.g. /envelope/bundles)."""
    raw = path.strip() if path else "/"
    if not raw.startswith("/"):
        raw = "/" + raw
    root = get_settings().root_path
    if not root:
        return raw
    if raw == "/":
        return root
    return root + raw
