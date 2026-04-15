# Envelope — usage guide

> **Web UI:** When the app is running, the same material is published as multi-page help: open **`/help`** (overview), then use the sidebar for **[Installation & hosting](/help/installation)**, **`/help/web-ui`**, **`/help/api`**, **`/help/certificates`**, **`/help/terraform`**, **`/help/pulumi`**, and **`/help/backup`**. The certificates page has the most detail on registering recipient public keys and sealed-secret payloads.

Envelope is a self-hosted **secure environment bundle** manager: named groups of variables (like a `.env` file), **encrypted at rest** for secret values, with **API keys** for automation and a **web UI** for administration.

For **installation**, **environment variables**, **TLS**, and **reverse proxies**, see **[Installation & hosting](/help/installation)** in this help. For the interactive API reference, open **`/docs`** (OpenAPI/Swagger) on your Envelope host when the server is running (use your public URL and any path prefix you configured).

---

## Installation & hosting

### Docker (typical)

1. Provide the required **`ENVELOPE_*`** settings (see below), e.g. via `docker compose` / orchestration env or an env file.
2. Map container port **8080** to your host or load balancer.
3. The admin UI is served under **`/app`** (e.g. `https://your-host/app`). Legacy **`/projects`**, **`/help`**, etc. redirect to **`/app/…`**.
4. On **first run** with an empty API-key table, set **`ENVELOPE_INITIAL_ADMIN_KEY`** to a chosen admin API key (stored hashed). Log in with it, create keys in the UI, then **remove** that variable from the environment.

### Required settings

| Variable | Purpose |
| --- | --- |
| **`ENVELOPE_MASTER_KEY`** | Fernet key (url-safe base64) used to encrypt secret values at rest. Generate once, e.g. `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. |
| **`ENVELOPE_SESSION_SECRET`** | Long random string used to sign browser sessions. Required when not in debug mode. |
| **`ENVELOPE_DATABASE_URL`** | Optional. Defaults to SQLite under the app data directory (e.g. `sqlite+aiosqlite:////data/envelope.db` in Docker with a `/data` volume). |
| **`ENVELOPE_INITIAL_ADMIN_KEY`** | **First deployment only:** plaintext admin API key, stored hashed; remove after bootstrap. |

Optional flags (see also **Behind a reverse proxy**): `ENVELOPE_RESTORE_ENABLED`, `ENVELOPE_HTTPS_COOKIES`, `ENVELOPE_ROOT_PATH`, `FORWARDED_ALLOW_IPS`, `ENVELOPE_PULUMI_STATE_ENABLED`, etc., as documented for your image or compose file.

### TLS

Use plain HTTP only on trusted networks. In production, terminate **HTTPS** in front of Envelope (Caddy, Traefik, nginx, cloud load balancer, …).

### Behind a reverse proxy

The app server only trusts **`X-Forwarded-Proto`** / **`X-Forwarded-For`** from addresses in **`FORWARDED_ALLOW_IPS`** (default **`127.0.0.1`**). Set it to your proxy’s subnet (often a Docker bridge CIDR such as **`172.16.0.0/12`**) so generated opaque **`/env/…`** URLs and internal URL building use **https** when clients use HTTPS.

- **`ENVELOPE_HTTPS_COOKIES=true`** — Set when users reach the UI over HTTPS (TLS usually terminates at the proxy) so session cookies use the **`Secure`** flag.
- **`ENVELOPE_ROOT_PATH=/prefix`** — No trailing slash. Use when Envelope is mounted under a path prefix; the proxy must **strip** that prefix when forwarding. Must match how uvicorn is started (`--root-path`).

Subdomain hosting (e.g. `envelope.example.com` with the app at `/` on that host) usually does **not** need `ENVELOPE_ROOT_PATH`.

### API documentation

With the server running, **OpenAPI/Swagger** is available at **`/docs`** on the same origin (prepend your site’s scheme and host, and your **`ENVELOPE_ROOT_PATH`** if you use one).

---

## Web UI

1. **Sign in** with an **admin** API key (the key is verified server-side; it is not stored in the browser after login).
2. **Projects** — Create projects to group bundles and stacks. Each project has a **slug** (used in URLs and Terraform state paths).
3. **Bundles** — Create bundles inside a project. Each bundle holds key/value entries; values can be stored as secrets (Fernet-encrypted) or plaintext config.
4. **Stacks** — Define an **ordered list of bundle names** (layers). Export merges variables from those bundles into one map; **later layers overwrite** earlier keys with the same name. Sealed secrets are not included in merged exports (same as single-bundle export).
5. **Variables** — Add, edit, encrypt, or delete entries on a bundle’s edit page.
6. **Sealed secrets** — In each bundle, manage ciphertext-only rows for client-side encrypted values and wrapped recipient keys.
7. **Secret env URL** — Generate opaque download links (`GET /env/<token>`) for a bundle or **merged stack**; project and resource names do not appear in the path. Treat these URLs like credentials.
8. **Certificates** — Register recipient public certificates used by sealed secrets.
9. **API keys** — Create keys with scoped access (`read:bundle:…`, `write:bundle:…`, `read:stack:…`, `write:stack:…`, per-project scopes, or **admin**). Export requires both **read** on the stack and **read** on every bundle in its layers.

---

## Exporting bundles (API)

**Authenticated export** (Bearer token):

```http
GET /api/v1/bundles/{name}/export?format=dotenv
Authorization: Bearer <api-key>
```

Use `format=json` for JSON. Requires read access to that bundle (or admin).

**Opaque env URL** — No `Authorization` header; the path token alone authorizes download:

```bash
curl -fsS "https://your-envelope.example.com/env/<token>" -o .env
```

Create links from the UI or `POST /api/v1/bundles/{name}/env-links` with a key that has write access to the bundle.

### Bundle stacks (merged export)

**Authenticated:**

```http
GET /api/v1/stacks/{name}/export?format=dotenv
Authorization: Bearer <api-key>
```

Use `format=json` for JSON. The caller must be allowed to read the stack **and** every bundle listed as a layer (`403` if any layer bundle is not readable).

**Opaque URL** — Same as bundles: `POST /api/v1/stacks/{name}/env-links` with write access; `GET /env/<token>` returns the merged variables (optional `?format=json`). For a **prefix slice** (merge from the bottom through one layer only), send JSON `{"through_layer_position": <n>}` where `n` is a layer `position` in that stack; omit the field or send `null` for the full merged stack. `GET /api/v1/stacks/{name}/env-links` lists links with `through_layer_position`, `slice_label` (bundle name at that position), and **`token_sha256`**.

### Which link am I revoking? (`token_sha256`)

The full secret path is shown only once when you create a link. List endpoints return **`token_sha256`**: the **SHA-256** digest of the path **token** only (UTF-8 string, lowercase **hex**, 64 characters). That matches what the server stores and uses for `GET /env/{token}`.

1. Take your saved URL, e.g. `https://envelope.example.com/env/AbC-d_Ef.123~x` (or with a path prefix before `/env/`).
2. Extract the **last path segment** after `/env/` — **not** the query string: strip `?format=json` etc. Do **not** include a leading slash in the string you hash.
3. Compute **SHA-256** of that segment encoded as **UTF-8**, and express the digest as **hex** (same as `token_sha256` in the API).

Examples:

```bash
# GNU coreutils / typical Linux
printf '%s' 'PASTE_TOKEN_HERE' | sha256sum
```

```python
import hashlib
token = "PASTE_TOKEN_HERE"  # segment only, e.g. from urlparse or split("/env/")[-1].split("?")[0]
digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
```

Find the list row whose **`token_sha256`** equals that digest, then call **`DELETE /api/v1/bundles/{name}/env-links/{id}`** or **`DELETE /api/v1/stacks/{name}/env-links/{id}`** with that **`id`**. On stacks, **`through_layer_position`** / **`slice_label`** still tell you full merge vs prefix slice for each row.

**Open the admin page from the digest** — With a session or API key that can manage env links for that resource, **`GET /api/v1/env-links/resolve?token_sha256=<64 hex>`** returns **`resource`** (`bundle` or `stack`), **`name`**, **`project_slug`**, and **`environment_slug`** so the UI can jump to the right **Secret env URL** page. The in-app tool **Admin → Env link hash** also offers **Open Secret env URL page** after you paste the digest or compute it from a URL.

---

## Certificate-backed sealed secrets

Use sealed secrets when you want a server-blind storage path: clients encrypt data locally, then upload ciphertext envelopes and wrapped data keys for recipients. Envelope stores:

- ciphertext payload
- nonce (and optional AAD)
- wrapped keys per certificate recipient

Envelope does **not** store recipient private keys.

### Endpoints

- `GET /api/v1/certificates` (admin)
- `POST /api/v1/certificates` (admin)
- `DELETE /api/v1/certificates/{id}` (admin, blocked if certificate is in use)
- `GET /api/v1/bundles/{name}/sealed-secrets` (read scope for bundle)
- `POST /api/v1/bundles/{name}/sealed-secrets` (write scope for bundle)
- `DELETE /api/v1/bundles/{name}/sealed-secrets?key_name=...` (write scope for bundle)

### Typical flow

1. Register public certificates (admin).
2. Client encrypts plaintext with a random data key (for example AES-GCM).
3. Client wraps that data key once per recipient certificate.
4. Upload ciphertext + recipients to `POST /sealed-secrets`.
5. Consumers fetch sealed metadata and decrypt client-side with recipient private key.

### Example payload

```json
{
  "key_name": "API_TOKEN",
  "enc_alg": "aes-256-gcm",
  "payload_ciphertext": "BASE64_CIPHERTEXT",
  "payload_nonce": "BASE64_NONCE",
  "payload_aad": "optional-context",
  "recipients": [
    {"certificate_id": 1, "wrapped_key": "BASE64_WRAPPED_KEY_1", "key_wrap_alg": "rsa-oaep-256"},
    {"certificate_id": 2, "wrapped_key": "BASE64_WRAPPED_KEY_2", "key_wrap_alg": "rsa-oaep-256"}
  ]
}
```

---

## Terraform HTTP remote state

Envelope can expose a **Terraform HTTP backend**–compatible API: `GET` / `POST` / `DELETE`, plus optional `LOCK` / `UNLOCK`, so Terraform can store remote state in the same SQLite database as the rest of the app.

### Storage model

- State file bytes are stored in the **`pulumi_state_blobs`** table (name is historical). Each row is keyed by a string path; the **body** column holds the **raw state blob** (`application/octet-stream`).
- **Locks** for concurrent Terraform runs are stored in **`pulumi_state_locks`**, one row per state key, with JSON lock metadata in **`lock_body`**.
- Unlike bundle **secrets**, Terraform state is **not** wrapped with Fernet/`ENVELOPE_MASTER_KEY`. Protect the database backups and filesystem like any infrastructure state store.

### Per-project URLs (recommended)

Use paths scoped to an Envelope project:

`/tfstate/projects/<project_slug>/<path-to-statefile>`

Examples: `/tfstate/projects/my-proj/default.tfstate`

- **GET** requires **`read:project:…`** matching that project (or **`read:project:*`**), or **admin**.
- **POST**, **DELETE**, **LOCK**, **UNLOCK** require **`write:project:…`** for that project (or admin).

Authenticate with **`Authorization: Bearer <api-key>`** or HTTP **Basic** (password = API key).

### Legacy flat keys

`GET` / `POST` / `DELETE` / `LOCK` / `UNLOCK` on `/tfstate/blobs/<key>` use a flat key namespace. The API key must include **`terraform:http_state`** or **`pulumi:state`**, or **admin**. Prefer per-project URLs for new setups. Do not put `projects/…` keys under `/tfstate/blobs/` — use `/tfstate/projects/…` instead.

### Configuration

- Routes are registered when **`ENVELOPE_PULUMI_STATE_ENABLED=true`** (default: enabled). Set to `false` to disable all `/tfstate/…` endpoints.
- If Envelope sits behind a path prefix, set **`ENVELOPE_ROOT_PATH`** and use the same prefix in Terraform `backend "http"` addresses.

### Terraform example

**Never commit the API key in Terraform source.** Use [`TF_HTTP_PASSWORD`](https://developer.hashicorp.com/terraform/language/settings/backends/http) (and optionally `TF_HTTP_USERNAME`) so the key is not stored in `.tf` files, `.terraform/`, or plan artifacts.

```hcl
terraform {
  backend "http" {
    address        = "https://envelope.example.com/tfstate/projects/my-proj/default.tfstate"
    lock_address   = "https://envelope.example.com/tfstate/projects/my-proj/default.tfstate"
    unlock_address = "https://envelope.example.com/tfstate/projects/my-proj/default.tfstate"
    username       = "terraform"
  }
}
```

```bash
export TF_HTTP_USERNAME=terraform
export TF_HTTP_PASSWORD="$ENVELOPE_TF_WRITE_KEY"
```

Use the same exports for **`terraform init`** and for plan/apply. In CI, set `TF_HTTP_PASSWORD` from the platform secret store only.

More detail: see **[Terraform remote state](/help/terraform)** in this help (per-project URLs, scopes, and legacy flat keys).

---

## Pulumi state (not Envelope’s Terraform HTTP API)

Envelope’s `/tfstate/…` API implements the **Terraform HTTP backend** wire protocol. The **Pulumi CLI** does not use that protocol for `pulumi login`. Supported self-managed backends include **PostgreSQL**, **S3**, Azure Blob, GCS, and local file — see [Pulumi: State and backends](https://www.pulumi.com/docs/concepts/state/).

**Recommended:** Point Pulumi at Postgres (or S3, etc.), and store the backend URL and credentials in an Envelope **bundle** (or supply them from CI after exporting from Envelope). Example:

```bash
pulumi login postgres://user:pass@host:5432/pulumi
```

The legacy scope name **`pulumi:state`** only authorizes flat **`/tfstate/blobs/…`** keys in Envelope; it does not enable the stock Pulumi CLI to use Envelope as an HTTP state store. For Pulumi, use a native backend plus secrets from Envelope.

---

## Backups

- **Full database** — Admin API or **Backup** in the UI; optional passphrase-encrypted download. The encrypted backup does not include `ENVELOPE_MASTER_KEY`; keep the Fernet key separately.
- **Per-bundle** — Export/merge via scoped API keys; see README API table.

---

## Security reminders

- Use **HTTPS** in production; opaque env URLs and exports return **plaintext** for use in pipelines.
- Never log request bodies or API keys.
- Rate limits apply to sensitive routes (export, login, Terraform state).
- Sealed secret payloads are opaque to the server, but holders of recipient private keys can decrypt them; treat wrapped-key metadata and ciphertext as sensitive configuration artifacts.
