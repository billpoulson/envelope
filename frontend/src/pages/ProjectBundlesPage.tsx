import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { listProjectBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { environmentListApiOpts } from "@/projectEnv";
import { projectBundlesBase, projectEnvironmentsPath, searchWithoutEnv } from "@/projectPaths";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";
export default function ProjectBundlesPage() {
  const { projectSlug = "", environmentSlug = "" } = useParams<{
    projectSlug: string;
    environmentSlug: string;
  }>();
  const location = useLocation();
  const listOpts = environmentListApiOpts(environmentSlug);
  const q = useQuery({
    queryKey: ["bundles", projectSlug, environmentSlug, "with-env"],
    queryFn: () => listProjectBundles(projectSlug, listOpts),
    enabled: !!projectSlug && !!environmentSlug,
  });
  const envsQ = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug),
    enabled: !!projectSlug,
  });

  if (!projectSlug || !environmentSlug) return <p className="text-red-400">Missing project or environment</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading bundles…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = q.data ?? [];
  const base = projectBundlesBase(projectSlug, environmentSlug);
  const envPath = projectEnvironmentsPath(projectSlug);
  const qs = searchWithoutEnv(location.search);
  const envCount = envsQ.data?.length ?? 0;
  const envsLoaded = !envsQ.isLoading && !envsQ.isError;
  const needsEnvironment = envsLoaded && envCount === 0;

  const items = rows.map((row) => {
    const href = `${base}/${encodeURIComponent(row.slug)}/edit${qs}`;
    return {
      name: row.name,
      href,
      extras: [{ label: "Open", to: href }],
    };
  });

  return (
    <div>
      <PageHeader
        title="Bundles"
        subtitle={rows.length > 0 ? `${rows.length} in this project` : undefined}
        actions={
          <Link to={`${base}/new${qs}`}>
            <Button>New bundle</Button>
          </Link>
        }
      />
      {needsEnvironment ? (
        <div
          className="mb-6 rounded-lg border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-slate-200"
          role="status"
        >
          <strong className="text-amber-100">Environments are required first.</strong>{" "}
          <span className="text-slate-400">
            Create at least one project environment, then you can add bundles (and stacks) tied to it.
          </span>{" "}
          <Link className="font-medium text-accent underline hover:text-accent/90" to={envPath}>
            Open Environments
          </Link>
        </div>
      ) : null}
      <ResourceList
        items={items}
        emptyMessage="No bundles in this project yet."
        emptyHint="Create a bundle to store variables for stacks and exports."
        extrasAsButtons
      />
    </div>
  );
}
