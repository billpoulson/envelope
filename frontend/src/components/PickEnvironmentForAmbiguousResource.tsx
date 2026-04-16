import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listProjectBundles, type ProjectBundleListRow } from "@/api/bundles";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { listProjectStacks, type ProjectStackListRow } from "@/api/stacks";
import { Button } from "@/components/ui";
import { projectBundlesBase, projectStacksBase, searchWithoutEnv } from "@/projectPaths";

function matchesSegment(row: ProjectBundleListRow | ProjectStackListRow, segment: string): boolean {
  const s = segment.trim();
  return row.name === s || row.slug === s;
}

function optionsFromRows(
  rows: (ProjectBundleListRow | ProjectStackListRow)[],
  segment: string,
): { value: string; label: string }[] {
  const matches = rows.filter((r) => matchesSegment(r, segment));
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const r of matches) {
    if (r.project_environment_slug == null) continue;
    const value = r.project_environment_slug;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: `${r.project_environment_name ?? r.project_environment_slug} (${r.project_environment_slug})`,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

type Props = {
  projectSlug: string;
  kind: "bundle" | "stack";
  /** Route param (name or slug) for this bundle/stack. */
  resourceSegment: string;
};

/**
 * Shown when the API returns 400 “multiple … share this name”. Navigates to env-in-path URLs.
 */
export function PickEnvironmentForAmbiguousResource({ projectSlug, kind, resourceSegment }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState("");

  const listQ = useQuery({
    queryKey: ["ambiguous-resource-rows", projectSlug, kind],
    queryFn: () =>
      kind === "bundle" ? listProjectBundles(projectSlug) : listProjectStacks(projectSlug),
  });

  const fallbackEnvQ = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug),
    enabled: listQ.isSuccess && optionsFromRows(listQ.data ?? [], resourceSegment).length === 0,
  });

  const options = useMemo(() => {
    const rows = listQ.data ?? [];
    const fromMatches = optionsFromRows(rows, resourceSegment);
    if (fromMatches.length > 0) return fromMatches;
    const fe = fallbackEnvQ.data ?? [];
    return fe
      .map((e) => ({
        value: e.slug,
        label: `${e.name} (${e.slug})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [listQ.data, resourceSegment, fallbackEnvQ.data]);

  const loading =
    listQ.isLoading ||
    (listQ.isSuccess &&
      optionsFromRows(listQ.data ?? [], resourceSegment).length === 0 &&
      fallbackEnvQ.isLoading);

  const title = kind === "bundle" ? "Choose environment for this bundle" : "Choose environment for this stack";

  function subpathAfterResource(): string {
    const p = location.pathname;
    if (p.includes("/sealed-secrets")) return "/sealed-secrets";
    if (p.includes("/env-links")) return "/env-links";
    return "/edit";
  }

  return (
    <div className="flex min-h-[min(70vh,32rem)] flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-md rounded-xl border border-amber-900/40 bg-amber-950/20 p-6 text-center shadow-xl">
        <h1 className="text-lg font-semibold text-amber-100">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">
          <span className="font-mono text-slate-200">{resourceSegment}</span> exists in more than one environment. Pick
          which one to load.
        </p>
        {loading ? (
          <p className="mt-6 text-sm text-slate-500">Loading environments…</p>
        ) : listQ.isError ? (
          <p className="mt-6 text-sm text-red-400">
            {listQ.error instanceof Error ? listQ.error.message : "Could not load project data"}
          </p>
        ) : (
          <>
            <label className="mt-6 block text-left text-xs text-slate-500">Environment</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                disabled={!selected}
                onClick={() => {
                  const enc = encodeURIComponent;
                  const tail = subpathAfterResource();
                  const path =
                    kind === "bundle"
                      ? `${projectBundlesBase(projectSlug, selected)}/${enc(resourceSegment)}${tail}`
                      : `${projectStacksBase(projectSlug, selected)}/${enc(resourceSegment)}${tail}`;
                  const search = searchWithoutEnv(location.search);
                  navigate({ pathname: path, search }, { replace: true });
                }}
              >
                Continue
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
