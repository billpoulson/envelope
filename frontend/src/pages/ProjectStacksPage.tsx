import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { listProjectStacks } from "@/api/stacks";
import { NeedBundlesBeforeStacks } from "@/components/NeedBundlesBeforeStacks";
import { envSearchParam, environmentChipLabel, environmentListApiOpts } from "@/projectEnv";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";

export default function ProjectStacksPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const [searchParams] = useSearchParams();
  const envTag = envSearchParam(searchParams.get("env")) ?? "";
  const listOpts = environmentListApiOpts(envTag);
  const q = useQuery({
    queryKey: ["stacks", projectSlug, envTag, "with-env"],
    queryFn: () => listProjectStacks(projectSlug, listOpts),
    enabled: !!projectSlug,
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
    queryKey: ["bundles", projectSlug, "project-all"],
    queryFn: () => listBundles(projectSlug),
    enabled: !!projectSlug && !needsEnvironment,
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
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
  const base = `/projects/${encodeURIComponent(projectSlug)}/stacks`;
  const envPath = `/projects/${encodeURIComponent(projectSlug)}/environments`;
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const items = rows.map((row) => {
    const href = `${base}/${encodeURIComponent(row.slug)}/edit${qs}`;
    return {
      name: row.name,
      href,
      environmentLabel: environmentChipLabel(row),
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
        <NeedBundlesBeforeStacks projectSlug={projectSlug} envSearch={envTag} />
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
