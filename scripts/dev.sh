#!/usr/bin/env sh
# Run FastAPI (reload) and the Vite dev server together. Requires: pip install -r requirements.txt, npm install in frontend/
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
PORT="${PORT:-8000}"

cleanup() {
  if [ -n "${UV_PID:-}" ]; then
    kill "$UV_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

if ! command -v uvicorn >/dev/null 2>&1; then
  echo "uvicorn not found. Install deps: pip install -r requirements.txt" >&2
  exit 1
fi

uvicorn app.main:app --reload --host 127.0.0.1 --port "$PORT" &
UV_PID=$!

if [ ! -d frontend/node_modules ]; then
  echo "Installing frontend dependencies..." >&2
  (cd frontend && npm install)
fi

(cd frontend && npm run dev)
