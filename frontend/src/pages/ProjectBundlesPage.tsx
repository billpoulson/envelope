import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";

export default function ProjectBundlesPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const q = useQuery({
    queryKey: ["bundles", projectSlug],
    queryFn: () => listBundles(projectSlug),
    enabled: !!projectSlug,
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading bundles…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const names = q.data ?? [];
  const base = `/projects/${encodeURIComponent(projectSlug)}/bundles`;
  const items = names.map((n) => {
    const href = `${base}/${encodeURIComponent(n)}/edit`;
    return {
      name: n,
      href,
      extras: [{ label: "Open", to: href }],
    };
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Bundles</h1>
          {names.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">{names.length} in this project</p>
          ) : null}
        </div>
        <Link to={`${base}/new`}>
          <Button>New bundle</Button>
        </Link>
      </div>
      <ResourceList
        items={items}
        emptyMessage="No bundles in this project yet."
        emptyHint="Create a bundle to store variables for stacks and exports."
        extrasAsButtons
      />
    </div>
  );
}
