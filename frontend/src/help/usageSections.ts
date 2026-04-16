/** Split bundled usage.md into sections for the in-app Help page (no iframes to /help/*). */

import usageRaw from "./usage.md?raw";

export type HelpSectionId =
  | "index"
  | "installation"
  | "web-ui"
  | "oidc"
  | "api"
  | "certificates"
  | "terraform"
  | "cli"
  | "github-actions"
  | "backup";

function headingToSectionId(title: string): HelpSectionId | null {
  const t = title.trim();
  if (t === "Installation & hosting") return "installation";
  if (t === "Web UI") return "web-ui";
  if (t === "OpenID Connect (SSO)") return "oidc";
  if (t.startsWith("Exporting bundles")) return "api";
  if (t.startsWith("Certificate-backed")) return "certificates";
  if (t.startsWith("Terraform HTTP")) return "terraform";
  if (t === "CLI tool") return "cli";
  if (t === "GitHub Actions") return "github-actions";
  return null;
}

function parseUsageSections(raw: string): Record<HelpSectionId, string> {
  const blocks = raw.split(/\n(?=## )/);
  const out: Partial<Record<HelpSectionId, string>> = {};
  out.index = (blocks[0] ?? "").trim();

  const backupBlocks: string[] = [];
  for (const block of blocks.slice(1)) {
    const m = block.match(/^## (.+)$/m);
    if (!m) continue;
    const title = m[1]!.trim();
    if (title === "Backups" || title === "Security reminders") {
      backupBlocks.push(block.trim());
      continue;
    }
    const id = headingToSectionId(title);
    if (id) {
      out[id] = block.trim();
    }
  }
  if (backupBlocks.length) {
    out.backup = backupBlocks.join("\n\n---\n\n");
  } else {
    out.backup = "_No backup section found in usage.md._";
  }
  return out as Record<HelpSectionId, string>;
}

export const USAGE_SECTIONS = parseUsageSections(usageRaw);
