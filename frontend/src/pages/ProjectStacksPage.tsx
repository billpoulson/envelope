import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { listStacks } from "@/api/stacks";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";

export default function ProjectStacksPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const q = useQuery({
    queryKey: ["stacks", projectSlug],
    queryFn: () => listStacks(projectSlug),
    enabled: !!projectSlug,
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading stacks…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const names = q.data ?? [];
  const base = `/projects/${encodeURIComponent(projectSlug)}/stacks`;
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
          <h1 className="text-2xl font-semibold tracking-tight text-white">Stacks</h1>
          {names.length > 0 ? (
            <p className="mt-1 text-sm text-slate-500">{names.length} in this project</p>
          ) : null}
        </div>
        <Link to={`${base}/new`}>
          <Button>New stack</Button>
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
