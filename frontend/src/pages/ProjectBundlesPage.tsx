import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { listProjectBundles } from "@/api/bundles";
import { envSearchParam, environmentChipLabel, environmentListApiOpts } from "@/projectEnv";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";

export default function ProjectBundlesPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const [searchParams] = useSearchParams();
  const envTag = envSearchParam(searchParams.get("env")) ?? "";
  const listOpts = environmentListApiOpts(envTag);
  const q = useQuery({
    queryKey: ["bundles", projectSlug, envTag, "with-env"],
    queryFn: () => listProjectBundles(projectSlug, listOpts),
    enabled: !!projectSlug,
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading bundles…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = q.data ?? [];
  const base = `/projects/${encodeURIComponent(projectSlug)}/bundles`;
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const items = rows.map((row) => {
    const href = `${base}/${encodeURIComponent(row.name)}/edit${qs}`;
    return {
      name: row.name,
      href,
      environmentLabel: environmentChipLabel(row),
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
      <ResourceList
        items={items}
        emptyMessage="No bundles in this project yet."
        emptyHint="Create a bundle to store variables for stacks and exports."
        extrasAsButtons
      />
    </div>
  );
}
