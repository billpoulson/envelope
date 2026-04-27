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

path_has_dir() {
  local dir="${1%/}"
  case ":${PATH:-}:" in
    *":${dir}:"*) return 0 ;;
  esac
  return 1
}

prompt_append_profile() {
  local bindir="$1"
  if path_has_dir "$bindir" || command -v envelope >/dev/null 2>&1; then
    echo "The 'envelope' command is on your current PATH."
    return 0
  fi
  echo ""
  echo "The install location is not on your PATH:"
  echo "  $bindir"
  echo ""
  local ans="n"
  if [[ -t 0 ]]; then
    read -r -p "Append a PATH line to ~/.profile so new terminals find 'envelope'? [y/N] " ans || true
  fi
  if [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]; then
    local cfg="${HOME}/.profile"
    touch "$cfg"
    if grep -Fq "$bindir" "$cfg" 2>/dev/null; then
      echo "~/.profile already references this directory."
    else
      printf '\n# envelope-cli (install-envelope-cli.sh)\nexport PATH="%s:$PATH"\n' "$bindir" >>"$cfg"
      echo "Updated $cfg"
      echo "Open a new terminal, or run: source ~/.profile"
    fi
  else
    echo "Add it yourself for this shell:"
    echo "  export PATH=\"$bindir:\$PATH\""
    echo "Or add that line to ~/.profile or ~/.bashrc."
  fi
}

if [[ -n "${VIRTUAL_ENV:-}" ]]; then
  if [[ "$EDITABLE" -eq 1 ]]; then
    python3 -m pip install --editable "$CLI_DIR"
  else
    python3 -m pip install "$CLI_DIR"
  fi
  vbin="${VIRTUAL_ENV}/bin"
  echo ""
  if path_has_dir "$vbin" || command -v envelope >/dev/null 2>&1; then
    echo "Virtualenv bin is on PATH — 'envelope' should work in this shell."
  else
    echo "Activate this virtualenv so PATH includes:"
    echo "  $vbin"
    echo "  (e.g. source \"${VIRTUAL_ENV}/bin/activate\")"
  fi
else
  if [[ "$EDITABLE" -eq 1 ]]; then
    python3 -m pip install --user --editable "$CLI_DIR"
  else
    python3 -m pip install --user "$CLI_DIR"
  fi
  ubin="$(python3 -c 'import site; print(site.USER_BASE + "/bin")')"
  prompt_append_profile "$ubin"
fi

echo ""
echo "Try: envelope --help"
