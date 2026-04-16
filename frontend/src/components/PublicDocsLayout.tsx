import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { fetchCsrf, logout, sessionInfo } from "@/api/auth";

/**
 * Shell for Help and Tutorial: no admin login required, but shows Dashboard / Log out when signed in.
 */
export function PublicDocsLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["session"], queryFn: sessionInfo });

  async function handleLogout() {
    const csrf = await fetchCsrf();
    await logout(csrf);
    qc.removeQueries({ queryKey: ["session"] });
    qc.clear();
    navigate("/login", { replace: true });
  }

  const homeHref = data?.admin ? "/projects" : "/login";

  return (
    <div className="flex min-h-[100dvh] min-h-screen flex-col bg-[#0b0f14]">
      <header className="z-20 shrink-0 border-b border-border/80 bg-[#121820]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-none flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to={homeHref} className="text-lg font-semibold tracking-tight text-white">
            Envelope
          </Link>
          <div className="flex flex-wrap items-center gap-4">
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
            {isLoading ? (
              <span className="text-sm text-slate-500">…</span>
            ) : data?.admin ? (
              <>
                <Link
                  to="/projects"
                  className="text-sm text-slate-400 transition hover:text-slate-200"
                >
                  Dashboard
                </Link>
                <button
                  type="button"
                  className="text-sm text-slate-400 transition hover:text-slate-200"
                  onClick={() => void handleLogout()}
                >
                  Log out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="text-sm font-medium text-accent transition hover:text-accent/90"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-[min(96rem,calc(100vw-2rem))] flex-1 flex-col overflow-y-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
