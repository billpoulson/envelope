#!/usr/bin/env sh
# Thin wrapper: keep envelope_run.py next to this file.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$SCRIPT_DIR/envelope_run.py" "$@"
