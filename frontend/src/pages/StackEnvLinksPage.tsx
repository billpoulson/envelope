import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  createStackEnvLink,
  deleteStackEnvLink,
  getStack,
  listStackEnvLinks,
} from "@/api/stacks";
import { envLinkRowId, useEnvLinkRowHighlight } from "@/hooks/useEnvLinkRowHighlight";
import { StackPageShell } from "@/components/StackPageShell";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { envSearchParam, resourceScopeFromNav } from "@/projectEnv";

export default function StackEnvLinksPage() {
  const { projectSlug: projectSlugParam, stackName = "" } = useParams<{
    projectSlug?: string;
    stackName: string;
  }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const envTag = envSearchParam(searchParams.get("env")) ?? "";
  const resourceScope = resourceScopeFromNav(projectSlugParam, envTag);
  const qc = useQueryClient();
  const stackQ = useQuery({
    queryKey: ["stack", stackName, projectSlugParam ?? "", envTag ?? ""],
    queryFn: () => getStack(stackName, resourceScope),
    enabled: !!stackName,
  });
  const q = useQuery({
    queryKey: ["stack-env-links", stackName, projectSlugParam ?? "", envTag ?? ""],
    queryFn: () => listStackEnvLinks(stackName, resourceScope),
    enabled: !!stackName,
  });
  const linkRowsForHighlight = q.data ?? [];
  const { isHighlighted } = useEnvLinkRowHighlight(
    linkRowsForHighlight,
    `${stackName}|${projectSlugParam ?? ""}`,
  );
  const [err, setErr] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [lastCreatedThrough, setLastCreatedThrough] = useState<number | null>(null);
  const fullDialogRef = useRef<HTMLDialogElement>(null);
  const resultDialogRef = useRef<HTMLDialogElement>(null);

  const createM = useMutation({
    mutationFn: (throughLayerPosition: number | null) =>
      createStackEnvLink(stackName, throughLayerPosition, resourceScope),
    onSuccess: (data, throughLayerPosition) => {
      setResultUrl(data.url);
      setLastCreatedThrough(throughLayerPosition);
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["stack-env-links", stackName] });
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delM = useMutation({
    mutationFn: (id: number) => deleteStackEnvLink(stackName, id, resourceScope),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["stack-env-links", stackName] }),
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  useEffect(() => {
    if (resultUrl) resultDialogRef.current?.showModal();
  }, [resultUrl]);

  if (!stackName) return <p className="text-red-400">Missing stack</p>;
  if (stackQ.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (stackQ.isError) {
    return (
      <p className="text-red-400">{stackQ.error instanceof Error ? stackQ.error.message : "Failed"}</p>
    );
  }
  const projectSlug = projectSlugParam ?? stackQ.data?.project_slug ?? "";
  const subnavSlug = projectSlugParam ?? (projectSlug || undefined);
  const editTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/stacks/${encodeURIComponent(stackName)}/edit`
    : `/stacks/${encodeURIComponent(stackName)}/edit`;

  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const rows = linkRowsForHighlight;
  const stackLayers = stackQ.data?.layers ?? [];

  const sliceDescription = (through: number | null) => {
    if (through === null) {
      return "Full merged stack";
    }
    const layer = stackLayers[through];
    const label = layer?.label?.trim() || layer?.bundle || "?";
    const slice = rows.find((r) => r.through_layer_position === through)?.slice_label;
    return `Prefix through ${slice || label} (position ${through})`;
  };

  return (
    <StackPageShell
      stackName={stackName}
      subnavSlug={subnavSlug}
      linkSearch={location.search}
      subtitle="Secret env URLs"
      tertiaryLink={{ to: `${editTo}${location.search}`, label: "← Edit stack layers" }}
      fullBleed
    >
      <h2 className="mb-2 text-lg font-medium text-white">Secret env URL</h2>
      <p className="mb-6 text-sm leading-relaxed text-slate-400">
        Download the stack as <code className="text-slate-300">.env</code> or JSON using a random path — project and
        stack names never appear in the URL. Issue a link for the <strong className="text-slate-300">full merged</strong>{" "}
        stack or a <strong className="text-slate-300">prefix slice</strong> (merge from the bottom through a chosen
        layer). Anyone with a link can fetch variables; revoke when done.
      </p>

      {err ? <p className="mb-4 text-red-400">{err}</p> : null}

      <section className="mb-10" aria-label="Issued links">
        <h3 className="mb-2 text-base font-medium text-slate-200">Issued links</h3>
        <p className="mb-3 max-w-2xl text-xs text-slate-500">
          <span className="font-mono text-slate-400">token_sha256</span> identifies the secret path (same for full stack
          and per-layer links). Hash your saved URL’s path segment and match it here, or use{" "}
          <Link to="/tools/env-link-hash" className="text-accent hover:underline">
            Identify Secret Url
          </Link>
          .
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">None yet. Generate one below.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                id={envLinkRowId(r.id)}
                tabIndex={-1}
                className={`flex flex-col gap-2 rounded-lg border bg-[#0b0f14]/80 px-4 py-3 outline-none transition-[box-shadow,background-color] focus-visible:ring-2 focus-visible:ring-accent sm:flex-row sm:items-center sm:justify-between ${
                  isHighlighted(r.token_sha256)
                    ? "border-accent/60 ring-2 ring-accent/50 bg-accent/5"
                    : "border-border/60"
                }`}
                aria-label={isHighlighted(r.token_sha256) ? "Matched env link (from Identify Secret Url)" : undefined}
              >
                <div className="min-w-0 flex-1 text-sm text-slate-300">
                  <span className="font-mono text-slate-400">#{r.id}</span>
                  <span className="mx-2 text-slate-600">·</span>
                  {r.through_layer_position === null ? (
                    <span>Full merged stack</span>
                  ) : (
                    <span>
                      Prefix through{" "}
                      <strong className="text-slate-200">{r.slice_label || "?"}</strong>
                      <span className="text-slate-500"> (position {r.through_layer_position})</span>
                    </span>
                  )}
                  <span className="mx-2 text-slate-600">·</span>
                  <span className="text-slate-500">created {r.created_at}</span>
                  <div className="mt-1 font-mono text-xs text-slate-400 break-all" title={r.token_sha256}>
                    {r.token_sha256}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-left text-sm text-red-400 underline hover:text-red-300"
                  onClick={() => {
                    if (
                      confirm(
                        "Revoke this URL? Clients using it will get 404.",
                      )
                    ) {
                      delM.mutate(r.id);
                    }
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {stackLayers.length > 0 ? (
        <section className="mb-10" aria-label="Prefix slice URLs">
          <h3 className="mb-2 text-base font-medium text-slate-200">Prefix slice (per layer)</h3>
          <p className="mb-4 text-sm text-slate-500">
            Each link merges from the bottom of the stack through the selected layer (same overwrite rules as the full
            stack, but layers above are omitted).
          </p>
          <ul className="space-y-2">
            {stackLayers.map((layer, position) => (
              <li
                key={position}
                className="flex flex-col gap-3 rounded-lg border border-border/60 bg-[#0b0f14]/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm text-slate-300">
                  Through <strong className="text-white">{layer.bundle}</strong>
                  {layer.label ? (
                    <span className="text-slate-500"> — {layer.label}</span>
                  ) : null}
                  <span className="text-slate-500"> (position {position})</span>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  disabled={createM.isPending}
                  onClick={() => createM.mutate(position)}
                >
                  Generate secret URL
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mb-8 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={createM.isPending}
          onClick={() => fullDialogRef.current?.showModal()}
        >
          Generate full-stack URL
        </Button>
      </div>

      <dialog
        ref={fullDialogRef}
        className="max-w-lg rounded-xl border border-border bg-[#121820] p-0 text-slate-200 shadow-2xl backdrop:bg-black/60"
      >
        <div className="p-6">
          <h2 className="mb-2 text-lg font-medium text-white">Generate full-stack URL</h2>
          <p className="mb-4 text-sm text-slate-400">
            Creates a new random path under <code className="text-slate-300">/env/…</code>. Anyone with the link can
            download the <strong className="text-slate-300">fully merged</strong> stack as <code>.env</code> or JSON.
            Revoke unused links when finished.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={createM.isPending}
              onClick={() => {
                fullDialogRef.current?.close();
                createM.mutate(null);
              }}
            >
              {createM.isPending ? "Generating…" : "Generate URL"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => fullDialogRef.current?.close()}
            >
              Cancel
            </Button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={resultDialogRef}
        className="max-w-lg rounded-xl border border-border bg-[#121820] p-0 text-slate-200 shadow-2xl backdrop:bg-black/60"
        onClose={() => setResultUrl(null)}
      >
        <div className="p-6">
          <h2 className="mb-2 text-lg font-medium text-white">New secret URL</h2>
          <p className="mb-2 text-sm text-amber-200/90">
            Copy now — this path is not stored and cannot be shown again.
          </p>
          {resultUrl ? (
            <p className="mb-4 break-all font-mono text-sm text-accent">
              <a href={resultUrl} className="underline hover:text-accent/90">
                {resultUrl}
              </a>
            </p>
          ) : null}
          <p className="mb-4 text-xs text-slate-500">
            Append <code className="text-slate-400">?format=json</code> for JSON. Rate-limited.
          </p>
          <p className="mb-4 text-xs text-slate-500">{sliceDescription(lastCreatedThrough)}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!resultUrl}
              onClick={() => {
                if (resultUrl) void navigator.clipboard.writeText(resultUrl);
              }}
            >
              Copy URL
            </Button>
            <Button
              type="button"
              onClick={() => {
                resultDialogRef.current?.close();
                setResultUrl(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </dialog>
    </StackPageShell>
  );
}
