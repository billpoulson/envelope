import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type OidcSettings = {
  source: "db" | "env";
  enabled: boolean;
  issuer: string;
  client_id: string;
  client_secret_configured: boolean;
  scopes: string;
  allowed_email_domains: string;
  post_login_path: string;
  redirect_uri_override: string | null;
  oidc_login_ready: boolean;
  suggested_callback_url: string;
};

export type OidcSettingsPatch = {
  enabled?: boolean;
  issuer?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string;
  allowed_email_domains?: string;
  post_login_path?: string;
  redirect_uri_override?: string | null;
};

export async function getOidcSettings(): Promise<OidcSettings> {
  return apiFetch<OidcSettings>("/settings/oidc", { method: "GET" });
}

export async function patchOidcSettings(patch: OidcSettingsPatch): Promise<OidcSettings> {
  const csrf = await fetchCsrf();
  return apiFetch<OidcSettings>("/settings/oidc", {
    method: "PATCH",
    headers: getCsrfHeader(csrf),
    json: patch,
  });
}
