# Web routes vs `/api/v1` inventory

Generated for the React migration. **Gap** means no equivalent JSON API today (or only HTML/form).

Legend: **Covered** = `/api/v1` can serve the SPA with session-or-Bearer auth after migration work; **Partial** = some operations only on web; **Gap** = web-only or HTML-specific.

## Session / help / public


| Method | Web path           | Notes               | API                                  |
| ------ | ------------------ | ------------------- | ------------------------------------ |
| GET    | `/env/{token}`     | Public env download | N/A (keep server)                    |
| GET    | `/help`, `/help/*` | Static help HTML    | Gap → React pages or static          |
| GET    | `/login`           | Login form          | Gap → React `/login`                 |
| POST   | `/login`           | Form + CSRF         | **POST `/api/v1/auth/login`** (JSON) |
| POST   | `/logout`          | Form + CSRF         | **POST `/api/v1/auth/logout`**       |
| GET    | `/`                | Redirect            | SPA router                           |


## Projects


| Method | Web path                  | API                              |
| ------ | ------------------------- | -------------------------------- |
| GET    | `/projects`               | GET `/api/v1/projects`           |
| GET    | `/projects/new`           | N/A                              |
| POST   | `/projects/new`           | POST `/api/v1/projects`          |
| POST   | `/projects/{slug}/delete` | DELETE `/api/v1/projects/{slug}` |


## Bundles (project-scoped and legacy)


| Pattern                   | API equivalent                                                                |
| ------------------------- | ----------------------------------------------------------------------------- |
| List                      | GET `/api/v1/bundles?project_slug=`                                           |
| Create                    | POST `/api/v1/bundles`                                                        |
| Edit / entries            | GET+PATCH bundle, entries via `/api/v1/bundles/{name}`                        |
| Env links                 | Covered by bundles + env link endpoints                                       |
| Secrets / sealed          | Multiple `/api/v1/bundles/...` and sealed-secrets router                      |
| Variable key names (AJAX) | GET `/projects/.../variable-key-names` (JSON) — add under `/api/v1` if needed |


**Gaps to verify during migration:** import merge, bundle rename flows, any web-only POST in `[app/web/routes.py](../../app/web/routes.py)`.

## Stacks


| Pattern        | API                                                                      |
| -------------- | ------------------------------------------------------------------------ |
| CRUD / layers  | `/api/v1/stacks`                                                         |
| Key graph data | GET web `/stacks/{name}/key-graph/data` → expose or reuse stacks service |
| Env links      | Check stacks API for parity                                              |


## Certificates, keys, backup


| Area           | API                                                              |
| -------------- | ---------------------------------------------------------------- |
| Certificates   | `/api/v1/certificates`                                           |
| API keys       | `/api/v1/keys`                                                   |
| Backup/restore | `/api/v1/system` (partial; web gates `ENVELOPE_RESTORE_ENABLED`) |


## Follow-up

- Replace this document with a machine-generated table (script) when routes stabilize.
- Track **session + CSRF** for mutating calls from the SPA alongside Bearer automation.