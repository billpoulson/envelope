import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listProjects } from "@/api/projects";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";

export default function ProjectsPage() {
  const q = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  if (q.isLoading) {
    return <p className="text-slate-400">Loading projects…</p>;
  }
  if (q.isError) {
    return (
      <p className="text-red-400">
        {q.error instanceof Error ? q.error.message : "Failed to load projects"}
      </p>
    );
  }

  const rows = q.data ?? [];

  return (
    <div>
      <PageHeader
        title="Projects"
        actions={
          <Link to="/projects/new">
            <Button>New project</Button>
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="text-slate-400">No projects yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/80">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/80 bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Bundles</th>
                <th className="px-4 py-3 font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3 text-slate-200">{p.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{p.slug}</td>
                  <td className="px-4 py-3 text-slate-400">{p.bundle_count}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/projects/${encodeURIComponent(p.slug)}/bundles`}
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-surface/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      aria-label={`Open project ${p.name}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
