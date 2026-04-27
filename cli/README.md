# envelope-cli

Install from the repository root:

- **Linux / macOS:** `./scripts/install-envelope-cli.sh`
- **Windows:** `.\scripts\install-envelope-cli.ps1`

Or: `pip install ./cli` (from repo root, path to this directory).

Commands:

- `envelope run …` — fetch an opaque env URL or bundle export, write a file, and/or exec a child process (same flags as the legacy script).
- `envelope login` — device authorization in the browser; stores credentials under the user config directory.
- `envelope logout` — remove stored credentials.

Legacy: `envelope --envelope-url … --token …` is accepted as an alias for `envelope run …`.
