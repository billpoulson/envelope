/** Step-by-step tutorial for the reusable envelope-env GitHub Action. */

const REPO = "billpoulson/envelope";
const ACTION_PATH = `${REPO}/.github/actions/envelope-env`;

export function GithubActionsTutorial() {
  return (
    <div className="not-prose mt-8 space-y-8 border-t border-border/60 pt-8">
      <h3 className="text-lg font-semibold text-slate-100">Tutorial</h3>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">1. Get credentials</h4>
        <p className="text-sm leading-relaxed text-slate-400">
          In Envelope, open your bundle or stack → <strong className="text-slate-300">Secret env URL</strong> → generate
          a link. You will either store the <strong className="text-slate-300">full HTTPS URL</strong> (one secret) or
          copy the deployment <strong className="text-slate-300">base URL</strong> and the opaque{" "}
          <strong className="text-slate-300">token</strong> (path segment after <code className="font-mono text-slate-300">/env/</code>
          ) into two values.
        </p>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">2. Add GitHub secrets (or variables)</h4>
        <ul className="list-inside list-disc space-y-2 text-sm text-slate-400">
          <li>
            <strong className="text-slate-300">Full URL mode:</strong> repository secret{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-xs text-slate-200">ENVELOPE_ENV_URL</code> — value is
            the opaque link (e.g. <code className="font-mono text-xs text-slate-300">https://…/env/…</code>).
          </li>
          <li>
            <strong className="text-slate-300">Split mode:</strong> variable{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-xs text-slate-200">ENVELOPE_URL</code> (or org
            variable) for the deployment base, including path prefix if you use one; secret{" "}
            <code className="rounded bg-white/10 px-1 font-mono text-xs text-slate-200">ENVELOPE_ENV_TOKEN</code> for the
            token only.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">3. Pin the action</h4>
        <p className="text-sm leading-relaxed text-slate-400">
          Reference <code className="rounded bg-white/10 px-1 font-mono text-xs text-slate-200">{ACTION_PATH}</code> with
          a <strong className="text-slate-300">semver tag</strong> or <strong className="text-slate-300">commit SHA</strong>
          . Avoid bare branch names for reproducible builds.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-[#0b0f14] p-4 text-xs leading-relaxed text-slate-300">
          {`uses: ${ACTION_PATH}@v1.0.0   # example tag — use the tag you publish`}
        </pre>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">4. Example workflow</h4>
        <p className="text-sm text-slate-400">
          <strong className="text-slate-300">Full opaque URL</strong> (matches a simple{" "}
          <code className="font-mono text-xs text-slate-300">curl</code> to the same link):
        </p>
        <pre className="max-h-[min(360px,45vh)] overflow-auto rounded-lg border border-border/60 bg-[#0b0f14] p-4 text-xs leading-relaxed text-slate-300">
          {`jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: ${ACTION_PATH}@v1.0.0
        with:
          opaque-env-url: \${{ secrets.ENVELOPE_ENV_URL }}
          export-to-github-env: true

      - name: Use secrets
        run: echo "\${{ env.MY_VAR }}"   # variables from the bundle appear as env vars`}
        </pre>
        <p className="text-sm text-slate-400">
          <strong className="text-slate-300">Deployment URL + token</strong> (path-prefixed deployments, or when you keep
          base URL and token separate):
        </p>
        <pre className="max-h-[min(360px,45vh)] overflow-auto rounded-lg border border-border/60 bg-[#0b0f14] p-4 text-xs leading-relaxed text-slate-300">
          {`      - uses: ${ACTION_PATH}@v1.0.0
        with:
          envelope-url: \${{ vars.ENVELOPE_URL }}
          token: \${{ secrets.ENVELOPE_ENV_TOKEN }}
          out-file: .envelope.env
          out-format: dotenv`}
        </pre>
        <p className="text-sm text-slate-500">
          Default <code className="font-mono text-slate-400">out-file</code> is the runner temp path; override to write
          into the workspace. Set <code className="font-mono text-slate-400">export-to-github-env: true</code> to inject
          all keys into <code className="font-mono text-slate-400">$GITHUB_ENV</code> for later steps without sourcing a
          file.
        </p>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">5. Vendoring (optional)</h4>
        <p className="text-sm text-slate-400">
          Copy <code className="font-mono text-xs text-slate-300">action.yml</code> and{" "}
          <code className="font-mono text-xs text-slate-300">envelope_run.py</code> into{" "}
          <code className="font-mono text-xs text-slate-300">.github/actions/envelope-env/</code> in your repo, then{" "}
          <code className="font-mono text-xs text-slate-300">uses: ./.github/actions/envelope-env</code>.
        </p>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-400">
          <li>
            <a
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:opacity-90"
              href={`https://github.com/${REPO}/tree/main/.github/actions/envelope-env`}
              target="_blank"
              rel="noreferrer"
            >
              Browse on GitHub
            </a>
          </li>
          <li>
            Raw:{" "}
            <a
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:opacity-90"
              href={`https://raw.githubusercontent.com/${REPO}/main/.github/actions/envelope-env/action.yml`}
              target="_blank"
              rel="noreferrer"
            >
              action.yml
            </a>
            ,{" "}
            <a
              className="text-accent underline decoration-accent/40 underline-offset-2 hover:opacity-90"
              href={`https://raw.githubusercontent.com/${REPO}/main/.github/actions/envelope-env/envelope_run.py`}
              target="_blank"
              rel="noreferrer"
            >
              envelope_run.py
            </a>{" "}
            (pin a tag in the URL when you care about reproducibility)
          </li>
        </ul>
      </section>
    </div>
  );
}
