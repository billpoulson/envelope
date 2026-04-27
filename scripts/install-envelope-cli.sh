#!/usr/bin/env bash
# Install envelope-cli from a git checkout: ./scripts/install-envelope-cli.sh [--editable]
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$REPO_ROOT/cli"
EDITABLE=0
if [[ "${1:-}" == "--editable" ]] || [[ "${1:-}" == "-e" ]]; then
  EDITABLE=1
fi
if [[ ! -f "$CLI_DIR/pyproject.toml" ]]; then
  echo "error: expected envelope CLI at $CLI_DIR (run from repo clone)" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found" >&2
  exit 1
fi
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
  if [[ "$EDITABLE" -eq 1 ]]; then
    python3 -m pip install --editable "$CLI_DIR"
  else
    python3 -m pip install "$CLI_DIR"
  fi
else
  if [[ "$EDITABLE" -eq 1 ]]; then
    python3 -m pip install --user --editable "$CLI_DIR"
  else
    python3 -m pip install --user "$CLI_DIR"
  fi
  ubin="$(python3 -c 'import site; print(site.USER_BASE + "/bin")')"
  echo ""
  echo "Installed. Ensure $ubin is on your PATH (e.g. export PATH=\"$ubin:\$PATH\")."
fi
echo "Try: envelope --help"
