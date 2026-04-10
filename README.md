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

### Behind a gateway

Uvicorn applies **forwarded headers** only from **trusted** client addresses (`FORWARDED_ALLOW_IPS`, default `127.0.0.1`). Set this to your gateway’s subnet (for example Docker bridge `172.18.0.0/16`) so `X-Forwarded-Proto` and `X-Forwarded-For` are honored. The Docker image passes `--forwarded-allow-ips` from that environment variable. Without it, opaque env URLs and `request.base_url` may show `http://` and rate limits may see the proxy as the only client.

**Pattern A — own hostname or subdomain (app at `/`).** Configure the proxy to preserve `Host`, set `X-Forwarded-Proto: https`, and optionally `X-Forwarded-For`. Set `FORWARDED_ALLOW_IPS` as above. For HTTPS in the browser while the app speaks HTTP to the proxy, set `ENVELOPE_HTTPS_COOKIES=true` so session cookies use the `Secure` flag.

**Pattern B — path prefix (e.g. `https://example.com/envelope/…`).** Set `ENVELOPE_ROOT_PATH=/envelope` (no trailing slash). The reverse proxy must **strip** that prefix when forwarding to Envelope so the upstream request path is `/bundles`, `/api/v1/…`, etc.; uvicorn is started with `--root-path` from the same value (handled in the Dockerfile `CMD`). OpenAPI and the web UI then use the prefixed paths.

#### Subdomain (e.g. `envelope.example.com`)

This is **pattern A**: Envelope stays at the **root path** `/` on its own host name; you do **not** set `ENVELOPE_ROOT_PATH`.

1. Point DNS (**A** / **AAAA**) for `envelope.example.com` to the machine or load balancer that runs Traefik (or another proxy).
2. Terminate **TLS** at the proxy with a real certificate (Let’s Encrypt, etc.).
3. Forward HTTP to the container on port **8080** (or your mapped port). Preserve the original **`Host`** header (Traefik does this by default).
4. Set **`ENVELOPE_HTTPS_COOKIES=true`** so the web UI session cookie is marked **Secure**—browsers only send it over HTTPS to that host.
5. Set **`FORWARDED_ALLOW_IPS`** so it includes the **proxy’s IP range** (see below). Uvicorn only trusts `X-Forwarded-Proto` / `X-Forwarded-For` from those addresses, which keeps generated opaque env URLs and `request.base_url` on `https://…`.

#### Traefik (example)

Traefik usually sets **`X-Forwarded-*`** for you when it proxies to the backend. Envelope must **trust** Traefik’s IP (not only `127.0.0.1`) or forwarded headers are ignored.

- Put Traefik and Envelope on the **same Docker network** and route by **host** rule.
- Set **`FORWARDED_ALLOW_IPS`** on the Envelope service to the **Docker bridge** subnet Traefik uses (often something like `172.16.0.0/12`—inspect with `docker network inspect`). If Traefik is the only entry to Envelope on that network, restricting to that CIDR is enough for trust; avoid `*` unless you understand the risk.

Example **Docker Compose** fragments (Traefik v2 style labels; adjust names, networks, and cert resolver to your setup):

```yaml
services:
  traefik:
    image: traefik:v3.0
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    # ... command / static config for entrypoints web, websecure, certificates ...

  envelope:
    build: .
    environment:
      ENVELOPE_MASTER_KEY: ${ENVELOPE_MASTER_KEY}
      ENVELOPE_SESSION_SECRET: ${ENVELOPE_SESSION_SECRET}
      ENVELOPE_HTTPS_COOKIES: "true"
      FORWARDED_ALLOW_IPS: "172.16.0.0/12" # example; use your Docker network CIDR
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.envelope.rule=Host(`envelope.example.com`)"
      - "traefik.http.routers.envelope.entrypoints=websecure"
      - "traefik.http.routers.envelope.tls=true"
      - "traefik.http.routers.envelope.tls.certresolver=myresolver"
      - "traefik.http.services.envelope.loadbalancer.server.port=8080"
```

Use **`websecure`** (HTTPS) for production; redirect HTTP → HTTPS with a global middleware if you expose port 80. After deploy, open `https://envelope.example.com` and confirm API/env links show **https** in generated URLs.

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

## Opaque `/env/…` URLs and encrypted values

**`GET /env/{token}`.** The `{token}` segment is a **random secret** Envelope generates when you create an env link. It is **not** `ENVELOPE_MASTER_KEY`, not something you paste from another system, and it does not encode the bundle or project name. Holders of the URL can download variables **without** `Authorization: Bearer`; treat the URL like a password. Query: `?format=dotenv` (default) or `?format=json`. The HTTP body is **plaintext** dotenv or JSON—protect it with **HTTPS**.

**At-rest encryption.** Variable values marked secret are stored in SQLite as **Fernet** ciphertext using the server’s `ENVELOPE_MASTER_KEY`. Exports (`/api/v1/…/export`, `/env/…`, decrypted API responses) return **cleartext** for use in apps; the master key never appears in those responses.

**JSON `entries` (API or UI import).** Top-level string values default to **encrypted at rest** (`secret` semantics). Use `"_plaintext_keys": ["KEY1", …]` and/or per-key form `"KEY": {"value": "…", "secret": false}` for non-secret config; use `"secret": true` or the default string form for secrets.

### Examples (secret env URL)

Create a link once (write access to the bundle), then reuse the returned `url` anywhere you would use a credential—**no** `Authorization` header on download.

**Create via API and save `.env`:**

```bash
# Returns JSON: { "url": "https://envelope.example.com/env/<token>", "message": "..." }
RESP=$(curl -fsS -X POST \
  -H "Authorization: Bearer $WRITE_OR_ADMIN_KEY" \
  "$ENVELOPE_URL/api/v1/bundles/myapp-prod/env-links")
URL=$(echo "$RESP" | python -c "import sys,json; print(json.load(sys.stdin)['url'])")

curl -fsS "$URL" -o .env
# JSON instead of dotenv:
curl -fsS "$URL?format=json" -o environment.json
```

**Download when the URL is already in a secret store** (variable name is arbitrary; the value is the full `https://…/env/…` string):

```bash
curl -fsS "$ENVELOPE_SECRET_ENV_URL" -o .env
curl -fsS "$ENVELOPE_SECRET_ENV_URL?format=json" | python -m json.tool
```

**GitHub Actions** (store the full opaque URL in a secret, e.g. `ENVELOPE_ENV_URL`):

```yaml
- name: Fetch .env from opaque URL
  run: curl -fsS "${{ secrets.ENVELOPE_ENV_URL }}" -o .env
```

If Envelope is behind a **path prefix** (`ENVELOPE_ROOT_PATH`), the `url` from the API already includes that prefix—use it exactly as returned.

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
