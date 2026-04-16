import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { listProjectBundles, reorderProjectBundles, type ProjectBundleListRow } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { environmentListApiOpts } from "@/projectEnv";
import { projectBundlesBase, projectEnvironmentsPath, searchWithoutEnv } from "@/projectPaths";
import { PageHeader } from "@/components/PageHeader";
import { ResourceList } from "@/components/ResourceList";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

function DragHandle({
  attributes,
  listeners,
  disabled,
}: {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown> | undefined;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="touch-none rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
      aria-label="Drag to reorder"
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <circle cx="5" cy="4" r="1.5" />
        <circle cx="11" cy="4" r="1.5" />
        <circle cx="5" cy="8" r="1.5" />
        <circle cx="11" cy="8" r="1.5" />
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="11" cy="12" r="1.5" />
      </svg>
    </button>
  );
}

function SortableBundleRow({
  row,
  href,
  openHref,
  reordering,
}: {
  row: ProjectBundleListRow;
  href: string;
  openHref: string;
  reordering: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.slug,
    disabled: reordering,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`border-b border-border/45 last:border-0 ${isDragging ? "bg-white/[0.06]" : ""}`}
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:max-w-[min(100%,42rem)]">
          <DragHandle attributes={attributes} listeners={listeners} disabled={reordering} />
          <Link to={href} className="group flex min-w-0 items-baseline gap-2">
            <span className="truncate font-mono text-sm font-medium tracking-tight text-slate-100 transition group-hover:text-white">
              {row.name}
            </span>
            <span
              className="shrink-0 text-xs text-slate-600 opacity-0 transition group-hover:text-accent group-hover:opacity-100"
              aria-hidden="true"
            >
              →
            </span>
          </Link>
        </div>
        <nav
          className="flex flex-wrap items-center gap-2 border-t border-border/35 pt-3 sm:border-0 sm:pt-0"
          aria-label={`Shortcuts for ${row.name}`}
        >
          <Link
            to={openHref}
            className="inline-flex items-center justify-center rounded-lg border border-border/80 bg-[#141a22] px-3 py-1.5 text-xs font-medium text-slate-200 shadow-sm transition hover:border-border hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 whitespace-nowrap"
            aria-label={`Open ${row.name}`}
          >
            Open
          </Link>
        </nav>
      </div>
    </li>
  );
}

export default function ProjectBundlesPage() {
  const { projectSlug = "", environmentSlug = "" } = useParams<{
    projectSlug: string;
    environmentSlug: string;
  }>();
  const location = useLocation();
  const qc = useQueryClient();
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
  const [sortErr, setSortErr] = useState<string | null>(null);

  const reorderM = useMutation({
    mutationFn: (slugs: string[]) => reorderProjectBundles(projectSlug, environmentSlug, slugs),
    onSuccess: async () => {
      setSortErr(null);
      await qc.invalidateQueries({ queryKey: ["bundles", projectSlug, environmentSlug, "with-env"] });
    },
    onError: (e: unknown) => setSortErr(formatApiError(e)),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const list = q.data ?? [];
    if (!over || active.id === over.id || list.length < 2) return;
    const oldIndex = list.findIndex((r) => r.slug === String(active.id));
    const newIndex = list.findIndex((r) => r.slug === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(list, oldIndex, newIndex);
    reorderM.mutate(next.map((r) => r.slug));
  }

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

  const sortable = !needsEnvironment && rows.length > 0;

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

      {sortErr ? <p className="mb-4 text-sm text-red-400">{sortErr}</p> : null}

      {sortable ? (
        <>
          <p className="mb-2 text-xs text-slate-500">
            Drag the grip to reorder. Order is saved for this environment.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={rows.map((r) => r.slug)} strategy={verticalListSortingStrategy}>
              <ul className="overflow-hidden rounded-xl border border-border/70 bg-gradient-to-b from-[#0f161d]/90 to-[#0b0f14]/95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                {rows.map((row) => {
                  const href = `${base}/${encodeURIComponent(row.slug)}/edit${qs}`;
                  return (
                    <SortableBundleRow
                      key={row.slug}
                      row={row}
                      href={href}
                      openHref={href}
                      reordering={reorderM.isPending}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      ) : (
        <ResourceList
          items={items}
          emptyMessage="No bundles in this project yet."
          emptyHint="Create a bundle to store variables for stacks and exports."
          extrasAsButtons
        />
      )}
    </div>
  );
}
