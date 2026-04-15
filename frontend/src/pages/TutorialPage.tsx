import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";

function Section({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="mb-3 flex items-baseline gap-3 text-lg font-semibold text-white">
        <span className="font-mono text-sm text-accent">{n}.</span>
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

export default function TutorialPage() {
  return (
    <div>
      <PageHeader title="Tutorial" />
      <div className="max-w-3xl">
      <p className="mb-8 text-slate-400">
        Envelope stores named groups of environment variables (like{" "}
        <code className="rounded bg-white/10 px-1 font-mono text-slate-200">.env</code> files), encrypts
        secrets at rest, and exposes them to you and to automation via API keys. This page walks through the
        web app in order. For long-form reference (API paths, Terraform state, backups), use{" "}
        <Link to="/help" className="text-accent underline">
          Help
        </Link>
        .
      </p>

      <nav
        className="mb-10 rounded-xl border border-border/60 bg-[#0b0f14]/80 p-4 text-sm text-slate-400"
        aria-label="On this page"
      >
        <p className="mb-2 font-medium text-slate-300">On this page</p>
        <ol className="list-inside list-decimal space-y-1">
          <li>
            <a href="#sign-in" className="text-accent hover:underline">
              Sign in
            </a>
          </li>
          <li>
            <a href="#projects" className="text-accent hover:underline">
              Projects
            </a>
          </li>
          <li>
            <a href="#bundles" className="text-accent hover:underline">
              Bundles and variables
            </a>
          </li>
          <li>
            <a href="#stacks" className="text-accent hover:underline">
              Stacks (merged exports)
            </a>
          </li>
          <li>
            <a href="#key-graph" className="text-accent hover:underline">
              Key graph and aliases
            </a>
          </li>
          <li>
            <a href="#env-links" className="text-accent hover:underline">
              Secret env URLs
            </a>
          </li>
          <li>
            <a href="#admin" className="text-accent hover:underline">
              API keys and other admin tools
            </a>
          </li>
        </ol>
      </nav>

      <div className="space-y-12">
        <Section id="sign-in" n={1} title="Sign in">
          <p>
            Open <strong className="text-slate-200">Log in</strong> and paste an <strong className="text-slate-200">admin</strong>{" "}
            API key. The server checks the key; it is not kept in the browser after the session is established.
            Create additional keys (including non-admin scopes) under{" "}
            <strong className="text-slate-200">Admin → API keys</strong> once you are signed in.
          </p>
        </Section>

        <Section id="projects" n={2} title="Projects">
          <p>
            Go to <Link to="/projects" className="text-accent underline">Projects</Link> and create a
            project if you do not have one. A project groups <strong className="text-slate-200">bundles</strong> and{" "}
            <strong className="text-slate-200">stacks</strong> and has a stable <strong className="text-slate-200">slug</strong>{" "}
            used in URLs (and in optional Terraform state paths). Use{" "}
            <strong className="text-slate-200">Settings</strong> inside a project to rename it or inspect the slug.
          </p>
        </Section>

        <Section id="bundles" n={3} title="Bundles and variables">
          <p>
            Inside a project, open <strong className="text-slate-200">Bundles</strong>, then{" "}
            <strong className="text-slate-200">New bundle</strong>. Each bundle is a named collection of keys and
            values. On the bundle edit page you can add variables, mark them as encrypted secrets or plaintext, import
            from paste, and manage <strong className="text-slate-200">sealed secrets</strong> (client-encrypted payloads)
            on the dedicated tab.
          </p>
          <p>
            Bundles are the unit of access control: API keys can be scoped to read or write specific bundles (or
            whole projects).
          </p>
        </Section>

        <Section id="stacks" n={4} title="Stacks (merged exports)">
          <p>
            Open <strong className="text-slate-200">Stacks</strong> and create a stack. A stack is an{" "}
            <strong className="text-slate-200">ordered list of bundles</strong> (layers), bottom to top. When you
            export the stack, Envelope merges all variables: keys from higher layers replace the same key from lower
            layers. One bundle cannot appear twice in the same stack; each layer picks a bundle and which keys to
            include (all keys, or a selected subset—including names forwarded from lower layers).
          </p>
          <p>
            Use stacks when one pipeline should receive a single <code className="font-mono text-slate-200">.env</code>{" "}
            built from shared base config plus environment-specific overrides.
          </p>
        </Section>

        <Section id="key-graph" n={5} title="Key graph and aliases">
          <p>
            Open a stack’s <strong className="text-slate-200">Key graph</strong> to see every variable name, the value
            each layer contributes, which layer wins, and the final merged export. Enable{" "}
            <strong className="text-slate-200">Show secret values</strong> only when you need plaintext loaded from the
            server.
          </p>
          <p>
            On stack edit, layers above the bottom can define <strong className="text-slate-200">key aliases</strong>:
            export an extra name (for example <code className="font-mono text-slate-200">VITE_OIDC_KEY</code>) that
            copies the value of a variable already present in merged layers below (for example{" "}
            <code className="font-mono text-slate-200">OIDC_KEY</code>) without storing the value twice. From the key
            graph, right-click a layer column (or a cell in that column) and choose{" "}
            <strong className="text-slate-200">Key aliases for this layer…</strong> to edit aliases in a modal. The
            graph shows alias relationships next to the variable name and in cells.
          </p>
          <p>
            You can drag a value to another layer’s empty cell to move the variable between bundles, or use the
            right-click menu to move, edit in the source bundle, or remove from a bundle.
          </p>
        </Section>

        <Section id="env-links" n={6} title="Secret env URLs">
          <p>
            From a bundle’s or stack’s <strong className="text-slate-200">Secret env URL</strong> page, create opaque
            links. Anyone with the URL can download that bundle or merged stack as <code className="font-mono text-slate-200">.env</code>{" "}
            or JSON; the path contains only a random token—no project or resource name. Treat these URLs like
            credentials. Stacks support optional <strong className="text-slate-200">prefix slices</strong> (merge only
            through a chosen layer) when creating a link.
          </p>
        </Section>

        <Section id="admin" n={7} title="API keys and other admin tools">
          <p>
            Use the <strong className="text-slate-200">Admin</strong> menu for <strong className="text-slate-200">API keys</strong>,{" "}
            <strong className="text-slate-200">certificates</strong> (for sealed secrets), and{" "}
            <strong className="text-slate-200">backup</strong> of the database. Scoped keys can call the HTTP API to
            export bundles or stacks, manage resources allowed by their scopes, or automate CI without full admin.
          </p>
          <p>
            Full API paths, export examples, Terraform remote state, and security notes live under{" "}
            <Link to="/help" className="text-accent underline">
              Help
            </Link>
            .
          </p>
        </Section>
      </div>
      </div>
    </div>
  );
}
