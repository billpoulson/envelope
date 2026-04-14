import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createBundleEnvLink,
  deleteBundleEnvLink,
  getBundle,
  listBundleEnvLinks,
} from "@/api/bundles";
import { BundleSubnav } from "@/components/BundleSubnav";
import { Button } from "@/components/ui";

export default function BundleEnvLinksPage() {
  const { projectSlug: projectSlugParam, bundleName = "" } = useParams<{
    projectSlug?: string;
    bundleName: string;
  }>();
  const qc = useQueryClient();
  const bq = useQuery({
    queryKey: ["bundle", bundleName],
    queryFn: () => getBundle(bundleName),
    enabled: !!bundleName && !projectSlugParam,
  });
  const q = useQuery({
    queryKey: ["bundle-env-links", bundleName],
    queryFn: () => listBundleEnvLinks(bundleName),
    enabled: !!bundleName,
  });
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: () => createBundleEnvLink(bundleName),
    onSuccess: (data) => {
      setLastUrl(data.url);
      void qc.invalidateQueries({ queryKey: ["bundle-env-links", bundleName] });
      setErr(null);
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const delM = useMutation({
    mutationFn: (id: number) => deleteBundleEnvLink(bundleName, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bundle-env-links", bundleName] }),
  });

  if (!bundleName) return <p className="text-red-400">Missing bundle</p>;
  if (!projectSlugParam && bq.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (!projectSlugParam && bq.isError) {
    return (
      <p className="text-red-400">{bq.error instanceof Error ? bq.error.message : "Failed"}</p>
    );
  }
  const projectSlug = projectSlugParam ?? bq.data?.project_slug ?? "";
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const editTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/bundles/${encodeURIComponent(bundleName)}/edit`
    : `/bundles/${encodeURIComponent(bundleName)}/edit`;

  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = q.data ?? [];

  return (
    <div>
      <h1 className="mb-2 font-mono text-2xl font-semibold text-white">{bundleName}</h1>
      <BundleSubnav projectSlug={subnavSlug} bundleName={bundleName} />
      <p className="mb-4 text-slate-400">
        <Link to={editTo}>← Variables</Link>
      </p>
      {err ? <p className="mb-4 text-red-400">{err}</p> : null}
      {lastUrl ? (
        <div className="mb-6 rounded-lg border border-accent/40 bg-accent/10 p-4">
          <p className="mb-2 text-sm text-slate-300">Save this URL now (shown once):</p>
          <code className="break-all text-sm text-white">{lastUrl}</code>
        </div>
      ) : null}
      <Button type="button" disabled={createM.isPending} onClick={() => createM.mutate()}>
        {createM.isPending ? "Generating…" : "Generate new secret URL"}
      </Button>
      <h2 className="mt-8 mb-2 text-lg text-white">Existing links</h2>
      {rows.length === 0 ? (
        <p className="text-slate-400">None yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
            >
              <span className="text-slate-400">#{r.id}</span>
              <span className="text-xs text-slate-500">{r.created_at}</span>
              <button
                type="button"
                className="text-sm text-red-400 underline"
                onClick={() => {
                  if (confirm("Revoke this link?")) delM.mutate(r.id);
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
