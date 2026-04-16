import { apiFetch, getCsrfHeader } from "./client";

export async function fetchCsrf(): Promise<string> {
  const r = await apiFetch<{ csrf_token: string }>("/auth/csrf", { method: "GET" });
  return r.csrf_token;
}

export async function login(apiKey: string): Promise<string> {
  const csrf = await fetchCsrf();
  const r = await apiFetch<{ csrf_token: string }>("/auth/login", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: { api_key: apiKey },
  });
  return r.csrf_token;
}

export async function logout(csrf: string): Promise<void> {
  await apiFetch("/auth/logout", {
    method: "POST",
    headers: getCsrfHeader(csrf),
  });
}

export async function sessionInfo(): Promise<{ admin: boolean }> {
  return apiFetch("/auth/session", { method: "GET" });
}

export async function loginOptions(): Promise<{ oidc_available: boolean }> {
  return apiFetch("/auth/login-options", { method: "GET" });
}
