import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { createBundleEnvLink, deleteBundleEnvLink, listBundleEnvLinks } from "@/api/bundles";
import { PickEnvironmentForAmbiguousResource } from "@/components/PickEnvironmentForAmbiguousResource";
import { BundlePageShell } from "@/components/BundlePageShell";
import { Button } from "@/components/ui";
import { envLinkRowId, useEnvLinkRowHighlight } from "@/hooks/useEnvLinkRowHighlight";
import { projectBundlesBase, resourceScopeFromPath, searchWithoutEnv } from "@/projectPaths";
import { isAmbiguousBundleScopeError, resourceScopeQueryRetry } from "@/util/ambiguousScopeError";

export default function BundleEnvLinksPage() {
  const { projectSlug: projectSlugParam, environmentSlug = "", bundleName = "" } = useParams<{
    projectSlug?: string;
    environmentSlug?: string;
    bundleName: string;
  }>();
  const location = useLocation();
  const resourceScope = resourceScopeFromPath(projectSlugParam, environmentSlug);
  const qc = useQueryClient();
  const scopeReady = !!bundleName && !!projectSlugParam?.trim() && !!environmentSlug?.trim();
  const q = useQuery({
    queryKey: ["bundle-env-links", bundleName, projectSlugParam ?? "", environmentSlug ?? ""],
    queryFn: () => listBundleEnvLinks(bundleName, resourceScope),
    enabled: scopeReady,
    retry: resourceScopeQueryRetry,
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
  if (!projectSlugParam?.trim() || !environmentSlug?.trim()) {
    return <p className="text-red-400">Missing project or environment</p>;
  }
  const ps = projectSlugParam.trim();
  const es = environmentSlug.trim();
  const subnavSlug = ps;
  const editTo = `${projectBundlesBase(ps, es)}/${encodeURIComponent(bundleName)}/edit`;

  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    if (projectSlugParam && isAmbiguousBundleScopeError(q.error)) {
      return (
        <PickEnvironmentForAmbiguousResource
          projectSlug={projectSlugParam}
          kind="bundle"
          resourceSegment={bundleName}
        />
      );
    }
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  return (
    <BundlePageShell
      bundleName={bundleName}
      subnavSlug={subnavSlug}
      subnavEnvironmentSlug={es}
      linkSearch={searchWithoutEnv(location.search)}
      subtitle="Secret env URLs"
      tertiaryLink={{ to: `${editTo}${searchWithoutEnv(location.search)}`, label: "← Variables" }}
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
