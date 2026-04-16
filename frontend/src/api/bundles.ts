import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

/** Matches backend disambiguation for duplicate bundle/stack names per environment. */
export type ResourceScopeOpts = {
  projectSlug?: string;
  /** Project environment slug (matches admin UI env-in-path routes). */
  environmentSlug?: string | null;
};

export function appendResourceScope(pathWithQuery: string, scope?: ResourceScopeOpts): string {
  if (!scope?.projectSlug?.trim() && !scope?.environmentSlug?.trim()) {
    return pathWithQuery;
  }
  const p = new URLSearchParams();
  if (scope.projectSlug?.trim()) p.set("project_slug", scope.projectSlug.trim());
  const e = scope.environmentSlug?.trim();
  if (e) p.set("environment_slug", e);
  const joiner = pathWithQuery.includes("?") ? "&" : "?";
  return `${pathWithQuery}${joiner}${p.toString()}`;
}

export type ImportKind = "skip" | "json_object" | "json_array" | "csv_quoted" | "dotenv_lines";

export type ListBundlesOptions = {
  environmentSlug?: string;
  /** When false, asks the API to exclude legacy unassigned rows (deprecated server-side). */
  includeUnassigned?: boolean;
};

export type ProjectBundleListRow = {
  name: string;
  slug: string;
  project_environment_slug: string | null;
  project_environment_name: string | null;
};

export async function listBundles(
  projectSlug?: string,
  opts?: ListBundlesOptions,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (projectSlug) params.set("project_slug", projectSlug);
  if (opts?.environmentSlug) params.set("environment_slug", opts.environmentSlug);
  if (opts?.includeUnassigned === false) params.set("include_unassigned", "false");
  const q = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<string[]>(`/bundles${q}`, { method: "GET" });
}

/** Project page list with per-row environment metadata (for chips). */
export async function listProjectBundles(
  projectSlug: string,
  opts?: ListBundlesOptions,
): Promise<ProjectBundleListRow[]> {
  const params = new URLSearchParams();
  params.set("project_slug", projectSlug);
  params.set("with_environment", "true");
  if (opts?.environmentSlug) params.set("environment_slug", opts.environmentSlug);
  if (opts?.includeUnassigned === false) params.set("include_unassigned", "false");
  const q = `?${params.toString()}`;
  return apiFetch<ProjectBundleListRow[]>(`/bundles${q}`, { method: "GET" });
}

/** Persists bundle list order for the given project environment (admin UI). */
export async function reorderProjectBundles(
  projectSlug: string,
  environmentSlug: string,
  slugs: string[],
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch("/bundles/order", {
    method: "PUT",
    headers: getCsrfHeader(csrf),
    json: {
      project_slug: projectSlug,
      environment_slug: environmentSlug,
      slugs,
    },
  });
}

export type BundlePayload = {
  name: string;
  slug: string;
  /** Plaintext; `null` for encrypted rows when `secret_values_included` is false. */
  secrets: Record<string, string | null>;
  secret_flags: Record<string, boolean>;
  /** When false, encrypted values were not loaded from the server (see GET `include_secret_values`). */
  secret_values_included: boolean;
  group_id: number | null;
  project_name: string | null;
  project_slug: string | null;
  project_environment_slug: string | null;
};

export async function getBundle(
  name: string,
  scope?: ResourceScopeOpts,
  includeSecretValues = false,
): Promise<BundlePayload> {
  const base =
    includeSecretValues === true
      ? `/bundles/${encodeURIComponent(name)}?include_secret_values=true`
      : `/bundles/${encodeURIComponent(name)}`;
  return apiFetch<BundlePayload>(appendResourceScope(base, scope), { method: "GET" });
}

export async function createBundle(body: {
  name: string;
  slug?: string;
  project_slug: string;
  project_environment_slug: string;
  entries?: Record<string, unknown>;
  initial_paste?: string;
  import_kind?: ImportKind;
}): Promise<{ id: number; name: string; slug: string }> {
  const csrf = await fetchCsrf();
  return apiFetch("/bundles", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function patchBundle(
  name: string,
  body: {
    name?: string;
    slug?: string;
    entries?: Record<string, unknown>;
    project_slug?: string | null;
    project_environment_slug?: string | null;
  },
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(appendResourceScope(`/bundles/${encodeURIComponent(name)}`, scope), {
    method: "PATCH",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteBundle(name: string, scope?: ResourceScopeOpts): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(appendResourceScope(`/bundles/${encodeURIComponent(name)}`, scope), {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}

export async function upsertSecret(
  bundleName: string,
  body: { key_name: string; value: string; is_secret: boolean },
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/secrets`, scope), {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function encryptSecret(
  bundleName: string,
  keyName: string,
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/secrets/encrypt${q}`, scope),
    {
      method: "POST",
      headers: getCsrfHeader(csrf),
    },
  );
}

export async function declassifySecret(
  bundleName: string,
  keyName: string,
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/secrets/declassify${q}`, scope),
    {
      method: "POST",
      headers: getCsrfHeader(csrf),
    },
  );
}

export async function deleteSecret(
  bundleName: string,
  keyName: string,
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/secrets${q}`, scope),
    {
      method: "DELETE",
      headers: getCsrfHeader(csrf),
    },
  );
}

export async function listBundleKeyNames(
  bundleName: string,
  scope?: ResourceScopeOpts,
): Promise<string[]> {
  const r = await apiFetch<{ keys: string[] }>(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/key-names`, scope),
    { method: "GET" },
  );
  return r.keys ?? [];
}

/** SHA-256 hex (64 chars) of the UTF-8 env path token; matches server ``token_sha256_hex(raw)``. */
export type EnvLinkRow = { id: number; created_at: string; token_sha256: string };

export async function listBundleEnvLinks(
  bundleName: string,
  scope?: ResourceScopeOpts,
): Promise<EnvLinkRow[]> {
  return apiFetch<EnvLinkRow[]>(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/env-links`, scope),
    {
      method: "GET",
    },
  );
}

export async function createBundleEnvLink(
  bundleName: string,
  scope?: ResourceScopeOpts,
): Promise<{ url: string; message: string }> {
  const csrf = await fetchCsrf();
  return apiFetch(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/env-links`, scope),
    {
      method: "POST",
      headers: getCsrfHeader(csrf),
    },
  );
}

export async function deleteBundleEnvLink(
  bundleName: string,
  linkId: number,
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(
    appendResourceScope(
      `/bundles/${encodeURIComponent(bundleName)}/env-links/${encodeURIComponent(String(linkId))}`,
      scope,
    ),
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

export async function listSealedSecrets(
  bundleName: string,
  scope?: ResourceScopeOpts,
): Promise<SealedSecretRow[]> {
  return apiFetch<SealedSecretRow[]>(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/sealed-secrets`, scope),
    { method: "GET" },
  );
}

export async function deleteSealedSecret(
  bundleName: string,
  keyName: string,
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  const q = `?key_name=${encodeURIComponent(keyName)}`;
  await apiFetch(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/sealed-secrets${q}`, scope),
    {
      method: "DELETE",
      headers: getCsrfHeader(csrf),
    },
  );
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
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(
    appendResourceScope(`/bundles/${encodeURIComponent(bundleName)}/sealed-secrets`, scope),
    {
      method: "POST",
      headers: getCsrfHeader(csrf),
      json: body,
    },
  );
}
