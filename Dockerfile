FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# React Router basename must match `/app` (see app/main.py _register_react_spa).
ENV VITE_ADMIN_BASENAME=/app
RUN npm run build

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN useradd --create-home --uid 1000 envelope

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# React admin at /app (Vite build from frontend/)
COPY --from=frontend-build /build/dist ./frontend/dist

# If the UI looks stale after code changes, rebuild without cache so COPY layers refresh:
#   docker compose build --no-cache && docker compose up -d

RUN mkdir -p /data /app/data && chown envelope:envelope /data /app/data

USER envelope

EXPOSE 8080

# FORWARDED_ALLOW_IPS: trust only your gateway (e.g. 172.16.0.0/12 for Docker bridge). Default 127.0.0.1.
# ENVELOPE_ROOT_PATH: optional path prefix (e.g. /envelope); must match reverse proxy strip + this flag.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1}\" ${ENVELOPE_ROOT_PATH:+--root-path \"$ENVELOPE_ROOT_PATH\"}"]
