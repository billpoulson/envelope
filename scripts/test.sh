#!/usr/bin/env sh
# Run the Python test suite from the repo root.
# Prefer: pip install pytest && pytest (richer output). Fallback: unittest (same as CI).
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

_py=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -m pytest --version >/dev/null 2>&1; then
    _py=$c
    break
  fi
done
if [ -n "$_py" ]; then
  exec "$_py" -m pytest -q --tb=short "$@"
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 -m unittest discover -s tests -v
fi
exec python -m unittest discover -s tests -v
