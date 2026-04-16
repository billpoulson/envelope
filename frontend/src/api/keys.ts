import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type ApiKeyRow = {
  id: number;
  name: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  oidc_linked?: boolean;
};

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  return apiFetch<ApiKeyRow[]>("/api-keys", { method: "GET" });
}

export async function createApiKey(body: {
  name: string;
  scopes: string[];
  expires_at?: string;
}): Promise<{ id: number; name: string; scopes: string[]; plain_key: string }> {
  const csrf = await fetchCsrf();
  return apiFetch("/api-keys", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteApiKey(keyId: number): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/api-keys/${encodeURIComponent(String(keyId))}`, {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}
