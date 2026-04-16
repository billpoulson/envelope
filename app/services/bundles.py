import csv
import json
import re
import unicodedata
from io import StringIO
from typing import Any, Literal

from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.crypto import CryptoError, decrypt_value, encrypt_value
from app.deps import get_fernet
from app.models import Bundle, Secret

BUNDLE_NAME_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
# Skip lines that are only JSON/array/bracket junk when a JSON blob was pasted into dotenv mode.
_DOTENV_JSON_FRAME_LINE = re.compile(r"^[\s\[\]{},]*$")
# INSERT parameters: (bundle_id, 'key_name', 'value...'
_SQLITE_INSERT_KEY_RE = re.compile(
    r"\bparameters:\s*\(\s*\d+\s*,\s*'((?:[^'\\]|\\.)*)'",
    re.IGNORECASE | re.DOTALL,
)


def extract_conflicting_secret_key_name(error_text: str) -> str | None:
    """Best-effort parse of SQLite/SQLAlchemy INSERT parameter line for secrets.key_name."""
    m = _SQLITE_INSERT_KEY_RE.search(error_text)
    return m.group(1) if m else None

RESERVED_JSON_KEYS = frozenset({"_plaintext_keys", "_bundle_name"})

# Display titles (spaces allowed). Align with stack display rules.
_BUNDLE_DISPLAY_MAX_LEN = 256
_BUNDLE_DISPLAY_FORBIDDEN = re.compile(r'[/\\<>:"|?*\x00-\x1f]')
_BUNDLE_SLUG_MAX_LEN = 128
_BUNDLE_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
# Keep in sync with app.db bundle slug migration reserved set.
RESERVED_BUNDLE_SLUGS = frozenset({"new"})

ImportKind = Literal["json_object", "json_array", "csv_quoted", "dotenv_lines"]

IMPORT_KIND_VALUES: frozenset[str] = frozenset(
    {"skip", "json_object", "json_array", "csv_quoted", "dotenv_lines"}
)


def format_secrets_dotenv(secrets_map: dict[str, str]) -> str:
    """Serialize key/value map to dotenv-style text (sorted keys)."""
    lines = []
    for k in sorted(secrets_map.keys()):
        v = secrets_map[k]
        esc = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        lines.append(f'{k}="{esc}"')
    return "\n".join(lines) + ("\n" if lines else "")

# Strip, NFC-normalize, remove invisible chars that often duplicate keys in pasted exports.
_ZW_CHARS = ("\ufeff", "\u200b", "\u200c", "\u200d", "\u2060")


def normalize_env_key(key: str) -> str:
    s = unicodedata.normalize("NFC", key.strip())
    for ch in _ZW_CHARS:
        s = s.replace(ch, "")
    # Drop other format/control characters (Cf) often embedded in copied IaC output
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Cf")
    return s


def duplicate_key_groups_from_object(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Keys whose raw JSON names collapse to the same normalized name (true duplicates in paste)."""
    from collections import defaultdict

    groups: dict[str, list[str]] = defaultdict(list)
    for key in data:
        if key in RESERVED_JSON_KEYS:
            continue
        if not isinstance(key, str):
            continue
        nk = normalize_env_key(key)
        if nk:
            groups[nk].append(key)
    return [
        {"normalized": nk, "original_keys": raws}
        for nk, raws in sorted(groups.items())
        if len(raws) > 1
    ]


def dedupe_entry_rows(rows: list[tuple[str, str, bool]]) -> list[tuple[str, str, bool]]:
    """Last occurrence wins per key (safety net before DB insert)."""
    merged: dict[str, tuple[str, bool]] = {}
    for k, v, sec in rows:
        merged[k] = (v, sec)
    return [(k, merged[k][0], merged[k][1]) for k in sorted(merged.keys())]


def validate_bundle_display_name(name: str) -> None:
    """Human-readable bundle title (may include spaces)."""
    if not name.strip():
        raise HTTPException(status_code=400, detail="Bundle name is required")
    if len(name) > _BUNDLE_DISPLAY_MAX_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Bundle name must be at most {_BUNDLE_DISPLAY_MAX_LEN} characters",
        )
    if _BUNDLE_DISPLAY_FORBIDDEN.search(name):
        raise HTTPException(
            status_code=400,
            detail='Bundle name cannot contain / \\ : * ? " < > | or control characters',
        )


def validate_bundle_slug(slug: str) -> None:
    """URL-safe bundle identifier (per project environment)."""
    s = slug.strip()
    if not s or len(s) > _BUNDLE_SLUG_MAX_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Bundle slug must be 1–{_BUNDLE_SLUG_MAX_LEN} characters after trim.",
        )
    if not _BUNDLE_SLUG_RE.match(s):
        raise HTTPException(
            status_code=400,
            detail=(
                "Bundle slug: start with a letter or number; "
                "then lowercase letters, numbers, ., _, - only."
            ),
        )
    if s in RESERVED_BUNDLE_SLUGS:
        raise HTTPException(status_code=400, detail=f"Bundle slug {s!r} is reserved.")


def bundle_slug_suggestion_from_display_name(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-") or "bundle"
    if s in RESERVED_BUNDLE_SLUGS:
        s = f"{s}-bundle"
    return s[:_BUNDLE_SLUG_MAX_LEN]


def validate_bundle_path_segment(raw: str) -> None:
    """URL path segment: slug (preferred) or legacy strict bundle name."""
    s = raw.strip()
    if not s:
        raise HTTPException(status_code=400, detail="Bundle path is required")
    try:
        validate_bundle_slug(s)
    except HTTPException:
        if BUNDLE_NAME_RE.match(s):
            return
        raise HTTPException(
            status_code=400,
            detail="Bundle path must be a valid slug or legacy name [a-zA-Z0-9._-]+",
        ) from None


def validate_bundle_name(name: str) -> None:
    """Legacy strict token [a-zA-Z0-9._-]+ (used where the old rules still apply)."""
    if not BUNDLE_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Bundle name must match [a-zA-Z0-9._-]+",
        )


def encode_stored_value(fernet: Fernet, value: str, is_secret: bool) -> str:
    if is_secret:
        return encrypt_value(fernet, value)
    return value


def decode_stored_value(fernet: Fernet, stored: str, is_secret: bool) -> str:
    if is_secret:
        return decrypt_value(fernet, stored)
    return stored


def coerce_value_to_string(v: Any) -> str:
    if isinstance(v, str):
        return v
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return json.dumps(v, sort_keys=True)


def parse_bundle_entries_dict(data: dict[str, Any]) -> tuple[list[tuple[str, str, bool]], str | None]:
    """Parse a JSON object into (key, value, is_secret) rows. Returns (rows, error_message)."""
    if not isinstance(data, dict):
        return [], "JSON must be an object"

    plaintext_keys: set[str] = set()
    raw_pt = data.get("_plaintext_keys")
    if raw_pt is not None:
        if not isinstance(raw_pt, list):
            return [], "_plaintext_keys must be an array of strings"
        for x in raw_pt:
            if not isinstance(x, str):
                return [], "_plaintext_keys must contain only strings"
            nx = normalize_env_key(x)
            if nx:
                plaintext_keys.add(nx)

    # Normalized key -> (value, is_secret); last occurrence wins (handles
    # whitespace, BOM/zero-width, and NFC vs NFD duplicates in pasted JSON).
    merged: dict[str, tuple[str, bool]] = {}
    for key, raw in data.items():
        if key in RESERVED_JSON_KEYS:
            continue
        if not isinstance(key, str):
            return [], "All keys must be strings"
        kn = normalize_env_key(key)
        if not kn:
            return [], "Empty key is not allowed"

        if isinstance(raw, dict) and "value" in raw:
            val = coerce_value_to_string(raw["value"])
            if "secret" in raw:
                is_secret = bool(raw["secret"])
            else:
                is_secret = kn not in plaintext_keys
        else:
            val = coerce_value_to_string(raw)
            is_secret = kn not in plaintext_keys

        merged[kn] = (val, is_secret)

    rows = dedupe_entry_rows([(k, v[0], v[1]) for k, v in merged.items()])
    return rows, None


def _strip_kv_json_line_artifacts(k: str, v: str) -> tuple[str, str]:
    """Strip JSON-array line junk when KEY=value was parsed line-by-line (wrong import kind).

    Pasting a JSON array into **dotenv lines** yields rows like ``"NODE_VERSION=20.20.2",`` — split on
    ``=`` leaves a leading ``"`` on the key and trailing ``"`` on the value. This is not server-side
    buffering; each request is independent.
    """
    k = k.strip().rstrip(",").strip()
    v = v.strip().rstrip(",").strip()
    key_had_leading_quote = k.startswith('"')
    if key_had_leading_quote:
        k = k[1:]
    k = k.rstrip('"').strip()
    if key_had_leading_quote:
        if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            v = v[1:-1]
        elif v.endswith('"'):
            v = v[:-1].strip()
        elif v.startswith('"'):
            v = v[1:].strip()
    return k, v


def _split_key_value_first_eq(s: str) -> tuple[str | None, str | None, str | None]:
    """Split on first '='; return (error, key, value) where error is set if invalid."""
    s = s.strip().rstrip(",").strip()
    if not s:
        return ("Empty entry", None, None)
    if "=" not in s:
        return (f"Expected KEY=value, got: {s!r}", None, None)
    k, _, v = s.partition("=")
    k, v = _strip_kv_json_line_artifacts(k, v)
    kn = normalize_env_key(k)
    if not kn:
        return ("Empty key is not allowed", None, None)
    return (None, kn, v)


def _parse_json_array_of_kv_strings(raw: str) -> tuple[list[tuple[str, str, bool]], str | None]:
    try:
        data = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        return [], f"Invalid JSON: {e}"
    if not isinstance(data, list):
        return [], "Expected a JSON array of strings (each KEY=value)"
    rows: list[tuple[str, str, bool]] = []
    for i, item in enumerate(data):
        if not isinstance(item, str):
            return [], f"JSON array must contain only strings (index {i})"
        err, kn, v = _split_key_value_first_eq(item)
        if err:
            return [], err
        assert kn is not None and v is not None
        rows.append((kn, v, True))
    return dedupe_entry_rows(rows), None


def _parse_csv_quoted_key_value_pairs(raw: str) -> tuple[list[tuple[str, str, bool]], str | None]:
    s = raw.strip()
    if not s:
        return [], None
    s = s.rstrip(",").strip()
    all_cells: list[str] = []
    try:
        for row in csv.reader(StringIO(s)):
            for c in row:
                c = c.strip()
                if c:
                    all_cells.append(c)
    except csv.Error as e:
        return [], f"Could not parse comma-separated values: {e}"
    rows: list[tuple[str, str, bool]] = []
    for cell in all_cells:
        err, kn, v = _split_key_value_first_eq(cell)
        if err:
            return [], err
        assert kn is not None and v is not None
        rows.append((kn, v, True))
    return dedupe_entry_rows(rows), None


def _parse_dotenv_lines(raw: str) -> tuple[list[tuple[str, str, bool]], str | None]:
    rows: list[tuple[str, str, bool]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if _DOTENV_JSON_FRAME_LINE.fullmatch(line):
            continue
        err, kn, v = _split_key_value_first_eq(line)
        if err:
            return [], err
        assert kn is not None and v is not None
        rows.append((kn, v, True))
    return dedupe_entry_rows(rows), None


def parse_bundle_initial_paste(
    raw: str, kind: ImportKind
) -> tuple[list[tuple[str, str, bool]], str | None]:
    """Parse initial bundle variables from pasted text; kind selects the format."""
    raw = raw.strip()
    if not raw:
        return [], None
    if kind == "json_object":
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            return [], f"Invalid JSON: {e}"
        if not isinstance(data, dict):
            return [], "JSON must be an object"
        return parse_bundle_entries_dict(data)
    if kind == "json_array":
        return _parse_json_array_of_kv_strings(raw)
    if kind == "csv_quoted":
        return _parse_csv_quoted_key_value_pairs(raw)
    if kind == "dotenv_lines":
        return _parse_dotenv_lines(raw)
    return [], f"Unknown import kind: {kind!r}"


def parse_bundle_entries_json(raw: str) -> tuple[list[tuple[str, str, bool]], str | None]:
    """Backward compat: same as import kind ``json_object`` (JSON object paste)."""
    return parse_bundle_initial_paste(raw, "json_object")


async def bulk_upsert_bundle_secrets(
    session: AsyncSession,
    bundle_id: int,
    rows: list[tuple[str, str, bool]],
) -> None:
    """Insert secrets for a bundle; identical (bundle_id, key_name) rows merge (last wins)."""
    if not rows:
        return
    from app.db import get_database_adapter

    await get_database_adapter().bulk_upsert_bundle_secrets(session, bundle_id, rows)


async def encrypt_plain_entry(
    session: AsyncSession, bundle_id: int, key_name: str
) -> None:
    """Re-store a plain-text row as Fernet ciphertext (same logical value)."""
    kn = key_name.strip()
    if not kn:
        raise HTTPException(status_code=400, detail="key_name required")
    r = await session.execute(
        select(Secret).where(Secret.bundle_id == bundle_id, Secret.key_name == kn)
    )
    row = r.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Secret not found")
    if row.is_secret:
        return
    fernet = get_fernet()
    plain = decode_stored_value(fernet, row.value_ciphertext, False)
    row.value_ciphertext = encode_stored_value(fernet, plain, True)
    row.is_secret = True


async def upsert_bundle_secret_entry(
    session: AsyncSession,
    bundle_id: int,
    *,
    key_name_input: str,
    value: str,
    is_secret: bool,
    previous_key_name: str | None,
) -> str:
    """Insert or update a bundle variable. With ``previous_key_name``, update that row (rename allowed).

    Returns the stored key name (normalized) for redirects. Raises ``ValueError`` on user-facing errors.
    """
    fernet = get_fernet()
    prev = (previous_key_name or "").strip()
    nk = normalize_env_key(key_name_input)
    if not nk:
        raise ValueError("Enter a key name.")

    stored = encode_stored_value(fernet, value, is_secret)

    if not prev:
        r = await session.execute(
            select(Secret).where(Secret.bundle_id == bundle_id, Secret.key_name == nk)
        )
        row = r.scalar_one_or_none()
        if row:
            row.value_ciphertext = stored
            row.is_secret = is_secret
        else:
            session.add(
                Secret(
                    bundle_id=bundle_id,
                    key_name=nk,
                    value_ciphertext=stored,
                    is_secret=is_secret,
                )
            )
        return nk

    r = await session.execute(
        select(Secret).where(Secret.bundle_id == bundle_id, Secret.key_name == prev)
    )
    row = r.scalar_one_or_none()
    if row is None:
        raise ValueError("That entry no longer exists. Cancel and try again.")

    prev_norm = normalize_env_key(prev)
    if nk == prev_norm:
        row.value_ciphertext = stored
        row.is_secret = is_secret
        return nk

    r2 = await session.execute(
        select(Secret.id).where(Secret.bundle_id == bundle_id, Secret.key_name == nk)
    )
    if r2.scalar_one_or_none() is not None:
        raise ValueError("Another variable already uses that name.")

    row.key_name = nk
    row.value_ciphertext = stored
    row.is_secret = is_secret
    return nk


async def declassify_secret_entry(
    session: AsyncSession, bundle_id: int, key_name: str
) -> None:
    """Re-store a Fernet-encrypted row as UTF-8 plaintext (same logical value)."""
    kn = key_name.strip()
    if not kn:
        raise HTTPException(status_code=400, detail="key_name required")
    r = await session.execute(
        select(Secret).where(Secret.bundle_id == bundle_id, Secret.key_name == kn)
    )
    row = r.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Secret not found")
    if not row.is_secret:
        return
    fernet = get_fernet()
    try:
        plain = decode_stored_value(fernet, row.value_ciphertext, True)
    except CryptoError:
        raise HTTPException(status_code=500, detail="Failed to decrypt secret") from None
    row.value_ciphertext = encode_stored_value(fernet, plain, False)
    row.is_secret = False


async def load_bundle_entries_by_id(
    session: AsyncSession, bundle_id: int
) -> tuple[Bundle, dict[str, tuple[str, bool]]]:
    """Returns map key -> (value, is_secret). Decrypts every row (export/API)."""
    r = await session.execute(
        select(Bundle)
        .where(Bundle.id == bundle_id)
        .options(
            selectinload(Bundle.secrets),
            selectinload(Bundle.group),
            selectinload(Bundle.project_environment),
        )
    )
    bundle = r.scalar_one_or_none()
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    fernet = get_fernet()
    out: dict[str, tuple[str, bool]] = {}
    for s in bundle.secrets:
        try:
            plain = decode_stored_value(fernet, s.value_ciphertext, s.is_secret)
        except CryptoError:
            raise HTTPException(status_code=500, detail="Failed to decrypt secret") from None
        out[s.key_name] = (plain, s.is_secret)
    return bundle, out


async def load_bundle_secrets_by_bundle_id(
    session: AsyncSession, bundle_id: int
) -> tuple[Bundle, dict[str, str]]:
    bundle, ent = await load_bundle_entries_by_id(session, bundle_id)
    return bundle, {k: v[0] for k, v in ent.items()}


async def load_bundle_entries(
    session: AsyncSession,
    name: str,
    *,
    project_slug: str | None = None,
    environment_slug: str | None = None,
) -> tuple[Bundle, dict[str, tuple[str, bool]]]:
    """Returns map key -> (value, is_secret). Decrypts every row (export/API)."""
    from app.services.scope_resolution import fetch_bundle_for_path

    validate_bundle_path_segment(name)
    b = await fetch_bundle_for_path(
        session,
        name,
        project_slug=project_slug,
        environment_slug=environment_slug,
    )
    return await load_bundle_entries_by_id(session, b.id)


async def load_bundle_entries_list_masked(
    session: AsyncSession,
    name: str,
    *,
    project_slug: str | None = None,
    environment_slug: str | None = None,
) -> tuple[Bundle, dict[str, tuple[str | None, bool]]]:
    """Web list view: decrypt plaintext rows only; encrypted values are not loaded (None)."""
    from app.services.scope_resolution import fetch_bundle_for_path

    validate_bundle_path_segment(name)
    resolved = await fetch_bundle_for_path(
        session,
        name,
        project_slug=project_slug,
        environment_slug=environment_slug,
    )
    r = await session.execute(
        select(Bundle)
        .where(Bundle.id == resolved.id)
        .options(
            selectinload(Bundle.secrets),
            selectinload(Bundle.group),
            selectinload(Bundle.project_environment),
        )
    )
    bundle = r.scalar_one_or_none()
    if bundle is None:
        raise HTTPException(status_code=404, detail="Bundle not found")
    fernet = get_fernet()
    out: dict[str, tuple[str | None, bool]] = {}
    for s in bundle.secrets:
        if s.is_secret:
            out[s.key_name] = (None, True)
        else:
            try:
                plain = decode_stored_value(fernet, s.value_ciphertext, False)
            except CryptoError:
                raise HTTPException(status_code=500, detail="Failed to decode value") from None
            out[s.key_name] = (plain, False)
    return bundle, out


async def decrypt_bundle_entry_value(
    session: AsyncSession, bundle_id: int, key_name: str
) -> tuple[str, bool]:
    """Decrypt a single row (e.g. edit form); does not load other encrypted values."""
    kn = key_name.strip()
    r = await session.execute(
        select(Secret).where(Secret.bundle_id == bundle_id, Secret.key_name == kn)
    )
    s = r.scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    fernet = get_fernet()
    try:
        plain = decode_stored_value(fernet, s.value_ciphertext, s.is_secret)
    except CryptoError:
        raise HTTPException(status_code=500, detail="Failed to decrypt value") from None
    return plain, s.is_secret


async def load_bundle_secrets(
    session: AsyncSession,
    name: str,
    *,
    project_slug: str | None = None,
    environment_slug: str | None = None,
) -> tuple[Bundle, dict[str, str]]:
    bundle, ent = await load_bundle_entries(
        session, name, project_slug=project_slug, environment_slug=environment_slug
    )
    return bundle, {k: v[0] for k, v in ent.items()}


async def list_bundle_secret_key_names(
    session: AsyncSession,
    name: str,
    *,
    project_slug: str | None = None,
    environment_slug: str | None = None,
) -> list[str]:
    """Sorted key names from `secrets` rows only (not sealed secrets)."""
    from app.services.scope_resolution import fetch_bundle_for_path

    validate_bundle_path_segment(name)
    b = await fetch_bundle_for_path(
        session, name, project_slug=project_slug, environment_slug=environment_slug
    )
    r = await session.execute(
        select(Secret.key_name)
        .where(Secret.bundle_id == b.id)
        .order_by(Secret.key_name)
    )
    return [row[0] for row in r.all()]
