import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listBundles } from "@/api/bundles";
import { createApiKey } from "@/api/keys";
import { listProjects } from "@/api/projects";
import { listStacks } from "@/api/stacks";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

type AccessMode = "admin" | "scoped" | "terraform_project";
type ScopedResource = "project" | "bundle" | "stack" | "terraform_state";
type Perm = "read" | "write";
/** Remote state at /tfstate/projects/… — apply needs GET + POST (read + write scopes). */
type TerraformStateAccess = "read" | "write" | "apply";
type WizardStep = "name" | "access" | "scope" | "tf_project" | "review";

type ScopeDraft = {
  resource: ScopedResource;
  perm: Perm;
  terraformAccess: TerraformStateAccess;
  projectScopeMode: "all" | "one";
  projectSlug: string;
  bundleScopeMode: "all" | "one";
  bundleProjectFilter: string;
  bundleSlug: string;
  stackScopeMode: "all" | "one";
  stackProjectFilter: string;
  stackSlug: string;
};

const defaultScopeDraft = (): ScopeDraft => ({
  resource: "bundle",
  perm: "read",
  terraformAccess: "apply",
  projectScopeMode: "all",
  projectSlug: "",
  bundleScopeMode: "all",
  bundleProjectFilter: "",
  bundleSlug: "",
  stackScopeMode: "all",
  stackProjectFilter: "",
  stackSlug: "",
});

/** One scope string from the scoped builder (throws if incomplete). Not used for terraform_state — use scopesToAddFromDraft. */
function scopeFromDraft(d: ScopeDraft): string {
  if (d.resource === "terraform_state") {
    throw new Error("Use scopesToAddFromDraft for Terraform state.");
  }
  const p = d.perm === "read" ? "read" : "write";
  if (d.resource === "project") {
    if (d.projectScopeMode === "all") return `${p}:project:*`;
    const slug = d.projectSlug.trim();
    if (!slug) throw new Error("Pick a project.");
    return `${p}:project:slug:${slug}`;
  }
  if (d.resource === "bundle") {
    if (d.bundleScopeMode === "all") return `${p}:bundle:*`;
    const b = d.bundleSlug.trim();
    if (!b) throw new Error("Pick a bundle.");
    return `${p}:bundle:${b}`;
  }
  if (d.resource === "stack") {
    if (d.stackScopeMode === "all") return `${p}:stack:*`;
    const s = d.stackSlug.trim();
    if (!s) throw new Error("Pick a stack.");
    return `${p}:stack:${s}`;
  }
  return "read:bundle:*";
}

/** Scopes to add for the current draft (Terraform state may add read + write). */
function scopesToAddFromDraft(d: ScopeDraft): string[] {
  if (d.resource !== "terraform_state") {
    return [scopeFromDraft(d)];
  }
  if (d.projectScopeMode === "all") {
    if (d.terraformAccess === "read") return ["read:project:*"];
    if (d.terraformAccess === "write") return ["write:project:*"];
    return ["read:project:*", "write:project:*"];
  }
  const slug = d.projectSlug.trim();
  if (!slug) throw new Error("Pick a project.");
  if (d.terraformAccess === "read") return [`read:project:slug:${slug}`];
  if (d.terraformAccess === "write") return [`write:project:slug:${slug}`];
  return [`read:project:slug:${slug}`, `write:project:slug:${slug}`];
}

function tryScopesToAddFromDraft(d: ScopeDraft): string[] | null {
  try {
    return scopesToAddFromDraft(d);
  } catch {
    return null;
  }
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)];
}

type Props = {
  onCreated: (plainKey: string) => void;
  onError: (msg: string) => void;
};

export function ApiKeyCreateWizard({ onCreated, onError }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<WizardStep>("name");
  const [name, setName] = useState("");

  const [access, setAccess] = useState<AccessMode>("scoped");
  const [draft, setDraft] = useState<ScopeDraft>(() => defaultScopeDraft());
  const [pendingScopes, setPendingScopes] = useState<string[]>([]);
  const [tfProjectSlug, setTfProjectSlug] = useState("");

  const scopeStepActive = step === "scope";
  const tfProjectStepActive = step === "tf_project";

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: (scopeStepActive && access === "scoped") || (tfProjectStepActive && access === "terraform_project"),
  });

  const bundlesForPickerQ = useQuery({
    queryKey: ["bundles", draft.bundleProjectFilter || "__global__"],
    queryFn: () => listBundles(draft.bundleProjectFilter.trim() || undefined),
    enabled:
      scopeStepActive &&
      access === "scoped" &&
      draft.resource === "bundle" &&
      draft.bundleScopeMode === "one",
  });

  const stacksForPickerQ = useQuery({
    queryKey: ["stacks", draft.stackProjectFilter || "__global__"],
    queryFn: () => listStacks(draft.stackProjectFilter.trim() || undefined),
    enabled:
      scopeStepActive &&
      access === "scoped" &&
      draft.resource === "stack" &&
      draft.stackScopeMode === "one",
  });

  useEffect(() => {
    if (draft.resource !== "bundle") return;
    setDraft((d) => ({ ...d, bundleSlug: "" }));
  }, [draft.bundleProjectFilter, draft.resource]);

  useEffect(() => {
    if (draft.resource !== "stack") return;
    setDraft((d) => ({ ...d, stackSlug: "" }));
  }, [draft.stackProjectFilter, draft.resource]);

  const draftScopesPreview = useMemo(() => tryScopesToAddFromDraft(draft), [draft]);

  const createM = useMutation({
    mutationFn: async () => {
      const n = name.trim();
      if (!n) throw new Error("Enter a name for this key.");
      let scopes: string[];
      if (access === "admin") scopes = ["admin"];
      else if (access === "terraform_project") {
        const slug = tfProjectSlug.trim();
        if (!slug) throw new Error("Pick a project.");
        scopes = dedupeScopes([
          `read:project:slug:${slug}`,
          `write:project:slug:${slug}`,
        ]);
      } else {
        const list = dedupeScopes(pendingScopes);
        if (list.length === 0) throw new Error("Add at least one scope.");
        scopes = list;
      }
      return createApiKey({ name: n, scopes });
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
      setStep("name");
      setName("");
      setAccess("scoped");
      setDraft(defaultScopeDraft());
      setPendingScopes([]);
      setTfProjectSlug("");
      onCreated(data.plain_key);
    },
    onError: (e: unknown) => onError(formatApiError(e)),
  });

  function addCurrentScope() {
    const list = tryScopesToAddFromDraft(draft);
    if (!list || list.length === 0) {
      onError("Complete the scope selections before adding.");
      return;
    }
    const existing = new Set(pendingScopes);
    const newOnes = list.filter((s) => !existing.has(s));
    if (newOnes.length === 0) {
      onError("Those scopes are already in the list.");
      return;
    }
    onError("");
    setPendingScopes((prev) => dedupeScopes([...prev, ...newOnes]));
    setDraft(defaultScopeDraft());
  }

  function removeScopeAt(index: number) {
    setPendingScopes((prev) => prev.filter((_, i) => i !== index));
  }

  function goNext() {
    if (step === "name") {
      if (!name.trim()) {
        onError("Enter a name to continue.");
        return;
      }
      onError("");
      setStep("access");
      return;
    }
    if (step === "access") {
      onError("");
      if (access === "admin") {
        setStep("review");
      } else if (access === "terraform_project") {
        setStep("tf_project");
      } else {
        setStep("scope");
      }
      return;
    }
    if (step === "tf_project") {
      if (!tfProjectSlug.trim()) {
        onError("Select a project to continue.");
        return;
      }
      onError("");
      setStep("review");
      return;
    }
    if (step === "scope") {
      if (pendingScopes.length === 0) {
        onError("Add at least one scope using “Add scope”, then continue.");
        return;
      }
      onError("");
      setStep("review");
      return;
    }
  }

  function goBack() {
    onError("");
    if (step === "review") {
      if (access === "admin") {
        setStep("access");
      } else if (access === "terraform_project") {
        setStep("tf_project");
      } else {
        setStep("scope");
      }
      return;
    }
    if (step === "tf_project") {
      setStep("access");
      return;
    }
    if (step === "scope") {
      setStep("access");
      return;
    }
    if (step === "access") {
      setStep("name");
      return;
    }
  }

  const projects = projectsQ.data ?? [];
  const bundleOptions = bundlesForPickerQ.data ?? [];
  const stackOptions = stacksForPickerQ.data ?? [];

  const scopeLabel =
    access === "admin"
      ? "Full administrator (all API operations)"
      : access === "terraform_project"
        ? "Terraform remote state for one Envelope project (read + write on /tfstate/projects/…)."
        : null;

  const reviewScopes =
    access === "admin"
      ? ["admin"]
      : access === "terraform_project"
        ? tfProjectSlug.trim()
          ? dedupeScopes([
              `read:project:slug:${tfProjectSlug.trim()}`,
              `write:project:slug:${tfProjectSlug.trim()}`,
            ])
          : []
        : dedupeScopes(pendingScopes);

  const updateDraft = (patch: Partial<ScopeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <section className="rounded-xl border border-border/80 bg-white/[0.02] p-6">
      <h2 className="mb-2 text-lg text-white">Create key</h2>
      <p className="mb-1 text-sm font-medium text-slate-300">
        {step === "name"
          ? "Step 1 — Name"
          : step === "access"
            ? "Step 2 — Access level"
            : step === "scope"
              ? "Step 3 — Scopes"
              : step === "tf_project"
                ? "Step 3 — Terraform project"
                : step === "review"
                  ? access === "scoped"
                    ? "Step 4 — Review"
                    : "Step 3 — Review"
                  : "Review"}
      </p>
      <p className="mb-8 text-xs text-slate-500">
        {step === "tf_project"
          ? "Pick which Envelope project this key may read/write Terraform state for (/tfstate/projects/…)."
          : access === "admin"
            ? "Admin keys skip the scope builder."
            : "Add one or more scopes from the dropdowns. You can combine bundle, stack, project, and Terraform state access."}
      </p>

      {step === "name" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="api-key-wizard-name">
              Key name
            </label>
            <input
              id="api-key-wizard-name"
              className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CI deploy, laptop"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-slate-500">Shown in the key list; not sent to clients.</p>
          </div>
        </div>
      ) : null}

      {step === "access" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="api-key-access">
              What should this key be allowed to do?
            </label>
            <select
              id="api-key-access"
              className="w-full max-w-lg rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
              value={access}
              onChange={(e) => setAccess(e.target.value as AccessMode)}
            >
              <option value="scoped">Scoped access (build a list of scopes)</option>
              <option value="admin">Full administrator — entire API</option>
              <option value="terraform_project">Terraform state for one project (/tfstate/projects/…)</option>
            </select>
            <p className="mt-2 text-xs text-slate-500">
              <strong className="text-slate-400">Admin</strong> cannot be combined with other scopes.{" "}
              <strong className="text-slate-400">Terraform for one project</strong> grants read + write on that
              project&apos;s remote state. Use <strong className="text-slate-400">Scoped</strong> to mix Terraform with
              bundle/stack scopes.
            </p>
          </div>
        </div>
      ) : null}

      {step === "tf_project" && access === "terraform_project" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="tf-proj-pick">
              Envelope project
            </label>
            <select
              id="tf-proj-pick"
              className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
              value={tfProjectSlug}
              onChange={(e) => setTfProjectSlug(e.target.value)}
              disabled={projectsQ.isLoading}
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
            {projectsQ.isError ? (
              <p className="mt-1 text-xs text-red-400">Could not load projects.</p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              The key will include <span className="font-mono text-slate-400">read:project:slug:…</span> and{" "}
              <span className="font-mono text-slate-400">write:project:slug:…</span> for Terraform apply
              (GET + lock/write remote state).
            </p>
          </div>
        </div>
      ) : null}

      {step === "scope" && access === "scoped" ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-border/60 bg-[#0b0f14]/40 p-4">
            <p className="mb-2 text-sm font-medium text-slate-300">Scopes added ({pendingScopes.length})</p>
            {pendingScopes.length === 0 ? (
              <p className="text-sm text-slate-500">None yet — build a scope below and click “Add scope”.</p>
            ) : (
              <ul className="space-y-2">
                {pendingScopes.map((s, i) => (
                  <li
                    key={`${s}-${i}`}
                    className="flex items-start justify-between gap-2 rounded border border-border/50 bg-[#0b0f14]/80 px-3 py-2 font-mono text-xs text-accent"
                  >
                    <span className="min-w-0 break-all">{s}</span>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-red-400 underline hover:text-red-300"
                      onClick={() => removeScopeAt(i)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-sm text-slate-400">Add another scope</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400" htmlFor="scope-resource">
                Resource
              </label>
              <select
                id="scope-resource"
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
                value={draft.resource}
                onChange={(e) => updateDraft({ resource: e.target.value as ScopedResource })}
              >
                <option value="bundle">Bundles (variables &amp; secrets)</option>
                <option value="stack">Stacks (layered bundles)</option>
                <option value="project">Projects (containers)</option>
                <option value="terraform_state">Terraform remote state (/tfstate/projects/…)</option>
              </select>
            </div>
            {draft.resource === "terraform_state" ? (
              <div>
                <label className="mb-1 block text-sm text-slate-400" htmlFor="tf-access">
                  Terraform access
                </label>
                <select
                  id="tf-access"
                  className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
                  value={draft.terraformAccess}
                  onChange={(e) =>
                    updateDraft({ terraformAccess: e.target.value as TerraformStateAccess })
                  }
                >
                  <option value="apply">Read + write (terraform apply)</option>
                  <option value="read">Read only</option>
                  <option value="write">Write only</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm text-slate-400" htmlFor="scope-perm">
                  Permission
                </label>
                <select
                  id="scope-perm"
                  className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
                  value={draft.perm}
                  onChange={(e) => updateDraft({ perm: e.target.value as Perm })}
                >
                  <option value="read">Read</option>
                  <option value="write">Write (includes create/update)</option>
                </select>
              </div>
            )}
          </div>

          {draft.resource === "project" || draft.resource === "terraform_state" ? (
            <div className="rounded-lg border border-border/60 bg-[#0b0f14]/50 p-4">
              <p className="mb-3 text-sm text-slate-400">
                {draft.resource === "terraform_state"
                  ? "Which project for remote state?"
                  : "Which projects?"}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500" htmlFor="proj-mode">
                    Coverage
                  </label>
                  <select
                    id="proj-mode"
                    className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                    value={draft.projectScopeMode}
                    onChange={(e) => updateDraft({ projectScopeMode: e.target.value as "all" | "one" })}
                  >
                    <option value="all">All projects (*)</option>
                    <option value="one">One project…</option>
                  </select>
                </div>
                {draft.projectScopeMode === "one" ? (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500" htmlFor="proj-pick">
                      Project
                    </label>
                    <select
                      id="proj-pick"
                      className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                      value={draft.projectSlug}
                      onChange={(e) => updateDraft({ projectSlug: e.target.value })}
                      disabled={projectsQ.isLoading}
                    >
                      <option value="">Select a project…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.slug}>
                          {p.name} ({p.slug})
                        </option>
                      ))}
                    </select>
                    {projectsQ.isError ? (
                      <p className="mt-1 text-xs text-red-400">Could not load projects.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {draft.resource === "terraform_state" ? (
                <p className="mt-3 text-xs text-slate-500">
                  Use backend URLs under <span className="font-mono text-slate-400">/tfstate/projects/&lt;slug&gt;/…</span>.
                  {draft.terraformAccess === "apply" && draft.projectScopeMode === "one"
                    ? " “Add scope” adds read + write for that project (required for terraform apply)."
                    : null}
                  {draft.terraformAccess === "apply" && draft.projectScopeMode === "all"
                    ? " “Add scope” adds read + write for all projects."
                    : null}
                </p>
              ) : null}
            </div>
          ) : null}

          {draft.resource === "bundle" ? (
            <div className="rounded-lg border border-border/60 bg-[#0b0f14]/50 p-4">
              <p className="mb-3 text-sm text-slate-400">Which bundles?</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500" htmlFor="bundle-mode">
                    Coverage
                  </label>
                  <select
                    id="bundle-mode"
                    className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                    value={draft.bundleScopeMode}
                    onChange={(e) => updateDraft({ bundleScopeMode: e.target.value as "all" | "one" })}
                  >
                    <option value="all">All bundles (*)</option>
                    <option value="one">One bundle…</option>
                  </select>
                </div>
                {draft.bundleScopeMode === "one" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="bundle-proj-filter">
                        Narrow list by project (optional)
                      </label>
                      <select
                        id="bundle-proj-filter"
                        className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                        value={draft.bundleProjectFilter}
                        onChange={(e) => updateDraft({ bundleProjectFilter: e.target.value })}
                        disabled={projectsQ.isLoading}
                      >
                        <option value="">All visible bundles</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.slug}>
                            {p.name} ({p.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="bundle-pick">
                        Bundle (slug)
                      </label>
                      <select
                        id="bundle-pick"
                        className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                        value={draft.bundleSlug}
                        onChange={(e) => updateDraft({ bundleSlug: e.target.value })}
                        disabled={bundlesForPickerQ.isLoading}
                      >
                        <option value="">Select a bundle…</option>
                        {bundleOptions.map((slug) => (
                          <option key={slug} value={slug}>
                            {slug}
                          </option>
                        ))}
                      </select>
                      {bundlesForPickerQ.isError ? (
                        <p className="mt-1 text-xs text-red-400">Could not load bundles.</p>
                      ) : null}
                      {bundleOptions.length === 0 && !bundlesForPickerQ.isLoading ? (
                        <p className="mt-1 text-xs text-amber-400/90">No bundles in this filter.</p>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {draft.resource === "stack" ? (
            <div className="rounded-lg border border-border/60 bg-[#0b0f14]/50 p-4">
              <p className="mb-3 text-sm text-slate-400">Which stacks?</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500" htmlFor="stack-mode">
                    Coverage
                  </label>
                  <select
                    id="stack-mode"
                    className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                    value={draft.stackScopeMode}
                    onChange={(e) => updateDraft({ stackScopeMode: e.target.value as "all" | "one" })}
                  >
                    <option value="all">All stacks (*)</option>
                    <option value="one">One stack…</option>
                  </select>
                </div>
                {draft.stackScopeMode === "one" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="stack-proj-filter">
                        Narrow list by project (optional)
                      </label>
                      <select
                        id="stack-proj-filter"
                        className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                        value={draft.stackProjectFilter}
                        onChange={(e) => updateDraft({ stackProjectFilter: e.target.value })}
                        disabled={projectsQ.isLoading}
                      >
                        <option value="">All visible stacks</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.slug}>
                            {p.name} ({p.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="stack-pick">
                        Stack (slug)
                      </label>
                      <select
                        id="stack-pick"
                        className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
                        value={draft.stackSlug}
                        onChange={(e) => updateDraft({ stackSlug: e.target.value })}
                        disabled={stacksForPickerQ.isLoading}
                      >
                        <option value="">Select a stack…</option>
                        {stackOptions.map((slug) => (
                          <option key={slug} value={slug}>
                            {slug}
                          </option>
                        ))}
                      </select>
                      {stacksForPickerQ.isError ? (
                        <p className="mt-1 text-xs text-red-400">Could not load stacks.</p>
                      ) : null}
                      {stackOptions.length === 0 && !stacksForPickerQ.isLoading ? (
                        <p className="mt-1 text-xs text-amber-400/90">No stacks in this filter.</p>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!draftScopesPreview || draftScopesPreview.length === 0}
              onClick={() => addCurrentScope()}
            >
              Add scope
            </Button>
            {draftScopesPreview && draftScopesPreview.length > 0 ? (
              <span className="text-xs text-slate-500">
                Adds:{" "}
                <span className="font-mono text-slate-400">{draftScopesPreview.join(", ")}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-[#0b0f14]/60 p-4 text-sm">
            <p className="mb-2 text-slate-400">Name</p>
            <p className="font-medium text-slate-100">{name.trim() || "—"}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-[#0b0f14]/60 p-4 text-sm">
            <p className="mb-2 text-slate-400">Scopes (stored on the key)</p>
            {access === "admin" ? (
              <p className="font-mono text-xs text-accent">admin</p>
            ) : null}
            {access === "terraform_project" && scopeLabel ? (
              <p className="mb-3 text-slate-300">{scopeLabel}</p>
            ) : null}
            {access !== "admin" && reviewScopes.length > 0 ? (
              <ul className="list-inside list-disc font-mono text-xs text-accent">
                {reviewScopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : null}
            {access !== "admin" && reviewScopes.length === 0 ? (
              <p className="text-amber-400">No scopes — go back and add at least one.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-2 border-t border-border/40 pt-6">
        {step !== "name" ? (
          <Button type="button" variant="secondary" onClick={goBack}>
            Back
          </Button>
        ) : null}
        {step !== "review" ? (
          <Button
            type="button"
            disabled={
              (step === "scope" && access === "scoped" && pendingScopes.length === 0) ||
              (step === "tf_project" && (!tfProjectSlug.trim() || projectsQ.isLoading))
            }
            onClick={goNext}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              createM.isPending ||
              !name.trim() ||
              (access === "scoped" && reviewScopes.length === 0)
            }
            onClick={() => createM.mutate()}
          >
            {createM.isPending ? "Creating…" : "Create key"}
          </Button>
        )}
      </div>
    </section>
  );
}
