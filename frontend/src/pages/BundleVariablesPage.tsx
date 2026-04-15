import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import {
  deleteBundle,
  deleteSecret,
  declassifySecret,
  encryptSecret,
  getBundle,
  listBundleKeyNames,
  patchBundle,
  upsertSecret,
  type BundlePayload,
} from "@/api/bundles";
import { BundlePageShell } from "@/components/BundlePageShell";
import { BundleVarActionsMenu } from "@/components/BundleVarActionsMenu";
import { EditNameSlugModal } from "@/components/EditNameSlugModal";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";
import { envSearchParam, keyParamFromSearch, resourceScopeFromNav } from "@/projectEnv";

export default function BundleVariablesPage() {
  const { projectSlug: projectSlugParam, bundleName = "" } = useParams<{
    projectSlug?: string;
    bundleName: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const envTag = envSearchParam(searchParams.get("env")) ?? "";
  const resourceScope = resourceScopeFromNav(projectSlugParam, searchParams.get("env"));
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["bundle", bundleName, projectSlugParam ?? "", envTag],
    queryFn: () => getBundle(bundleName, resourceScope),
    enabled: !!bundleName,
  });
  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [newSecret, setNewSecret] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editingKey, setEditingKey] = useState("");
  const [editVal, setEditVal] = useState("");
  const [editSecret, setEditSecret] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [actionsMenuKey, setActionsMenuKey] = useState<string | null>(null);
  const urlKeyConsumedRef = useRef(false);
  const [displayName, setDisplayName] = useState("");
  const [bundleSlug, setBundleSlug] = useState("");
  const [bundleDetailsOpen, setBundleDetailsOpen] = useState(false);

  const projectSlugForEnv = projectSlugParam ?? q.data?.project_slug ?? "";
  const envsQ = useQuery({
    queryKey: ["project-environments", projectSlugForEnv],
    queryFn: () => listProjectEnvironments(projectSlugForEnv),
    enabled: !!bundleName && !!projectSlugForEnv,
  });
  const patchEnvM = useMutation({
    mutationFn: (slug: string | null) =>
      patchBundle(bundleName, { project_environment_slug: slug }, resourceScope),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bundle", bundleName] });
      setErr(null);
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  useLayoutEffect(() => {
    if (q.data && !bundleDetailsOpen) {
      setDisplayName(q.data.name);
      setBundleSlug(q.data.slug);
    }
  }, [q.data, bundleDetailsOpen]);

  function openBundleDetails() {
    if (!q.data) return;
    setErr(null);
    setDisplayName(q.data.name);
    setBundleSlug(q.data.slug);
    setBundleDetailsOpen(true);
  }

  const saveDetailsM = useMutation({
    mutationFn: async () => {
      const d = q.data;
      if (!d) throw new Error("Missing bundle");
      const dn = displayName.trim();
      const ss = bundleSlug.trim();
      const body: { name?: string; slug?: string } = {};
      if (dn !== d.name) body.name = dn;
      if (ss !== d.slug) body.slug = ss;
      if (Object.keys(body).length === 0) {
        return { ss, slugChanged: ss !== bundleName, skipped: true as const };
      }
      await patchBundle(bundleName, body, resourceScope);
      return { ss, slugChanged: ss !== bundleName, skipped: false as const };
    },
    onSuccess: async (result) => {
      setBundleDetailsOpen(false);
      if (result.skipped) return;
      await qc.invalidateQueries({ queryKey: ["bundle"] });
      await qc.invalidateQueries({ queryKey: ["bundles"] });
      setErr(null);
      const { ss, slugChanged } = result;
      if (slugChanged && projectSlugParam) {
        const sp = new URLSearchParams(location.search);
        const qs = sp.toString();
        navigate(
          {
            pathname: `/projects/${encodeURIComponent(projectSlugParam)}/bundles/${encodeURIComponent(ss)}/edit`,
            search: qs ? `?${qs}` : "",
          },
          { replace: true },
        );
      } else if (slugChanged) {
        navigate(`/bundles/${encodeURIComponent(ss)}/edit${location.search}`, { replace: true });
      }
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const addM = useMutation({
    mutationFn: () =>
      upsertSecret(
        bundleName,
        {
          key_name: newKey.trim(),
          value: newVal,
          is_secret: newSecret,
        },
        resourceScope,
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bundle", bundleName] });
      setAddOpen(false);
      setNewKey("");
      setNewVal("");
      setErr(null);
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const editM = useMutation({
    mutationFn: () =>
      upsertSecret(
        bundleName,
        {
          key_name: editingKey.trim(),
          value: editVal,
          is_secret: editSecret,
        },
        resourceScope,
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["bundle", bundleName] });
      setEditOpen(false);
      setEditingKey("");
      setEditVal("");
      setErr(null);
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const delBundleM = useMutation({
    mutationFn: () => deleteBundle(bundleName, resourceScope),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bundles"] });
      const cached = qc.getQueryData<BundlePayload>(["bundle", bundleName]);
      const ps = projectSlugParam ?? cached?.project_slug ?? null;
      window.location.href = ps
        ? `/projects/${encodeURIComponent(ps)}/bundles`
        : "/bundles";
    },
    onError: (e: unknown) => setErr(formatApiError(e)),
  });

  const copyKeys = async () => {
    const keys = await listBundleKeyNames(bundleName, resourceScope);
    await navigator.clipboard.writeText(keys.join(","));
  };

  function openEditForKey(k: string, payload: BundlePayload) {
    const isSec = payload.secret_flags[k] ?? true;
    setEditingKey(k);
    setEditVal(isSec ? "" : payload.secrets[k]);
    setEditSecret(isSec);
    setEditOpen(true);
  }

  useEffect(() => {
    urlKeyConsumedRef.current = false;
  }, [bundleName]);

  useEffect(() => {
    if (!q.data || urlKeyConsumedRef.current) return;
    const sp = new URLSearchParams(location.search);
    const k = keyParamFromSearch(sp, searchParams.get("env"));
    urlKeyConsumedRef.current = true;
    if (!k || !(k in q.data.secrets)) return;
    openEditForKey(k, q.data);
    navigate({ pathname: location.pathname, search: "" }, { replace: true });
  }, [q.data, bundleName, location.pathname, navigate, searchParams]);

  if (!bundleName) return <p className="text-red-400">Missing bundle name</p>;
  if (q.isLoading) return <p className="text-slate-400">Loading…</p>;
  if (q.isError || !q.data) {
    return (
      <p className="text-red-400">{q.error instanceof Error ? q.error.message : "Failed"}</p>
    );
  }

  const data = q.data;
  const envAssignmentLocked = data.project_environment_slug != null;
  const projectSlug = projectSlugParam ?? data.project_slug ?? "";
  const subnavProjectSlug = projectSlugParam ?? (projectSlug || undefined);
  const bundlesListTo = projectSlug
    ? `/projects/${encodeURIComponent(projectSlug)}/bundles`
    : "/bundles";
  const entries = Object.entries(data.secrets).sort(([a], [b]) => a.localeCompare(b));

  return (
    <BundlePageShell
      bundleName={bundleName}
      displayName={data.name}
      subnavSlug={subnavProjectSlug}
      linkSearch={location.search}
      subtitle="Variables"
      tertiaryLink={{ to: `${bundlesListTo}${location.search}`, label: "← Bundles" }}
      titleAccessory={
        <button
          type="button"
          className="rounded-md border border-border/60 p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          title="Edit name and slug"
          aria-label="Edit name and slug"
          onClick={openBundleDetails}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      }
      belowSubnav={
        <>
          <Button type="button" variant="secondary" onClick={() => void copyKeys()}>
            Copy key names
          </Button>
          <Button type="button" onClick={() => setAddOpen(true)}>
            Add entry
          </Button>
        </>
      }
    >
      {err && !bundleDetailsOpen ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

      {projectSlug && !envAssignmentLocked ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Environment</span>
          <span className="text-xs text-slate-500">(set once; cannot be changed afterward)</span>
          <select
            className="w-full max-w-xs rounded-md border border-border bg-[#0b0f14] px-2 py-1 font-mono text-sm text-slate-200"
            value={data.project_environment_slug ?? ""}
            disabled={envsQ.isLoading || patchEnvM.isPending}
            onChange={(e) => {
              const v = e.target.value;
              patchEnvM.mutate(v === "" ? null : v);
            }}
          >
            <option value="">Unassigned</option>
            {(envsQ.data ?? []).map((row) => (
              <option key={row.id} value={row.slug}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="rounded-xl border border-border/80">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/80 bg-white/[0.03] text-slate-400">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Storage</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, v]) => {
              const isSec = data.secret_flags[k] ?? true;
              const isPlain = !isSec;
              const menuOpen = actionsMenuKey === k;
              return (
                <tr key={k} className="border-b border-border/40">
                  <td className="px-3 py-2 font-mono text-slate-200">{k}</td>
                  <td className="px-3 py-2 text-slate-400">{isSec ? "encrypted" : "plain"}</td>
                  <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-slate-300">
                    {isSec ? "••••" : v}
                  </td>
                  <td
                    className={`relative isolate px-3 py-2 align-top ${menuOpen ? "z-[280]" : ""}`}
                  >
                    <BundleVarActionsMenu
                      variableKey={k}
                      isPlain={isPlain}
                      open={menuOpen}
                      onOpenChange={(next) => {
                        if (next) setActionsMenuKey(k);
                        else setActionsMenuKey((cur) => (cur === k ? null : cur));
                      }}
                      onEdit={() => openEditForKey(k, data)}
                      onEncrypt={() =>
                        encryptSecret(bundleName, k, resourceScope).then(() =>
                          qc.invalidateQueries({
                            queryKey: ["bundle", bundleName, projectSlugParam ?? "", envTag ?? ""],
                          }),
                        )
                      }
                      onDeclassify={() => {
                        if (
                          confirm(
                            "Declassify this variable?\n\nThe value will be stored as plain text and will appear in exports and this list without masking.",
                          )
                        ) {
                          return declassifySecret(bundleName, k, resourceScope).then(() =>
                            qc.invalidateQueries({
                              queryKey: ["bundle", bundleName, projectSlugParam ?? "", envTag ?? ""],
                            }),
                          );
                        }
                      }}
                      onRemove={() => {
                        if (confirm(`Remove ${k} from this bundle?\n\nThis cannot be undone.`)) {
                          return deleteSecret(bundleName, k, resourceScope).then(() =>
                            qc.invalidateQueries({
                              queryKey: ["bundle", bundleName, projectSlugParam ?? "", envTag ?? ""],
                            }),
                          );
                        }
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <EditNameSlugModal
        open={bundleDetailsOpen}
        onClose={() => setBundleDetailsOpen(false)}
        title="Bundle name & slug"
        nameValue={displayName}
        slugValue={bundleSlug}
        onNameChange={setDisplayName}
        onSlugChange={setBundleSlug}
        onSave={() => saveDetailsM.mutate()}
        savePending={saveDetailsM.isPending}
        error={err}
        saveLabel="Save"
      />

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-white">Add entry</h2>
            <div className="space-y-3">
              <input
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                placeholder="KEY"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <textarea
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                rows={4}
                placeholder="value"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={newSecret}
                  onChange={(e) => setNewSecret(e.target.checked)}
                />
                Encrypted (secret)
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                disabled={!newKey.trim() || addM.isPending}
                onClick={() => addM.mutate()}
              >
                Save
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen && editingKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-white">Edit entry</h2>
            <p className="mb-3 font-mono text-sm text-slate-400">{editingKey}</p>
            <div className="space-y-3">
              <textarea
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                rows={4}
                placeholder={editSecret ? "New value (required to update a secret)" : "value"}
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={editSecret}
                  onChange={(e) => setEditSecret(e.target.checked)}
                />
                Encrypted (secret)
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                disabled={editM.isPending}
                onClick={() => editM.mutate()}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditOpen(false);
                  setEditingKey("");
                  setEditVal("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-10 border-t border-border/60 pt-6">
        <h2 className="mb-2 text-lg text-red-300">Danger zone</h2>
        <p className="mb-2 text-sm text-slate-400">
          Type the bundle name <span className="font-mono">{bundleName}</span> to delete.
        </p>
        <input
          className="mb-2 w-full max-w-xs rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder={bundleName}
        />
        <div>
          <Button
            type="button"
            variant="secondary"
            className="border-red-900 text-red-300"
            disabled={deleteConfirm !== bundleName || delBundleM.isPending}
            onClick={() => delBundleM.mutate()}
          >
            Delete bundle
          </Button>
        </div>
      </div>
    </BundlePageShell>
  );
}
