import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";

export default function BundlesPage() {
  const q = useQuery({ queryKey: ["bundles"], queryFn: () => listBundles() });

  if (q.isLoading) return <p className="text-slate-400">Loading bundles…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">
        {q.error instanceof Error ? q.error.message : "Failed to load"}
      </p>
    );
  }

  const names = q.data ?? [];
  const items = names.map((n) => ({
    name: n,
    href: `/bundles/${encodeURIComponent(n)}/edit`,
  }));

  return (
    <div>
      <PageHeader
        title="Bundles"
        subtitle={names.length > 0 ? `${names.length} total` : undefined}
      />
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
        Bundles belong to a project. Open a project to create new ones, or jump to a bundle below
        (including bundles without a project group).
      </p>
      <ResourceList
        items={items}
        emptyMessage="No bundles found."
        emptyHint={
          <>
            Go to{" "}
            <Link className="text-accent underline" to="/projects">
              Projects
            </Link>{" "}
            and open a project to add a bundle.
          </>
        }
      />
    </div>
  );
}
