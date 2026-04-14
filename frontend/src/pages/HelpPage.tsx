import { useState } from "react";

const SECTIONS: { id: string; label: string; path: string }[] = [
  { id: "index", label: "Overview", path: "/help" },
  { id: "web-ui", label: "Web UI", path: "/help/web-ui" },
  { id: "api", label: "API export", path: "/help/api" },
  {
    id: "certificates",
    label: "Certificates & sealed secrets",
    path: "/help/certificates",
  },
  { id: "terraform", label: "Terraform remote state", path: "/help/terraform" },
  { id: "pulumi", label: "Pulumi state", path: "/help/pulumi" },
  { id: "backup", label: "Backup & security", path: "/help/backup" },
];

export default function HelpPage() {
  const [active, setActive] = useState(SECTIONS[0]!);

  return (
    <div className="flex min-h-[70vh] flex-col gap-6 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <h1 className="mb-4 text-2xl font-semibold text-white">Help</h1>
        <nav className="flex flex-col gap-1 text-sm" aria-label="Help sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`rounded-md px-3 py-2 text-left ${
                active.path === s.path
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
              onClick={() => setActive(s)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <p className="mt-6 text-xs text-slate-500">
          Same documentation as the classic HTML help routes on this host (useful when the admin UI is
          only served under <code className="font-mono text-slate-400">/app</code>).
        </p>
      </aside>
      <div className="min-h-[480px] flex-1 overflow-hidden rounded-xl border border-border/80 bg-[#0b0f14]">
        <iframe
          title={active.label}
          className="h-full min-h-[480px] w-full border-0"
          src={active.path}
        />
      </div>
    </div>
  );
}
