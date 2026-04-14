import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type ProjectRow = {
  id: number;
  name: string;
  slug: string;
  bundle_count: number;
};

export async function listProjects(): Promise<ProjectRow[]> {
  return apiFetch<ProjectRow[]>("/projects", { method: "GET" });
}

export async function patchProject(
  projectSlug: string,
  body: { name?: string; slug?: string },
): Promise<Pick<ProjectRow, "id" | "name" | "slug">> {
  const csrf = await fetchCsrf();
  return apiFetch(`/projects/${encodeURIComponent(projectSlug)}`, {
    method: "PATCH",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteProject(projectSlug: string): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/projects/${encodeURIComponent(projectSlug)}`, {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}
