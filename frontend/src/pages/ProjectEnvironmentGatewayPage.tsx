import { useQuery } from "@tanstack/react-query";
import { Globe, Settings } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { listProjects } from "@/api/projects";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import { projectBundlesBase, projectEnvironmentsPath, projectSettingsPath } from "@/projectPaths";

const quickLinkClass =
  "inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-border hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const quickIconClass = "h-4 w-4 shrink-0 opacity-80";

export default function ProjectEnvironmentGatewayPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: !!projectSlug,
  });
  const projectRow = projectsQ.data?.find((p) => p.slug === projectSlug);
  const projectName = projectRow?.name ?? projectSlug;

  const envsQ = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug),
    enabled: !!projectSlug,
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
  if (envsQ.isLoading) return <p className="text-slate-400">Loading environments…</p>;
  if (envsQ.isError) {
    return (
      <p className="text-red-400">{envsQ.error instanceof Error ? envsQ.error.message : "Failed to load environments"}</p>
    );
  }

  const envs = envsQ.data ?? [];

  return (
    <div>
      <PageHeader
        title={projectName}
        subtitle="Choose a deployment environment for bundles and stacks, or manage project settings and environments."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={projectEnvironmentsPath(projectSlug)} className={quickLinkClass}>
              <Globe className={quickIconClass} aria-hidden />
              Environments
            </Link>
            <Link
              to={projectSettingsPath(projectSlug)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Settings className="h-4 w-4 opacity-80" aria-hidden />
              Settings
            </Link>
          </div>
        }
      />

      <h2 className="mb-3 text-base font-semibold text-slate-200">Open workspace</h2>
      {envs.length === 0 ? (
        <div className="rounded-lg border border-amber-500/35 bg-amber-950/35 px-4 py-6 text-sm text-slate-200">
          <p className="font-medium text-amber-100">No environments yet.</p>
          <p className="mt-2 text-slate-400">
            Create at least one environment before you can work with bundles and stacks.
          </p>
          <Button className="mt-4" type="button" onClick={() => navigate(projectEnvironmentsPath(projectSlug))}>
            Add environments
          </Button>
        </div>
      ) : (
        <ul className="grid max-w-lg gap-2">
          {envs.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-border/70 bg-[#0f141a] px-4 py-3 text-left text-sm text-slate-100 transition hover:border-accent/60 hover:bg-white/[0.04]"
                onClick={() => navigate(projectBundlesBase(projectSlug, e.slug))}
              >
                <span className="font-medium">{e.name}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{e.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
