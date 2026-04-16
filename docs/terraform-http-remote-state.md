# Terraform HTTP remote state (HTTP backend)

Envelope exposes an optional **Terraform HTTP backend–compatible** API for storing **remote state blobs** (GET / POST / DELETE, optional LOCK / UNLOCK). This follows HashiCorp’s HTTP backend contract, not Pulumi’s state protocol.

## Per-project state (recommended)

State is **scoped to an Envelope project** (same “project” as bundles). Use:

`/tfstate/projects/<project_slug>/<path-to-statefile>`

**Authorization:** `Authorization: Bearer <api-key>` or HTTP **Basic** (password = API key).

- **GET** requires **read** access to that project (`read:project:…` matching the project, e.g. `read:project:slug:my-proj` or `read:project:*`).
- **POST**, **DELETE**, **LOCK**, **UNLOCK** require **write** access (`write:project:…`).

**Administrator** can use all methods on all projects.

## Legacy flat keys (no project)

`GET/POST/DELETE/LOCK/UNLOCK` on `/tfstate/blobs/<key>` still works for keys with scope `**terraform:http_state`** or `**pulumi:state**` (or **admin**). Prefer per-project URLs for new setups.

## Pulumi

Envelope’s `/tfstate/…` API implements the **Terraform HTTP backend** wire protocol. The **Pulumi CLI** does not use that protocol — there is no supported `pulumi login https://…/tfstate/…` that stores state in Envelope’s HTTP API.

**Use a [Pulumi-supported backend](https://www.pulumi.com/docs/concepts/state/)** (e.g. `**pulumi login postgres://…`**, `**s3://…**`) and keep the URL and credentials in an Envelope **bundle** or CI secrets exported from Envelope.

The legacy scope `**pulumi:state`** only authorizes Envelope’s flat `**/tfstate/blobs/…**` paths; it does not connect the stock Pulumi CLI to this HTTP API.

## Envelope configuration

- Enable with `ENVELOPE_PULUMI_STATE_ENABLED=true` (default: enabled). *(Name is historical; gates Terraform HTTP routes.)*
- OpenAPI: `/docs` when the app is running.

## Terraform example (per project)

**Do not put your Envelope API key in `.tf` files.** HashiCorp warns that `password` (and similar) in backend config can end up in the `.terraform` directory and in plan files. Supply the password with environment variables instead (`[TF_HTTP_PASSWORD](https://developer.hashicorp.com/terraform/language/settings/backends/http)`, optional `[TF_HTTP_USERNAME](https://developer.hashicorp.com/terraform/language/settings/backends/http)`).

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

Before `terraform init` / apply (CI secret, password manager export, etc.):

```bash
export TF_HTTP_USERNAME=terraform
export TF_HTTP_PASSWORD="$ENVELOPE_TF_WRITE_KEY"   # API key with write:project… for that project
```

`terraform init` reads the HTTP backend too — set these variables for **init** as well as plan/apply.

**CI example (GitHub Actions):** store the key as a repository secret (e.g. `ENVELOPE_TF_WRITE_KEY`), then:

```yaml
env:
  TF_HTTP_USERNAME: terraform
  TF_HTTP_PASSWORD: ${{ secrets.ENVELOPE_TF_WRITE_KEY }}
```

Run `terraform init` and `terraform apply` in the same job so the env is available for both.

Use HTTPS in production; align with `ENVELOPE_ROOT_PATH` if Envelope is behind a path prefix.

## Locking

When `lock_address` / `unlock_address` are set, Terraform sends **LOCK** / **UNLOCK**. Envelope returns **423 Locked** when another lock ID holds the state.