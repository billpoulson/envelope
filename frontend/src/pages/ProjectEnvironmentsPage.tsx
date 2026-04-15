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
import { Link, useParams } from "react-router-dom";
import {
  createProjectEnvironment,
  deleteProjectEnvironment,
  listProjectEnvironments,
  reorderProjectEnvironments,
  updateProjectEnvironment,
  type ProjectEnvironmentRow,
} from "@/api/projectEnvironments";
import { PageHeader } from "@/components/PageHeader";
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

function SortableEnvironmentRow({
  row,
  reordering,
  removePending,
  onEdit,
  onRemove,
}: {
  row: ProjectEnvironmentRow;
  reordering: boolean;
  removePending: boolean;
  onEdit: () => void;
  onRemove: () => void;
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
      className={`flex flex-col gap-3 border-b border-border/50 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between ${
        isDragging ? "bg-white/[0.06]" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center">
        <DragHandle attributes={attributes} listeners={listeners} disabled={reordering} />
        <div className="min-w-0">
          <span className="font-medium text-slate-100">{row.name}</span>
          <span className="ml-2 font-mono text-sm text-slate-500">{row.slug}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-8 sm:pl-0">
        <Button type="button" variant="secondary" className="text-xs" onClick={onEdit}>
          Edit
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="text-xs text-red-300"
          disabled={reordering || removePending}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

export default function ProjectEnvironmentsPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug),
    enabled: !!projectSlug,
  });
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editing, setEditing] = useState<ProjectEnvironmentRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  const createM = useMutation({
    mutationFn: () =>
      createProjectEnvironment(projectSlug, {
        name: name.trim(),
        slug: slug.trim() || null,
      }),
    onSuccess: async () => {
      setErr(null);
      setName("");
      setSlug("");
      await qc.invalidateQueries({ queryKey: ["project-environments", projectSlug] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delM = useMutation({
    mutationFn: (envSlug: string) => deleteProjectEnvironment(projectSlug, envSlug),
    onSuccess: async () => {
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["project-environments", projectSlug] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const saveEditM = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("no edit");
      const nextSlug = editSlug.trim();
      return updateProjectEnvironment(projectSlug, editing.slug, {
        name: editName.trim(),
        ...(nextSlug !== editing.slug ? { slug: nextSlug } : {}),
      });
    },
    onSuccess: async () => {
      setErr(null);
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["project-environments", projectSlug] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const reorderM = useMutation({
    mutationFn: (slugs: string[]) => reorderProjectEnvironments(projectSlug, slugs),
    onSuccess: async () => {
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["project-environments", projectSlug] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
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

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = q.data ?? [];

  return (
    <div>
      <PageHeader
        title="Environments"
        below={
          <>
            <p className="mb-2 max-w-2xl text-sm text-slate-400">
              Define deployment stages for this project (for example Local, E2E, CI, Production). Use them as
              labels when organizing bundles and automation; more integrations can build on this list later.
            </p>
            <p className="mb-8">
              <Link
                className="text-accent underline hover:text-accent/90"
                to={`/projects/${encodeURIComponent(projectSlug)}/bundles`}
              >
                ← Bundles
              </Link>
            </p>
          </>
        }
      />

      {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

      <section className="mb-10 max-w-2xl rounded-xl border border-border/70 bg-[#0b0f14]/50 p-6">
        <h2 className="mb-4 text-lg font-medium text-white">Add environment</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[12rem] flex-1">
            <label className="mb-1 block text-xs text-slate-500">Display name</label>
            <input
              className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production"
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className="mb-1 block text-xs text-slate-500">Slug (optional)</label>
            <input
              className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="prod (auto if empty)"
            />
          </div>
          <Button
            type="button"
            disabled={!name.trim() || createM.isPending}
            onClick={() => createM.mutate()}
          >
            Add
          </Button>
        </div>
      </section>

      <section className="max-w-3xl">
        <h2 className="mb-3 text-lg font-medium text-white">Defined environments</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">None yet. Add one above.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-500">
              Drag the grip to reorder. You can also focus the grip and use arrow keys.
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rows.map((r) => r.slug)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="overflow-hidden rounded-xl border border-border/70 bg-[#0b0f14]/50">
                  {rows.map((row) => (
                    <SortableEnvironmentRow
                      key={row.id}
                      row={row}
                      reordering={reorderM.isPending}
                      removePending={delM.isPending}
                      onEdit={() => {
                        setEditing(row);
                        setEditName(row.name);
                        setEditSlug(row.slug);
                      }}
                      onRemove={() => {
                        if (confirm(`Remove environment “${row.name}” (${row.slug})?`)) {
                          delM.mutate(row.slug);
                        }
                      }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </>
        )}
      </section>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-medium text-white">Edit environment</h3>
            <div className="mb-3 space-y-2">
              <label className="block text-xs text-slate-500">Display name</label>
              <input
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <label className="block text-xs text-slate-500">Slug</label>
              <input
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={saveEditM.isPending || !editName.trim()}
                onClick={() => saveEditM.mutate()}
              >
                Save
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
