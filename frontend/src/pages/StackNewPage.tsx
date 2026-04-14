import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { listBundles } from "@/api/bundles";
import { createStack, type StackLayer } from "@/api/stacks";
import { Button } from "@/components/ui";

export default function StackNewPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [bundle, setBundle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const bundlesQ = useQuery({
    queryKey: ["bundles", projectSlug],
    queryFn: () => listBundles(projectSlug),
    enabled: !!projectSlug,
  });
  const bundleNames = useMemo(() => {
    const raw = bundlesQ.data ?? [];
    return [...raw].sort((a, b) => a.localeCompare(b));
  }, [bundlesQ.data]);

  const m = useMutation({
    mutationFn: () =>
      createStack({
        name: name.trim(),
        project_slug: projectSlug,
        layers: [{ bundle: bundle.trim(), keys: "*" } satisfies StackLayer],
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["stacks"] });
      navigate(
        `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(name.trim())}/edit`,
      );
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  if (!projectSlug) return <p className="text-red-400">Missing project</p>;

  const bundlesLoading = bundlesQ.isLoading;
  const bundlesError =
    bundlesQ.isError && bundlesQ.error instanceof Error ? bundlesQ.error.message : null;
  const canPickBundle = !bundlesLoading && !bundlesError && bundleNames.length > 0;
  const newBundleHref = `/projects/${encodeURIComponent(projectSlug)}/bundles/new`;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold text-white">New stack</h1>
      <p className="mb-4 text-sm text-slate-400">
        Start with one layer (bottom) from a bundle in this project. You can add layers and key picks on
        the edit page.
      </p>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label className="mb-1 block text-sm text-slate-400">Stack name</label>
          <input
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            Spaces and punctuation are fine. Not allowed:{" "}
            <span className="font-mono">/ \ : * ? &quot; &lt; &gt; |</span>
          </p>
        </div>
        <div>
          <label htmlFor="stack-bottom-bundle" className="mb-1 block text-sm text-slate-400">
            Bottom bundle
          </label>
          {bundlesLoading ? (
            <p className="text-sm text-slate-500">Loading bundles…</p>
          ) : bundlesError ? (
            <p className="text-sm text-red-400">{bundlesError}</p>
          ) : bundleNames.length === 0 ? (
            <p className="text-sm text-slate-400">
              No bundles in this project yet.{" "}
              <Link to={newBundleHref} className="text-accent underline hover:text-accent/90">
                Create a bundle
              </Link>{" "}
              first.
            </p>
          ) : (
            <select
              id="stack-bottom-bundle"
              className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
              value={bundle}
              onChange={(e) => setBundle(e.target.value)}
              required
            >
              <option value="">Select a bundle…</option>
              {bundleNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </div>
        {err ? <p className="text-sm text-red-400">{err}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={m.isPending || !canPickBundle || !bundle.trim()}>
            Create
          </Button>
          <Link to={`/projects/${encodeURIComponent(projectSlug)}/stacks`}>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
