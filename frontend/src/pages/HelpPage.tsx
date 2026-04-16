import { Navigate, NavLink, useParams } from "react-router-dom";
import { CliInstallTutorial } from "@/components/CliInstallTutorial";
import { GithubActionsTutorial } from "@/components/GithubActionsTutorial";
import { HelpMarkdown } from "@/components/HelpMarkdown";
import { PageHeader } from "@/components/PageHeader";
import type { HelpSectionId } from "@/help/usageSections";
import { USAGE_SECTIONS } from "@/help/usageSections";

const SECTIONS: { id: HelpSectionId; label: string; path: string }[] = [
  { id: "index", label: "Overview", path: "/help" },
  { id: "installation", label: "Installation & hosting", path: "/help/installation" },
  { id: "web-ui", label: "Web UI", path: "/help/web-ui" },
  { id: "oidc", label: "OpenID Connect (SSO)", path: "/help/oidc" },
  { id: "api", label: "API export", path: "/help/api" },
  {
    id: "certificates",
    label: "Certificates & sealed secrets",
    path: "/help/certificates",
  },
  { id: "terraform", label: "Terraform remote state", path: "/help/terraform" },
  { id: "cli", label: "CLI (opaque env)", path: "/help/cli" },
  { id: "github-actions", label: "GitHub Actions", path: "/help/github-actions" },
  { id: "backup", label: "Backup & security", path: "/help/backup" },
];

const VALID_IDS = new Set<HelpSectionId>(SECTIONS.map((s) => s.id));

function splatToSectionId(splat: string | undefined): HelpSectionId | null {
  const s = (splat ?? "").replace(/\/$/, "").trim();
  if (!s) return "index";
  if (VALID_IDS.has(s as HelpSectionId) && s !== "index") {
    return s as HelpSectionId;
  }
  return null;
}

export default function HelpPage() {
  const { "*": splat } = useParams();
  const sectionId = splatToSectionId(splat);

  if (sectionId === null) {
    return <Navigate to="/help" replace />;
  }

  const body = USAGE_SECTIONS[sectionId];

  return (
    <div>
      <PageHeader title="Help" />
      <div className="flex min-h-[70vh] flex-col gap-6 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <nav className="flex flex-col gap-1 text-sm" aria-label="Help sections">
            {SECTIONS.map((s) => (
              <NavLink
                key={s.id}
                to={s.path}
                end={s.id === "index"}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-left ${
                    isActive ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`
                }
              >
                {s.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <article
          className="min-h-[480px] flex-1 overflow-auto rounded-xl border border-border/80 bg-[#0b0f14] p-4 sm:p-6"
          aria-label={SECTIONS.find((x) => x.id === sectionId)?.label ?? "Help"}
        >
          <HelpMarkdown markdown={body} />
          {sectionId === "cli" ? <CliInstallTutorial /> : null}
          {sectionId === "github-actions" ? <GithubActionsTutorial /> : null}
        </article>
      </div>
    </div>
  );
}
