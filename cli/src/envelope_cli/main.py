"""Console entry: ``envelope``."""

from __future__ import annotations

import os
import sys

from envelope_cli.credentials import delete_credentials, load_credentials
from envelope_cli.device_login import run_login
from envelope_cli.run_core import parse_run_args, run_fetch_pipeline


def main(argv: list[str] | None = None) -> None:
    argv = list(argv if argv is not None else sys.argv[1:])

    if not argv or argv[0] in ("-h", "--help"):
        print(
            "Usage:\n"
            "  envelope login [--envelope-url URL] [--no-browser]\n"
            "  envelope logout\n"
            "  envelope run [options] [-- command ...]\n"
            "  envelope [run options] [-- command ...]  (legacy: same as envelope run)\n",
            file=sys.stderr,
        )
        if not argv:
            sys.exit(2)
        sys.exit(0)

    cmd = argv[0]
    if cmd == "login":
        run_login(argv[1:])
        return
    if cmd == "logout":
        if delete_credentials():
            print("Removed saved credentials.")
        else:
            print("No saved credentials.")
        return
    if cmd == "run":
        rest = argv[1:]
    elif cmd.startswith("-"):
        rest = argv
    else:
        print(f"unknown command {cmd!r}", file=sys.stderr)
        sys.exit(2)

    insecure = os.environ.get("ENVELOPE_CLI_INSECURE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    if "--" in rest:
        idx = rest.index("--")
        child = rest[idx + 1 :]
        run_argv = rest[:idx]
    else:
        child = []
        run_argv = rest

    args = parse_run_args(run_argv)
    creds = load_credentials()
    if creds:
        saved_url = (creds.get("envelope_url") or "").strip().rstrip("/")
        saved_key = (creds.get("api_key") or "").strip()
        req_url = (args.envelope_url or "").strip().rstrip("/")
        if saved_key and not (args.api_key or "").strip():
            if not req_url or req_url == saved_url:
                args.api_key = saved_key
                if not args.envelope_url and saved_url:
                    args.envelope_url = saved_url

    run_fetch_pipeline(args, child, insecure=insecure)


if __name__ == "__main__":
    main()
