import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { listProjectStacks } from "@/api/stacks";
import { NeedBundlesBeforeStacks } from "@/components/NeedBundlesBeforeStacks";
import { environmentListApiOpts } from "@/projectEnv";
import { projectEnvironmentsPath, projectStacksBase, searchWithoutEnv } from "@/projectPaths";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";

export default function ProjectStacksPage() {
  const { projectSlug = "", environmentSlug = "" } = useParams<{
    projectSlug: string;
    environmentSlug: string;
  }>();
  const location = useLocation();
  const listOpts = environmentListApiOpts(environmentSlug);
  const q = useQuery({
    queryKey: ["stacks", projectSlug, environmentSlug, "with-env"],
    queryFn: () => listProjectStacks(projectSlug, listOpts),
    enabled: !!projectSlug && !!environmentSlug,
  });
  const envsQ = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug),
    enabled: !!projectSlug,
  });
  const envCount = envsQ.data?.length ?? 0;
  const envsLoaded = !envsQ.isLoading && !envsQ.isError;
  const needsEnvironment = envsLoaded && envCount === 0;

  const bundlesQ = useQuery({
    queryKey: ["bundles", projectSlug, environmentSlug, "for-stacks-gate"],
    queryFn: () => listBundles(projectSlug, listOpts),
    enabled: !!projectSlug && !!environmentSlug && !needsEnvironment,
  });

  if (!projectSlug || !environmentSlug) return <p className="text-red-400">Missing project or environment</p>;
  if (envsQ.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (envsQ.isError) {
    return (
      <p className="text-red-400">
        {envsQ.error instanceof Error ? envsQ.error.message : "Failed to load environments"}
      </p>
    );
  }

  if (!needsEnvironment && bundlesQ.isLoading) {
    return <p className="text-slate-400">Loading…</p>;
  }
  if (!needsEnvironment && bundlesQ.isError) {
    return (
      <p className="text-red-400">
        {bundlesQ.error instanceof Error ? bundlesQ.error.message : "Failed to load bundles"}
      </p>
    );
  }

  const bundleCount = bundlesQ.data?.length ?? 0;
  const needsBundles = !needsEnvironment && bundleCount === 0;

  if (q.isLoading) return <p className="text-slate-400">Loading stacks…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = q.data ?? [];
  const base = projectStacksBase(projectSlug, environmentSlug);
  const envPath = projectEnvironmentsPath(projectSlug);
  const qs = searchWithoutEnv(location.search);
  const items = rows.map((row) => {
    const href = `${base}/${encodeURIComponent(row.slug)}/edit${qs}`;
    return {
      name: row.name,
      href,
      extras: [{ label: "Open", to: href }],
    };
  });

  if (needsEnvironment) {
    return (
      <div>
        <PageHeader
          title="Stacks"
          subtitle={rows.length > 0 ? `${rows.length} in this project` : undefined}
          actions={
            <Link to={`${base}/new${qs}`}>
              <Button>New stack</Button>
            </Link>
          }
        />
        <div
          className="mb-6 rounded-lg border border-amber-500/35 bg-amber-950/35 px-4 py-3 text-sm text-slate-200"
          role="status"
        >
          <strong className="text-amber-100">Environments are required first.</strong>{" "}
          <span className="text-slate-400">
            Stacks need a project environment and at least one bundle per layer. Add an environment, then create
            bundles, then stacks.
          </span>{" "}
          <Link className="font-medium text-accent underline hover:text-accent/90" to={envPath}>
            Open Environments
          </Link>
        </div>
        <ResourceList
          items={items}
          emptyMessage="No stacks in this project yet."
          emptyHint="Create a stack to merge bundle layers for exports and env URLs."
          extrasAsButtons
        />
      </div>
    );
  }

  if (needsBundles) {
    return (
      <div>
        <PageHeader
          title="Stacks"
          actions={
            <Link to={`${base}/new${qs}`}>
              <Button>New stack</Button>
            </Link>
          }
        />
        <NeedBundlesBeforeStacks projectSlug={projectSlug} environmentSlug={environmentSlug} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Stacks"
        subtitle={rows.length > 0 ? `${rows.length} in this project` : undefined}
        actions={
          <Link to={`${base}/new${qs}`}>
            <Button>New stack</Button>
          </Link>
        }
      />
      <ResourceList
        items={items}
        emptyMessage="No stacks in this project yet."
        emptyHint="Create a stack to merge bundle layers for exports and env URLs."
        extrasAsButtons
      />
    </div>
  );
}
