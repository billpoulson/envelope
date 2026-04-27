from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from urllib.parse import urlparse

from envelope_cli.credentials import save_credentials


def _json_post(url: str, payload: dict, *, insecure_http: bool) -> dict:
    p = urlparse(url)
    if p.scheme == "http" and not insecure_http:
        raise SystemExit(
            "refusing http:// (set ENVELOPE_CLI_INSECURE=1 for local dev only)"
        )
    if p.scheme not in ("https", "http"):
        raise SystemExit("invalid URL scheme")
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} from device authorize") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"network error: {e}") from None
    try:
        out = json.loads(body)
    except json.JSONDecodeError as e:
        raise SystemExit("invalid JSON from server") from e
    if not isinstance(out, dict):
        raise SystemExit("unexpected response from server")
    return out


def run_login(argv: list[str]) -> None:
    import argparse

    p = argparse.ArgumentParser(description="Log in via browser (device code)")
    p.add_argument(
        "--envelope-url",
        default=os.environ.get("ENVELOPE_URL", "").strip() or None,
        help="Envelope base URL",
    )
    p.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open a browser window",
    )
    args = p.parse_args(argv)
    base = (args.envelope_url or "").strip().rstrip("/")
    if not base:
        raise SystemExit("set --envelope-url or ENVELOPE_URL")

    insecure = os.environ.get("ENVELOPE_CLI_INSECURE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    start = _json_post(
        f"{base}/api/v1/auth/device",
        {},
        insecure_http=insecure,
    )
    device_code = start.get("device_code")
    user_code = start.get("user_code")
    verify_complete = start.get("verification_uri_complete") or start.get(
        "verification_uri"
    )
    interval = int(start.get("interval") or 5)
    if not device_code or not user_code:
        raise SystemExit("server did not return device credentials")

    print(f"User code: {user_code}")
    print(f"Open: {verify_complete}")
    if sys.stdin.isatty() and not args.no_browser and verify_complete:
        try:
            webbrowser.open(verify_complete)
        except Exception:
            pass

    grant_type = "urn:ietf:params:oauth:grant-type:device_code"
    token_url = f"{base}/api/v1/auth/device/token"
    deadline = time.monotonic() + float(start.get("expires_in") or 900)

    while time.monotonic() < deadline:
        time.sleep(max(1, interval))
        body = _json_post(
            token_url,
            {"grant_type": grant_type, "device_code": device_code},
            insecure_http=insecure,
        )
        err = body.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval = min(interval + 2, 30)
            continue
        if err:
            raise SystemExit(f"login failed: {err}")
        token = body.get("access_token")
        if token:
            save_credentials(base, token)
            print("Saved credentials for this Envelope URL.")
            return
    raise SystemExit("login timed out waiting for browser approval")
