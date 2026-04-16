#!/usr/bin/env python3
"""Fetch bundle/stack env from an Envelope opaque /env/{token} link and run a command or write a file.

Usage:
  envelope_run.py --envelope-url https://host[/prefix] --token TOKEN [--out FILE] [--out-format dotenv|json] [--export-github-env] -- command ...
  envelope_run.py --envelope-url https://host[/prefix] --token TOKEN --out FILE
  envelope_run.py --opaque-env-url https://host[/prefix]/env/TOKEN [--out FILE] ...

Environment (if CLI flags omitted):
  ENVELOPE_URL   deployment base URL (same as --envelope-url; may include path prefix, e.g. https://x.com/envelope)
  ENVELOPE_ENV_TOKEN  opaque path token

HTTPS only unless ENVELOPE_CLI_INSECURE=1 is set (not recommended).
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import ssl
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse


def format_secrets_dotenv(secrets_map: dict[str, str]) -> str:
    """Match app.services.bundles.format_secrets_dotenv (sorted keys, quoted values)."""
    lines = []
    for k in sorted(secrets_map.keys()):
        v = secrets_map[k]
        esc = v.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        lines.append(f'{k}="{esc}"')
    return "\n".join(lines) + ("\n" if lines else "")


def build_fetch_url(envelope_url: str, token: str) -> str:
    """Build GET URL for JSON export: {envelope_url}/env/{token}?format=json"""
    base = envelope_url.strip().rstrip("/")
    raw = token.strip()
    if len(raw) < 16 or len(raw) > 256:
        raise ValueError("token length must be between 16 and 256 characters")
    seg = quote(raw, safe="")
    return f"{base}/env/{seg}?format=json"


def opaque_url_with_json_format(opaque_url: str) -> str:
    """Ensure query includes format=json (opaque env links default to dotenv without it)."""
    u = opaque_url.strip()
    p = urlparse(u)
    pairs = parse_qsl(p.query, keep_blank_values=True)
    found = False
    new_pairs: list[tuple[str, str]] = []
    for k, v in pairs:
        if k == "format":
            new_pairs.append(("format", "json"))
            found = True
        else:
            new_pairs.append((k, v))
    if not found:
        new_pairs.append(("format", "json"))
    query = urlencode(new_pairs)
    return urlunparse((p.scheme, p.netloc, p.path, p.params, query, p.fragment))


def _redacted_host(url: str) -> str:
    try:
        p = urlparse(url)
        return p.hostname or "unknown-host"
    except Exception:
        return "unknown-host"


def fetch_json(url: str, *, insecure_http: bool) -> dict[str, Any]:
    p = urlparse(url)
    if p.scheme == "http" and not insecure_http:
        raise SystemExit(
            "refusing http:// (set ENVELOPE_CLI_INSECURE=1 for local dev only)"
        )
    if p.scheme not in ("https", "http"):
        raise SystemExit("invalid URL scheme (https required)")

    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        host = _redacted_host(url)
        raise SystemExit(f"request failed for host {host!r} (HTTP {e.code})") from None
    except urllib.error.URLError as e:
        host = _redacted_host(url)
        raise SystemExit(f"request failed for host {host!r}: network error") from None

    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise SystemExit("invalid JSON in response") from e
    if not isinstance(data, dict):
        raise SystemExit("expected JSON object in response")
    out: dict[str, str] = {}
    for k, v in data.items():
        if not isinstance(k, str):
            continue
        if isinstance(v, str):
            out[k] = v
        elif v is None:
            out[k] = ""
        else:
            out[k] = str(v)
    return out


def atomic_write(path: str, content: bytes) -> None:
    d = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".env-", dir=d, text=False)
    try:
        os.write(fd, content)
        os.close(fd)
        fd = -1
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
    finally:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


_GITHUB_ENV_NAME_OK = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_"
)


def append_github_env(secrets_map: dict[str, str], github_env_path: str) -> None:
    """Append KEY=value entries for GitHub Actions (multiline-safe heredoc syntax)."""
    with open(github_env_path, "a", encoding="utf-8") as f:
        for k in sorted(secrets_map.keys()):
            if not k or not all(c in _GITHUB_ENV_NAME_OK for c in k):
                raise SystemExit(
                    f"invalid environment variable name for GITHUB_ENV: {k!r}"
                )
            v = secrets_map[k]
            delim = f"EOF_ENVELOPE_{secrets.token_hex(16)}"
            while delim in v:
                delim = f"EOF_ENVELOPE_{secrets.token_hex(16)}"
            f.write(f"{k}<<{delim}\n")
            f.write(v)
            if not v.endswith("\n"):
                f.write("\n")
            f.write(f"{delim}\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Envelope opaque env: fetch and run or write file")
    p.add_argument(
        "--envelope-url",
        default=os.environ.get("ENVELOPE_URL", "").strip() or None,
        help="Deployment base URL (may include path prefix), or set ENVELOPE_URL",
    )
    p.add_argument(
        "--token",
        default=os.environ.get("ENVELOPE_ENV_TOKEN", "").strip() or None,
        help="Opaque /env/… token, or set ENVELOPE_ENV_TOKEN",
    )
    p.add_argument(
        "--opaque-env-url",
        default=None,
        metavar="URL",
        help="Full opaque env URL (alternative to --envelope-url and --token); JSON export is requested automatically",
    )
    p.add_argument(
        "--out",
        metavar="FILE",
        help="Write fetched variables to this file (dotenv or JSON)",
    )
    p.add_argument(
        "--out-format",
        choices=("dotenv", "json"),
        default="dotenv",
        help="File format when using --out (default: dotenv)",
    )
    p.add_argument(
        "--export-github-env",
        action="store_true",
        help="Append variables to the file path in GITHUB_ENV (GitHub Actions)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    argv = list(argv if argv is not None else sys.argv[1:])
    insecure = os.environ.get("ENVELOPE_CLI_INSECURE", "").strip() in (
        "1",
        "true",
        "yes",
    )

    if "--" in argv:
        idx = argv.index("--")
        child = argv[idx + 1 :]
        argv = argv[:idx]
    else:
        child = []

    args = parse_args(argv)

    opaque = (args.opaque_env_url or "").strip() or None
    if opaque:
        fetch_url = opaque_url_with_json_format(opaque)
    elif args.envelope_url and args.token:
        fetch_url = build_fetch_url(args.envelope_url, args.token)
    else:
        raise SystemExit(
            "provide --opaque-env-url, or both --envelope-url / ENVELOPE_URL and --token / ENVELOPE_ENV_TOKEN"
        )

    secrets_map = fetch_json(fetch_url, insecure_http=insecure)

    if args.out:
        if args.out_format == "json":
            body = json.dumps(secrets_map, sort_keys=True, indent=2) + "\n"
            atomic_write(args.out, body.encode("utf-8"))
        else:
            text = format_secrets_dotenv(secrets_map)
            atomic_write(args.out, text.encode("utf-8"))

        github_output = os.environ.get("GITHUB_OUTPUT")
        if github_output:
            abs_out = str(Path(args.out).resolve())
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"out-file={abs_out}\n")

    if args.export_github_env:
        ghe = os.environ.get("GITHUB_ENV")
        if not ghe:
            raise SystemExit("--export-github-env requires GITHUB_ENV (GitHub Actions)")
        append_github_env(secrets_map, ghe)

    if child:
        merged = os.environ.copy()
        merged.update(secrets_map)
        os.execvpe(child[0], child, merged)

    if not args.out and not args.export_github_env:
        raise SystemExit(
            "nothing to do: provide --out and/or --export-github-env and/or a command after --"
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
