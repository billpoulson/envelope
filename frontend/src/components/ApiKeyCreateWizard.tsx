import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listBundles } from "@/api/bundles";
import { createApiKey } from "@/api/keys";
import { listProjects } from "@/api/projects";
import { listStacks } from "@/api/stacks";
import { Button } from "@/components/ui";
import { formatApiError } from "@/util/apiError";

type AccessMode = "admin" | "terraform" | "scoped";
type ScopedResource = "project" | "bundle" | "stack";
type Perm = "read" | "write";
type WizardStep = "name" | "access" | "scope" | "review";

function buildScopes(args: {
  access: AccessMode;
  resource: ScopedResource;
  perm: Perm;
  projectScopeMode: "all" | "one";
  projectSlug: string;
  bundleScopeMode: "all" | "one";
  bundleProjectFilter: string;
  bundleSlug: string;
  stackScopeMode: "all" | "one";
  stackProjectFilter: string;
  stackSlug: string;
}): string[] {
  if (args.access === "admin") return ["admin"];
  if (args.access === "terraform") return ["terraform:http_state"];
  const p = args.perm === "read" ? "read" : "write";
  if (args.resource === "project") {
    if (args.projectScopeMode === "all") return [`${p}:project:*`];
    const slug = args.projectSlug.trim();
    if (!slug) throw new Error("Pick a project.");
    return [`${p}:project:slug:${slug}`];
  }
  if (args.resource === "bundle") {
    if (args.bundleScopeMode === "all") return [`${p}:bundle:*`];
    const b = args.bundleSlug.trim();
    if (!b) throw new Error("Pick a bundle.");
    return [`${p}:bundle:${b}`];
  }
  if (args.resource === "stack") {
    if (args.stackScopeMode === "all") return [`${p}:stack:*`];
    const s = args.stackSlug.trim();
    if (!s) throw new Error("Pick a stack.");
    return [`${p}:stack:${s}`];
  }
  return ["read:bundle:*"];
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
  const [resource, setResource] = useState<ScopedResource>("bundle");
  const [perm, setPerm] = useState<Perm>("read");

  const [projectScopeMode, setProjectScopeMode] = useState<"all" | "one">("all");
  const [projectSlug, setProjectSlug] = useState("");

  const [bundleScopeMode, setBundleScopeMode] = useState<"all" | "one">("all");
  /** When narrowing bundles by project; empty = list all visible bundles. */
  const [bundleProjectFilter, setBundleProjectFilter] = useState("");
  const [bundleSlug, setBundleSlug] = useState("");

  const [stackScopeMode, setStackScopeMode] = useState<"all" | "one">("all");
  const [stackProjectFilter, setStackProjectFilter] = useState("");
  const [stackSlug, setStackSlug] = useState("");

  const scopeStepActive = step === "scope";

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: scopeStepActive && access === "scoped",
  });

  const bundlesForPickerQ = useQuery({
    queryKey: ["bundles", bundleProjectFilter || "__global__"],
    queryFn: () => listBundles(bundleProjectFilter.trim() || undefined),
    enabled:
      scopeStepActive &&
      access === "scoped" &&
      resource === "bundle" &&
      bundleScopeMode === "one",
  });

  const stacksForPickerQ = useQuery({
    queryKey: ["stacks", stackProjectFilter || "__global__"],
    queryFn: () => listStacks(stackProjectFilter.trim() || undefined),
    enabled:
      scopeStepActive &&
      access === "scoped" &&
      resource === "stack" &&
      stackScopeMode === "one",
  });

  useEffect(() => {
    if (resource !== "bundle") return;
    setBundleSlug("");
  }, [bundleProjectFilter, resource]);

  useEffect(() => {
    if (resource !== "stack") return;
    setStackSlug("");
  }, [stackProjectFilter, resource]);

  const computedScopes = useMemo(() => {
    try {
      return buildScopes({
        access,
        resource,
        perm,
        projectScopeMode,
        projectSlug,
        bundleScopeMode,
        bundleProjectFilter,
        bundleSlug,
        stackScopeMode,
        stackProjectFilter,
        stackSlug,
      });
    } catch {
      return null;
    }
  }, [
    access,
    resource,
    perm,
    projectScopeMode,
    projectSlug,
    bundleScopeMode,
    bundleProjectFilter,
    bundleSlug,
    stackScopeMode,
    stackProjectFilter,
    stackSlug,
  ]);

  const createM = useMutation({
    mutationFn: async () => {
      const scopes = buildScopes({
        access,
        resource,
        perm,
        projectScopeMode,
        projectSlug,
        bundleScopeMode,
        bundleProjectFilter,
        bundleSlug,
        stackScopeMode,
        stackProjectFilter,
        stackSlug,
      });
      const n = name.trim();
      if (!n) throw new Error("Enter a name for this key.");
      return createApiKey({ name: n, scopes });
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
      setStep("name");
      setName("");
      setAccess("scoped");
      setResource("bundle");
      setPerm("read");
      setProjectScopeMode("all");
      setProjectSlug("");
      setBundleScopeMode("all");
      setBundleProjectFilter("");
      setBundleSlug("");
      setStackScopeMode("all");
      setStackProjectFilter("");
      setStackSlug("");
      onCreated(data.plain_key);
    },
    onError: (e: unknown) => onError(formatApiError(e)),
  });

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
      if (access === "admin" || access === "terraform") {
        setStep("review");
      } else {
        setStep("scope");
      }
      return;
    }
    if (step === "scope") {
      if (!computedScopes) {
        onError("Complete the scope selections.");
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
      if (access === "admin" || access === "terraform") {
        setStep("access");
      } else {
        setStep("scope");
      }
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
      : access === "terraform"
        ? "Terraform HTTP remote state only"
        : null;

  return (
    <section className="rounded-xl border border-border/80 bg-white/[0.02] p-6">
      <h2 className="mb-2 text-lg text-white">Create key</h2>
      <p className="mb-1 text-sm font-medium text-slate-300">
        {step === "name"
          ? "Step 1 — Name"
          : step === "access"
            ? "Step 2 — Access level"
            : step === "scope"
              ? "Step 3 — Scope"
              : access === "admin" || access === "terraform"
                ? "Step 3 — Review"
                : "Step 4 — Review"}
      </p>
      <p className="mb-8 text-xs text-slate-500">
        {access === "admin" || access === "terraform"
          ? "Admin and Terraform keys skip the scope builder."
          : "Choose resource type, then narrow with the dropdowns — no raw scope strings."}
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
              <option value="scoped">Scoped access (choose resource and permissions)</option>
              <option value="admin">Full administrator — entire API</option>
              <option value="terraform">Terraform HTTP remote state only</option>
            </select>
            <p className="mt-2 text-xs text-slate-500">
              <strong className="text-slate-400">Admin</strong> cannot be combined with other scopes.{" "}
              <strong className="text-slate-400">Terraform</strong> is limited to the remote state backend.
            </p>
          </div>
        </div>
      ) : null}

      {step === "scope" && access === "scoped" ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-slate-400" htmlFor="scope-resource">
                Resource
              </label>
              <select
                id="scope-resource"
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
                value={resource}
                onChange={(e) => setResource(e.target.value as ScopedResource)}
              >
                <option value="bundle">Bundles (variables &amp; secrets)</option>
                <option value="stack">Stacks (layered bundles)</option>
                <option value="project">Projects (containers)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400" htmlFor="scope-perm">
                Permission
              </label>
              <select
                id="scope-perm"
                className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
                value={perm}
                onChange={(e) => setPerm(e.target.value as Perm)}
              >
                <option value="read">Read</option>
                <option value="write">Write (includes create/update)</option>
              </select>
            </div>
          </div>

          {resource === "project" ? (
            <div className="rounded-lg border border-border/60 bg-[#0b0f14]/50 p-4">
              <p className="mb-3 text-sm text-slate-400">Which projects?</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500" htmlFor="proj-mode">
                    Coverage
                  </label>
                  <select
                    id="proj-mode"
                    className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                    value={projectScopeMode}
                    onChange={(e) => setProjectScopeMode(e.target.value as "all" | "one")}
                  >
                    <option value="all">All projects (*)</option>
                    <option value="one">One project…</option>
                  </select>
                </div>
                {projectScopeMode === "one" ? (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500" htmlFor="proj-pick">
                      Project
                    </label>
                    <select
                      id="proj-pick"
                      className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                      value={projectSlug}
                      onChange={(e) => setProjectSlug(e.target.value)}
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
            </div>
          ) : null}

          {resource === "bundle" ? (
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
                    value={bundleScopeMode}
                    onChange={(e) => setBundleScopeMode(e.target.value as "all" | "one")}
                  >
                    <option value="all">All bundles (*)</option>
                    <option value="one">One bundle…</option>
                  </select>
                </div>
                {bundleScopeMode === "one" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="bundle-proj-filter">
                        Narrow list by project (optional)
                      </label>
                      <select
                        id="bundle-proj-filter"
                        className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                        value={bundleProjectFilter}
                        onChange={(e) => setBundleProjectFilter(e.target.value)}
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
                        value={bundleSlug}
                        onChange={(e) => setBundleSlug(e.target.value)}
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

          {resource === "stack" ? (
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
                    value={stackScopeMode}
                    onChange={(e) => setStackScopeMode(e.target.value as "all" | "one")}
                  >
                    <option value="all">All stacks (*)</option>
                    <option value="one">One stack…</option>
                  </select>
                </div>
                {stackScopeMode === "one" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500" htmlFor="stack-proj-filter">
                        Narrow list by project (optional)
                      </label>
                      <select
                        id="stack-proj-filter"
                        className="w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm"
                        value={stackProjectFilter}
                        onChange={(e) => setStackProjectFilter(e.target.value)}
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
                        value={stackSlug}
                        onChange={(e) => setStackSlug(e.target.value)}
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
            {access === "admin" || access === "terraform" ? (
              <p className="text-slate-200">{scopeLabel}</p>
            ) : computedScopes ? (
              <ul className="list-inside list-disc font-mono text-xs text-accent">
                {computedScopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              <p className="text-amber-400">Incomplete — go back and finish scope selections.</p>
            )}
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
          <Button type="button" onClick={goNext}>
            Next
          </Button>
        ) : (
          <Button
            type="button"
            disabled={
              createM.isPending ||
              !name.trim() ||
              (access === "scoped" && !computedScopes)
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
