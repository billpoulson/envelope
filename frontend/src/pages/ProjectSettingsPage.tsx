import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteProject, listProjects, patchProject } from "@/api/projects";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

export default function ProjectSettingsPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const q = useQuery({ queryKey: ["projects"], queryFn: listProjects });
  const project = q.data?.find((p) => p.slug === projectSlug);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setSlug(project.slug);
  }, [project?.id, project?.name, project?.slug]);

  const saveM = useMutation({
    mutationFn: () =>
      patchProject(projectSlug, {
        name: name.trim(),
        slug: slug.trim(),
      }),
    onSuccess: async (data) => {
      setErr(null);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      if (data.slug !== projectSlug) {
        navigate(`/projects/${encodeURIComponent(data.slug)}/settings`, { replace: true });
      }
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delM = useMutation({
    mutationFn: () => deleteProject(projectSlug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      setErr(null);
      navigate("/projects", { replace: true });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }
  if (!project) {
    return <p className="text-red-400">Project not found.</p>;
  }

  const bundlesPath = `/projects/${encodeURIComponent(projectSlug)}/bundles`;
  const dirty =
    name.trim() !== project.name || slug.trim() !== project.slug;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-white">Project settings</h1>
      <p className="mb-6 font-mono text-lg text-slate-300">{project.name}</p>
      <p className="mb-8">
        <Link className="text-accent underline hover:text-accent/90" to={bundlesPath}>
          ← Bundles
        </Link>
      </p>

      {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

      <section className="mb-10 max-w-xl rounded-xl border border-border/70 bg-[#0b0f14]/50 p-6">
        <h2 className="mb-4 text-lg font-medium text-white">Project details</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="project-name">
              Name
            </label>
            <input
              id="project-name"
              className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="project-slug">
              Slug
            </label>
            <input
              id="project-slug"
              className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used in URLs (lowercase letters, numbers, <code className="text-slate-400">.</code>,{" "}
              <code className="text-slate-400">_</code>, <code className="text-slate-400">-</code>
              ). Changing it updates project links.
            </p>
          </div>
        </div>
        <div className="mt-6">
          <Button
            type="button"
            disabled={!dirty || saveM.isPending || !name.trim() || !slug.trim()}
            onClick={() => saveM.mutate()}
          >
            {saveM.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          {project.bundle_count} bundle{project.bundle_count === 1 ? "" : "s"} in this project.
        </p>
      </section>

      <section className="border-t border-border/60 pt-8">
        <h2 className="mb-2 text-lg font-medium text-red-300">Danger zone</h2>
        <p className="mb-4 max-w-xl text-sm text-slate-400">
          Delete this project and all bundles and stacks that belong to it. This cannot be undone.
        </p>
        <p className="mb-2 text-sm text-slate-500">
          Type the project slug <span className="font-mono text-slate-300">{project.slug}</span> to
          confirm.
        </p>
        <input
          className="mb-4 w-full max-w-xs rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={project.slug}
          autoComplete="off"
          aria-label="Confirm project slug"
        />
        <div>
          <Button
            type="button"
            variant="secondary"
            className="border-red-900/80 text-red-300 hover:bg-red-950/30"
            disabled={deleteConfirm !== project.slug || delM.isPending}
            onClick={() => {
              if (
                confirm(
                  `Delete project "${project.name}" and all associated data? This cannot be undone.`,
                )
              ) {
                delM.mutate();
              }
            }}
          >
            {delM.isPending ? "Deleting…" : "Delete project"}
          </Button>
        </div>
      </section>
    </div>
  );
}
