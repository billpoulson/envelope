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
    winner_layer_index: number | null;
    merged: string | null;
    merged_secret: boolean | null;
  }[];
};

export async function getStackKeyGraph(name: string): Promise<StackKeyGraphPayload> {
  return apiFetch(`/stacks/${encodeURIComponent(name)}/key-graph`, { method: "GET" });
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
