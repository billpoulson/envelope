import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  deleteBundle,
  deleteSecret,
  upsertSecret,
  type ResourceScopeOpts,
} from "@/api/bundles";
import { patchStack, type StackKeyGraphPayload, type StackLayer } from "@/api/stacks";
import { bundleScopeForApi } from "@/projectEnv";
import { DangerTypeConfirmModal } from "@/components/DangerTypeConfirmModal";
import {
  editorToStackLayer,
  LayerAliasesBlock,
  stackLayersFromApi,
  type LayerEditorState,
} from "@/components/StackLayersEditor";
import { Button } from "@/components/ui";
import { appendQueryParam } from "@/util/appendQueryParam";
import { formatApiError } from "@/util/apiError";
import {
  graphCellHasValue,
  graphMergedHasValue,
  hasProvidedCellValue,
  tryPrettyJson,
} from "@/util/keyGraphDisplay";

function moveTargetsForCell(
  layers: StackKeyGraphPayload["layers"],
  cells: (string | null)[],
  cellsSecretRedacted: (boolean | null)[] | undefined,
  sourceLi: number,
): { layerIndex: number; label: string; bundle: string }[] {
  const bundleAt = (i: number) => String(layers[i]?.bundle || "");
  const srcB = bundleAt(sourceLi);
  return layers
    .map((L, ti) => ({ layerIndex: ti, label: L.label, bundle: String(L.bundle || "") }))
    .filter(
      ({ layerIndex, bundle }) =>
        layerIndex !== sourceLi &&
        !!bundle &&
        bundle !== srcB &&
        !graphCellHasValue(cells[layerIndex], cellsSecretRedacted?.[layerIndex]),
    );
}

type MoveValuePayload = {
  key: string;
  sourceBundle: string;
  value: string;
  isSecret: boolean;
};

type DragMovePayload = MoveValuePayload & { sourceLi: number };

function isValidDropTarget(
  drag: DragMovePayload,
  rowKey: string,
  targetLi: number,
  cells: (string | null)[],
  layers: StackKeyGraphPayload["layers"],
  cellsSecretRedacted: (boolean | null)[] | undefined,
): boolean {
  if (drag.key !== rowKey) return false;
  if (targetLi === drag.sourceLi) return false;
  const tgtBundle = String(layers[targetLi]?.bundle || "");
  if (!tgtBundle || tgtBundle === drag.sourceBundle) return false;
  return !graphCellHasValue(cells[targetLi], cellsSecretRedacted?.[targetLi]);
}

function scrollToGraphRowByKey(sourceKey: string) {
  const el = document.querySelector(`[data-graph-row="${CSS.escape(sourceKey)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function DragHandle() {
  return (
    <span
      className="inline-flex shrink-0 cursor-grab select-none flex-col justify-center gap-0.5 rounded border border-border/50 bg-white/[0.04] px-1 py-1 text-slate-500 hover:border-border hover:bg-white/[0.07] hover:text-slate-300 active:cursor-grabbing"
      aria-hidden
    >
      <span className="block h-px w-3 bg-current" />
      <span className="block h-px w-3 bg-current" />
      <span className="block h-px w-3 bg-current" />
    </span>
  );
}

type Props = {
  data: StackKeyGraphPayload;
  /** Stack name and layers for editing key aliases from the context menu (optional). */
  stackName?: string;
  /** Project slug when under `/projects/...` — disambiguates bundle names. */
  projectSlug?: string;
  stackScope?: ResourceScopeOpts;
  stackLayers?: StackLayer[];
  showSecrets: boolean;
  onShowSecretsChange: (next: boolean) => void;
  onRefetch: () => void;
};

function CellValue({
  raw,
  isSecret,
  showSecrets,
  redactedFromApi = false,
  className = "",
}: {
  raw: string;
  isSecret: boolean;
  showSecrets: boolean;
  redactedFromApi?: boolean;
  className?: string;
}) {
  if (isSecret && (!showSecrets || redactedFromApi)) {
    return (
      <span className="text-slate-500" title="Enable “Show secret values” to load plaintext from the server">
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

export function StackKeyGraphView({
  data,
  stackName,
  projectSlug,
  stackScope,
  stackLayers = [],
  showSecrets,
  onShowSecretsChange,
  onRefetch,
}: Props) {
  const [filter, setFilter] = useState("");
  const n = data.layers.length;
  const [collapsed, setCollapsed] = useState<boolean[]>(() => Array.from({ length: n }, () => false));

  useEffect(() => {
    setCollapsed((c) => {
      if (c.length === n) return c;
      return Array.from({ length: n }, () => false);
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
        define?: { bundleName: string; keyName: string; bundleEnvironmentSlug: string | null };
        move?: {
          key: string;
          sourceLi: number;
          sourceBundle: string;
          value: string;
          isSecret: boolean;
          targets: { layerIndex: number; label: string; bundle: string }[];
        };
        remove?: { bundleName: string; keyName: string; bundleEnvironmentSlug: string | null };
        /** Layer column header — remove layer from stack or delete the bundle. */
        layerHeader?: { layerIndex: number };
        aliasesLayer?: { layerIndex: number };
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
    bundleEnvironmentSlug: string | null;
    value: string;
    isSecret: boolean;
  } | null>(null);
  const [defineErr, setDefineErr] = useState<string | null>(null);
  const [defineBusy, setDefineBusy] = useState(false);

  const [viewSecret, setViewSecret] = useState<{ title: string; raw: string } | null>(null);

  const [moveDialog, setMoveDialog] = useState<{
    key: string;
    sourceBundle: string;
    sourceLayerIndex: number;
    value: string;
    isSecret: boolean;
    targets: { layerIndex: number; label: string; bundle: string }[];
  } | null>(null);
  const [movePick, setMovePick] = useState<number | null>(null);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  const [removeErr, setRemoveErr] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const [layerHeaderErr, setLayerHeaderErr] = useState<string | null>(null);
  const [layerHeaderBusy, setLayerHeaderBusy] = useState(false);

  const [dragMove, setDragMove] = useState<DragMovePayload | null>(null);
  const [dragOverDrop, setDragOverDrop] = useState<{ key: string; li: number } | null>(null);

  const [aliasModalLayer, setAliasModalLayer] = useState<number | null>(null);
  const [aliasEditLayers, setAliasEditLayers] = useState<LayerEditorState[]>([]);
  const [aliasErr, setAliasErr] = useState<string | null>(null);
  const [aliasBusy, setAliasBusy] = useState(false);

  const canEditAliases = Boolean(stackName?.trim()) && stackLayers.length > 0;
  const canEditStackLayers = Boolean(stackName?.trim()) && stackLayers.length > 0;

  const openAliasModal = useCallback(
    (layerIndex: number) => {
      setAliasErr(null);
      setAliasEditLayers(stackLayersFromApi(stackLayers));
      setAliasModalLayer(layerIndex);
      setCtx(null);
    },
    [stackLayers],
  );

  const submitDefine = useCallback(async () => {
    if (!defineBody) return;
    setDefineErr(null);
    setDefineBusy(true);
    try {
      await upsertSecret(
        defineBody.bundleName,
        {
          key_name: defineBody.keyName,
          value: defineBody.value,
          is_secret: defineBody.isSecret,
        },
        bundleScopeForApi(projectSlug, defineBody.bundleEnvironmentSlug),
      );
      setDefineOpen(false);
      setDefineBody(null);
      onRefetch();
    } catch (e: unknown) {
      setDefineErr(formatApiError(e));
    } finally {
      setDefineBusy(false);
    }
  }, [defineBody, onRefetch, projectSlug]);

  const executeMoveToBundle = useCallback(
    async (
      payload: MoveValuePayload & { sourceLayerIndex: number },
      targetLayerIndex: number,
    ) => {
      setMoveErr(null);
      setMoveBusy(true);
      try {
        const targetBundle = String(data.layers[targetLayerIndex]?.bundle || "");
        const tgtSlug =
          (
            data.layers[targetLayerIndex] as { bundle_environment_slug?: string | null }
          )?.bundle_environment_slug ?? null;
        const srcSlug =
          (
            data.layers[payload.sourceLayerIndex] as { bundle_environment_slug?: string | null }
          )?.bundle_environment_slug ?? null;
        await upsertSecret(
          targetBundle,
          {
            key_name: payload.key,
            value: payload.value,
            is_secret: payload.isSecret,
          },
          bundleScopeForApi(projectSlug, tgtSlug),
        );
        await deleteSecret(
          payload.sourceBundle,
          payload.key,
          bundleScopeForApi(projectSlug, srcSlug),
        );
        setMoveDialog(null);
        setMovePick(null);
        setDragMove(null);
        setDragOverDrop(null);
        onRefetch();
      } catch (e: unknown) {
        setMoveErr(formatApiError(e));
      } finally {
        setMoveBusy(false);
      }
    },
    [data.layers, onRefetch, projectSlug],
  );

  const submitMove = useCallback(async () => {
    if (!moveDialog || movePick === null) return;
    const tgt = moveDialog.targets.find((t) => t.layerIndex === movePick);
    if (!tgt) return;
    await executeMoveToBundle(
      {
        key: moveDialog.key,
        sourceBundle: moveDialog.sourceBundle,
        sourceLayerIndex: moveDialog.sourceLayerIndex,
        value: moveDialog.value,
        isSecret: moveDialog.isSecret,
      },
      tgt.layerIndex,
    );
  }, [moveDialog, movePick, executeMoveToBundle]);

  const executeRemoveFromBundle = useCallback(
    async (bundleName: string, keyName: string, bundleEnvironmentSlug: string | null) => {
      setRemoveErr(null);
      setRemoveBusy(true);
      try {
        await deleteSecret(
          bundleName,
          keyName,
          bundleScopeForApi(projectSlug, bundleEnvironmentSlug),
        );
        setCtx(null);
        onRefetch();
      } catch (e: unknown) {
        setRemoveErr(formatApiError(e));
      } finally {
        setRemoveBusy(false);
      }
    },
    [onRefetch, projectSlug],
  );

  const submitAliasSave = useCallback(async () => {
    if (aliasModalLayer === null || !stackName?.trim()) return;
    setAliasErr(null);
    setAliasBusy(true);
    try {
      await patchStack(
        stackName.trim(),
        {
          layers: aliasEditLayers.map(editorToStackLayer),
        },
        stackScope,
      );
      setAliasModalLayer(null);
      onRefetch();
    } catch (e: unknown) {
      setAliasErr(formatApiError(e));
    } finally {
      setAliasBusy(false);
    }
  }, [aliasEditLayers, aliasModalLayer, onRefetch, stackName, stackScope]);

  const [deleteBundleTarget, setDeleteBundleTarget] = useState<string | null>(null);
  const [deleteBundleErr, setDeleteBundleErr] = useState<string | null>(null);
  const [deleteBundleBusy, setDeleteBundleBusy] = useState(false);

  const confirmDeleteBundle = useCallback(async () => {
    const bn = deleteBundleTarget?.trim();
    if (!bn) return;
    setDeleteBundleErr(null);
    setDeleteBundleBusy(true);
    try {
      await deleteBundle(bn, stackScope);
      setDeleteBundleTarget(null);
      onRefetch();
    } catch (e: unknown) {
      setDeleteBundleErr(formatApiError(e));
    } finally {
      setDeleteBundleBusy(false);
    }
  }, [deleteBundleTarget, onRefetch, stackScope]);

  const executeRemoveLayerFromStack = useCallback(
    async (layerIndex: number) => {
      const sn = stackName?.trim();
      if (!sn || stackLayers.length === 0) return;
      const label = String(data.layers[layerIndex]?.label || "").trim() || `Layer ${layerIndex + 1}`;
      const bundle = String(data.layers[layerIndex]?.bundle || "").trim() || "(no bundle)";
      const msg = `Remove ${label} (${bundle}) from this stack? The bundle is not deleted.`;
      if (!confirm(msg)) return;
      setLayerHeaderErr(null);
      setLayerHeaderBusy(true);
      try {
        const next = stackLayers.filter((_, i) => i !== layerIndex);
        if (next.length < 1) {
          setLayerHeaderErr("A stack must keep at least one layer.");
          return;
        }
        await patchStack(sn, { layers: next }, stackScope);
        setCtx(null);
        onRefetch();
      } catch (e: unknown) {
        setLayerHeaderErr(formatApiError(e));
      } finally {
        setLayerHeaderBusy(false);
      }
    },
    [data.layers, onRefetch, stackLayers, stackName, stackScope],
  );

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
            <strong className="text-slate-300">Merged export</strong> is the final value. Secret plaintext is not
            loaded until you enable <strong className="text-slate-300">Show secret values</strong> (the page refetches);
            until then values appear as <code className="text-slate-300">(secret)</code>.
          </li>
          <li>
            <strong className="text-slate-300">Right-click a layer header</strong> for{" "}
            <strong className="text-slate-300">Open bundle</strong>, to remove that layer from this stack or delete its
            bundle entirely, or (except the bottom layer) open{" "}
            <strong className="text-slate-300">Key aliases for this layer</strong>.
          </li>
          <li>
            <strong className="text-slate-300">Drag</strong> using the grip beside a value onto another layer’s{" "}
            <strong className="text-slate-300">empty</strong> cell (same row) to move the variable to that bundle.
            Or <strong className="text-slate-300">right-click a cell</strong> for View secret, Edit, Define, Move, or{" "}
            <strong className="text-slate-300">Remove from bundle</strong> (deletes the variable from that bundle for
            all stacks).
          </li>
        </ul>
      </details>

      {moveErr && !moveDialog ? (
        <p className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{moveErr}</p>
      ) : null}
      {removeErr ? (
        <p className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{removeErr}</p>
      ) : null}
      {layerHeaderErr ? (
        <p className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          {layerHeaderErr}
        </p>
      ) : null}

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
            onChange={(e) => onShowSecretsChange(e.target.checked)}
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
                  onContextMenu={(e) => {
                    if (!canEditStackLayers) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setLayerHeaderErr(null);
                    setTimeout(() => {
                      setCtx({
                        x: e.clientX,
                        y: e.clientY,
                        layerHeader: { layerIndex: li },
                        ...(li > 0 && canEditAliases ? { aliasesLayer: { layerIndex: li } } : {}),
                      });
                    }, 0);
                  }}
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
                const cellsSecretRedacted = row.cells_secret_redacted;
                const win = row.winner_layer_index;
                const mergedRaw =
                  row.merged !== undefined && row.merged !== null
                    ? row.merged
                    : win != null
                      ? cells[win]
                      : null;
                const mergedSecret = row.merged_secret === true;
                const mergedValueRedacted = row.merged_value_redacted === true;
                const mergedHasVal = graphMergedHasValue(mergedRaw, row.merged_secret, row.merged_value_redacted);

                let rowNoValueAnywhere = true;
                for (let ri = 0; ri < n; ri++) {
                  if (graphCellHasValue(cells[ri], cellsSecretRedacted?.[ri])) {
                    rowNoValueAnywhere = false;
                    break;
                  }
                }

                const aliasSrc =
                  row.cells_alias_source ??
                  (row as { cellsAliasSource?: (string | null)[] }).cellsAliasSource;
                const aliasSourceName = aliasSrc?.find((s) => s != null && String(s).trim() !== "");

                return (
                  <tr
                    key={key}
                    data-graph-row={key}
                    className="border-b border-border/30 hover:bg-white/[0.02]"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-[#121820] px-2 py-2 font-mono text-xs text-slate-200"
                    >
                      <div>{key}</div>
                      {aliasSourceName ? (
                        <div
                          className="mt-1 max-w-[14rem] font-mono text-[10px] font-normal leading-tight text-slate-500"
                          title="This name is a stack layer alias; same value as the source variable from merged layers below."
                        >
                          <span className="text-slate-600">alias of </span>
                          <button
                            type="button"
                            className="text-accent underline decoration-accent/40 underline-offset-2 hover:text-slate-300"
                            onClick={(e) => {
                              e.stopPropagation();
                              scrollToGraphRowByKey(aliasSourceName);
                            }}
                          >
                            {aliasSourceName}
                          </button>
                        </div>
                      ) : null}
                    </th>
                    {data.layers.map((L, li) => {
                      const v = cells[li];
                      const layerMeta = data.layers[li]!;
                      const editBase = (layerMeta.bundle_edit_path || "").trim();
                      const bundleName = String(layerMeta.bundle || "");
                      const redacted = cellsSecretRedacted?.[li] === true;
                      const hasVal = graphCellHasValue(v, cellsSecretRedacted?.[li]);
                      const nextHasVal = graphCellHasValue(cells[li + 1], cellsSecretRedacted?.[li + 1]);
                      const overriddenByNext = li < n - 1 && hasVal && nextHasVal;
                      const notOverriddenByNext = hasVal && !overriddenByNext;
                      const isSec = cellSecrets[li] === true;

                      const editTo =
                        hasVal && editBase ? appendQueryParam(editBase, "key", key) : "";

                      const moveTargets = hasVal
                        ? moveTargetsForCell(data.layers, cells, cellsSecretRedacted, li)
                        : [];
                      const movePayload =
                        hasVal && v != null && moveTargets.length > 0
                          ? {
                              key,
                              sourceLi: li,
                              sourceBundle: bundleName,
                              value: String(v),
                              isSecret: isSec,
                              targets: moveTargets,
                            }
                          : undefined;

                      const openMenu = (e: MouseEvent) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const viewSecretPayload =
                          hasVal && isSec && hasProvidedCellValue(v)
                            ? { raw: String(v), title: `${key} · ${bundleName}` }
                            : undefined;
                        const canDefine = rowNoValueAnywhere && !!bundleName && !!editBase;
                        const bundleEnvSlug =
                          (
                            layerMeta as {
                              bundle_environment_slug?: string | null;
                            }
                          ).bundle_environment_slug ?? null;
                        const definePayload = canDefine
                          ? { bundleName, keyName: key, bundleEnvironmentSlug: bundleEnvSlug }
                          : undefined;
                        const removePayload =
                          hasVal && bundleName
                            ? { bundleName, keyName: key, bundleEnvironmentSlug: bundleEnvSlug }
                            : undefined;
                        const aliasesPayload =
                          canEditAliases && li > 0 ? { layerIndex: li } : undefined;
                        if (
                          !viewSecretPayload &&
                          !editTo &&
                          !definePayload &&
                          !movePayload &&
                          !removePayload &&
                          !aliasesPayload
                        )
                          return;
                        setTimeout(() => {
                          setCtx({
                            x: e.clientX,
                            y: e.clientY,
                            viewSecret: viewSecretPayload,
                            editTo: editTo || undefined,
                            define: definePayload,
                            move: movePayload,
                            remove: removePayload,
                            aliasesLayer: aliasesPayload,
                          });
                        }, 0);
                      };

                      const isWinner = win === li && hasVal;

                      const canDrag =
                        hasVal && v != null && moveTargets.length > 0 && !moveBusy;
                      const dragPayload: DragMovePayload | null = canDrag
                        ? {
                            key,
                            sourceLi: li,
                            sourceBundle: bundleName,
                            value: String(v),
                            isSecret: isSec,
                          }
                        : null;

                      const onCellDragOver = (e: DragEvent<HTMLTableCellElement>) => {
                        if (!dragMove || moveBusy) return;
                        if (
                          !isValidDropTarget(dragMove, key, li, cells, data.layers, cellsSecretRedacted)
                        ) {
                          e.dataTransfer.dropEffect = "none";
                          return;
                        }
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverDrop({ key, li });
                      };

                      const onCellDragLeave = (e: DragEvent<HTMLTableCellElement>) => {
                        const rel = e.relatedTarget as Node | null;
                        if (rel && e.currentTarget.contains(rel)) return;
                        setDragOverDrop((cur) => (cur?.key === key && cur?.li === li ? null : cur));
                      };

                      const onCellDrop = async (e: DragEvent<HTMLTableCellElement>) => {
                        e.preventDefault();
                        if (!dragMove || moveBusy) return;
                        if (!isValidDropTarget(dragMove, key, li, cells, data.layers, cellsSecretRedacted))
                          return;
                        await executeMoveToBundle(
                          {
                            key: dragMove.key,
                            sourceBundle: dragMove.sourceBundle,
                            sourceLayerIndex: dragMove.sourceLi,
                            value: dragMove.value,
                            isSecret: dragMove.isSecret,
                          },
                          li,
                        );
                      };

                      const dropHighlighted =
                        dragMove &&
                        dragOverDrop?.key === key &&
                        dragOverDrop?.li === li &&
                        isValidDropTarget(dragMove, key, li, cells, data.layers, cellsSecretRedacted);

                      return (
                        <td
                          key={li}
                          className={`border-l border-border/40 px-1 py-1 align-top ${collapsed[li] ? "max-w-[3.5rem]" : ""} ${isWinner ? "ring-1 ring-accent/40" : ""} ${dropHighlighted ? "ring-2 ring-inset ring-accent/60 bg-accent/[0.07]" : ""}`}
                          onContextMenu={openMenu}
                          onDragOver={onCellDragOver}
                          onDragLeave={onCellDragLeave}
                          onDrop={onCellDrop}
                        >
                          <div
                            className={`flex flex-col gap-0.5 ${collapsed[li] ? "items-center" : ""}`}
                          >
                            {collapsed[li] && canDrag && dragPayload ? (
                              <div className="flex justify-center py-0.5">
                                <span
                                  draggable
                                  className="inline-flex"
                                  title="Drag onto an empty layer cell (→) to move this variable"
                                  onDragStart={(e) => {
                                    setDragMove(dragPayload);
                                    e.dataTransfer.effectAllowed = "move";
                                    e.dataTransfer.setData("text/plain", key);
                                  }}
                                  onDragEnd={() => {
                                    setDragMove(null);
                                    setDragOverDrop(null);
                                  }}
                                >
                                  <DragHandle />
                                </span>
                              </div>
                            ) : null}
                            <div
                              className={`min-h-[1.5rem] ${collapsed[li] ? "hidden" : "block"}`}
                            >
                              {hasVal && (v != null || redacted) ? (
                                <div className="flex gap-1.5">
                                  {canDrag && dragPayload ? (
                                    <span
                                      draggable
                                      className="mt-0.5 inline-flex shrink-0"
                                      title="Drag onto an empty layer cell (→) to move this variable"
                                      onDragStart={(e) => {
                                        setDragMove(dragPayload);
                                        e.dataTransfer.effectAllowed = "move";
                                        e.dataTransfer.setData("text/plain", key);
                                      }}
                                      onDragEnd={() => {
                                        setDragMove(null);
                                        setDragOverDrop(null);
                                      }}
                                    >
                                      <DragHandle />
                                    </span>
                                  ) : null}
                                  <div className="min-w-0 flex-1">
                                    <CellValue
                                      raw={v != null ? String(v) : ""}
                                      isSecret={isSec}
                                      showSecrets={showSecrets}
                                      redactedFromApi={redacted}
                                    />
                                    {aliasSrc?.[li] ? (
                                      <div
                                        className="mt-0.5 font-mono text-[10px] leading-tight text-slate-500"
                                        title={`Alias: same value as ${aliasSrc[li]} from merged layers below this layer`}
                                      >
                                        <span className="select-none text-slate-600">from </span>
                                        <button
                                          type="button"
                                          className="text-accent underline decoration-accent/40 underline-offset-2 hover:text-slate-300"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            scrollToGraphRowByKey(aliasSrc[li]!);
                                          }}
                                        >
                                          {aliasSrc[li]}
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
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
                        if (!mergedHasVal) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const winBundle =
                          win != null ? String(data.layers[win]?.bundle || "").trim() : "";
                        const viewSecretPayload =
                          mergedSecret && hasProvidedCellValue(mergedRaw)
                            ? {
                                raw: String(mergedRaw),
                                title: `${key} · merged export`,
                              }
                            : undefined;
                        const winMeta = win != null ? data.layers[win] : undefined;
                        const winEnv =
                          (
                            winMeta as { bundle_environment_slug?: string | null } | undefined
                          )?.bundle_environment_slug ?? null;
                        const removePayload =
                          winBundle !== ""
                            ? { bundleName: winBundle, keyName: key, bundleEnvironmentSlug: winEnv }
                            : undefined;
                        if (!viewSecretPayload && !removePayload) return;
                        setTimeout(() => {
                          setCtx({
                            x: e.clientX,
                            y: e.clientY,
                            viewSecret: viewSecretPayload,
                            remove: removePayload,
                          });
                        }, 0);
                      }}
                    >
                      {mergedHasVal ? (
                        <CellValue
                          raw={mergedRaw != null ? String(mergedRaw) : ""}
                          isSecret={mergedSecret}
                          showSecrets={showSecrets}
                          redactedFromApi={mergedValueRedacted}
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
          {ctx.layerHeader ? (
            <>
              {(() => {
                const li = ctx.layerHeader!.layerIndex;
                const to = (data.layers[li]?.bundle_edit_path || "").trim();
                return to ? (
                  <Link
                    to={to}
                    className="block px-3 py-2 text-sm text-accent hover:bg-white/10"
                    onClick={() => setCtx(null)}
                  >
                    Open bundle
                  </Link>
                ) : null;
              })()}
              <button
                type="button"
                disabled={layerHeaderBusy}
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
                onClick={() => {
                  const li = ctx.layerHeader!.layerIndex;
                  void executeRemoveLayerFromStack(li);
                }}
              >
                Remove from stack…
              </button>
              <button
                type="button"
                disabled={
                  layerHeaderBusy ||
                  !String(data.layers[ctx.layerHeader.layerIndex]?.bundle || "").trim()
                }
                className="block w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                onClick={() => {
                  const li = ctx.layerHeader!.layerIndex;
                  const bundleName = String(data.layers[li]?.bundle || "").trim();
                  if (!bundleName) {
                    setLayerHeaderErr("This layer has no bundle to delete.");
                    return;
                  }
                  setDeleteBundleTarget(bundleName);
                  setDeleteBundleErr(null);
                  setCtx(null);
                }}
              >
                Delete bundle…
              </button>
            </>
          ) : null}
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
                  bundleEnvironmentSlug: ctx.define!.bundleEnvironmentSlug,
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
          {ctx.move ? (
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
              onClick={() => {
                const m = ctx.move!;
                setMovePick(m.targets[0]!.layerIndex);
                setMoveErr(null);
                setMoveDialog({
                  key: m.key,
                  sourceBundle: m.sourceBundle,
                  sourceLayerIndex: m.sourceLi,
                  value: m.value,
                  isSecret: m.isSecret,
                  targets: m.targets,
                });
                setCtx(null);
              }}
            >
              Move to another layer…
            </button>
          ) : null}
          {ctx.remove ? (
            <button
              type="button"
              disabled={removeBusy}
              className="block w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              onClick={() => {
                const r = ctx.remove!;
                const msg = `Remove "${r.keyName}" from bundle "${r.bundleName}"? This deletes the variable from that bundle; other stacks using this bundle will no longer see it.`;
                if (!confirm(msg)) return;
                void executeRemoveFromBundle(r.bundleName, r.keyName, r.bundleEnvironmentSlug);
              }}
            >
              {removeBusy ? "Removing…" : "Remove from bundle…"}
            </button>
          ) : null}
          {ctx.aliasesLayer ? (
            <>
              {ctx.layerHeader ? <div className="border-t border-border/40" /> : null}
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"
                onClick={() => {
                  openAliasModal(ctx.aliasesLayer!.layerIndex);
                }}
              >
                Key aliases for this layer…
              </button>
            </>
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

      {moveDialog ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl">
            <h3 className="mb-2 text-lg text-white">Move variable to another layer</h3>
            <p className="mb-1 font-mono text-sm text-slate-200">{moveDialog.key}</p>
            <p className="mb-4 text-xs text-slate-500">
              Removes <span className="font-mono text-slate-400">{moveDialog.key}</span> from{" "}
              <span className="font-mono text-slate-400">{moveDialog.sourceBundle}</span> and defines the same value in
              the bundle you pick (that bundle must not already define this key in this stack).
            </p>
            {moveErr ? <p className="mb-2 text-sm text-red-400">{moveErr}</p> : null}
            <label className="mb-2 block text-xs text-slate-400">Target layer / bundle</label>
            <select
              className="mb-4 w-full rounded border border-border bg-[#0b0f14] px-2 py-2 text-sm"
              value={movePick ?? moveDialog.targets[0]?.layerIndex ?? ""}
              onChange={(e) => setMovePick(Number(e.target.value))}
            >
              {moveDialog.targets.map((t) => (
                <option key={t.layerIndex} value={t.layerIndex}>
                  {t.label} — {t.bundle}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button type="button" disabled={moveBusy || movePick === null} onClick={() => void submitMove()}>
                {moveBusy ? "Moving…" : "Move"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setMoveDialog(null);
                  setMovePick(null);
                  setMoveErr(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {aliasModalLayer !== null ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            if (!aliasBusy) setAliasModalLayer(null);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-[#121820] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg text-white">Key aliases for this layer</h3>
            <p className="mb-4 font-mono text-xs text-slate-400">
              {data.layers[aliasModalLayer]?.label} · {data.layers[aliasModalLayer]?.bundle}
            </p>
            {aliasErr ? <p className="mb-3 text-sm text-red-400">{aliasErr}</p> : null}
            <LayerAliasesBlock
              layerIndex={aliasModalLayer}
              layers={aliasEditLayers}
              aliasRows={aliasEditLayers[aliasModalLayer]?.aliasRows ?? []}
              updateLayer={(index, patch) => {
                setAliasEditLayers((prev) =>
                  prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
                );
              }}
            />
            <div className="mt-6 flex flex-wrap gap-2 border-t border-border/40 pt-4">
              <Button type="button" disabled={aliasBusy} onClick={() => void submitAliasSave()}>
                {aliasBusy ? "Saving…" : "Save aliases"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={aliasBusy}
                onClick={() => setAliasModalLayer(null)}
              >
                Cancel
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

      <DangerTypeConfirmModal
        open={deleteBundleTarget !== null && deleteBundleTarget.trim() !== ""}
        onClose={() => {
          if (deleteBundleBusy) return;
          setDeleteBundleTarget(null);
          setDeleteBundleErr(null);
        }}
        title="Delete this bundle?"
        description={
          <>
            This removes <span className="text-slate-200">all variables</span> in this bundle. Other stacks or
            environments that use this bundle will be affected.
          </>
        }
        confirmationPhrase={deleteBundleTarget ?? ""}
        typeFieldLabel="Type the bundle name to confirm:"
        typeFieldHint="Bundle name"
        confirmButtonLabel="Delete bundle"
        pending={deleteBundleBusy}
        error={deleteBundleErr}
        onConfirm={() => void confirmDeleteBundle()}
      />
    </div>
  );
}
