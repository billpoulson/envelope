import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listProjectStacks } from "@/api/stacks";
import { listProjects } from "@/api/projects";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { projectStacksBase } from "@/projectPaths";

export default function StacksPage() {
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const projects = projectsQ.data ?? [];
  const stackQueries = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["stacks", p.slug, "all-envs-global"],
      queryFn: () => listProjectStacks(p.slug),
      enabled: projectsQ.isSuccess && projects.length > 0,
    })),
  });

  if (projectsQ.isLoading) return <p className="text-slate-400">Loading stacks…</p>;
  if (projectsQ.isError) {
    return (
      <p className="text-red-400">
        {projectsQ.error instanceof Error ? projectsQ.error.message : "Failed to load"}
      </p>
    );
  }

  const stackLoading = stackQueries.some((q) => q.isLoading);
  const stackErr = stackQueries.find((q) => q.isError)?.error;
  if (stackLoading) return <p className="text-slate-400">Loading stacks…</p>;
  if (stackErr) {
    return (
      <p className="text-red-400">
        {stackErr instanceof Error ? stackErr.message : "Failed to load stacks"}
      </p>
    );
  }

  const items: { name: string; href: string }[] = [];
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]!;
    const rows = stackQueries[i]?.data ?? [];
    for (const row of rows) {
      const es = row.project_environment_slug?.trim();
      if (!es) continue;
      items.push({
        name: `${p.name} · ${row.name}`,
        href: `${projectStacksBase(p.slug, es)}/${encodeURIComponent(row.slug)}/edit`,
      });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return (
    <div>
      <PageHeader
        title="Stacks"
        subtitle={items.length > 0 ? `${items.length} total` : undefined}
      />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
        Stacks are defined per project and environment. Choose a project to create new ones, or open a stack below to
        edit layers, view the key graph, or manage env links.
      </p>
      <ResourceList
        items={items}
        emptyMessage="No stacks found."
        emptyHint={
          <>
            Open a{" "}
            <Link className="text-accent underline" to="/projects">
              project
            </Link>{" "}
            and use Stacks → New stack.
          </>
        }
      />
    </div>
  );
}
