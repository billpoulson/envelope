import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type ProjectEnvironmentRow = {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
};

export async function listProjectEnvironments(
  projectSlug: string,
): Promise<ProjectEnvironmentRow[]> {
  return apiFetch<ProjectEnvironmentRow[]>(
    `/projects/${encodeURIComponent(projectSlug)}/environments`,
    { method: "GET" },
  );
}

export async function createProjectEnvironment(
  projectSlug: string,
  body: { name: string; slug?: string | null },
): Promise<ProjectEnvironmentRow> {
  const csrf = await fetchCsrf();
  return apiFetch(`/projects/${encodeURIComponent(projectSlug)}/environments`, {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function updateProjectEnvironment(
  projectSlug: string,
  envSlug: string,
  body: { name?: string; slug?: string },
): Promise<ProjectEnvironmentRow> {
  const csrf = await fetchCsrf();
  return apiFetch(
    `/projects/${encodeURIComponent(projectSlug)}/environments/${encodeURIComponent(envSlug)}`,
    {
      method: "PATCH",
      headers: getCsrfHeader(csrf),
      json: body,
    },
  );
}

export async function deleteProjectEnvironment(
  projectSlug: string,
  envSlug: string,
): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(
    `/projects/${encodeURIComponent(projectSlug)}/environments/${encodeURIComponent(envSlug)}`,
    {
      method: "DELETE",
      headers: getCsrfHeader(csrf),
    },
  );
}

export async function reorderProjectEnvironments(
  projectSlug: string,
  slugs: string[],
): Promise<ProjectEnvironmentRow[]> {
  const csrf = await fetchCsrf();
  return apiFetch(`/projects/${encodeURIComponent(projectSlug)}/environments/order`, {
    method: "PUT",
    headers: getCsrfHeader(csrf),
    json: { slugs },
  });
}
