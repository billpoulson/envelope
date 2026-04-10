# Envelope

Self-hosted **secure environment bundle** manager: named groups of secrets (like a `.env` file), **encrypted at rest**, with **API key** access for CI/CD and a small **web UI** for administration.

## Features

- **Fernet (AES)** encryption of secret values in SQLite using `ENVELOPE_MASTER_KEY`
- **API keys** (bcrypt-hashed): `read` (export bundles) and `admin` (manage bundles and keys)
- **Export** for pipelines: `GET /api/v1/bundles/{name}/export?format=dotenv|json` with `Authorization: Bearer …`
- **Opaque env URLs**: download a bundle as `.env` or JSON via `GET /env/{secret-token}` — the path is a random token only (no project or bundle name). Create links from the bundle’s **Secret env URL** page in the web UI (`…/bundles/{name}/env-links`, or under **Projects**) or `POST /api/v1/bundles/{name}/env-links` (API key with write access to that bundle).
- **Backups**: full SQLite snapshots and passphrase-encrypted files (admin); per-bundle JSON/encrypted export and merge import (scoped API keys)
- **Rate limits** on sensitive routes (export, web login)

## Quick start (Docker)

1. Copy `.env.example` to `.env` and set:

   - `ENVELOPE_MASTER_KEY` — generate with:
     `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
   - `ENVELOPE_SESSION_SECRET` — long random string (web session signing)
   - `ENVELOPE_INITIAL_ADMIN_KEY` — **first run only**: a chosen admin API key (stored hashed); remove after you create keys in the UI

2. Build and run:

   ```bash
   docker compose --env-file .env up --build
   ```

3. Open `http://localhost:8080`, sign in with the **admin** key you set in `ENVELOPE_INITIAL_ADMIN_KEY`, create a **read** key for CI, add bundles and secrets.

4. Remove `ENVELOPE_INITIAL_ADMIN_KEY` from your compose/env once you have another admin key saved.

### TLS

Use HTTP only on trusted networks. In production, terminate **HTTPS** in front of Envelope (Caddy, Traefik, nginx, a cloud load balancer).

## CI example (GitHub Actions)

Store a **read** API key in `ENVELOPE_API_KEY` (or similar), then:

```yaml
- name: Fetch .env from Envelope
  run: |
    curl -fsS -H "Authorization: Bearer ${{ secrets.ENVELOPE_API_KEY }}" \
      "${{ vars.ENVELOPE_URL }}/api/v1/bundles/myapp-prod/export?format=dotenv" \
      -o .env
```

Use `format=json` for JSON instead of dotenv text.

### Without project or bundle names in the download URL

For jobs where the fetch URL must not contain bundle or project identifiers, create an **opaque link** once (admin / bundle write scope), store the full URL in your secret store, then use it with plain `curl` (no `Authorization` header):

1. **Web:** open the bundle → **Secret env URL** (sub-nav) → **Generate new secret URL**, copy the link once (it is not shown again).
2. **API:** `curl -fsS -X POST -H "Authorization: Bearer $ADMIN_KEY" "$ENVELOPE_URL/api/v1/bundles/myapp-prod/env-links"` — response includes `"url": "https://…/env/<token>"`.

Download: `curl -fsS "$URL" -o .env` or append `?format=json`. Revoke unused links from the bundle’s **Secret env URL** page or `DELETE /api/v1/bundles/{name}/env-links/{id}`. Treat the URL like a credential; use HTTPS in production.

## Local development

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
set ENVELOPE_MASTER_KEY=...        # Fernet key
set ENVELOPE_SESSION_SECRET=...    # any string in dev; or set ENVELOPE_DEBUG=true
set ENVELOPE_INITIAL_ADMIN_KEY=your-first-admin-key
uvicorn app.main:app --reload --port 8080
```

API docs: `http://localhost:8080/docs`

## API overview

| Method | Path | Scope |
|--------|------|--------|
| GET | `/api/v1/bundles` | admin — list bundle names |
| POST | `/api/v1/bundles` | admin — create bundle |
| PATCH | `/api/v1/bundles/{name}` | write — optional `project_slug` / `group_id` (move project) and/or `entries` (upsert keys; same JSON rules as create) |
| DELETE | `/api/v1/bundles/{name}` | admin |
| GET | `/api/v1/bundles/{name}` | admin — decrypted JSON |
| GET | `/api/v1/bundles/{name}/export?format=dotenv` or `format=json` | read or admin |
| POST | `/api/v1/bundles/{name}/secrets` | admin — body: `key_name`, `value` |
| DELETE | `/api/v1/bundles/{name}/secrets?key_name=…` | admin |
| GET | `/api/v1/bundles/{name}/env-links` | write scope for bundle — list link ids (not full URLs) |
| POST | `/api/v1/bundles/{name}/env-links` | write — returns `{ "url": "…/env/<token>" }` once |
| DELETE | `/api/v1/bundles/{name}/env-links/{id}` | write — revoke |
| GET | `/api/v1/api-keys` | admin |
| POST | `/api/v1/api-keys` | admin — response includes `plain_key` once |
| DELETE | `/api/v1/api-keys/{id}` | admin |
| GET | `/api/v1/system/backup/database` | admin — raw SQLite snapshot (`application/octet-stream`) |
| POST | `/api/v1/system/backup/database` | admin — body `{"passphrase":"..."}`; encrypted `.envelope-db` download |
| POST | `/api/v1/system/restore/database` | admin — multipart `file` (+ optional `passphrase` for encrypted files); **requires** `ENVELOPE_RESTORE_ENABLED=true` |
| GET | `/api/v1/bundles/{name}/backup` | read access to bundle — structured JSON (`envelope-bundle-backup-v1`) |
| POST | `/api/v1/bundles/{name}/backup/encrypted` | read — JSON `{"passphrase":"..."}`; encrypted bundle file |
| PUT | `/api/v1/bundles/{name}/backup` | write access — merge secrets from JSON backup (upsert keys) |
| POST | `/api/v1/bundles/{name}/backup/import-encrypted` | write — multipart `file` + form `passphrase` |

Never log request bodies or API keys.

## Backups

Two levels:

1. **Full database (disaster recovery)** — Admin API key only (`GET`/`POST /api/v1/system/backup/database`). The raw file is sensitive (metadata, Fernet ciphertext, API key hashes). Encrypted downloads use **Scrypt** + **AES-256-GCM**; passphrases must only be sent over **HTTPS** in production. The backup file does **not** include `ENVELOPE_MASTER_KEY`; keep the Fernet key in a separate secret store so you can decrypt secret values after restore.

2. **Single bundle** — Any key with read access can export `GET /api/v1/bundles/{name}/backup` or request an encrypted bundle file; keys with write access can `PUT` merge-import JSON or `POST` an encrypted file. This is for moving one bundle between instances without sharing the whole database.

**Restore** replaces the SQLite file on disk (`/data/envelope.db` in Docker). It is **disabled** by default (`ENVELOPE_RESTORE_ENABLED=false`). Enable only when you need in-app recovery; otherwise stop the container and replace the file on the volume manually. The web UI exposes the same operations at `/backup` (signed-in admin).

Offline copy: you can still copy the SQLite file from the `/data` volume while the service is stopped.
