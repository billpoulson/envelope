import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type ImportKind = "skip" | "json_object" | "json_array" | "csv_quoted" | "dotenv_lines";

export async function listBundles(projectSlug?: string): Promise<string[]> {
  const q = projectSlug ? `?project_slug=${encodeURIComponent(projectSlug)}` : "";
  return apiFetch<string[]>(`/bundles${q}`, { method: "GET" });
}

export type BundlePayload = {
  secrets: Record<string, string>;
  secret_flags: Record<string, boolean>;
  group_id: number | null;
  project_name: string | null;
  project_slug: string | null;
};

export async function getBundle(name: string): Promise<BundlePayload> {
  return apiFetch<BundlePayload>(`/bundles/${encodeURIComponent(name)}`, { method: "GET" });
}

export async function createBundle(body: {
  name: string;
  project_slug: string;
  entries?: Record<string, unknown>;
  initial_paste?: string;
  import_kind?: ImportKind;
}): Promise<{ id: number; name: string }> {
  const csrf = await fetchCsrf();
  return apiFetch("/bundles", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function patchBundle(
  name: string,
  body: { entries?: Record<string, unknown>; project_slug?: string | null },
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/bundles/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteBundle(name: string): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/bundles/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}

export async function upsertSecret(
  bundleName: string,
  body: { key_name: string; value: string; is_secret: boolean },
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/bundles/${encodeURIComponent(bundleName)}/secrets`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function encryptSecret(bundleName: string, keyName: string): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(`/bundles/${encodeURIComponent(bundleName)}/secrets/encrypt${q}`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
  });
}

export async function declassifySecret(bundleName: string, keyName: string): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(`/bundles/${encodeURIComponent(bundleName)}/secrets/declassify${q}`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
  });
}

export async function deleteSecret(bundleName: string, keyName: string): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(`/bundles/${encodeURIComponent(bundleName)}/secrets${q}`, {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}

export async function listBundleKeyNames(bundleName: string): Promise<string[]> {
  const r = await apiFetch<{ keys: string[] }>(
    `/bundles/${encodeURIComponent(bundleName)}/key-names`,
    { method: "GET" },
  );
  return r.keys ?? [];
}

export type EnvLinkRow = { id: number; created_at: string };

export async function listBundleEnvLinks(bundleName: string): Promise<EnvLinkRow[]> {
  return apiFetch<EnvLinkRow[]>(`/bundles/${encodeURIComponent(bundleName)}/env-links`, {
    method: "GET",
  });
}

export async function createBundleEnvLink(
  bundleName: string,
): Promise<{ url: string; message: string }> {
  const csrf = await fetchCsrf();
  return apiFetch(`/bundles/${encodeURIComponent(bundleName)}/env-links`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
  });
}

export async function deleteBundleEnvLink(bundleName: string, linkId: number): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(
    `/bundles/${encodeURIComponent(bundleName)}/env-links/${encodeURIComponent(String(linkId))}`,
    { method: "DELETE", headers: getCsrfHeader(csrf) },
  );
}

export type SealedSecretRow = {
  key_name: string;
  enc_alg: string;
  payload_ciphertext: string;
  payload_nonce: string;
  payload_aad: string | null;
  recipients: { certificate_id: number; wrapped_key: string; key_wrap_alg: string }[];
  updated_at: string;
};

export async function listSealedSecrets(bundleName: string): Promise<SealedSecretRow[]> {
  return apiFetch<SealedSecretRow[]>(
    `/bundles/${encodeURIComponent(bundleName)}/sealed-secrets`,
    { method: "GET" },
  );
}

export async function deleteSealedSecret(bundleName: string, keyName: string): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(`/bundles/${encodeURIComponent(bundleName)}/sealed-secrets${q}`, {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}

export type SealedRecipientIn = {
  certificate_id: number;
  wrapped_key: string;
  key_wrap_alg: string;
};

export async function upsertSealedSecret(
  bundleName: string,
  body: {
    key_name: string;
    enc_alg: string;
    payload_ciphertext: string;
    payload_nonce: string;
    payload_aad?: string | null;
    recipients: SealedRecipientIn[];
  },
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/bundles/${encodeURIComponent(bundleName)}/sealed-secrets`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}
