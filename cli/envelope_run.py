#!/usr/bin/env python3
"""Backward-compatible entrypoint next to curl-downloaded wrappers; prefer ``envelope`` after install."""

from __future__ import annotations

import sys
from pathlib import Path

_root = Path(__file__).resolve().parent
_src = _root / "src"
if _src.is_dir():
    p = str(_src.resolve())
    if p not in sys.path:
        sys.path.insert(0, p)

from envelope_cli.main import main
from envelope_cli.run_core import (  # noqa: F401
    append_github_env,
    atomic_write,
    build_fetch_url,
    fetch_json,
    format_secrets_dotenv,
    opaque_url_with_json_format,
    parse_run_args,
    run_fetch_pipeline,
)

if __name__ == "__main__":
    main()
