"""Device authorization flow for the Envelope CLI."""

import os
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
_db_path = Path(_tmp.name).resolve()
os.environ["ENVELOPE_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path.as_posix()}"
os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
os.environ["ENVELOPE_SESSION_SECRET"] = "test-session-secret-test-session-secret"
os.environ["ENVELOPE_DEBUG"] = "true"
os.environ["ENVELOPE_INITIAL_ADMIN_KEY"] = "cli-device-test-admin-key"

from fastapi.testclient import TestClient  # noqa: E402

from app.limiter import limiter  # noqa: E402
from app.main import app  # noqa: E402


class CliDeviceAuthTests(unittest.TestCase):
    _admin = "cli-device-test-admin-key"

    def setUp(self) -> None:
        limiter.reset()

    def _session(self, client: TestClient) -> str:
        r = client.get("/api/v1/auth/csrf")
        self.assertEqual(r.status_code, 200, r.text)
        csrf = r.json()["csrf_token"]
        r2 = client.post(
            "/api/v1/auth/login",
            json={"api_key": self._admin},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(r2.status_code, 200, r2.text)
        return r2.json()["csrf_token"]

    def test_device_authorize_approve_token_happy_path(self) -> None:
        with TestClient(app) as client:
            r0 = client.post("/api/v1/auth/device", json={})
            self.assertEqual(r0.status_code, 200, r0.text)
            j0 = r0.json()
            device_code = j0["device_code"]
            user_code = j0["user_code"]
            self.assertIn("verification_uri_complete", j0)

            csrf = self._session(client)
            r1 = client.post(
                "/api/v1/auth/device/approve",
                json={
                    "user_code": user_code,
                    "name": "cli-test-key",
                    "scopes": ["admin"],
                },
                headers={"X-CSRF-Token": csrf},
            )
            self.assertEqual(r1.status_code, 200, r1.text)
            self.assertEqual(r1.json().get("status"), "ok")

            r2 = client.post(
                "/api/v1/auth/device/token",
                json={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                },
            )
            self.assertEqual(r2.status_code, 200, r2.text)
            tok = r2.json()
            self.assertIn("access_token", tok)
            self.assertTrue(tok["access_token"].startswith("env_"))

            r3 = client.post(
                "/api/v1/auth/device/token",
                json={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                },
            )
            self.assertEqual(r3.status_code, 200, r3.text)
            self.assertEqual(r3.json().get("error"), "invalid_grant")

    def test_device_token_invalid_grant_unknown_code(self) -> None:
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/auth/device/token",
                json={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": "not-a-real-device-code-value-xxxxxxxx",
                },
            )
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json().get("error"), "invalid_grant")

    def test_device_token_slow_down(self) -> None:
        with TestClient(app) as client:
            r0 = client.post("/api/v1/auth/device", json={})
            self.assertEqual(r0.status_code, 200, r0.text)
            device_code = r0.json()["device_code"]
            r1 = client.post(
                "/api/v1/auth/device/token",
                json={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                },
            )
            self.assertEqual(r1.status_code, 200, r1.text)
            self.assertEqual(r1.json().get("error"), "authorization_pending")
            r2 = client.post(
                "/api/v1/auth/device/token",
                json={
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                },
            )
            self.assertEqual(r2.status_code, 200, r2.text)
            self.assertEqual(r2.json().get("error"), "slow_down")


if __name__ == "__main__":
    unittest.main()
