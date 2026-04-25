# Envelope — usage guide

> **Web UI:** When the app is running, the same material is published as multi-page help: open **`/help`** (overview), then use the sidebar for **[Installation & hosting](/help/installation)**, **`/help/web-ui`**, **[OpenID Connect (SSO)](/help/oidc)**, **`/help/api`**, **`/help/certificates`**, **`/help/terraform`**, **[CLI (opaque env)](/help/cli)**, **[GitHub Actions](/help/github-actions)**, **[Security audit trail](/help/audit)**, and **`/help/backup`**. The certificates page has the most detail on registering recipient public keys and sealed-secret payloads.

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
| **`ENVELOPE_DATABASE_URL`** | Optional. Defaults to **SQLite** under the app data directory (e.g. `sqlite+aiosqlite:////data/envelope.db` in Docker with a `/data` volume). For **PostgreSQL**, use `postgresql+asyncpg://user:pass@host:5432/dbname` (managed DB, HA, backups via your platform). |
| **`ENVELOPE_INITIAL_ADMIN_KEY`** | **First deployment only:** plaintext admin API key, stored hashed; remove after bootstrap. |

Optional flags (see also **Behind a reverse proxy**): `ENVELOPE_RESTORE_ENABLED`, `ENVELOPE_HTTPS_COOKIES`, `ENVELOPE_ROOT_PATH`, `FORWARDED_ALLOW_IPS`, `ENVELOPE_TERRAFORM_HTTP_STATE_ENABLED`, `ENVELOPE_AUDIT_LOG_ENABLED`, `ENVELOPE_AUDIT_DATABASE_ENABLED`, etc., as documented for your image or compose file.

### Database backend (`ENVELOPE_DATABASE_URL`)

- **SQLite** — Default. Single file, good for one node or small teams. Use a persistent volume in Docker so the file survives restarts. The admin **Backup** UI/API downloads a full database snapshot (SQLite file–backed URLs only).
- **PostgreSQL** — Set `ENVELOPE_DATABASE_URL` to `postgresql+asyncpg://…`. Requires the `asyncpg` dependency (included in the published image and `requirements.txt`). Create an empty database and user first; the app creates tables on startup. Use your cloud or DBA tooling for backups and HA (`pg_dump`, managed snapshots, PITR)—not the in-app full-database download.
- **Operator guide** — For URL examples, Docker Compose, TLS to Postgres, troubleshooting, and SQLite→Postgres migration notes, see the repository file **`docs/database-configuration.md`** (same content applies whether you run from source or a container image).

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

### Create order (prerequisites)

In the web UI, use projects in this order:

1. **Project** — Create a project (it groups bundles and stacks and has a stable slug).
2. **Environments** — Add at least one **project environment** (for example Production or Staging) on the project’s **Environments** page. New bundles and stacks must be assigned to a **named** environment; the API requires `project_environment_slug` on create.
3. **Bundles** — Create bundles inside the project, each tagged to an environment for its lifetime.
4. **Stacks** — Create stacks (ordered **layers**, each referencing a bundle). A stack is also tagged to an environment; layers resolve bundles in the same project (matching that environment or a shared unassigned bundle, per server rules).

There is no automatic default environment when you create a project—add environments before **New bundle** or **New stack** will succeed.

---

## OpenID Connect (SSO)

Envelope can use **OpenID Connect** so people sign in to the admin UI through your identity provider (Okta, Azure AD, Keycloak, Auth0, etc.) instead of pasting an API key every time. The server stores **no passwords** for SSO users: the IdP issues tokens; Envelope maps **`issuer` + `sub`** to an existing **admin API key** after a one-time link.

### Operator setup (App settings)

1. In the web UI, open **Admin → App settings** (admin session required).
2. Enable **OIDC sign-in** and fill in **Issuer URL**, **Client ID**, and **Client secret** from your IdP’s OIDC application.
3. Register the **redirect URL** shown on that page with your IdP (typically `…/api/v1/auth/oidc/callback` on your public Envelope base URL; use **`ENVELOPE_ROOT_PATH`** consistently if the app is behind a path prefix).
4. Adjust **Scopes** if needed (defaults usually include `openid email profile`). Optional **Allowed email domains** restricts which IdP accounts may complete SSO sign-in.
5. Save. When the UI shows that **OIDC is ready**, users can link and use SSO.

Configuration may also come from environment variables on the server (see deployment docs); **App settings** in the database override env defaults when present.

### Per-user link (Account)

SSO is tied to a **specific API key**:

1. Sign in with an **admin API key** (normal login).
2. Open **Account** and use **Connect SSO**. You are sent to your IdP; after consent, that IdP identity is **linked** to the API key you used to sign in.
3. Next time, you can use **Sign in with SSO** on the login page; the session uses the **same** underlying key and permissions.

Only one IdP identity can be linked to a given API key at a time. Use **Disconnect SSO** on Account to remove the link.

### If SSO is not available yet

Until OIDC is fully configured, **Connect SSO** is hidden and the Account page explains that an administrator must complete **App settings**. The login page only offers **Sign in with SSO** when the server reports OIDC as configured (`GET /api/v1/auth/login-options` → `oidc_configured`).

### API surface (for automation)

- Start login: `GET /api/v1/auth/oidc/login` (browser; redirects to IdP).
- Start link (Bearer admin key): `GET /api/v1/auth/oidc/link`.
- Callback: `GET /api/v1/auth/oidc/callback` (registered with IdP).
- Link status: `GET /api/v1/auth/oidc/status`.
- Unlink: `DELETE /api/v1/auth/oidc/link` (CSRF + session).

Flows use **authorization code + PKCE**. Details match your IdP’s OIDC discovery document.

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

**Open the admin page from the digest** — With a session or API key that can manage env links for that resource, **`GET /api/v1/env-links/resolve?token_sha256=<64 hex>`** returns **`resource`** (`bundle` or `stack`), **`name`**, **`project_slug`**, and **`environment_slug`** so the UI can jump to the right **Secret env URL** page. The in-app tool **Admin → Identify Secret Url** also offers **Open Secret env URL page** after you paste the digest or compute it from a URL.

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

### Configuration

- Routes are registered when **`ENVELOPE_TERRAFORM_HTTP_STATE_ENABLED=true`** (default: enabled). Set to `false` to disable all `/tfstate/…` endpoints.
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

More detail: see **[Terraform remote state](/help/terraform)** in this help (per-project URLs and scopes).

---

## CLI tool

Download the **opaque env CLI** from this deployment (`GET /cli/envelope_run.py` and shell wrappers) and add it to your **`PATH`**.

Use **`--envelope-url`** with your deployment’s public base URL (including any gateway path prefix, e.g. `https://host/envelope`) and **`--token`** with the secret path segment from **Secret env URL**. The interactive **installer** below runs in your browser: it detects that base URL, lets you choose **user** vs **system** environment scope for **`PATH`**, and generates a **Bash** or **PowerShell** script you can save and run locally.

For **GitHub Actions**, see **[GitHub Actions](/help/github-actions)** (reusable Node action and tutorial).

---

## GitHub Actions

The same opaque-env fetch logic as [`cli/envelope_run.py`](https://github.com/billpoulson/envelope/blob/main/cli/envelope_run.py) is published as a **reusable Node 20 action** in the [Envelope](https://github.com/billpoulson/envelope) repository: **`.github/actions/envelope-env/`**. Reference it with `uses: billpoulson/envelope/.github/actions/envelope-env@<tag>` and pin a **semver tag** or **commit SHA**. The **tutorial** below walks through secrets, workflow YAML, and optional vendoring.

---

## Security audit trail

Envelope records **who** accessed sensitive data **when** (API key id and name snapshot, resource ids, request path, client connection info). This supports compliance and incident review alongside your **reverse-proxy access logs**.

### What is audited

Typical events include bundle/stack **export**, bundle **JSON or encrypted backup** download, **`GET /api/v1/bundles/{name}?include_secret_values=true`**, full-database **backup/restore** (admin), and **`GET /env/{token}`** opaque env downloads. Env-link downloads include a **short prefix** of the stored token hash for correlation—not the raw URL token.

### Configuration (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| **`ENVELOPE_AUDIT_LOG_ENABLED`** | `true` | Emit one **JSON object per line** on the Python logger **`envelope.audit`** (process stdout/stderr in Docker). |
| **`ENVELOPE_AUDIT_DATABASE_ENABLED`** | `true` | Append rows to the **`audit_events`** table. Set to `false` if you ingest logs only. |

### Logs (SIEM / aggregators)

- Ship container or process logs to your platform (CloudWatch, Datadog, Splunk, Loki, …) and **filter or parse** lines from logger `envelope.audit`. Each line is a single JSON object (no secret values or request bodies).
- **Client IP:** The app logs the ASGI client host. When Envelope runs behind a trusted proxy, set **`FORWARDED_ALLOW_IPS`** (see **Installation & hosting**) so Uvicorn can apply **`X-Forwarded-For`** / **`X-Forwarded-Proto`**; otherwise rely on **gateway access logs** for authoritative client IP.

### Database and admin API

- Rows accumulate in **`audit_events`**. Plan **disk** (SQLite) or **table growth** (PostgreSQL); the product does not prune old rows automatically.
- Admins can page events: **`GET /api/v1/system/audit-events?limit=50`** with optional **`before_id`** for older pages (see OpenAPI **`/docs`**). Requires an **admin** API key (or signed-in admin session for browser calls).

### Opaque env URLs and gateways

Unauthenticated **`/env/…`** downloads have **no API key** in the audit row (actor is empty). Correlate using **`token_sha256_prefix`** plus your **proxy or WAF logs** (path, source IP, user-agent).

**Repository reference:** [docs/audit-trail.md](https://github.com/billpoulson/envelope/blob/main/docs/audit-trail.md) (operator-focused guide: retention, immutability, proxy alignment).

---

## Backups

- **Full database (SQLite only)** — Admin API or **Backup** in the UI downloads a raw SQLite snapshot; optional passphrase-encrypted download. Not available when using PostgreSQL or other server databases; use your platform’s backups (`pg_dump`, managed automated backups, PITR, volume snapshots) with an agreed RPO/RTO instead.
- **Per-bundle** — Export/merge via scoped API keys; see README API table.

The encrypted SQLite backup does not include `ENVELOPE_MASTER_KEY`; keep the Fernet key separately.

---

## Security reminders

- Use **HTTPS** in production; opaque env URLs and exports return **plaintext** for use in pipelines.
- Never log request bodies or API keys.
- Rate limits apply to sensitive routes (export, login, Terraform state).
- Sealed secret payloads are opaque to the server, but holders of recipient private keys can decrypt them; treat wrapped-key metadata and ciphertext as sensitive configuration artifacts.
