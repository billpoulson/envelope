"""Integration tests for /tfstate (Terraform HTTP backend) and system backup/restore."""

import os
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet

# Configure Envelope before importing the app (settings + DB path are read at import time).
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
_db_path = Path(_tmp.name).resolve()
os.environ["ENVELOPE_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path.as_posix()}"
os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
os.environ["ENVELOPE_SESSION_SECRET"] = "test-session-secret-test-session-secret"
os.environ["ENVELOPE_DEBUG"] = "true"
os.environ["ENVELOPE_INITIAL_ADMIN_KEY"] = "tfstate-http-test-admin-key"
os.environ["ENVELOPE_PULUMI_STATE_ENABLED"] = "true"
os.environ["ENVELOPE_RESTORE_ENABLED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class BackupRestoreHttpTests(unittest.TestCase):
    """Full-database GET /system/backup/database and POST /system/restore/database."""

    _token = "tfstate-http-test-admin-key"

    def test_backup_download_is_sqlite_snapshot(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            r = client.get("/api/v1/system/backup/database", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.headers.get("content-type"), "application/octet-stream")
        self.assertGreater(len(r.content), 100)
        self.assertEqual(r.content[:16], b"SQLite format 3\x00")

    def test_backup_restore_round_trip_preserves_data(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        project = {"name": "Backup restore proj", "slug": "brrestore"}
        bundle_body = {"name": "restore-marker-bundle", "project_slug": "brrestore"}
        with TestClient(app) as client:
            pr = client.post("/api/v1/projects", json=project, headers=hj)
            self.assertEqual(pr.status_code, 201, pr.text)
            br = client.post("/api/v1/bundles", json=bundle_body, headers=hj)
            self.assertEqual(br.status_code, 201, br.text)

            snap = client.get("/api/v1/system/backup/database", headers=h)
            self.assertEqual(snap.status_code, 200, snap.text)
            backup_bytes = snap.content

            dr = client.delete("/api/v1/bundles/restore-marker-bundle", headers=h)
            self.assertEqual(dr.status_code, 204)
            lst = client.get("/api/v1/bundles", headers=h)
            self.assertEqual(lst.status_code, 200)
            self.assertNotIn("restore-marker-bundle", lst.json())

            rr = client.post(
                "/api/v1/system/restore/database",
                files={"file": ("envelope.db", backup_bytes, "application/octet-stream")},
                headers=h,
            )
            self.assertEqual(rr.status_code, 200, rr.text)
            self.assertEqual(rr.json().get("status"), "ok")

            lst2 = client.get("/api/v1/bundles", headers=h)
            self.assertEqual(lst2.status_code, 200)
            self.assertIn("restore-marker-bundle", lst2.json())

    def test_restore_rejects_empty_upload(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/system/restore/database",
                files={"file": ("empty.db", b"", "application/octet-stream")},
                headers=h,
            )
        self.assertEqual(r.status_code, 400)
        self.assertIn("empty", r.json()["detail"].lower())


class TfstateHttpTests(unittest.TestCase):
    _token = "tfstate-http-test-admin-key"

    def test_get_404(self) -> None:
        with TestClient(app) as client:
            r = client.get(
                "/tfstate/blobs/test-stack/tfstate",
                headers={"Authorization": f"Bearer {self._token}"},
            )
        self.assertEqual(r.status_code, 404)

    def test_post_get_delete_round_trip(self) -> None:
        key = "demo/proj/stack.json"
        payload = b'{"version":3,"checkpoint":true}'
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            pr = client.post(f"/tfstate/blobs/{key}", content=payload, headers=h)
            self.assertEqual(pr.status_code, 200)
            gr = client.get(f"/tfstate/blobs/{key}", headers=h)
            self.assertEqual(gr.status_code, 200)
            self.assertEqual(gr.content, payload)
            dr = client.delete(f"/tfstate/blobs/{key}", headers=h)
        self.assertEqual(dr.status_code, 200)

    def test_lock_conflict(self) -> None:
        key = "lock-demo/state"
        h = {"Authorization": f"Bearer {self._token}"}
        a = '{"ID":"aaa","Operation":"OperationTypeApply"}'
        b = '{"ID":"bbb","Operation":"OperationTypeApply"}'
        with TestClient(app) as client:
            client.request("LOCK", f"/tfstate/blobs/{key}", content=a, headers=h)
            r2 = client.request("LOCK", f"/tfstate/blobs/{key}", content=b, headers=h)
            self.assertEqual(r2.status_code, 423)
            ul = client.request("UNLOCK", f"/tfstate/blobs/{key}", content=a, headers=h)
        self.assertEqual(ul.status_code, 200)

    def test_project_post_get_delete_round_trip(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        payload = b'{"version":4}'
        with TestClient(app) as client:
            cp = client.post("/api/v1/projects", json={"name": "TF Proj", "slug": "tfproj"}, headers=hj)
            self.assertEqual(cp.status_code, 201, cp.text)
            pr = client.post("/tfstate/projects/tfproj/default.tfstate", content=payload, headers=h)
            self.assertEqual(pr.status_code, 200)
            gr = client.get("/tfstate/projects/tfproj/default.tfstate", headers=h)
            self.assertEqual(gr.status_code, 200)
            self.assertEqual(gr.content, payload)
            dr = client.delete("/tfstate/projects/tfproj/default.tfstate", headers=h)
        self.assertEqual(dr.status_code, 200)

    def test_project_read_scope_cannot_write(self) -> None:
        h_admin = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        with TestClient(app) as client:
            client.post("/api/v1/projects", json={"name": "RO Proj", "slug": "roproj"}, headers=h_admin)
            kr = client.post(
                "/api/v1/api-keys",
                json={"name": "ro-tf", "scopes": ["read:project:slug:roproj"]},
                headers=h_admin,
            )
            self.assertEqual(kr.status_code, 201, kr.text)
            ro_token = kr.json()["plain_key"]
        h_ro = {"Authorization": f"Bearer {ro_token}"}
        with TestClient(app) as client:
            pr = client.post("/tfstate/projects/roproj/s.tfstate", content=b"{}", headers=h_ro)
            self.assertEqual(pr.status_code, 403)


if __name__ == "__main__":
    unittest.main()
