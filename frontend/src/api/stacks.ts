import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";
import { appendResourceScope, type ResourceScopeOpts } from "./bundles";

export type { ResourceScopeOpts };

export type ListStacksOptions = {
  environmentSlug?: string;
  includeUnassigned?: boolean;
};

export type ProjectStackListRow = {
  name: string;
  project_environment_slug: string | null;
  project_environment_name: string | null;
};

export async function listStacks(
  projectSlug?: string,
  opts?: ListStacksOptions,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (projectSlug) params.set("project_slug", projectSlug);
  if (opts?.environmentSlug) params.set("environment_slug", opts.environmentSlug);
  if (opts?.includeUnassigned === false) params.set("include_unassigned", "false");
  const q = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<string[]>(`/stacks${q}`, { method: "GET" });
}

export async function listProjectStacks(
  projectSlug: string,
  opts?: ListStacksOptions,
): Promise<ProjectStackListRow[]> {
  const params = new URLSearchParams();
  params.set("project_slug", projectSlug);
  params.set("with_environment", "true");
  if (opts?.environmentSlug) params.set("environment_slug", opts.environmentSlug);
  if (opts?.includeUnassigned === false) params.set("include_unassigned", "false");
  const q = `?${params.toString()}`;
  return apiFetch<ProjectStackListRow[]>(`/stacks${q}`, { method: "GET" });
}

export type StackLayer = {
  bundle: string;
  keys: "*" | string[];
  label?: string | null;
  /** Export name -> source variable from merged layers below (e.g. VITE_OIDC_KEY -> OIDC_KEY). */
  aliases?: Record<string, string> | null;
};

export type StackDetail = {
  name: string;
  group_id: number | null;
  project_slug: string | null;
  project_environment_slug: string | null;
  layers: StackLayer[];
};

export async function getStack(name: string, scope?: ResourceScopeOpts): Promise<StackDetail> {
  return apiFetch<StackDetail>(
    appendResourceScope(`/stacks/${encodeURIComponent(name)}`, scope),
    { method: "GET" },
  );
}

export async function createStack(body: {
  name: string;
  project_slug: string;
  project_environment_slug: string;
  layers: StackLayer[];
}): Promise<{ id: number; name: string }> {
  const csrf = await fetchCsrf();
  return apiFetch("/stacks", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function patchStack(
  name: string,
  body: {
    name?: string;
    project_slug?: string | null;
    project_environment_slug?: string | null;
    layers?: StackLayer[];
  },
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(appendResourceScope(`/stacks/${encodeURIComponent(name)}`, scope), {
    method: "PATCH",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteStack(name: string, scope?: ResourceScopeOpts): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(appendResourceScope(`/stacks/${encodeURIComponent(name)}`, scope), {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}

export type StackKeyGraphPayload = {
  layers: {
    bundle: string;
    position: number;
    label: string;
    display_label?: string | null;
    bundle_edit_path?: string;
    /** Which deployment environment this layer's bundle is tagged with (null = unassigned). */
    bundle_environment_slug?: string | null;
  }[];
  rows: {
    key: string;
    cells: (string | null)[];
    cell_secrets: (boolean | null)[];
    cells_value_present?: (boolean | null)[];
    cells_secret_redacted?: (boolean | null)[];
    /** Per layer: source key name when this row key is a layer alias export; else null. */
    cells_alias_source?: (string | null)[];
    winner_layer_index: number | null;
    merged: string | null;
    merged_secret: boolean | null;
    merged_value_redacted?: boolean;
  }[];
  secret_values_included?: boolean;
};

export async function getStackKeyGraph(
  name: string,
  includeSecretValues = false,
  scope?: ResourceScopeOpts,
): Promise<StackKeyGraphPayload> {
  const p = new URLSearchParams();
  p.set("include_secret_values", includeSecretValues ? "true" : "false");
  if (scope?.projectSlug?.trim()) p.set("project_slug", scope.projectSlug.trim());
  const e = scope?.environmentSlug?.trim();
  if (e) p.set("environment_slug", e);
  return apiFetch(
    `/stacks/${encodeURIComponent(name)}/key-graph?${p.toString()}`,
    { method: "GET" },
  );
}

export type StackEnvLinkRow = {
  id: number;
  created_at: string;
  through_layer_position: number | null;
  slice_label: string | null;
};

export async function listStackEnvLinks(
  stackName: string,
  scope?: ResourceScopeOpts,
): Promise<StackEnvLinkRow[]> {
  return apiFetch<StackEnvLinkRow[]>(
    appendResourceScope(`/stacks/${encodeURIComponent(stackName)}/env-links`, scope),
    {
      method: "GET",
    },
  );
}

export async function createStackEnvLink(
  stackName: string,
  throughLayerPosition: number | null,
  scope?: ResourceScopeOpts,
): Promise<{ url: string; message: string }> {
  const csrf = await fetchCsrf();
  return apiFetch(
    appendResourceScope(`/stacks/${encodeURIComponent(stackName)}/env-links`, scope),
    {
      method: "POST",
      headers: getCsrfHeader(csrf),
      json: { through_layer_position: throughLayerPosition },
    },
  );
}

export async function deleteStackEnvLink(
  stackName: string,
  linkId: number,
  scope?: ResourceScopeOpts,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(
    appendResourceScope(
      `/stacks/${encodeURIComponent(stackName)}/env-links/${encodeURIComponent(String(linkId))}`,
      scope,
    ),
    { method: "DELETE", headers: getCsrfHeader(csrf) },
  );
}
