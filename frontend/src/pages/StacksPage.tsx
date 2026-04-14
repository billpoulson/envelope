import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listStacks } from "@/api/stacks";
import { ResourceList } from "@/components/ResourceList";

export default function StacksPage() {
  const q = useQuery({ queryKey: ["stacks"], queryFn: () => listStacks() });

  if (q.isLoading) return <p className="text-slate-400">Loading stacks…</p>;
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
    href: `/stacks/${encodeURIComponent(n)}/edit`,
  }));

  return (
    <div>
      <div className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Stacks</h1>
        {names.length > 0 ? (
          <p className="mt-1 text-sm text-slate-500">{names.length} total</p>
        ) : null}
      </div>
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
        Stacks are defined per project. Choose a project to create new ones, or open a stack below to
        edit layers, view the key graph, or manage env links.
      </p>
      <ResourceList
        items={items}
        emptyMessage="No stacks found."
        emptyHint={
          <>
            Open a{" "}
            <Link className="text-accent underline" to="/projects">
              project
            </Link>{" "}
            and use Stacks → New stack.
          </>
        }
      />
    </div>
  );
}
