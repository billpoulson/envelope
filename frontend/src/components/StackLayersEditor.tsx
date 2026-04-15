import { useCallback, useEffect, useMemo, useState } from "react";
import { listBundleKeyNames } from "@/api/bundles";
import type { StackLayer } from "@/api/stacks";
import { Button } from "@/components/ui";

export type LayerEditorState = {
  bundle: string;
  mode: "all" | "pick";
  selected: string[];
  label: string;
  /** Pairs for API `aliases` (export name <- source from lower layers). */
  aliasRows: { target: string; source: string }[];
};

function stackLayerToEditor(l: StackLayer): LayerEditorState {
  const label = typeof l.label === "string" ? l.label : "";
  const aliasRows: { target: string; source: string }[] = [];
  if (l.aliases && typeof l.aliases === "object") {
    for (const [target, source] of Object.entries(l.aliases)) {
      aliasRows.push({ target, source: String(source) });
    }
    aliasRows.sort((a, b) => a.target.localeCompare(b.target));
  }
  if (l.keys === "*") {
    return { bundle: l.bundle, mode: "all", selected: [], label, aliasRows };
  }
  if (Array.isArray(l.keys)) {
    return { bundle: l.bundle, mode: "pick", selected: [...l.keys], label, aliasRows };
  }
  return { bundle: l.bundle, mode: "all", selected: [], label, aliasRows };
}

export function editorToStackLayer(l: LayerEditorState): StackLayer {
  const label = l.label.trim() ? l.label.trim() : undefined;
  const aliases: Record<string, string> = {};
  for (const row of l.aliasRows) {
    const t = row.target.trim();
    const s = row.source.trim();
    if (t && s) aliases[t] = s;
  }
  const aliasOpt = Object.keys(aliases).length ? { aliases } : {};
  if (l.mode === "all") {
    return { bundle: l.bundle.trim(), keys: "*", ...aliasOpt, ...(label ? { label } : {}) };
  }
  return {
    bundle: l.bundle.trim(),
    keys: l.selected,
    ...aliasOpt,
    ...(label ? { label } : {}),
  };
}

/** Export names from key aliases on layers strictly below ``belowIndex`` (synthetic keys forwarded upward). */
function forwardedAliasExportNames(layers: LayerEditorState[], belowIndex: number): string[] {
  const out = new Set<string>();
  for (let j = 0; j < belowIndex; j++) {
    for (const row of layers[j]?.aliasRows ?? []) {
      const t = row.target.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

async function unionForwardedKeyNames(
  layers: LayerEditorState[],
  belowIndex: number,
): Promise<string[]> {
  const out = new Set<string>();
  for (let j = 0; j < belowIndex; j++) {
    const L = layers[j];
    const bn = L.bundle.trim();
    if (!bn) continue;
    if (L.mode === "all") {
      const keys = await listBundleKeyNames(bn);
      keys.forEach((k) => {
        const s = k.trim();
        if (s) out.add(s);
      });
    } else {
      L.selected.forEach((k) => {
        const s = k.trim();
        if (s) out.add(s);
      });
    }
  }
  for (const t of forwardedAliasExportNames(layers, belowIndex)) {
    out.add(t);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Bundles not used on other layers; always includes this row's current bundle if set. */
function bundleNamesForLayerSelect(
  allNames: string[],
  layers: LayerEditorState[],
  layerIndex: number,
): string[] {
  const current = layers[layerIndex]?.bundle.trim() ?? "";
  const usedElsewhere = new Set<string>();
  for (let j = 0; j < layers.length; j++) {
    if (j === layerIndex) continue;
    const b = layers[j]?.bundle.trim() ?? "";
    if (b) usedElsewhere.add(b);
  }
  let out = allNames.filter((n) => !usedElsewhere.has(n) || n === current);
  if (current && !out.includes(current)) {
    out = [...out, current];
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function loadPickKeyData(
  layers: LayerEditorState[],
  index: number,
): Promise<{ keys: string[]; native: Set<string> }> {
  const L = layers[index];
  const bn = L.bundle.trim();
  if (!bn) return { keys: [], native: new Set() };
  const nativeArr = await listBundleKeyNames(bn);
  const native = new Set(nativeArr.map((k) => k.trim()).filter(Boolean));
  if (index === 0) {
    const keys = [...native].sort((a, b) => a.localeCompare(b));
    return { keys, native };
  }
  const forwarded = await unionForwardedKeyNames(layers, index);
  const seen = new Set<string>();
  const combined: string[] = [];
  const add = (k: string) => {
    const s = k.trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    combined.push(s);
  };
  forwarded.forEach(add);
  nativeArr.forEach((k) => add(k));
  combined.sort((a, b) => a.localeCompare(b));
  return { keys: combined, native };
}

type Props = {
  bundleNames: string[];
  layers: LayerEditorState[];
  onChange: (next: LayerEditorState[]) => void;
};

export function StackLayersEditor({ bundleNames, layers, onChange }: Props) {
  const [keyData, setKeyData] = useState<
    Record<number, { keys: string[]; native: Set<string> } | "loading" | "error">
  >({});
  const [filter, setFilter] = useState<Record<number, string>>({});

  const layersKey = useMemo(() => JSON.stringify(layers), [layers]);

  useEffect(() => {
    let cancelled = false;
    const parsed = JSON.parse(layersKey) as LayerEditorState[];
    (async () => {
      const updates: Record<number, { keys: string[]; native: Set<string> } | "error"> = {};
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].mode !== "pick" || !parsed[i].bundle.trim()) continue;
        try {
          const data = await loadPickKeyData(parsed, i);
          if (cancelled) return;
          updates[i] = data;
        } catch {
          if (cancelled) return;
          updates[i] = "error";
        }
      }
      if (cancelled) return;
      setKeyData((prev) => {
        const next: typeof prev = { ...prev };
        for (const k of Object.keys(next)) {
          const idx = Number(k);
          if (Number.isNaN(idx) || idx >= parsed.length) {
            delete next[idx];
            continue;
          }
          if (parsed[idx].mode !== "pick" || !parsed[idx].bundle.trim()) delete next[idx];
        }
        Object.assign(next, updates);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [layersKey]);

  const updateLayer = useCallback(
    (index: number, patch: Partial<LayerEditorState>) => {
      onChange(layers.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    },
    [layers, onChange],
  );

  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= layers.length) return;
    const copy = layers.slice();
    const t = copy[index]!;
    copy[index] = copy[j]!;
    copy[j] = t;
    onChange(copy);
  };

  const addLayer = () => {
    onChange([
      ...layers,
      { bundle: "", mode: "all", selected: [], label: "", aliasRows: [] },
    ]);
  };

  const removeLayer = (index: number) => {
    if (layers.length <= 1) return;
    onChange(layers.filter((_, i) => i !== index));
  };

  const opts = bundleNames.length ? bundleNames : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Choose a bundle per layer, then <strong className="text-slate-300">all keys</strong> or{" "}
        <strong className="text-slate-300">selected keys</strong>. Bottom layer first; top layer wins on
        duplicates. Each list only shows bundles not already used on another layer in this stack.
      </p>
      {layers.map((layer, index) => {
        const rowBundleOpts = bundleNamesForLayerSelect(opts, layers, index);
        const badge =
          (layer.label || "").trim() ||
          `Layer ${index + 1}`;
        const kd = keyData[index];
        const pickKeys =
          kd && kd !== "loading" && kd !== "error" ? kd.keys : [];
        const native =
          kd && kd !== "loading" && kd !== "error" ? kd.native : new Set<string>();

        return (
          <div
            key={index}
            className="rounded-xl border border-border/70 bg-[#0b0f14]/90 p-4 shadow-sm"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-sm text-white">
                  {badge}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  {index === 0
                    ? "Bottom"
                    : index === layers.length - 1
                      ? "Top — wins on duplicate keys"
                      : "Middle"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {index > 0 ? (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10"
                    title="Move up"
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                ) : null}
                {index < layers.length - 1 ? (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10"
                    title="Move down"
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded border border-red-900/50 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-40"
                  disabled={layers.length <= 1}
                  title={layers.length <= 1 ? "A stack needs at least one layer" : "Remove layer"}
                  onClick={() => removeLayer(index)}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs text-slate-500">Layer name (optional)</label>
              <input
                className="w-full max-w-lg rounded border border-border bg-[#121820] px-3 py-2 text-sm"
                value={layer.label}
                onChange={(e) => updateLayer(index, { label: e.target.value })}
                placeholder="Shown in the UI; underlying bundle is unchanged"
              />
            </div>

            <div className="mb-3">
              <label className="mb-1 block text-xs text-slate-500">Bundle</label>
              <select
                className="w-full max-w-lg rounded border border-border bg-[#121820] px-3 py-2 font-mono text-sm"
                value={layer.bundle}
                onChange={(e) =>
                  updateLayer(index, {
                    bundle: e.target.value,
                    selected: [],
                  })
                }
              >
                <option value="">
                  {!opts.length
                    ? "No bundles in this project"
                    : rowBundleOpts.length || layer.bundle.trim()
                      ? "Select a bundle…"
                      : "No unused bundles — remove or change a layer first"}
                </option>
                {rowBundleOpts.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-500">Variables</div>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`mode-${index}`}
                    checked={layer.mode === "all"}
                    onChange={() => {
                      updateLayer(index, { mode: "all" });
                    }}
                  />
                  All keys
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`mode-${index}`}
                    checked={layer.mode === "pick"}
                    onChange={() => updateLayer(index, { mode: "pick" })}
                  />
                  Selected only
                </label>
              </div>

              {layer.mode === "pick" ? (
                <div className="mt-2 rounded-lg border border-border/50 bg-[#121820]/80 p-3">
                  {index > 0 ? (
                    <p className="mb-2 text-xs text-slate-500">
                      Includes names from this bundle and from lower layers. The list updates when you change
                      bundles, scope, or selections below.
                    </p>
                  ) : null}
                  {kd === "loading" ? (
                    <p className="text-sm text-slate-500">Loading variable names…</p>
                  ) : kd === "error" ? (
                    <p className="text-sm text-red-400">Could not load variable names.</p>
                  ) : !layer.bundle.trim() ? (
                    <p className="text-sm text-amber-200/90">Choose a bundle first.</p>
                  ) : pickKeys.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      {index > 0
                        ? "No variable names from this bundle or lower layers."
                        : "No variables in this bundle yet."}
                    </p>
                  ) : (
                    <>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-slate-500">
                          {pickKeys.length} variable{pickKeys.length === 1 ? "" : "s"}
                        </span>
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            className="text-accent underline"
                            onClick={() => {
                              updateLayer(index, { selected: [...pickKeys] });
                            }}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            className="text-accent underline"
                            onClick={() => updateLayer(index, { selected: [] })}
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <input
                        type="search"
                        className="mb-2 w-full rounded border border-border bg-[#0b0f14] px-2 py-1 font-mono text-xs"
                        placeholder="Filter by name…"
                        value={filter[index] ?? ""}
                        onChange={(e) =>
                          setFilter((f) => ({ ...f, [index]: e.target.value }))
                        }
                      />
                      <div className="max-h-48 overflow-y-auto rounded border border-border/40 p-2">
                        {pickKeys.map((kn) => {
                          const q = (filter[index] ?? "").trim().toLowerCase();
                          if (q && !kn.toLowerCase().includes(q)) return null;
                          const isFwd = !native.has(kn);
                          const checked = layer.selected.includes(kn);
                          return (
                            <label
                              key={kn}
                              className={`flex cursor-pointer items-center gap-2 border-b border-border/20 py-1 font-mono text-xs last:border-0 ${isFwd ? "text-slate-500" : "text-slate-200"}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  const next = on
                                    ? [...layer.selected, kn]
                                    : layer.selected.filter((k) => k !== kn);
                                  updateLayer(index, { selected: next });
                                }}
                              />
                              <span>{kn}</span>
                              {isFwd ? (
                                <span className="rounded bg-white/5 px-1 text-[10px] text-slate-500">
                                  from lower layer(s)
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {index > 0 ? (
              <LayerAliasesBlock
                layerIndex={index}
                layers={layers}
                aliasRows={layer.aliasRows ?? []}
                updateLayer={updateLayer}
              />
            ) : null}
          </div>
        );
      })}

      <Button type="button" variant="secondary" onClick={addLayer}>
        Add layer
      </Button>
    </div>
  );
}

export function stackLayersFromApi(layers: StackLayer[]): LayerEditorState[] {
  if (!layers.length) {
    return [{ bundle: "", mode: "all", selected: [], label: "", aliasRows: [] }];
  }
  return layers.map(stackLayerToEditor);
}

type AliasBlockProps = {
  layerIndex: number;
  layers: LayerEditorState[];
  aliasRows: { target: string; source: string }[];
  updateLayer: (index: number, patch: Partial<LayerEditorState>) => void;
};

function LayerAliasesBlock({ layerIndex, layers, aliasRows, updateLayer }: AliasBlockProps) {
  const [sourceOptions, setSourceOptions] = useState<string[] | "loading" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const keys = await unionForwardedKeyNames(layers, layerIndex);
        if (!cancelled) setSourceOptions(keys);
      } catch {
        if (!cancelled) setSourceOptions("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [layers, layerIndex]);

  const opts = sourceOptions === "loading" || sourceOptions === "error" ? [] : sourceOptions;

  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <div className="mb-1 text-xs font-medium text-slate-500">Key aliases (optional)</div>
      <p className="mb-2 text-xs text-slate-500">
        Add export names that copy values from variables already present in merged layers below — e.g.{" "}
        <span className="font-mono text-slate-400">VITE_OIDC_KEY</span> from{" "}
        <span className="font-mono text-slate-400">OIDC_KEY</span> without storing the value twice.
      </p>
      {sourceOptions === "loading" ? (
        <p className="text-sm text-slate-500">Loading names from lower layers…</p>
      ) : sourceOptions === "error" ? (
        <p className="text-sm text-red-400">Could not load variable names from lower layers.</p>
      ) : (
        <div className="space-y-2">
          {aliasRows.map((row, ri) => (
            <div key={ri} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem] flex-1">
                <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">
                  Export as
                </label>
                <input
                  className="w-full rounded border border-border bg-[#121820] px-2 py-1.5 font-mono text-xs"
                  placeholder="VITE_OIDC_KEY"
                  value={row.target}
                  onChange={(e) => {
                    const next = aliasRows.slice();
                    next[ri] = { ...row, target: e.target.value };
                    updateLayer(layerIndex, { aliasRows: next });
                  }}
                />
              </div>
              <span className="pb-2 text-slate-600">←</span>
              <div className="min-w-[8rem] flex-1">
                <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-500">
                  From (below)
                </label>
                <select
                  className="w-full rounded border border-border bg-[#121820] px-2 py-1.5 font-mono text-xs"
                  value={row.source}
                  onChange={(e) => {
                    const next = aliasRows.slice();
                    next[ri] = { ...row, source: e.target.value };
                    updateLayer(layerIndex, { aliasRows: next });
                  }}
                >
                  <option value="">Select…</option>
                  {opts.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="rounded border border-red-900/40 px-2 py-1 text-xs text-red-300 hover:bg-red-950/30"
                onClick={() => {
                  updateLayer(
                    layerIndex,
                    { aliasRows: aliasRows.filter((_, j) => j !== ri) },
                  );
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-accent underline"
            onClick={() =>
              updateLayer(layerIndex, {
                aliasRows: [...aliasRows, { target: "", source: "" }],
              })
            }
          >
            Add alias
          </button>
        </div>
      )}
    </div>
  );
}
