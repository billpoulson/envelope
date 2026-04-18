import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listProjectBundles } from "@/api/bundles";
import { listProjects } from "@/api/projects";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { projectBundlesBase } from "@/projectPaths";

export default function BundlesPage() {
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const projects = projectsQ.data ?? [];
  const bundleQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["bundles", p.slug, "all-envs-global"],
      queryFn: () => listProjectBundles(p.slug),
      enabled: projectsQ.isSuccess && projects.length > 0,
    })),
  });

  if (projectsQ.isLoading) return <p className="text-slate-400">Loading bundles…</p>;
  if (projectsQ.isError) {
    return (
      <p className="text-red-400">
        {projectsQ.error instanceof Error ? projectsQ.error.message : "Failed to load"}
      </p>
    );
  }

  const bundleLoading = bundleQueries.some((q) => q.isLoading);
  const bundleErr = bundleQueries.find((q) => q.isError)?.error;
  if (bundleLoading) return <p className="text-slate-400">Loading bundles…</p>;
  if (bundleErr) {
    return (
      <p className="text-red-400">
        {bundleErr instanceof Error ? bundleErr.message : "Failed to load bundles"}
      </p>
    );
  }

  const items: { name: string; href: string }[] = [];
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]!;
    const rows = bundleQueries[i]?.data ?? [];
    for (const row of rows) {
      const es = row.project_environment_slug?.trim();
      if (!es) continue;
      items.push({
        name: `${p.name} · ${row.name}`,
        href: `${projectBundlesBase(p.slug, es)}/${encodeURIComponent(row.slug)}/edit`,
      });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return (
    <div>
      <PageHeader
        title="Bundles"
        subtitle={items.length > 0 ? `${items.length} total` : undefined}
      />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
        Bundles belong to a project and environment. Open a project to create new ones, or jump to a bundle below.
      </p>
      <ResourceList
        items={items}
        emptyMessage="No bundles found."
        emptyHint={
          <>
            Go to{" "}
            <Link className="text-accent underline" to="/projects">
              Projects
            </Link>{" "}
            and open a project to add a bundle.
          </>
        }
      />
    </div>
  );
}
