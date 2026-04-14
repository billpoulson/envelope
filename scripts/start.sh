#!/usr/bin/env sh
# Production-style API server (same defaults as the container CMD).
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if [ ! -f "$ROOT/.env" ]; then
  echo "No .env in repo root. Copy .env.example to .env and set ENVELOPE_MASTER_KEY and ENVELOPE_SESSION_SECRET." >&2
fi
PORT="${PORT:-8080}"
exec uvicorn app.main:app \
  --host "${HOST:-0.0.0.0}" \
  --port "$PORT" \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
  ${ENVELOPE_ROOT_PATH:+--root-path "$ENVELOPE_ROOT_PATH"} \
  "$@"
