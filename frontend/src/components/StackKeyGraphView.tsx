import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { upsertSecret } from "@/api/bundles";
import type { StackKeyGraphPayload } from "@/api/stacks";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { hasProvidedCellValue, tryPrettyJson } from "@/util/keyGraphDisplay";

type Props = {
  data: StackKeyGraphPayload;
  onRefetch: () => void;
};

function CellValue({
  raw,
  isSecret,
  showSecrets,
  className = "",
}: {
  raw: string;
  isSecret: boolean;
  showSecrets: boolean;
  className?: string;
}) {
  if (isSecret && !showSecrets) {
    return (
      <span className="text-slate-500" title="Enable “Show secret values” or use the cell menu">
        (secret)
      </span>
    );
  }
  const pj = tryPrettyJson(raw);
  if (pj.ok) {
    return (
      <pre
        className={`max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-200 ${pj.mode === "list" ? "pl-1" : ""} ${className}`}
      >
        {pj.text}
      </pre>
    );
  }
  return <div className={`font-mono text-[11px] text-slate-200 ${className}`}>{pj.text}</div>;
}

export function StackKeyGraphView({ data, onRefetch }: Props) {
  const [filter, setFilter] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const n = data.layers.length;
  const [collapsed, setCollapsed] = useState<boolean[]>(() => Array.from({ length: n }, () => true));

  useEffect(() => {
    setCollapsed((c) => {
      if (c.length === n) return c;
      return Array.from({ length: n }, () => true);
    });
  }, [n]);

  const rows = data.rows ?? [];
  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = !q ? rows : rows.filter((r) => r.key.toLowerCase().includes(q));
    return [...list].sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: "base" }));
  }, [rows, filter]);

  const [ctx, setCtx] = useState<
    | null
    | {
        x: number;
        y: number;
        viewSecret?: { raw: string; title: string };
        editTo?: string;
        define?: { bundleName: string; keyName: string };
      }
  >(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close() {
      setCtx(null);
    }
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  const [defineOpen, setDefineOpen] = useState(false);
  const [defineBody, setDefineBody] = useState<{
    bundleName: string;
    keyName: string;
    value: string;
    isSecret: boolean;
  } | null>(null);
  const [defineErr, setDefineErr] = useState<string | null>(null);
  const [defineBusy, setDefineBusy] = useState(false);

  const [viewSecret, setViewSecret] = useState<{ title: string; raw: string } | null>(null);

  const submitDefine = useCallback(async () => {
    if (!defineBody) return;
    setDefineErr(null);
    setDefineBusy(true);
    try {
      await upsertSecret(defineBody.bundleName, {
        key_name: defineBody.keyName,
        value: defineBody.value,
        is_secret: defineBody.isSecret,
      });
      setDefineOpen(false);
      setDefineBody(null);
      onRefetch();
    } catch (e: unknown) {
      setDefineErr(formatApiError(e));
    } finally {
      setDefineBusy(false);
    }
  }, [defineBody, onRefetch]);

  if (n === 0) {
    return <p className="text-slate-400">This stack has no layers.</p>;
  }

  return (
    <div className="space-y-4">
      <details className="rounded-lg border border-border/60 bg-[#0b0f14]/80 p-4 text-sm text-slate-400">
        <summary className="cursor-pointer font-medium text-slate-200">
          How to read this view
        </summary>
        <ul className="mt-3 list-inside list-disc space-y-2 pl-1">
          <li>
            Layers run <strong className="text-slate-300">left → right</strong> (bottom → top of the stack).
          </li>
          <li>
            Use <kbd className="rounded bg-white/10 px-1">▶</kbd> / <kbd className="rounded bg-white/10 px-1">▼</kbd>{" "}
            in a column header to collapse or expand that layer’s values.
          </li>
          <li>
            <span className="inline-block h-2 w-2 rounded-sm bg-slate-500" title="" /> Gray strip — overridden by a
            layer above. <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> Green — this layer wins
            vs the layer above for this key.
          </li>
          <li>
            <strong className="text-slate-300">Merged export</strong> is the final value. Secrets show as{" "}
            <code className="text-slate-300">(secret)</code> until you enable “Show secret values” or open the cell
            menu.
          </li>
          <li>
            <strong className="text-slate-300">Right-click</strong> a cell for View secret, Edit in bundle, or Define
            value (when applicable).
          </li>
        </ul>
      </details>

      <div className="flex flex-wrap items-center gap-4 border-b border-border/40 pb-3">
        <input
          type="search"
          className="min-w-[12rem] flex-1 rounded-md border border-border bg-[#0b0f14] px-3 py-1.5 font-mono text-sm"
          placeholder="Filter by variable name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter keys"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showSecrets}
            onChange={(e) => setShowSecrets(e.target.checked)}
          />
          Show secret values
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-white/[0.03]">
              <th className="sticky left-0 z-10 min-w-[10rem] bg-[#121820] px-2 py-2 font-medium text-slate-400">
                Variable
              </th>
              {data.layers.map((L, li) => (
                <th
                  key={L.position}
                  className={`border-l border-border/40 px-1 py-1 align-bottom transition-[width] ${collapsed[li] ? "max-w-[3.5rem]" : "min-w-[12rem] w-[14rem]"}`}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-start gap-1">
                      <button
                        type="button"
                        className="shrink-0 rounded border border-border/60 px-1 text-[10px] text-slate-400 hover:bg-white/10"
                        aria-expanded={!collapsed[li]}
                        title={collapsed[li] ? "Expand column" : "Collapse column"}
                        onClick={() =>
                          setCollapsed((c) => {
                            const next = [...c];
                            next[li] = !next[li];
                            return next;
                          })
                        }
                      >
                        {collapsed[li] ? "▶" : "▼"}
                      </button>
                      <div className="min-w-0">
                        <div className="font-medium leading-tight text-slate-200">{L.label}</div>
                        <div className="font-mono text-[10px] text-slate-500">{L.bundle}</div>
                      </div>
                    </div>
                  </div>
                </th>
              ))}
              <th className="min-w-[14rem] w-[16rem] border-l border-border/40 px-2 py-2 text-slate-300">
                <div className="font-medium">Merged export</div>
                <div className="text-[10px] font-normal text-slate-500">Final value after layers</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={n + 2} className="px-3 py-6 text-center text-slate-500">
                  No matching variables.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const key = row.key;
                const cells = row.cells;
                const cellSecrets = row.cell_secrets;
                const win = row.winner_layer_index;
                const merged =
                  row.merged !== undefined && row.merged !== null
                    ? row.merged
                    : win != null
                      ? cells[win]
                      : null;
                const mergedSecret = row.merged_secret === true;

                let rowNoValueAnywhere = true;
                for (let ri = 0; ri < n; ri++) {
                  if (hasProvidedCellValue(cells[ri])) {
                    rowNoValueAnywhere = false;
                    break;
                  }
                }

                return (
                  <tr key={key} className="border-b border-border/30 hover:bg-white/[0.02]">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-[#121820] px-2 py-2 font-mono text-xs text-slate-200"
                    >
                      {key}
                    </th>
                    {data.layers.map((L, li) => {
                      const v = cells[li];
                      const layerMeta = data.layers[li]!;
                      const editBase = (layerMeta.bundle_edit_path || "").trim();
                      const bundleName = String(layerMeta.bundle || "");
                      const hasVal = hasProvidedCellValue(v);
                      const overriddenByNext =
                        li < n - 1 && hasVal && hasProvidedCellValue(cells[li + 1]);
                      const notOverriddenByNext = hasVal && !overriddenByNext;
                      const isSec = cellSecrets[li] === true;

                      const editTo =
                        hasVal && editBase ? `${editBase}?key=${encodeURIComponent(key)}` : "";

                      const openMenu = (e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const viewSecretPayload =
                          hasVal && isSec && v != null
                            ? { raw: String(v), title: `${key} · ${bundleName}` }
                            : undefined;
                        const canDefine = rowNoValueAnywhere && !!bundleName && !!editBase;
                        const definePayload = canDefine ? { bundleName, keyName: key } : undefined;
                        if (!viewSecretPayload && !editTo && !definePayload) return;
                        setTimeout(() => {
                          setCtx({
                            x: e.clientX,
                            y: e.clientY,
                            viewSecret: viewSecretPayload,
                            editTo: editTo || undefined,
                            define: definePayload,
                          });
                        }, 0);
                      };

                      const isWinner = win === li && hasVal;

                      return (
                        <td
                          key={li}
                          className={`border-l border-border/40 px-1 py-1 align-top ${collapsed[li] ? "max-w-[3.5rem]" : ""} ${isWinner ? "ring-1 ring-accent/40" : ""}`}
                          onContextMenu={openMenu}
                        >
                          <div
                            className={`flex flex-col gap-0.5 ${collapsed[li] ? "items-center" : ""}`}
                          >
                            <div
                              className={`min-h-[1.5rem] ${collapsed[li] ? "hidden" : "block"}`}
                            >
                              {hasVal && v != null ? (
                                <CellValue
                                  raw={String(v)}
                                  isSecret={isSec}
                                  showSecrets={showSecrets}
                                />
                              ) : (
                                <div className="text-slate-600">
                                  {rowNoValueAnywhere ? (
                                    <span
                                      className="inline-block h-2 w-2 rounded-sm bg-red-900/80"
                                      title="No value in any layer"
                                    />
                                  ) : (
                                    <span title="Not defined in this bundle">→</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div
                              className={`flex min-h-[10px] items-center gap-0.5 ${collapsed[li] ? "justify-center" : "border-t border-border/20 pt-1"}`}
                            >
                              {hasVal && overriddenByNext ? (
                                <span
                                  className="inline-block h-2 w-2 rounded-sm bg-slate-500"
                                  title="Overridden by the next layer"
                                />
                              ) : null}
                              {hasVal && notOverriddenByNext ? (
                                <span
                                  className="inline-block h-2 w-2 rounded-sm bg-emerald-500"
                                  title={
                                    li === n - 1
                                      ? "Top layer — nothing above overrides"
                                      : "Next layer does not define this key"
                                  }
                                />
                              ) : null}
                              {!hasVal && !rowNoValueAnywhere ? (
                                <span className="text-slate-600" title="Not defined in this bundle">
                                  →
                                </span>
                              ) : null}
                              {!hasVal && rowNoValueAnywhere ? (
                                <span
                                  className="inline-block h-2 w-2 rounded-sm bg-red-900/80"
                                  title="No value in any layer"
                                />
                              ) : null}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    <td
                      className="border-l border-border/40 px-2 py-1 align-top text-slate-200"
                      onContextMenu={(e) => {
                        if (!hasProvidedCellValue(merged)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (!mergedSecret || merged == null) return;
                        setTimeout(() => {
                          setCtx({
                            x: e.clientX,
                            y: e.clientY,
                            viewSecret: { raw: String(merged), title: `${key} · merged export` },
                          });
                        }, 0);
                      }}
                    >
                      {hasProvidedCellValue(merged) && merged != null ? (
                        <CellValue
                          raw={String(merged)}
                          isSecret={mergedSecret}
                          showSecrets={showSecrets}
                          className="text-slate-100"
                        />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-sm bg-red-900/80" title="No merged value" />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {ctx ? (
        <div
          ref={ctxRef}
          className="fixed z-[100] min-w-[12rem] rounded-lg border border-border/80 bg-[#1a222c] py-1 shadow-xl"
          style={{ left: ctx.x, top: ctx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctx.viewSecret ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
              onClick={() => {
                setViewSecret({ title: ctx.viewSecret!.title, raw: ctx.viewSecret!.raw });
                setCtx(null);
              }}
            >
              View secret…
            </button>
          ) : null}
          {ctx.editTo ? (
            <Link
              to={ctx.editTo}
              className="block px-3 py-2 text-sm text-accent hover:bg-white/10"
              onClick={() => setCtx(null)}
            >
              Edit in source bundle…
            </Link>
          ) : null}
          {ctx.define ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
              onClick={() => {
                setDefineBody({
                  bundleName: ctx.define!.bundleName,
                  keyName: ctx.define!.keyName,
                  value: "",
                  isSecret: true,
                });
                setDefineOpen(true);
                setCtx(null);
              }}
            >
              Define value in this layer…
            </button>
          ) : null}
        </div>
      ) : null}

      {viewSecret ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-[#121820] p-6 shadow-xl">
            <h3 className="mb-2 text-lg text-white">Secret value</h3>
            <p className="mb-2 text-xs text-slate-500">{viewSecret.title}</p>
            <textarea
              readOnly
              className="h-64 w-full rounded border border-border bg-[#0b0f14] p-2 font-mono text-xs text-slate-200"
              value={viewSecret.raw}
            />
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(viewSecret.raw);
                }}
              >
                Copy
              </Button>
              <Button type="button" onClick={() => setViewSecret(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {defineOpen && defineBody ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl">
            <h3 className="mb-2 text-lg text-white">Define value in layer</h3>
            <p className="mb-4 text-xs text-slate-500">
              {defineBody.keyName} · bundle {defineBody.bundleName}
            </p>
            {defineErr ? <p className="mb-2 text-sm text-red-400">{defineErr}</p> : null}
            <label className="mb-2 block text-xs text-slate-400">Storage</label>
            <select
              className="mb-4 w-full rounded border border-border bg-[#0b0f14] px-2 py-2 text-sm"
              value={defineBody.isSecret ? "1" : "0"}
              onChange={(e) =>
                setDefineBody((b) => (b ? { ...b, isSecret: e.target.value === "1" } : b))
              }
            >
              <option value="1">Encrypted (secret)</option>
              <option value="0">Plain (not encrypted)</option>
            </select>
            <label className="mb-2 block text-xs text-slate-400">Value</label>
            <textarea
              required
              className="mb-4 h-32 w-full rounded border border-border bg-[#0b0f14] px-2 py-2 font-mono text-sm"
              value={defineBody.value}
              onChange={(e) =>
                setDefineBody((b) => (b ? { ...b, value: e.target.value } : b))
              }
            />
            <div className="flex gap-2">
              <Button type="button" disabled={defineBusy} onClick={() => void submitDefine()}>
                {defineBusy ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDefineOpen(false);
                  setDefineBody(null);
                  setDefineErr(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
