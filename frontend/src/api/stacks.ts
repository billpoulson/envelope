import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export async function listStacks(projectSlug?: string): Promise<string[]> {
  const q = projectSlug ? `?project_slug=${encodeURIComponent(projectSlug)}` : "";
  return apiFetch<string[]>(`/stacks${q}`, { method: "GET" });
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
  layers: StackLayer[];
};

export async function getStack(name: string): Promise<StackDetail> {
  return apiFetch<StackDetail>(`/stacks/${encodeURIComponent(name)}`, { method: "GET" });
}

export async function createStack(body: {
  name: string;
  project_slug: string;
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
  body: { name?: string; project_slug?: string | null; layers?: StackLayer[] },
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/stacks/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteStack(name: string): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/stacks/${encodeURIComponent(name)}`, {
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
): Promise<StackKeyGraphPayload> {
  const q =
    includeSecretValues === true
      ? "?include_secret_values=true"
      : "?include_secret_values=false";
  return apiFetch(`/stacks/${encodeURIComponent(name)}/key-graph${q}`, { method: "GET" });
}

export type StackEnvLinkRow = {
  id: number;
  created_at: string;
  through_layer_position: number | null;
  slice_label: string | null;
};

export async function listStackEnvLinks(stackName: string): Promise<StackEnvLinkRow[]> {
  return apiFetch<StackEnvLinkRow[]>(`/stacks/${encodeURIComponent(stackName)}/env-links`, {
    method: "GET",
  });
}

export async function createStackEnvLink(
  stackName: string,
  throughLayerPosition: number | null,
): Promise<{ url: string; message: string }> {
  const csrf = await fetchCsrf();
  return apiFetch(`/stacks/${encodeURIComponent(stackName)}/env-links`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: { through_layer_position: throughLayerPosition },
  });
}

export async function deleteStackEnvLink(stackName: string, linkId: number): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(
    `/stacks/${encodeURIComponent(stackName)}/env-links/${encodeURIComponent(String(linkId))}`,
    { method: "DELETE", headers: getCsrfHeader(csrf) },
  );
}
