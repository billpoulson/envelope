# Envelope

Self-hosted **secure environment bundle** manager: named groups of secrets (like a `.env` file), **encrypted at rest**, with **API key** access for CI/CD and a small **web UI** for administration.

## Features

- **Fernet (AES)** encryption of secret values in SQLite using `ENVELOPE_MASTER_KEY`
- **API keys** (bcrypt-hashed): `read` (export bundles) and `admin` (manage bundles and keys)
- **Export** for pipelines: `GET /api/v1/bundles/{name}/export?format=dotenv|json` with `Authorization: Bearer …`
- **Bundle stacks** — ordered layers of existing bundles merged into one composite `.env` / JSON (`GET /api/v1/stacks/{name}/export`). Later layers **overwrite** duplicate keys from earlier layers. Scopes: `read:stack:…`, `write:stack:…` (and project scopes for stacks in a project). Web: **Stacks**; same opaque `/env/{token}` links as bundles (`POST /api/v1/stacks/{name}/env-links`). Stack links can optionally be a **prefix slice**: merge from the bottom through a chosen layer only (`POST` body `{"through_layer_position": <n>}` matching a layer position).
- **Opaque env URLs**: download a bundle **or merged stack** (full or prefix slice) as `.env` or JSON via `GET /env/{secret-token}` — the path is a random token only (no project, bundle, or stack name). Create links from a bundle’s or stack’s **Secret env URL** page (`…/bundles/{name}/env-links`, `…/stacks/{name}/env-links`) or the matching `POST /api/v1/…/env-links` API (API key with write access).
- **Backups**: full SQLite snapshots and passphrase-encrypted files (admin); per-bundle JSON/encrypted export and merge import (scoped API keys)
- **Rate limits** on sensitive routes (export, web login)
- **Certificate-backed sealed secrets** (zero-knowledge path): store client-encrypted ciphertext + wrapped data keys per recipient certificate; server does not need private keys to decrypt
- **Terraform HTTP remote state** (optional): per-project URLs `/tfstate/projects/<slug>/…` with **read/write project** scopes; legacy flat `/tfstate/blobs/…` with **`terraform:http_state`** (or **admin**). See [docs/terraform-http-remote-state.md](docs/terraform-http-remote-state.md) and [docs/usage.md](docs/usage.md) (storage model and scopes).
- **Help** in the web UI at **`/help`** (no login required) — usage overview including Terraform state storage.

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

## React admin (SPA)

A **Vite + React + TypeScript + Tailwind** admin app lives under [`frontend/`](frontend/).

**Local development** (API + Vite together):

- **Windows:** `powershell -ExecutionPolicy Bypass -File scripts/dev.ps1`
- **Unix:** `chmod +x scripts/dev.sh && ./scripts/dev.sh`

Optional: run the API and Vite in two terminals — `uvicorn app.main:app --reload --port 8000` and `cd frontend && npm run dev` (Vite on **5173** proxies `/api` to `127.0.0.1:8000`). Open `http://127.0.0.1:5173` and sign in with an **admin** API key.

**Tests** (Python API / integration, from repo root):

- **Windows:** `powershell -ExecutionPolicy Bypass -File scripts/test.ps1`
- **Unix:** `chmod +x scripts/test.sh && ./scripts/test.sh`

Install **pytest** for the default runner (`pip install pytest`). If pytest is missing, the scripts fall back to `python -m unittest discover` (same idea as CI). Pass extra arguments through to pytest (for example `./scripts/test.sh tests/test_bundle_entries_parse.py -v`).

**Production-style process** (no reload, default port **8080** like the container): `scripts/start.sh` or `powershell -File scripts/start.ps1`. Put secrets in a **`.env`** file next to `.env.example` (see [Quick start](#quick-start-docker)); the app loads it when the working directory is the repo root. You can still set `ENVELOPE_*` in the shell; those override `.env`. Override bind address and proxy options with `PORT`, `HOST`, `FORWARDED_ALLOW_IPS`, `ENVELOPE_ROOT_PATH` as needed. On Windows, the scripts pick **Python 3.10+** via the `py` launcher if plain `python` is an older install.

The **Docker image** builds the SPA and serves it at **`/app`**. Details: [`docs/react-migration/README.md`](docs/react-migration/README.md).

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

## Certificate-backed sealed secrets (server-blind mode)

Use this mode when you want Envelope to store only ciphertext envelopes and wrapped data keys for recipients. You encrypt on the client side (browser app, CLI, or pipeline step), then upload:

- ciphertext payload (`payload_ciphertext`)
- payload nonce (`payload_nonce`)
- optional AAD (`payload_aad`)
- recipient wrapped keys (one per registered certificate)

Envelope stores only these values and certificate metadata; it does **not** store recipient private keys.

### Web UI

- **Certificates** page (`/certificates`) — register/delete recipient public certificates.
- Bundle sub-nav **Sealed secrets** (`…/bundles/{name}/sealed-secrets`) — manage ciphertext rows per bundle.

### API workflow

1. Register recipient certificates (admin):

```bash
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  "$ENVELOPE_URL/api/v1/certificates" \
  -d '{"name":"team-a-prod","certificate_pem":"-----BEGIN CERTIFICATE-----\n..."}'
```

2. Upload a sealed secret (write scope for bundle):

```bash
curl -fsS -X POST -H "Authorization: Bearer $WRITE_KEY" \
  -H "Content-Type: application/json" \
  "$ENVELOPE_URL/api/v1/bundles/myapp-prod/sealed-secrets" \
  -d '{
    "key_name": "API_TOKEN",
    "enc_alg": "aes-256-gcm",
    "payload_ciphertext": "BASE64_CIPHERTEXT",
    "payload_nonce": "BASE64_NONCE",
    "payload_aad": "optional-context",
    "recipients": [
      {"certificate_id": 1, "wrapped_key": "BASE64_WRAPPED_KEY_1", "key_wrap_alg": "rsa-oaep-256"},
      {"certificate_id": 2, "wrapped_key": "BASE64_WRAPPED_KEY_2", "key_wrap_alg": "rsa-oaep-256"}
    ]
  }'
```

3. Read/delete sealed secret metadata (read/write scope for bundle):

- `GET /api/v1/bundles/{name}/sealed-secrets`
- `DELETE /api/v1/bundles/{name}/sealed-secrets?key_name=...`

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
| GET | `/api/v1/stacks` | list stack names (scoped) |
| POST | `/api/v1/stacks` | create — body `name`, `layers` (bundle names, bottom→top), `project_slug` or `group_id` |
| GET | `/api/v1/stacks/{name}` | read stack — metadata + ordered `layers` |
| PATCH | `/api/v1/stacks/{name}` | write — optional `layers`, `project_slug` / `group_id` |
| DELETE | `/api/v1/stacks/{name}` | write — deletes stack only (bundles unchanged) |
| GET | `/api/v1/stacks/{name}/export?format=dotenv` or `format=json` | read stack **and** read every layer bundle |
| GET/POST/DELETE | `/api/v1/stacks/{name}/env-links` | write — list links (with optional `through_layer_position` / `slice_label`); POST optional JSON `{"through_layer_position": n}` for a prefix slice; merged export at `/env/{token}` |
| GET | `/api/v1/certificates` | admin — list recipient certificates |
| POST | `/api/v1/certificates` | admin — body `{"name":"…","certificate_pem":"-----BEGIN CERTIFICATE-----..."}` |
| DELETE | `/api/v1/certificates/{id}` | admin — delete certificate (fails if in use) |
| GET | `/api/v1/bundles/{name}/sealed-secrets` | read access to bundle — list ciphertext envelopes + recipients |
| POST | `/api/v1/bundles/{name}/sealed-secrets` | write access to bundle — upsert ciphertext envelope + recipients |
| DELETE | `/api/v1/bundles/{name}/sealed-secrets?key_name=…` | write access to bundle — delete one sealed secret row |
| GET | `/api/v1/api-keys` | admin |
| POST | `/api/v1/api-keys` | admin — body `{"name":"…","scopes":["…"]}`; use `read:project:…` / `write:project:…` for Terraform state under `/tfstate/projects/<slug>/…`; `terraform:http_state` only for legacy `/tfstate/blobs/…` |
| DELETE | `/api/v1/api-keys/{id}` | admin |
| GET | `/api/v1/system/backup/database` | admin — raw SQLite snapshot (`application/octet-stream`) |
| POST | `/api/v1/system/backup/database` | admin — body `{"passphrase":"..."}`; encrypted `.envelope-db` download |
| POST | `/api/v1/system/restore/database` | admin — multipart `file` (+ optional `passphrase` for encrypted files); **requires** `ENVELOPE_RESTORE_ENABLED=true` |
| GET | `/api/v1/bundles/{name}/backup` | read access to bundle — structured JSON (`envelope-bundle-backup-v1`) |
| POST | `/api/v1/bundles/{name}/backup/encrypted` | read — JSON `{"passphrase":"..."}`; encrypted bundle file |
| PUT | `/api/v1/bundles/{name}/backup` | write access — merge secrets from JSON backup (upsert keys) |
| POST | `/api/v1/bundles/{name}/backup/import-encrypted` | write — multipart `file` + form `passphrase` |
| GET/POST/DELETE/LOCK/UNLOCK | `/tfstate/projects/{slug}/{path}` | **read:project…** / **write:project…** (or admin); Terraform state per project |
| GET/POST/DELETE/LOCK/UNLOCK | `/tfstate/blobs/{key}` | **`terraform:http_state`** or admin — legacy flat keys; prefer `/tfstate/projects/…` |

Never log request bodies or API keys.

## Backups

Two levels:

1. **Full database (disaster recovery)** — Admin API key only (`GET`/`POST /api/v1/system/backup/database`). The raw file is sensitive (metadata, Fernet ciphertext, API key hashes). Encrypted downloads use **Scrypt** + **AES-256-GCM**; passphrases must only be sent over **HTTPS** in production. The backup file does **not** include `ENVELOPE_MASTER_KEY`; keep the Fernet key in a separate secret store so you can decrypt secret values after restore.

2. **Single bundle** — Any key with read access can export `GET /api/v1/bundles/{name}/backup` or request an encrypted bundle file; keys with write access can `PUT` merge-import JSON or `POST` an encrypted file. This is for moving one bundle between instances without sharing the whole database.

**Restore** replaces the SQLite file on disk (`/data/envelope.db` in Docker). It is **disabled** by default (`ENVELOPE_RESTORE_ENABLED=false`). Enable only when you need in-app recovery; otherwise stop the container and replace the file on the volume manually. The web UI exposes the same operations at `/backup` (signed-in admin).

Offline copy: you can still copy the SQLite file from the `/data` volume while the service is stopped.
