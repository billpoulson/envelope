import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  createBundleEnvLink,
  deleteBundleEnvLink,
  getBundle,
  listBundleEnvLinks,
} from "@/api/bundles";
import { BundlePageShell } from "@/components/BundlePageShell";
import { Button } from "@/components/ui";
import { envLinkRowId, useEnvLinkRowHighlight } from "@/hooks/useEnvLinkRowHighlight";
import { envSearchParam, resourceScopeFromNav } from "@/projectEnv";

export default function BundleEnvLinksPage() {
  const { projectSlug: projectSlugParam, bundleName = "" } = useParams<{
    projectSlug?: string;
    bundleName: string;
  }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const envTag = envSearchParam(searchParams.get("env")) ?? "";
  const resourceScope = resourceScopeFromNav(projectSlugParam, envTag);
  const qc = useQueryClient();
  const bq = useQuery({
    queryKey: ["bundle", bundleName, projectSlugParam ?? "", envTag ?? ""],
    queryFn: () => getBundle(bundleName, resourceScope),
    enabled: !!bundleName && !projectSlugParam,
  });
  const q = useQuery({
    queryKey: ["bundle-env-links", bundleName, projectSlugParam ?? "", envTag ?? ""],
    queryFn: () => listBundleEnvLinks(bundleName, resourceScope),
    enabled: !!bundleName,
  });
  const rows = q.data ?? [];
  const { isHighlighted } = useEnvLinkRowHighlight(
    rows,
    `${bundleName}|${projectSlugParam ?? ""}`,
  );
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: () => createBundleEnvLink(bundleName, resourceScope),
    onSuccess: (data) => {
      setLastUrl(data.url);
      void qc.invalidateQueries({ queryKey: ["bundle-env-links", bundleName] });
      setErr(null);
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const delM = useMutation({
    mutationFn: (id: number) => deleteBundleEnvLink(bundleName, id, resourceScope),
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

  return (
    <BundlePageShell
      bundleName={bundleName}
      subnavSlug={subnavSlug}
      linkSearch={location.search}
      subtitle="Secret env URLs"
      tertiaryLink={{ to: `${editTo}${location.search}`, label: "← Variables" }}
    >
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
      <p className="mb-3 max-w-2xl text-xs text-slate-500">
        Each row shows <span className="font-mono text-slate-400">token_sha256</span> (SHA-256 hex of the secret path
        segment). Hash the token from your saved URL and match this value to know which link to revoke, or use{" "}
        <Link to="/tools/env-link-hash" className="text-accent hover:underline">
          Identify Secret Url
        </Link>
        .
      </p>
      {rows.length === 0 ? (
        <p className="text-slate-400">None yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              id={envLinkRowId(r.id)}
              tabIndex={-1}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 outline-none transition-[box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-accent ${
                isHighlighted(r.token_sha256)
                  ? "border-accent/60 bg-accent/10 ring-2 ring-accent/50"
                  : "border-border/60"
              }`}
              aria-label={isHighlighted(r.token_sha256) ? "Matched env link (from Identify Secret Url)" : undefined}
            >
              <span className="text-slate-400">#{r.id}</span>
              <code
                className="max-w-[min(100%,28rem)] truncate text-xs text-slate-300"
                title={r.token_sha256}
              >
                {r.token_sha256}
              </code>
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
    </BundlePageShell>
  );
}
