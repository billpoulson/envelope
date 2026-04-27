import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type AuditUsage = {
  name?: string;
  kind?: string;
  run?: string;
};

export type AuditDetails = {
  usage?: AuditUsage;
  [key: string]: unknown;
};

export type AuditEventRow = {
  id: number;
  created_at: string;
  event_type: string;
  actor_api_key_id: number | null;
  actor_api_key_name: string | null;
  bundle_id: number | null;
  bundle_name: string | null;
  stack_id: number | null;
  stack_name: string | null;
  bundle_env_link_id: number | null;
  stack_env_link_id: number | null;
  token_sha256_prefix: string | null;
  client_ip: string | null;
  user_agent: string | null;
  http_method: string | null;
  path: string | null;
  details: AuditDetails | null;
};

export type AuditEventsResponse = {
  events: AuditEventRow[];
};

export type LastAccessMetadata = {
  last_accessed_at: string | null;
  last_accessed_usage_name: string | null;
  last_accessed_usage_kind: string | null;
  last_accessed_usage_run: string | null;
  last_accessed_ip: string | null;
  last_accessed_user_agent: string | null;
};

export async function listAuditEvents({
  limit = 50,
  beforeId,
}: {
  limit?: number;
  beforeId?: number;
} = {}): Promise<AuditEventsResponse> {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (beforeId !== undefined) q.set("before_id", String(beforeId));
  return apiFetch<AuditEventsResponse>(`/system/audit-events?${q.toString()}`, { method: "GET" });
}

export async function downloadEncryptedBackup(passphrase: string): Promise<void> {
  const csrf = await fetchCsrf();
  const res = await fetch("/api/v1/system/backup/database", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/octet-stream",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition");
  let name = "envelope.envelope-db";
  if (cd) {
    const m = /filename="([^"]+)"/.exec(cd);
    if (m) name = m[1] ?? name;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function restoreDatabase(file: File, passphrase: string): Promise<string> {
  const csrf = await fetchCsrf();
  const fd = new FormData();
  fd.append("file", file);
  if (passphrase) fd.append("passphrase", passphrase);
  const res = await fetch("/api/v1/system/restore/database", {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrf },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  try {
    const j = JSON.parse(text) as { message?: string };
    return j.message ?? text;
  } catch {
    return text;
  }
}
