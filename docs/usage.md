# Envelope — usage guide

Envelope is a self-hosted **secure environment bundle** manager: named groups of variables (like a `.env` file), **encrypted at rest** for secret values, with **API keys** for automation and a **web UI** for administration.

For installation, environment variables, TLS, and reverse-proxy notes, see the [project README](../README.md). Interactive API reference: `/docs` (OpenAPI/Swagger) when the app is running.

---

## Web UI

1. **Sign in** with an **admin** API key (the key is verified server-side; it is not stored in the browser after login).
2. **Projects** — Create projects to group bundles. Each project has a **slug** (used in URLs and Terraform state paths).
3. **Bundles** — Create bundles inside a project. Each bundle holds key/value entries; values can be stored as secrets (Fernet-encrypted) or plaintext config.
4. **Variables** — Add, edit, encrypt, or delete entries on a bundle’s edit page.
5. **Secret env URL** — Generate opaque download links (`GET /env/<token>`) that do not expose project or bundle names. Treat these URLs like credentials.
6. **API keys** — Create keys with scoped access (`read`, `write`, per-bundle or per-project scopes). Use **read** keys in CI to export bundles; reserve **admin** for management.

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

More detail: [terraform-http-remote-state.md](terraform-http-remote-state.md).

---

## Backups

- **Full database** — Admin API or **Backup** in the UI; optional passphrase-encrypted download. The encrypted backup does not include `ENVELOPE_MASTER_KEY`; keep the Fernet key separately.
- **Per-bundle** — Export/merge via scoped API keys; see README API table.

---

## Security reminders

- Use **HTTPS** in production; opaque env URLs and exports return **plaintext** for use in pipelines.
- Never log request bodies or API keys.
- Rate limits apply to sensitive routes (export, login, Terraform state).
