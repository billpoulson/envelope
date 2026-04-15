import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { fetchCsrf, logout } from "@/api/auth";
import { listProjectEnvironments } from "@/api/projectEnvironments";
import { listProjects } from "@/api/projects";
import { envSearchParam, UNASSIGNED_ENV_SLUG } from "@/projectEnv";

const linkBase =
  "rounded-md px-2 py-1 text-sm transition hover:bg-white/5 hover:text-slate-200";
const linkInactive = "text-slate-400";
const linkActive = "bg-white/10 text-white";

function navLinkClass(active: boolean) {
  return `${linkBase} ${active ? linkActive : linkInactive}`;
}

export function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { pathname } = useLocation();
  /** Full-bleed main: stack layers, env links, and key graph use full width; body scroll is inside the page shell. */
  const stackWorkbenchFullBleed =
    pathname.includes("/key-graph") ||
    (pathname.includes("/stacks/") &&
      (pathname.endsWith("/edit") || pathname.endsWith("/env-links")));
  const projectMatch = useMatch({ path: "/projects/:projectSlug/*", end: false });
  const rawSlug = projectMatch?.params.projectSlug;
  const projectSlug = rawSlug && rawSlug !== "new" ? rawSlug : undefined;

  const onAdminPage =
    pathname === "/backup" || pathname === "/keys" || pathname === "/certificates";
  /** Match classic UI: Projects stays highlighted for any project subtree and global bundle/stack lists. */
  const onProjectsNav =
    pathname === "/projects" ||
    pathname.startsWith("/projects/") ||
    pathname === "/bundles" ||
    pathname.startsWith("/bundles/") ||
    pathname === "/stacks" ||
    pathname.startsWith("/stacks/");
  const [adminOpen, setAdminOpen] = useState(onAdminPage);
  const adminMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAdminOpen(onAdminPage);
  }, [onAdminPage]);

  useEffect(() => {
    if (!adminOpen) return;
    function handlePointerDown(e: PointerEvent) {
      const root = adminMenuRef.current;
      if (root && !root.contains(e.target as Node)) {
        setAdminOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [adminOpen]);

  useEffect(() => {
    if (!adminOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAdminOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [adminOpen]);

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: !!projectSlug,
  });
  const projectLabel =
    projectSlug &&
    (projectsQ.data?.find((p) => p.slug === projectSlug)?.name ?? projectSlug);

  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const projectSearch = projectSlug ? location.search : "";
  const envParam = envSearchParam(searchParams.get("env")) ?? "";

  const environmentsQ = useQuery({
    queryKey: ["project-environments", projectSlug],
    queryFn: () => listProjectEnvironments(projectSlug!),
    enabled: !!projectSlug,
  });

  async function handleLogout() {
    const csrf = await fetchCsrf();
    await logout(csrf);
    qc.removeQueries({ queryKey: ["session"] });
    qc.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-[100dvh] min-h-screen flex-col bg-[#0b0f14]">
      <header className="z-20 shrink-0 border-b border-border/80 bg-[#121820]/95 backdrop-blur">
        <div className="mx-auto w-full max-w-none px-4 pt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Link to="/" className="text-lg font-semibold tracking-tight text-white">
              Envelope
            </Link>
            <div className="flex items-center gap-4">
              <NavLink
                to="/tutorial"
                className={({ isActive }) =>
                  `text-sm ${isActive ? "text-white" : "text-slate-400 hover:text-slate-200"}`
                }
              >
                Tutorial
              </NavLink>
              <NavLink
                to="/help"
                className={({ isActive }) =>
                  `text-sm ${isActive ? "text-white" : "text-slate-400 hover:text-slate-200"}`
                }
              >
                Help
              </NavLink>
            </div>
          </div>

          <nav
            className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-2 text-sm"
            aria-label="Main"
          >
            <Link to="/projects" className={navLinkClass(onProjectsNav)}>
              Projects
            </Link>

            <div className="flex flex-wrap items-center justify-end gap-1">
              <div className="relative" ref={adminMenuRef}>
                <button
                  type="button"
                  id="admin-menu-button"
                  className={`rounded-md px-2 py-1 text-sm ${onAdminPage ? linkActive : linkInactive} hover:bg-white/5 hover:text-slate-200`}
                  aria-expanded={adminOpen}
                  aria-haspopup="menu"
                  aria-controls="admin-menu-panel"
                  onClick={() => setAdminOpen((o) => !o)}
                >
                  Admin
                </button>
                {adminOpen ? (
                  <div
                    id="admin-menu-panel"
                    className="absolute right-0 top-full z-40 min-w-[12rem] rounded-lg border border-border/80 bg-[#0f141a] py-1 shadow-lg"
                    role="menu"
                    aria-label="Administration"
                  >
                    <NavLink
                      to="/backup"
                      role="menuitem"
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`
                      }
                      onClick={() => setAdminOpen(false)}
                    >
                      Backup
                    </NavLink>
                    <NavLink
                      to="/keys"
                      role="menuitem"
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`
                      }
                      onClick={() => setAdminOpen(false)}
                    >
                      API keys
                    </NavLink>
                    <NavLink
                      to="/certificates"
                      role="menuitem"
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm ${isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5"}`
                      }
                      onClick={() => setAdminOpen(false)}
                    >
                      Certificates
                    </NavLink>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className={`${linkBase} ${linkInactive} border-0 bg-transparent hover:text-slate-200`}
                onClick={() => void handleLogout()}
              >
                Log out
              </button>
            </div>
          </nav>

          {projectSlug ? (
            <nav
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/40 py-2 text-sm"
              aria-label="Project"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  to="/projects"
                  className="font-medium text-accent hover:underline"
                  title="Projects — switch or open another project"
                >
                  {projectLabel}
                </Link>
                <span className="text-slate-600" aria-hidden="true">
                  |
                </span>
                <NavLink
                  to={{
                    pathname: `/projects/${encodeURIComponent(projectSlug)}/environments`,
                    search: projectSearch,
                  }}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  Environments
                </NavLink>
                <NavLink
                  to={{
                    pathname: `/projects/${encodeURIComponent(projectSlug)}/bundles`,
                    search: projectSearch,
                  }}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  Bundles
                </NavLink>
                <NavLink
                  to={{
                    pathname: `/projects/${encodeURIComponent(projectSlug)}/stacks`,
                    search: projectSearch,
                  }}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  Stacks
                </NavLink>
                <NavLink
                  to={{
                    pathname: `/projects/${encodeURIComponent(projectSlug)}/settings`,
                    search: projectSearch,
                  }}
                  className={({ isActive }) => navLinkClass(isActive)}
                >
                  Settings
                </NavLink>
              </div>
              <div className="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto sm:shrink-0">
                <label htmlFor="project-env-filter" className="shrink-0 text-slate-500">
                  Environment
                </label>
                <select
                  id="project-env-filter"
                  className="max-w-[min(14rem,calc(100vw-12rem))] rounded-md border border-border/80 bg-[#0b0f14] px-2 py-1 text-sm text-slate-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  value={envParam}
                  disabled={environmentsQ.isLoading}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        if (!v) next.delete("env");
                        else next.set("env", v);
                        return next;
                      },
                      { replace: true },
                    );
                  }}
                >
                  <option value="">All environments</option>
                  <option value={UNASSIGNED_ENV_SLUG}>Unassigned</option>
                  {(environmentsQ.data ?? []).map((row) => (
                    <option key={row.id} value={row.slug}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </div>
            </nav>
          ) : null}
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {stackWorkbenchFullBleed ? (
          <Outlet />
        ) : (
          <div className="mx-auto flex min-h-0 w-full max-w-[min(96rem,calc(100vw-2rem))] flex-1 flex-col overflow-y-auto px-4 py-8">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
