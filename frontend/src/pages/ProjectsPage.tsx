import { useQuery } from "@tanstack/react-query";
import { Globe, Layers, Package, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { listProjects } from "@/api/projects";
import { projectGatewayPath } from "@/projectPaths";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";

const navLinkClass =
  "inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 underline-offset-2 transition hover:text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm";

const navIconClass = "h-4 w-4 shrink-0 opacity-80";

export default function ProjectsPage() {
  const q = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-white/[0.06]" aria-hidden />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-border/40 bg-white/[0.03]"
              aria-hidden
            />
          ))}
        </div>
        <p className="sr-only">Loading projects…</p>
      </div>
    );
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
        subtitle="Each project groups bundles, stacks, and environments."
        actions={
          <Link to="/projects/new">
            <Button>New project</Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-[#0b0f14]/50 px-6 py-16 text-center sm:px-10">
          <h2 className="text-lg font-semibold text-slate-200">No projects yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Create a project to organize bundles and stacks. You will add deployment environments next, then variables
            and merged exports.
          </p>
          <div className="mt-8">
            <Link to="/projects/new">
              <Button>Create your first project</Button>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const gateway = projectGatewayPath(p.slug);
            return (
              <li key={p.id}>
                <article
                  className="flex h-full flex-col rounded-xl border border-border/70 bg-gradient-to-b from-[#0f161d]/90 to-[#0b0f14]/95 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-[border-color,box-shadow] hover:border-border hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold leading-tight tracking-tight text-slate-100">
                        <Link
                          to={gateway}
                          className="transition hover:text-accent focus:outline-none focus-visible:text-accent focus-visible:underline"
                        >
                          {p.name}
                        </Link>
                      </h2>
                      <p
                        className="mt-1.5 truncate font-mono text-xs text-slate-500"
                        title={p.slug}
                      >
                        {p.slug}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full border border-border/50 bg-white/[0.04] px-2.5 py-1 text-xs font-medium tabular-nums text-slate-400"
                      title="Bundles in this project"
                    >
                      {p.bundle_count}
                      <span className="ml-1 text-slate-600">
                        {p.bundle_count === 1 ? "bundle" : "bundles"}
                      </span>
                    </span>
                  </div>

                  <nav
                    className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/45 pt-4"
                    aria-label={`Quick links for ${p.name}`}
                  >
                    <Link to={`/projects/${encodeURIComponent(p.slug)}/environments`} className={navLinkClass}>
                      <Globe className={navIconClass} aria-hidden />
                      Environments
                    </Link>
                    <Link to={gateway} className={navLinkClass}>
                      <Package className={navIconClass} aria-hidden />
                      Bundles
                    </Link>
                    <Link to={gateway} className={navLinkClass}>
                      <Layers className={navIconClass} aria-hidden />
                      Stacks
                    </Link>
                    <Link to={`/projects/${encodeURIComponent(p.slug)}/settings`} className={navLinkClass}>
                      <Settings className={navIconClass} aria-hidden />
                      Settings
                    </Link>
                  </nav>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
