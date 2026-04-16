# Security audit trail (configuration and operations)

Envelope can emit **structured audit records** when sensitive data is read or exported: bundle/stack exports, bundle backups, full-database backup/restore, optional cleartext bundle reads, and unauthenticated opaque `/env/{token}` downloads.

Two sinks are available:

1. **Structured logs** — JSON lines on the Python logger `envelope.audit` (typically process **stdout/stderr** in containers).
2. **Database** — Append-only rows in table `audit_events` (application code inserts only; no updates/deletes from the app).

For enterprise expectations (SOC2, ISO 27001, internal security), combine these with **reverse-proxy or WAF access logs** and your **SIEM** retention policies.

---

## Environment variables


| Variable                          | Default | Description                                                                                                                   |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ENVELOPE_AUDIT_LOG_ENABLED`      | `true`  | When `true`, each audit event is logged as **one JSON object per line** on logger `envelope.audit`.                           |
| `ENVELOPE_AUDIT_DATABASE_ENABLED` | `true`  | When `true`, each event also **inserts a row** into `audit_events`. Set to `false` if you only ship logs to a central system. |


Example (Docker Compose):

```yaml
environment:
  ENVELOPE_AUDIT_LOG_ENABLED: "true"
  ENVELOPE_AUDIT_DATABASE_ENABLED: "true"
```

---

## Log format and shipping

- **Logger name:** `envelope.audit`
- **Format:** Single-line JSON per event (no multiline pretty-printing). Fields include `event_type`, `actor_api_key_id` / `actor_api_key_name` when the caller used an API key, resource identifiers (`bundle_id`, `stack_id`, link ids), `client_ip`, `user_agent`, `http_method`, `path`, and a `details` object. **Secrets and raw env tokens are never logged.**
- **Shipping:** Point your log agent, sidecar, or platform integration at the container/process log stream and filter or parse `envelope.audit` (or ship all stdout and filter in the SIEM).

### Example log line

Each emitted line is a single JSON object (keys are sorted). Example (values illustrative):

```json
{"actor_api_key_id": 1, "actor_api_key_name": "ci-readonly", "bundle_env_link_id": null, "bundle_id": 42, "bundle_name": "my-app", "client_ip": "10.0.0.1", "details": {"format": "dotenv"}, "event_type": "bundle.export", "http_method": "GET", "path": "/api/v1/bundles/my-app/export", "stack_env_link_id": null, "stack_id": null, "stack_name": null, "token_sha256_prefix": null, "ts": "2026-04-16T12:00:00.000000+00:00", "user_agent": "curl/8.0"}
```

### Consumers of the structured log

The process writes **only** the JSON payload (no `INFO:` prefix) to the `envelope.audit` logger. Your platform may still wrap lines (Docker timestamps, Kubernetes CRI prefixes, syslog headers). Strip wrappers in the agent or parse JSON from the substring starting at `{`.

**jq** (newline-delimited JSON on stdin or in a file):

```bash
# Keep only bundle exports
jq -c 'select(.event_type == "bundle.export")' < envelope-audit.ndjson

# Table: time, event, actor, bundle
jq -r '[.ts, .event_type, .actor_api_key_name // "-", .bundle_name // .stack_name // "-"] | @tsv' < envelope-audit.ndjson
```

**Python** (read stdin line-by-line):

```python
import json
import sys

for line in sys.stdin:
    line = line.strip()
    if not line or line[0] != "{":
        continue  # skip non-JSON wrappers if present; or extract line[line.index("{"):])
    obj = json.loads(line)
    if obj.get("event_type") == "env_link.download":
        print(obj["token_sha256_prefix"], obj.get("client_ip"))
```

**Vector** (remap transform: parse `message` as JSON after collecting container logs):

```toml
# Conceptual: route Envelope container logs through a remap
[transforms.parse_envelope_audit]
type = "remap"
inputs = ["from_kubernetes_logs"]
source = '''
  parsed, err = parse_json(.message)
  if err == null && exists(parsed.event_type) {
    . = parsed
  }
'''
```

**Fluent Bit** (parse JSON in the log field; filter or rewrite to your backend):

```ini
# Conceptual: if the whole line is JSON in the "log" key
[FILTER]
    Name    parser
    Match   envelope.*
    Key_Name log
    Parser  json
```

**CloudWatch Logs Insights** (if each event is stored as JSON in `@message` or a parsed field):

```sql
fields @timestamp, event_type, actor_api_key_name, bundle_name, client_ip
| filter event_type = "system.database_backup"
| sort @timestamp desc
| limit 100
```

Adapt field names to how your shipper maps the line (often `@message` or `log` contains the raw JSON string—use `parse_json(@message)` where supported).

**OpenTelemetry Collector → OTLP** (Envelope does not speak OTLP itself; the collector ingests JSON lines, then forwards **OTLP** to your backend—Grafana Cloud, Honeycomb, Dynatrace, self-hosted `otelcol`, Loki via OTLP, etc.):

Use **[opentelemetry-collector-contrib](https://github.com/open-telemetry/opentelemetry-collector-contrib)** with the `[filelog` receiver](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) and an **OTLP exporter**. Point `include` at a file you append audit lines to, or at a mounted container log file whose **body** is the JSON line (adjust `operators` if a runtime wraps the line).

Example `collector.yaml` (validate operator syntax against your collector version; layouts differ slightly by release):

```yaml
receivers:
  filelog/envelope_audit:
    include:
      - /var/log/envelope/audit.jsonl
    operators:
      # Whole line is one JSON object → log record attributes (includes string field `ts`)
      - type: json_parser
        parse_from: body
        parse_to: attributes

processors:
  batch: {}
  resource/envelope:
    attributes:
      - key: service.name
        value: envelope
        action: upsert

exporters:
  # gRPC (default port 4317) or HTTP (4318) — use what your backend expects
  otlphttp:
    endpoint: https://otel.example.com:4318
    tls:
      insecure: false
    headers:
      authorization: ${env:OTEL_EXPORTER_OTLP_HEADERS}

service:
  pipelines:
    logs:
      receivers: [filelog/envelope_audit]
      processors: [resource/envelope, batch]
      exporters: [otlphttp]
```

Set `OTEL_EXPORTER_OTLP_HEADERS` (or your vendor’s env vars) to the secret the OTLP endpoint requires. For **OTLP/gRPC** instead of HTTP, swap the exporter block for:

```yaml
exporters:
  otlp:
    endpoint: otel-collector.observability.svc.cluster.local:4317
    tls:
      insecure: false
```

In **Kubernetes**, you often collect stdout with a DaemonSet agent or sidecar and parse JSON there; the same `json_parser` + `otlphttp` pattern applies once each log line is the raw audit JSON (or you add a `regex`/`add` operator to strip CRI/Docker prefixes first).

Optionally add a `**time_parser`** operator after `json_parser` so `attributes.ts` (RFC3339 from Envelope) sets the log record’s observed time (see the **time_parser** stanza operator docs in **opentelemetry-collector-contrib** for `layout`), or leave timestamps to the backend and keep `ts` as a plain attribute.

### Client IP and proxies

The app records the ASGI **client** address. When Envelope sits behind a reverse proxy, configure `FORWARDED_ALLOW_IPS` so Uvicorn **trusts** `X-Forwarded-For` / `X-Forwarded-Proto` from your gateway (see the main **README** section *Behind a gateway*). If you need an **authoritative** client IP for compliance, also retain **gateway access logs**—they remain the usual source of truth when headers are complex or multi-hop.

---

## Database table and growth

- Table: `audit_events` (created on startup with the rest of the schema).
- **Retention:** The application does **not** rotate or delete old rows. Plan PostgreSQL or SQLite file growth, backups, and optional **offline archival** or a **scheduled job** (operator-owned) if you must cap table size.
- **Immutability:** Rows are append-only from application code. **Database-level** immutability (restricted roles, WORM storage, read replicas for analytics) is a deployment choice.

---

## Admin API (query)

- **Endpoint:** `GET /api/v1/system/audit-events`
- **Auth:** **Admin** scope (Bearer admin API key, or signed-in admin session where applicable).
- **Query parameters:**
  - `limit` — Page size, **1–200** (default **50**).
  - `before_id` — Return events with `id` **strictly less** than this value (pagination toward older events). Omit for the newest page.

Example:

```http
GET /api/v1/system/audit-events?limit=50 HTTP/1.1
Authorization: Bearer <admin-api-key>
```

Interactive documentation: `/docs` on your deployment (OpenAPI).

---

## Opaque env URLs (`/env/…`)

Downloads using the **opaque token path** are **not** tied to an API key. Audit rows for `env_link.download` leave the actor empty but include **resource ids** and a `token_sha256_prefix` (first 8 hex characters of the stored digest) for correlation. Pair these records with **proxy/WAF logs** (requested path, source IP, TLS properties) for full forensics.

---

## Related documentation

- Main **README** — *Audit trail* section (feature overview and API table row).
- **docs/security-gaps.md** — Residual expectations (SIEM, DB privileges, proxy logs).
- In-app **Help** — **Security audit trail** at `/help/audit` (bundled from `frontend/src/help/usage.md`).

