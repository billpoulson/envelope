"""Integration tests for /tfstate, system backup/restore, and sealed secrets/certificates."""

import hashlib
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

# Configure Envelope before importing the app (settings + DB path are read at import time).
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
_db_path = Path(_tmp.name).resolve()
os.environ["ENVELOPE_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_path.as_posix()}"
os.environ["ENVELOPE_MASTER_KEY"] = Fernet.generate_key().decode()
os.environ["ENVELOPE_SESSION_SECRET"] = "test-session-secret-test-session-secret"
os.environ["ENVELOPE_DEBUG"] = "true"
os.environ["ENVELOPE_INITIAL_ADMIN_KEY"] = "tfstate-http-test-admin-key"
os.environ["ENVELOPE_TERRAFORM_HTTP_STATE_ENABLED"] = "true"
os.environ["ENVELOPE_RESTORE_ENABLED"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _ensure_default_environment(client: TestClient, hj: dict[str, str], project_slug: str) -> None:
    r = client.post(
        f"/api/v1/projects/{project_slug}/environments",
        json={"name": "Default", "slug": "default"},
        headers=hj,
    )
    assert r.status_code == 201, r.text


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
        bundle_body = {
            "name": "restore-marker-bundle",
            "project_slug": "brrestore",
            "project_environment_slug": "default",
        }
        with TestClient(app) as client:
            pr = client.post("/api/v1/projects", json=project, headers=hj)
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, "brrestore")
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

    def _make_test_cert_pem(self, common_name: str) -> str:
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = datetime.now(timezone.utc)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
        cert = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(private_key=key, algorithm=hashes.SHA256())
        )
        return cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")

    def test_get_404(self) -> None:
        h = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        with TestClient(app) as client:
            cp = client.post("/api/v1/projects", json={"name": "TF404", "slug": "tf404"}, headers=h)
            self.assertEqual(cp.status_code, 201, cp.text)
            r = client.get(
                "/tfstate/projects/tf404/missing.tfstate",
                headers={"Authorization": f"Bearer {self._token}"},
            )
        self.assertEqual(r.status_code, 404)

    def test_post_get_delete_round_trip(self) -> None:
        payload = b'{"version":3,"checkpoint":true}'
        h = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        h_plain = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            cp = client.post("/api/v1/projects", json={"name": "Demo TF", "slug": "demotf"}, headers=h)
            self.assertEqual(cp.status_code, 201, cp.text)
            pr = client.post(
                "/tfstate/projects/demotf/proj/stack.json",
                content=payload,
                headers=h_plain,
            )
            self.assertEqual(pr.status_code, 200)
            gr = client.get("/tfstate/projects/demotf/proj/stack.json", headers=h_plain)
            self.assertEqual(gr.status_code, 200)
            self.assertEqual(gr.content, payload)
            dr = client.delete("/tfstate/projects/demotf/proj/stack.json", headers=h_plain)
        self.assertEqual(dr.status_code, 200)

    def test_lock_conflict(self) -> None:
        h = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        h_plain = {"Authorization": f"Bearer {self._token}"}
        a = '{"ID":"aaa","Operation":"OperationTypeApply"}'
        b = '{"ID":"bbb","Operation":"OperationTypeApply"}'
        with TestClient(app) as client:
            cp = client.post("/api/v1/projects", json={"name": "Lock demo", "slug": "lockdemo"}, headers=h)
            self.assertEqual(cp.status_code, 201, cp.text)
            client.request("LOCK", "/tfstate/projects/lockdemo/state", content=a, headers=h_plain)
            r2 = client.request("LOCK", "/tfstate/projects/lockdemo/state", content=b, headers=h_plain)
            self.assertEqual(r2.status_code, 423)
            ul = client.request("UNLOCK", "/tfstate/projects/lockdemo/state", content=a, headers=h_plain)
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

    def test_certificates_and_sealed_secret_flow(self) -> None:
        nonce = uuid4().hex[:8]
        project_slug = f"sealproj-{nonce}"
        bundle_name = f"sealed-demo-{nonce}"
        h_admin = {"Authorization": f"Bearer {self._token}"}
        h_admin_json = {**h_admin, "Content-Type": "application/json"}
        cert1_pem = self._make_test_cert_pem(f"user-one-{nonce}")
        cert2_pem = self._make_test_cert_pem(f"user-two-{nonce}")
        with TestClient(app) as client:
            cp = client.post(
                "/api/v1/projects",
                json={"name": f"Sealed Project {nonce}", "slug": project_slug},
                headers=h_admin_json,
            )
            self.assertEqual(cp.status_code, 201, cp.text)
            _ensure_default_environment(client, h_admin_json, project_slug)
            cb = client.post(
                "/api/v1/bundles",
                json={
                    "name": bundle_name,
                    "project_slug": project_slug,
                    "project_environment_slug": "default",
                },
                headers=h_admin_json,
            )
            self.assertEqual(cb.status_code, 201, cb.text)
            c1 = client.post(
                "/api/v1/certificates",
                json={"name": f"cert-one-{nonce}", "certificate_pem": cert1_pem},
                headers=h_admin_json,
            )
            self.assertEqual(c1.status_code, 201, c1.text)
            c2 = client.post(
                "/api/v1/certificates",
                json={"name": f"cert-two-{nonce}", "certificate_pem": cert2_pem},
                headers=h_admin_json,
            )
            self.assertEqual(c2.status_code, 201, c2.text)
            cert1_id = c1.json()["id"]
            cert2_id = c2.json()["id"]

            up = client.post(
                f"/api/v1/bundles/{bundle_name}/sealed-secrets",
                json={
                    "key_name": "APP_TOKEN",
                    "enc_alg": "aes-256-gcm",
                    "payload_ciphertext": "BASE64_CIPHERTEXT",
                    "payload_nonce": "BASE64_NONCE",
                    "payload_aad": "bundle-metadata",
                    "recipients": [
                        {
                            "certificate_id": cert1_id,
                            "wrapped_key": "WRAPPED_KEY_FOR_CERT1",
                            "key_wrap_alg": "rsa-oaep-256",
                        },
                        {
                            "certificate_id": cert2_id,
                            "wrapped_key": "WRAPPED_KEY_FOR_CERT2",
                            "key_wrap_alg": "rsa-oaep-256",
                        },
                    ],
                },
                headers=h_admin_json,
            )
            self.assertEqual(up.status_code, 204, up.text)

            lr = client.get(f"/api/v1/bundles/{bundle_name}/sealed-secrets", headers=h_admin)
            self.assertEqual(lr.status_code, 200, lr.text)
            rows = lr.json()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["key_name"], "APP_TOKEN")
            rec_ids = {r["certificate_id"] for r in rows[0]["recipients"]}
            self.assertEqual(rec_ids, {cert1_id, cert2_id})

            dr = client.delete(
                f"/api/v1/bundles/{bundle_name}/sealed-secrets",
                params={"key_name": "APP_TOKEN"},
                headers=h_admin,
            )
            self.assertEqual(dr.status_code, 200, dr.text)

            lr2 = client.get(f"/api/v1/bundles/{bundle_name}/sealed-secrets", headers=h_admin)
            self.assertEqual(lr2.status_code, 200, lr2.text)
            self.assertEqual(lr2.json(), [])

    def test_sealed_secret_rejects_unknown_certificate_id(self) -> None:
        nonce = uuid4().hex[:8]
        project_slug = f"sealmiss-{nonce}"
        bundle_name = f"sealed-miss-{nonce}"
        h_admin = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        with TestClient(app) as client:
            cp = client.post(
                "/api/v1/projects",
                json={"name": f"Sealed Missing Cert {nonce}", "slug": project_slug},
                headers=h_admin,
            )
            self.assertEqual(cp.status_code, 201, cp.text)
            _ensure_default_environment(client, h_admin, project_slug)
            cb = client.post(
                "/api/v1/bundles",
                json={
                    "name": bundle_name,
                    "project_slug": project_slug,
                    "project_environment_slug": "default",
                },
                headers=h_admin,
            )
            self.assertEqual(cb.status_code, 201, cb.text)
            up = client.post(
                f"/api/v1/bundles/{bundle_name}/sealed-secrets",
                json={
                    "key_name": "API_TOKEN",
                    "enc_alg": "aes-256-gcm",
                    "payload_ciphertext": "X",
                    "payload_nonce": "Y",
                    "recipients": [
                        {
                            "certificate_id": 999999,
                            "wrapped_key": "WRAPPED",
                            "key_wrap_alg": "rsa-oaep-256",
                        }
                    ],
                },
                headers=h_admin,
            )
        self.assertEqual(up.status_code, 400)


class StacksHttpTests(unittest.TestCase):
    """Bundle stacks: layered bundles merged into one export."""

    _token = "tfstate-http-test-admin-key"

    def test_patch_bundle_environment_locked_after_assignment(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"envlock-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Env lock {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            er = client.post(
                f"/api/v1/projects/{slug}/environments",
                json={"name": "Staging", "slug": "staging"},
                headers=hj,
            )
            self.assertEqual(er.status_code, 201, er.text)
            br = client.post(
                "/api/v1/bundles",
                json={
                    "name": f"eb-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                },
                headers=hj,
            )
            self.assertEqual(br.status_code, 201, br.text)
            pr = client.patch(
                f"/api/v1/bundles/eb-{nonce}",
                json={"project_environment_slug": "staging"},
                params={"project_slug": slug, "environment_slug": "default"},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 400, pr.text)
            self.assertIn("already assigned", pr.json()["detail"].lower())

    def test_create_bundle_and_stack_require_project_environment(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"reqenv-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Req env {nonce}", "slug": slug},
                headers=hj,
            )
            br = client.post(
                "/api/v1/bundles",
                json={"name": f"b-{nonce}", "project_slug": slug},
                headers=hj,
            )
            self.assertEqual(br.status_code, 400)
            self.assertIn("project_environment_slug", br.json()["detail"].lower())
            sr = client.post(
                "/api/v1/stacks",
                json={
                    "name": f"s-{nonce}",
                    "project_slug": slug,
                    "layers": [{"bundle": f"b-{nonce}", "keys": "*"}],
                },
                headers=hj,
            )
            self.assertEqual(sr.status_code, 400)
            self.assertIn("project_environment_slug", sr.json()["detail"].lower())

    def test_delete_bundle_removes_layer_stack_still_readable(self) -> None:
        """Deleting a bundle must drop its stack layer rows so GET /stacks/{name} still works."""
        nonce = uuid4().hex[:8]
        project_slug = f"delstk-{nonce}"
        b1 = f"bundle-a-{nonce}"
        b2 = f"bundle-b-{nonce}"
        stack_name = f"twolayer-{nonce}"
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        with TestClient(app) as client:
            pr = client.post(
                "/api/v1/projects",
                json={"name": f"Del stack {nonce}", "slug": project_slug},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, project_slug)
            for bn in (b1, b2):
                br = client.post(
                    "/api/v1/bundles",
                    json={
                        "name": bn,
                        "project_slug": project_slug,
                        "project_environment_slug": "default",
                    },
                    headers=hj,
                )
                self.assertEqual(br.status_code, 201, br.text)
            sr = client.post(
                "/api/v1/stacks",
                json={
                    "name": stack_name,
                    "project_slug": project_slug,
                    "project_environment_slug": "default",
                    "layers": [{"bundle": b1, "keys": "*"}, {"bundle": b2, "keys": "*"}],
                },
                headers=hj,
            )
            self.assertEqual(sr.status_code, 201, sr.text)

            dr = client.delete(
                f"/api/v1/bundles/{b1}",
                params={"project_slug": project_slug, "environment_slug": "default"},
                headers=h,
            )
            self.assertEqual(dr.status_code, 204, dr.text)

            gr = client.get(
                f"/api/v1/stacks/{stack_name}",
                params={"project_slug": project_slug, "environment_slug": "default"},
                headers=h,
            )
            self.assertEqual(gr.status_code, 200, gr.text)
            body = gr.json()
            layers = body.get("layers") or []
            self.assertEqual(len(layers), 1)
            self.assertEqual(layers[0].get("bundle"), b2)

    def test_stack_merge_last_layer_wins(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"stkproj-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Stack Proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"stack-base-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"FOO": "from-base", "ONLY_BASE": "yes"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"stack-top-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"FOO": "from-top", "ONLY_TOP": "yes"},
                },
                headers=hj,
            )
            cr = client.post(
                "/api/v1/stacks",
                json={
                    "name": f"merge-stack-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [f"stack-base-{nonce}", f"stack-top-{nonce}"],
                },
                headers=hj,
            )
            self.assertEqual(cr.status_code, 201, cr.text)
            er = client.get(f"/api/v1/stacks/merge-stack-{nonce}/export?format=json", headers=h)
            self.assertEqual(er.status_code, 200, er.text)
            data = json.loads(er.text)
            self.assertEqual(data["FOO"], "from-top")
            self.assertEqual(data["ONLY_BASE"], "yes")
            self.assertEqual(data["ONLY_TOP"], "yes")

    def test_stack_selected_keys_partial_merge(self) -> None:
        """Top layer with selected keys only merges those keys; other keys stay from lower layers."""
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"pickproj-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Pick Proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"sb-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"FOO": "from-base-foo", "BAR": "from-base-bar"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"st-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"FOO": "from-top-foo", "ONLY_TOP": "yes"},
                },
                headers=hj,
            )
            cr = client.post(
                "/api/v1/stacks",
                json={
                    "name": f"pick-stack-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [
                        {"bundle": f"sb-{nonce}", "keys": "*"},
                        {"bundle": f"st-{nonce}", "keys": ["FOO"]},
                    ],
                },
                headers=hj,
            )
            self.assertEqual(cr.status_code, 201, cr.text)
            er = client.get(f"/api/v1/stacks/pick-stack-{nonce}/export?format=json", headers=h)
            self.assertEqual(er.status_code, 200, er.text)
            data = json.loads(er.text)
            self.assertEqual(data["FOO"], "from-top-foo")
            self.assertEqual(data["BAR"], "from-base-bar")
            self.assertNotIn("ONLY_TOP", data)

    def test_stack_export_403_when_layer_bundle_unreadable(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"scproj-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Scope Proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"scope-a-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"K": "a"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"scope-b-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"K": "b"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/stacks",
                json={
                    "name": f"scope-stack-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [f"scope-a-{nonce}", f"scope-b-{nonce}"],
                },
                headers=hj,
            )
            kr = client.post(
                "/api/v1/api-keys",
                json={
                    "name": f"narrow-{nonce}",
                    "scopes": [
                        f"read:stack:scope-stack-{nonce}",
                        f"read:bundle:scope-a-{nonce}",
                    ],
                },
                headers=hj,
            )
            self.assertEqual(kr.status_code, 201, kr.text)
            plain = kr.json()["plain_key"]
            hn = {"Authorization": f"Bearer {plain}"}
            bad = client.get(f"/api/v1/stacks/scope-stack-{nonce}/export", headers=hn)
            self.assertEqual(bad.status_code, 403)

    def test_stack_crud_and_patch_layers(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"crud-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"CRUD Proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"c1-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"X": "1"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"c2-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"X": "2"},
                },
                headers=hj,
            )
            cr = client.post(
                "/api/v1/stacks",
                json={
                    "name": f"crud-s-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [f"c1-{nonce}"],
                },
                headers=hj,
            )
            self.assertEqual(cr.status_code, 201)
            gr = client.get(f"/api/v1/stacks/crud-s-{nonce}", headers=h)
            self.assertEqual(gr.status_code, 200)
            self.assertEqual(
                gr.json()["layers"],
                [{"bundle": f"c1-{nonce}", "keys": "*"}],
            )
            pr = client.patch(
                f"/api/v1/stacks/crud-s-{nonce}",
                json={"layers": [f"c1-{nonce}", f"c2-{nonce}"]},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 200)
            gr2 = client.get(f"/api/v1/stacks/crud-s-{nonce}", headers=h)
            self.assertEqual(
                gr2.json()["layers"],
                [
                    {"bundle": f"c1-{nonce}", "keys": "*"},
                    {"bundle": f"c2-{nonce}", "keys": "*"},
                ],
            )
            pr_label = client.patch(
                f"/api/v1/stacks/crud-s-{nonce}",
                json={
                    "layers": [
                        {"bundle": f"c1-{nonce}", "keys": "*", "label": "base"},
                        {"bundle": f"c2-{nonce}", "keys": "*"},
                    ]
                },
                headers=hj,
            )
            self.assertEqual(pr_label.status_code, 200)
            gr_lab = client.get(f"/api/v1/stacks/crud-s-{nonce}", headers=h)
            self.assertEqual(
                gr_lab.json()["layers"],
                [
                    {"bundle": f"c1-{nonce}", "keys": "*", "label": "base"},
                    {"bundle": f"c2-{nonce}", "keys": "*"},
                ],
            )
            rn = client.patch(
                f"/api/v1/stacks/crud-s-{nonce}",
                json={"name": f"crud-s2-{nonce}"},
                headers=hj,
            )
            self.assertEqual(rn.status_code, 200)
            grn = client.get(f"/api/v1/stacks/crud-s2-{nonce}", headers=h)
            self.assertEqual(grn.status_code, 200)
            self.assertEqual(grn.json()["name"], f"crud-s2-{nonce}")
            ex = client.get(f"/api/v1/stacks/crud-s2-{nonce}/export?format=json", headers=h)
            self.assertEqual(json.loads(ex.text)["X"], "2")
            dr = client.delete(f"/api/v1/stacks/crud-s2-{nonce}", headers=h)
            self.assertEqual(dr.status_code, 204)
            g1 = client.get(f"/api/v1/bundles/c1-{nonce}", headers=h)
            self.assertEqual(g1.status_code, 200)

    def test_stack_env_link_downloads_merged_env(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"envp-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Env Proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"e1-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"Z": "1"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"e2-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"Z": "2"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/stacks",
                json={
                    "name": f"env-stack-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [f"e1-{nonce}", f"e2-{nonce}"],
                },
                headers=hj,
            )
            lr = client.post(f"/api/v1/stacks/env-stack-{nonce}/env-links", headers=h)
            self.assertEqual(lr.status_code, 201, lr.text)
            url = lr.json()["url"]
            path = url.split("/env/")[-1].split("?")[0]
            nr = client.get(f"/env/{path}?format=json")
            self.assertEqual(nr.status_code, 200)
            self.assertEqual(json.loads(nr.text)["Z"], "2")

    def test_stack_env_link_prefix_slice(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"slip-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Slice Proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"s1-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"Z": "bottom"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"s2-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"Z": "top"},
                },
                headers=hj,
            )
            client.post(
                "/api/v1/stacks",
                json={
                    "name": f"slice-stack-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [f"s1-{nonce}", f"s2-{nonce}"],
                },
                headers=hj,
            )
            lr_full = client.post(
                f"/api/v1/stacks/slice-stack-{nonce}/env-links", headers=hj, json={}
            )
            self.assertEqual(lr_full.status_code, 201)
            path_full = lr_full.json()["url"].split("/env/")[-1].split("?")[0]
            self.assertEqual(
                json.loads(client.get(f"/env/{path_full}?format=json").text)["Z"],
                "top",
            )
            lr_slice = client.post(
                f"/api/v1/stacks/slice-stack-{nonce}/env-links",
                headers=hj,
                json={"through_layer_position": 0},
            )
            self.assertEqual(lr_slice.status_code, 201, lr_slice.text)
            path_slice = lr_slice.json()["url"].split("/env/")[-1].split("?")[0]
            self.assertEqual(
                json.loads(client.get(f"/env/{path_slice}?format=json").text)["Z"],
                "bottom",
            )
            lst = client.get(f"/api/v1/stacks/slice-stack-{nonce}/env-links", headers=h)
            self.assertEqual(lst.status_code, 200)
            rows = lst.json()
            slice_rows = [x for x in rows if x.get("through_layer_position") == 0]
            self.assertEqual(len(slice_rows), 1)
            self.assertEqual(slice_rows[0]["slice_label"], f"s1-{nonce}")
            full_rows = [x for x in rows if x.get("through_layer_position") is None]
            self.assertEqual(len(full_rows), 1)
            self.assertEqual(
                full_rows[0]["token_sha256"],
                hashlib.sha256(path_full.encode("utf-8")).hexdigest(),
            )
            self.assertEqual(
                slice_rows[0]["token_sha256"],
                hashlib.sha256(path_slice.encode("utf-8")).hexdigest(),
            )

    def test_env_link_resolve_by_digest(self) -> None:
        """GET /api/v1/env-links/resolve maps token_sha256 → bundle for navigation."""
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"resolv-{nonce}"
        with TestClient(app) as client:
            client.post(
                "/api/v1/projects",
                json={"name": f"Resolve proj {nonce}", "slug": slug},
                headers=hj,
            )
            _ensure_default_environment(client, hj, slug)
            client.post(
                "/api/v1/bundles",
                json={
                    "name": f"rb-{nonce}",
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"K": "v"},
                },
                headers=hj,
            )
            lr = client.post(f"/api/v1/bundles/rb-{nonce}/env-links", headers=h)
            self.assertEqual(lr.status_code, 201, lr.text)
            path = lr.json()["url"].split("/env/")[-1].split("?")[0]
            digest = hashlib.sha256(path.encode("utf-8")).hexdigest()
            rr = client.get(f"/api/v1/env-links/resolve?token_sha256={digest}", headers=h)
            self.assertEqual(rr.status_code, 200, rr.text)
            j = rr.json()
            self.assertEqual(j["resource"], "bundle")
            self.assertEqual(j["name"], f"rb-{nonce}")
            self.assertEqual(j["project_slug"], slug)
            self.assertEqual(j["environment_slug"], "default")


class AuthJsonApiTests(unittest.TestCase):
    """JSON auth routes and session-backed /api/v1 access for the React admin."""

    _token = "tfstate-http-test-admin-key"

    def test_auth_csrf_login_projects_logout(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/csrf")
            self.assertEqual(r.status_code, 200, r.text)
            csrf = r.json()["csrf_token"]
            r2 = client.post(
                "/api/v1/auth/login",
                json={"api_key": self._token},
                headers={"X-CSRF-Token": csrf},
            )
            self.assertEqual(r2.status_code, 200, r2.text)
            csrf_new = r2.json()["csrf_token"]
            r3 = client.get("/api/v1/projects")
            self.assertEqual(r3.status_code, 200, r3.text)
            r4 = client.post(
                "/api/v1/auth/logout",
                headers={"X-CSRF-Token": csrf_new},
            )
            self.assertEqual(r4.status_code, 204, r4.text)
            r5 = client.get("/api/v1/projects")
            self.assertEqual(r5.status_code, 401, r5.text)

    def test_session_post_without_csrf_returns_400(self) -> None:
        """Cookie session auth requires X-CSRF-Token on mutating API calls."""
        nonce = uuid4().hex[:8]
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/csrf")
            self.assertEqual(r.status_code, 200, r.text)
            csrf = r.json()["csrf_token"]
            r2 = client.post(
                "/api/v1/auth/login",
                json={"api_key": self._token},
                headers={"X-CSRF-Token": csrf},
            )
            self.assertEqual(r2.status_code, 200, r2.text)
            slug = f"csrf-neg-{nonce}"
            r3 = client.post(
                "/api/v1/projects",
                json={"name": f"CSRF neg {nonce}", "slug": slug},
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(r3.status_code, 400, r3.text)
            self.assertIn("CSRF", r3.json()["detail"])

    def test_session_post_with_csrf_succeeds(self) -> None:
        nonce = uuid4().hex[:8]
        slug = f"csrf-ok-{nonce}"
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/csrf")
            self.assertEqual(r.status_code, 200, r.text)
            csrf = r.json()["csrf_token"]
            r2 = client.post(
                "/api/v1/auth/login",
                json={"api_key": self._token},
                headers={"X-CSRF-Token": csrf},
            )
            self.assertEqual(r2.status_code, 200, r2.text)
            csrf_new = r2.json()["csrf_token"]
            r3 = client.post(
                "/api/v1/projects",
                json={"name": f"CSRF ok {nonce}", "slug": slug},
                headers={
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrf_new,
                },
            )
            self.assertEqual(r3.status_code, 201, r3.text)
            self.assertEqual(r3.json()["slug"], slug)


class StackKeyGraphApiTests(unittest.TestCase):
    """GET /api/v1/stacks/{name}/key-graph returns merged layer graph JSON."""

    _token = "tfstate-http-test-admin-key"

    def test_key_graph_json_shape(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"kgp-{nonce}"
        bname = f"kgb-{nonce}"
        sname = f"kgs-{nonce}"
        with TestClient(app) as client:
            pr = client.post(
                "/api/v1/projects",
                json={"name": f"KG {nonce}", "slug": slug},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, slug)
            br = client.post(
                "/api/v1/bundles",
                json={"name": bname, "project_slug": slug, "project_environment_slug": "default"},
                headers=hj,
            )
            self.assertEqual(br.status_code, 201, br.text)
            sr = client.post(
                "/api/v1/stacks",
                json={
                    "name": sname,
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [{"bundle": bname, "keys": "*"}],
                },
                headers=hj,
            )
            self.assertEqual(sr.status_code, 201, sr.text)
            r = client.get(f"/api/v1/stacks/{sname}/key-graph", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        self.assertIn("layers", j)
        self.assertIn("rows", j)
        self.assertIsInstance(j["layers"], list)
        self.assertIsInstance(j["rows"], list)
        self.assertIs(j.get("secret_values_included"), False)

    def test_key_graph_cells_alias_source(self) -> None:
        """Key-graph rows include cells_alias_source when stack layers define aliases."""
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        slug = f"kgalias-{nonce}"
        base_b = f"kgb-in-{nonce}"
        top_b = f"kgb-out-{nonce}"
        sname = f"kgs-alias-{nonce}"
        with TestClient(app) as client:
            pr = client.post(
                "/api/v1/projects",
                json={"name": f"KGAlias {nonce}", "slug": slug},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, slug)
            br0 = client.post(
                "/api/v1/bundles",
                json={
                    "name": base_b,
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "entries": {"OIDC_KEY": "the-oidc-value"},
                },
                headers=hj,
            )
            self.assertEqual(br0.status_code, 201, br0.text)
            br1 = client.post(
                "/api/v1/bundles",
                json={"name": top_b, "project_slug": slug, "project_environment_slug": "default"},
                headers=hj,
            )
            self.assertEqual(br1.status_code, 201, br1.text)
            sr = client.post(
                "/api/v1/stacks",
                json={
                    "name": sname,
                    "project_slug": slug,
                    "project_environment_slug": "default",
                    "layers": [
                        {"bundle": base_b, "keys": "*"},
                        {
                            "bundle": top_b,
                            "keys": "*",
                            "aliases": {"VITE_OIDC_KEY": "OIDC_KEY"},
                        },
                    ],
                },
                headers=hj,
            )
            self.assertEqual(sr.status_code, 201, sr.text)
            r = client.get(f"/api/v1/stacks/{sname}/key-graph", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        j = r.json()
        rows_by_key = {row["key"]: row for row in j["rows"]}
        self.assertIn("OIDC_KEY", rows_by_key)
        self.assertIn("VITE_OIDC_KEY", rows_by_key)
        vite = rows_by_key["VITE_OIDC_KEY"]
        cas = vite["cells_alias_source"]
        self.assertEqual(len(cas), 2)
        self.assertIsNone(cas[0])
        self.assertEqual(cas[1], "OIDC_KEY")
        oidc = rows_by_key["OIDC_KEY"]
        self.assertEqual(oidc["cells_alias_source"], [None, None])


class OidcAuthApiTests(unittest.TestCase):
    """OIDC app settings, login-options, and callback redirect."""

    _token = "tfstate-http-test-admin-key"

    def test_login_options_default(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/login-options")
            self.assertEqual(r.status_code, 200, r.text)
            self.assertFalse(r.json()["oidc_configured"])

    def test_oidc_settings_requires_auth(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/settings/oidc")
            self.assertEqual(r.status_code, 401, r.text)

    def test_oidc_settings_patch_and_login_options(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        body = {
            "enabled": True,
            "issuer": "https://example-tenant.example.com/oauth2/default",
            "client_id": "test-client-id",
            "client_secret": "test-client-secret",
            "scopes": "openid email profile",
            "post_login_path": "/projects",
        }
        with TestClient(app) as client:
            r = client.patch("/api/v1/settings/oidc", json=body, headers=h)
            self.assertEqual(r.status_code, 200, r.text)
            j = r.json()
            self.assertTrue(j["enabled"])
            self.assertTrue(j["client_secret_configured"])
            self.assertTrue(j["oidc_login_ready"])
            self.assertIn("suggested_callback_url", j)
            self.assertIn("/api/v1/auth/oidc/callback", j["suggested_callback_url"])
            r2 = client.get("/api/v1/auth/login-options")
            self.assertEqual(r2.status_code, 200, r2.text)
            self.assertTrue(r2.json()["oidc_configured"])

    def test_oidc_link_requires_auth(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/oidc/link", follow_redirects=False)
            self.assertEqual(r.status_code, 401, r.text)

    def test_oidc_login_redirects_info_when_not_configured(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/oidc/login", follow_redirects=False)
            self.assertEqual(r.status_code, 302, r.text)
            loc = r.headers.get("location", "")
            self.assertIn("/login", loc)
            self.assertIn("oidc_info=not_configured", loc)

    def test_oidc_link_redirects_info_when_not_configured(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/oidc/link", headers=h, follow_redirects=False)
            self.assertEqual(r.status_code, 302, r.text)
            loc = r.headers.get("location", "")
            self.assertIn("/account", loc)
            self.assertIn("oidc_info=not_configured", loc)

    def test_oidc_status_requires_auth(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/oidc/status")
            self.assertEqual(r.status_code, 401, r.text)

    def test_oidc_callback_without_session_redirects(self) -> None:
        with TestClient(app) as client:
            r = client.get(
                "/api/v1/auth/oidc/callback",
                params={"code": "x", "state": "y"},
                follow_redirects=False,
            )
            self.assertEqual(r.status_code, 302, r.text)
            self.assertIn("/login?oidc_error=1", r.headers.get("location", ""))


class ApiKeyResolutionTests(unittest.TestCase):
    """Indexed key_lookup_hmac + legacy NULL fallback (see app/deps.resolve_api_key)."""

    _token = "tfstate-http-test-admin-key"

    def setUp(self) -> None:
        """Ensure lifespan has run so SQLite tables exist (this class may run first in the module)."""
        h = {"Authorization": f"Bearer {self._token}"}
        with TestClient(app) as client:
            r = client.get("/api/v1/bundles", headers=h)
        self.assertEqual(r.status_code, 200, r.text)

    def test_bootstrap_row_has_key_lookup_hmac(self) -> None:
        import sqlite3

        conn = sqlite3.connect(str(_db_path))
        row = conn.execute("SELECT key_lookup_hmac FROM api_keys WHERE id = 1").fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertIsNotNone(row[0])
        self.assertEqual(len(row[0]), 64)

    def test_bearer_auth_legacy_path_when_lookup_null(self) -> None:
        import sqlite3

        from app.auth_keys import key_lookup_hmac
        from app.config import get_settings

        settings = get_settings()
        hmac_val = key_lookup_hmac(self._token, settings.master_key)
        conn = sqlite3.connect(str(_db_path))
        conn.execute("UPDATE api_keys SET key_lookup_hmac = NULL WHERE id = 1")
        conn.commit()
        conn.close()
        try:
            h = {"Authorization": f"Bearer {self._token}"}
            with TestClient(app) as client:
                r = client.get("/api/v1/bundles", headers=h)
            self.assertEqual(r.status_code, 200, r.text)
        finally:
            conn = sqlite3.connect(str(_db_path))
            conn.execute(
                "UPDATE api_keys SET key_lookup_hmac = ? WHERE id = 1",
                (hmac_val,),
            )
            conn.commit()
            conn.close()

    def test_created_api_key_bearer_uses_lookup(self) -> None:
        h = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        with TestClient(app) as client:
            r = client.post(
                "/api/v1/api-keys",
                headers=h,
                json={"name": "lookup-ci-key", "scopes": ["read:bundle:*"]},
            )
            self.assertEqual(r.status_code, 201, r.text)
            plain = r.json()["plain_key"]
            h2 = {"Authorization": f"Bearer {plain}"}
            r2 = client.get("/api/v1/bundles", headers=h2)
            self.assertEqual(r2.status_code, 200, r.text)


class AuditTrailHttpTests(unittest.TestCase):
    """Structured audit logger + audit_events rows on sensitive reads."""

    _token = "tfstate-http-test-admin-key"

    def test_bundle_export_emits_audit_log_and_database_row(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        with TestClient(app) as client:
            pr = client.post(
                "/api/v1/projects",
                json={"name": f"Audit proj {nonce}", "slug": f"auditproj-{nonce}"},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, f"auditproj-{nonce}")
            br = client.post(
                "/api/v1/bundles",
                json={
                    "name": f"audit-bun-{nonce}",
                    "project_slug": f"auditproj-{nonce}",
                    "project_environment_slug": "default",
                },
                headers=hj,
            )
            self.assertEqual(br.status_code, 201, br.text)
            with self.assertLogs("envelope.audit", level="INFO") as cm:
                ex = client.get(
                    f"/api/v1/bundles/audit-bun-{nonce}/export?format=dotenv",
                    headers=h,
                )
            self.assertEqual(ex.status_code, 200, ex.text)
            logged = "\n".join(cm.output)
            self.assertIn("bundle.export", logged)
            ar = client.get("/api/v1/system/audit-events?limit=20", headers=h)
            self.assertEqual(ar.status_code, 200, ar.text)
            events = ar.json()["events"]
            types = [e["event_type"] for e in events]
            self.assertIn("bundle.export", types)
            hit = next(e for e in events if e["event_type"] == "bundle.export")
            self.assertIsNotNone(hit.get("actor_api_key_id"))
            self.assertEqual(hit.get("details", {}).get("format"), "dotenv")

    def test_env_link_download_audit_has_no_api_key_actor(self) -> None:
        h = {"Authorization": f"Bearer {self._token}"}
        hj = {**h, "Content-Type": "application/json"}
        nonce = uuid4().hex[:8]
        with TestClient(app) as client:
            pr = client.post(
                "/api/v1/projects",
                json={"name": f"Env audit {nonce}", "slug": f"envaudit-{nonce}"},
                headers=hj,
            )
            self.assertEqual(pr.status_code, 201, pr.text)
            _ensure_default_environment(client, hj, f"envaudit-{nonce}")
            br = client.post(
                "/api/v1/bundles",
                json={
                    "name": f"env-audit-bun-{nonce}",
                    "project_slug": f"envaudit-{nonce}",
                    "project_environment_slug": "default",
                },
                headers=hj,
            )
            self.assertEqual(br.status_code, 201, br.text)
            lr = client.post(
                f"/api/v1/bundles/env-audit-bun-{nonce}/env-links",
                json={},
                headers=hj,
            )
            self.assertEqual(lr.status_code, 201, lr.text)
            url = lr.json()["url"]
            token = url.split("/env/")[-1]
            with self.assertLogs("envelope.audit", level="INFO") as cm:
                dr = client.get(f"/env/{token}")
            self.assertEqual(dr.status_code, 200, dr.text)
            logged = "\n".join(cm.output)
            self.assertIn("env_link.download", logged)
            ar = client.get("/api/v1/system/audit-events?limit=20", headers=h)
            self.assertEqual(ar.status_code, 200, ar.text)
            evs = [e for e in ar.json()["events"] if e["event_type"] == "env_link.download"]
            self.assertTrue(evs)
            e0 = evs[0]
            self.assertIsNone(e0.get("actor_api_key_id"))
            self.assertIsNotNone(e0.get("token_sha256_prefix"))


class SecurityHeadersHttpTests(unittest.TestCase):
    """Baseline browser hardening headers from app/security_headers.py."""

    def test_api_response_includes_baseline_and_csp(self) -> None:
        with TestClient(app) as client:
            r = client.get("/api/v1/auth/login-options")
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.headers.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(r.headers.get("X-Frame-Options"), "DENY")
            self.assertEqual(
                r.headers.get("Referrer-Policy"),
                "strict-origin-when-cross-origin",
            )
            self.assertIn("Permissions-Policy", r.headers)
            csp = r.headers.get("Content-Security-Policy", "")
            self.assertIn("default-src", csp)
            self.assertIn("frame-ancestors", csp)

    def test_csp_skipped_for_docs_and_openapi_paths(self) -> None:
        from app.security_headers import should_attach_content_security_policy

        self.assertFalse(should_attach_content_security_policy("/openapi.json"))
        self.assertFalse(should_attach_content_security_policy("/docs"))
        self.assertFalse(should_attach_content_security_policy("/docs/oauth2-redirect"))
        self.assertFalse(should_attach_content_security_policy("/redoc"))
        self.assertTrue(should_attach_content_security_policy("/api/v1/auth/login-options"))


if __name__ == "__main__":
    unittest.main()
