# Database configuration

Envelope stores all application data (API keys, bundles, secrets, Terraform HTTP state, OIDC settings, etc.) in a **single** SQL database. You choose the backend with **`ENVELOPE_DATABASE_URL`** (SQLAlchemy [async URL](https://docs.sqlalchemy.org/en/20/core/engines.html#database-urls)).

Supported options:

| Backend | Driver | Typical use |
| --- | --- | --- |
| **SQLite** (default) | `aiosqlite` | Single node, development, small teams, Docker with a volume |
| **PostgreSQL** | `asyncpg` | Managed databases, HA, larger teams, stricter operational requirements |

The app uses **one** URL per process. There is no automatic replication or multi-writer clustering; for PostgreSQL, point the URL at your **primary** (read/write) endpoint.

---

## SQLite (default)

**URL shape:** `sqlite+aiosqlite:///path/to/envelope.db`

- **Relative path** (common for local dev): `sqlite+aiosqlite:///./data/envelope.db` — file is created under the process working directory.
- **Absolute path on Linux/macOS** (Docker volume): `sqlite+aiosqlite:////data/envelope.db` — four slashes after the scheme: `//` + absolute path `/data/...`.
- **Windows path:** use forward slashes in the URL, e.g. `sqlite+aiosqlite:///C:/data/envelope.db`.
- **In-memory** (`:memory:`) is possible for tests only; it is not suitable for production and **HTTP database backup** is not available for in-memory databases.

**Backups:** The admin **GET `/api/v1/system/backup/database`** (and UI backup) downloads a consistent SQLite file snapshot. Optional passphrase encryption is supported. See also [Backups](#backups-and-disaster-recovery) below.

---

## PostgreSQL

**URL shape:** `postgresql+asyncpg://USER:PASSWORD@HOST:PORT/DATABASE`

Example:

```bash
ENVELOPE_DATABASE_URL=postgresql+asyncpg://envelope:your-secret@db.example.com:5432/envelope
```

**Requirements:**

- The **`asyncpg`** package must be installed (included in the project’s `requirements.txt` and Docker image).
- The database must exist before Envelope starts (create an empty database and user with appropriate permissions).
- On first startup, Envelope runs **`create_all`** from the ORM models to create tables and indexes. Use a **dedicated** database (do not share a schema with unrelated applications).

**SSL / TLS to the server:**

- Many cloud providers give you a connection string with TLS parameters. SQLAlchemy/asyncpg accept [query parameters on the URL](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html#ssl-connections); exact names depend on the driver (e.g. `ssl=true` or `sslmode=require` in some setups).
- Alternatively, terminate TLS in a sidecar or proxy and connect Envelope to `localhost` over a private network.

**High availability:** Use your platform’s managed PostgreSQL (RDS, Cloud SQL, Azure Database for PostgreSQL, etc.). Provide a single **write** URL to Envelope. Read replicas are not used by the app unless you put a proxy in front that sends writes to the primary.

**Backups:** The in-app **full database download** is **SQLite-only**. For PostgreSQL, use platform backups, `pg_dump` / `pg_restore`, continuous archiving, or snapshots. Plan **RPO/RTO** with your operations team.

---

## Docker Compose (PostgreSQL example)

Minimal pattern: run PostgreSQL as a service and pass the URL into Envelope.

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: envelope
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: envelope
    volumes:
      - pgdata:/var/lib/postgresql/data

  envelope:
    image: ghcr.io/your-org/envelope:latest
    environment:
      ENVELOPE_MASTER_KEY: ${ENVELOPE_MASTER_KEY}
      ENVELOPE_SESSION_SECRET: ${ENVELOPE_SESSION_SECRET}
      ENVELOPE_DATABASE_URL: postgresql+asyncpg://envelope:change-me@db:5432/envelope
    depends_on:
      - db
    ports:
      - "8080:8080"

volumes:
  pgdata:
```

Adjust image name, secrets, and networking to match your environment. Do not commit real passwords; use secrets management in production.

---

## Environment variable summary

| Variable | Meaning |
| --- | --- |
| **`ENVELOPE_DATABASE_URL`** | SQLAlchemy async URL. Defaults to SQLite under `./data/envelope.db` if unset (see `app/config.py`). |

Other settings (e.g. **`ENVELOPE_MASTER_KEY`**, **`ENVELOPE_SESSION_SECRET`**) are unchanged; they are not database-specific.

---

## Backups and disaster recovery

| Deployment | Full DB backup in the app |
| --- | --- |
| **SQLite** (file-backed) | Yes — admin API and UI can download a snapshot (and optional encrypted archive). |
| **PostgreSQL** | No — use database-native or platform tooling. |

Restoring a SQLite file via **`POST /api/v1/system/restore/database`** only applies to file-backed SQLite URLs.

---

## Migrating from SQLite to PostgreSQL

There is **no** built-in one-click migration. Typical approaches:

1. Export what you need via the API (bundles, keys) and re-import in a fresh PostgreSQL deployment, or  
2. Use one-off ETL / `pgloader` / custom scripts, depending on your compliance and downtime constraints.

Treat this as a planned migration with testing in a staging environment.

---

## Troubleshooting

- **`NotImplementedError: Unsupported database dialect`** — Only **`sqlite`** and **`postgresql`** (via **`asyncpg`**) are supported. Check the URL scheme and driver name.
- **Connection refused / timeout** — Verify host, port, firewall, and that PostgreSQL accepts connections from the Envelope host.
- **Authentication failed** — Check user, password, and `pg_hba.conf` / cloud security rules.

For development, confirm the URL with a small Python snippet using the same URL string and `asyncpg` or SQLAlchemy’s `create_async_engine`.
