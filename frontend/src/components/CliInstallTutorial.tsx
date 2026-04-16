import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getDeploymentBaseUrl } from "@/help/deploymentBaseUrl";

type PathScope = "user" | "system";
type ScriptKind = "unix" | "windows";

function escapeBashSingleQuoted(s: string): string {
  return s.replace(/'/g, `'\\''`);
}

function buildUnixUserInstallScript(deploymentBase: string): string {
  const q = escapeBashSingleQuoted(deploymentBase);
  return `#!/usr/bin/env bash
# Envelope CLI — install to ~/.local/bin and add to your user PATH (~/.profile).
set -euo pipefail
DEPLOYMENT_BASE='${q}'
INSTALL_DIR="\${HOME}/.local/bin"
mkdir -p "\$INSTALL_DIR"
for f in envelope_run.py envelope-run.sh envelope-run.ps1; do
  curl -fsS "\${DEPLOYMENT_BASE}/cli/\$f" -o "\$INSTALL_DIR/\$f"
done
chmod +x "\$INSTALL_DIR/envelope-run.sh"
ln -sf "\$INSTALL_DIR/envelope-run.sh" "\$INSTALL_DIR/envelope-run"
LINE='export PATH="\${HOME}/.local/bin:\$PATH"'
CFG="\${HOME}/.profile"
if [ -f "\$CFG" ] && grep -Fq '.local/bin' "\$CFG" 2>/dev/null; then
  echo "PATH already references ~/.local/bin in \$CFG — skipping append."
else
  touch "\$CFG"
  printf '\\n# Envelope CLI (envelope-run)\\n%s\\n' "\$LINE" >> "\$CFG"
  echo "Appended PATH line to \$CFG"
fi
echo ""
echo "Installed to \$INSTALL_DIR"
echo "Open a new terminal, or run: source \"\$CFG\""
echo "Example: \"\$INSTALL_DIR/envelope-run.sh\" --envelope-url "\$DEPLOYMENT_BASE" --token '<opaque-token>' -- your-command`;
}

function buildUnixSystemInstallScript(deploymentBase: string): string {
  const q = escapeBashSingleQuoted(deploymentBase);
  return `#!/usr/bin/env bash
# Envelope CLI — install to /usr/local (requires sudo). Adds symlinks under /usr/local/bin.
set -euo pipefail
DEPLOYMENT_BASE='${q}'
LIB=/usr/local/lib/envelope-cli
sudo mkdir -p "\$LIB"
for f in envelope_run.py envelope-run.sh envelope-run.ps1; do
  sudo curl -fsS "\${DEPLOYMENT_BASE}/cli/\$f" -o "\$LIB/\$f"
done
sudo chmod +x "\$LIB/envelope-run.sh"
sudo chmod a+r "\$LIB/envelope_run.py" "\$LIB/envelope-run.ps1"
sudo ln -sf "\$LIB/envelope-run.sh" /usr/local/bin/envelope-run
sudo ln -sf "\$LIB/envelope_run.py" /usr/local/bin/envelope_run.py
echo "Installed under \$LIB and linked from /usr/local/bin/"
echo "Example: envelope-run --envelope-url "\$DEPLOYMENT_BASE" --token '<opaque-token>' -- your-command`;
}

function buildWindowsUserInstallScript(deploymentBase: string): string {
  const b = deploymentBase.replace(/'/g, "''");
  return `# Envelope CLI — install to %USERPROFILE%\\.local\\bin and add to your user PATH.
\$ErrorActionPreference = 'Stop'
\$DeploymentBase = '${b}'.TrimEnd('/')
\$dir = Join-Path \$env:USERPROFILE '.local\\bin'
New-Item -ItemType Directory -Force -Path \$dir | Out-Null
@('envelope_run.py', 'envelope-run.sh', 'envelope-run.ps1') | ForEach-Object {
  \$uri = "\$DeploymentBase/cli/\$_"
  Invoke-WebRequest -Uri \$uri -OutFile (Join-Path \$dir \$_) -UseBasicParsing
}
\$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (\$null -eq \$userPath) { \$userPath = '' }
if (\$userPath -notlike "*\$dir*") {
  [Environment]::SetEnvironmentVariable('Path', "\$userPath;\$dir", 'User')
}
Write-Host "Installed to \$dir"
Write-Host "Close and reopen your terminal (or sign out) so PATH updates."
Write-Host 'Example: python .\\envelope_run.py --envelope-url <URL> --token <token> -- (from the install folder)'`;
}

function buildWindowsSystemInstallScript(deploymentBase: string): string {
  const b = deploymentBase.replace(/'/g, "''");
  return `# Envelope CLI — install for all users (requires Administrator PowerShell).
\$ErrorActionPreference = 'Stop'
\$DeploymentBase = '${b}'.TrimEnd('/')
\$installRoot = Join-Path \$env:ProgramFiles 'EnvelopeCLI'
New-Item -ItemType Directory -Force -Path \$installRoot | Out-Null
@('envelope_run.py', 'envelope-run.sh', 'envelope-run.ps1') | ForEach-Object {
  \$uri = "\$DeploymentBase/cli/\$_"
  Invoke-WebRequest -Uri \$uri -OutFile (Join-Path \$installRoot \$_) -UseBasicParsing
}
\$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (\$null -eq \$machinePath) { \$machinePath = '' }
if (\$machinePath -notlike "*\$installRoot*") {
  [Environment]::SetEnvironmentVariable('Path', "\$machinePath;\$installRoot", 'Machine')
}
Write-Host "Installed to \$installRoot"
Write-Host "Close and reopen terminals so PATH updates for all users."
Write-Host 'Example: python .\\envelope_run.py --envelope-url <URL> --token <token> -- (from the install folder)'`;
}

export function CliInstallTutorial() {
  const deploymentBase = useMemo(() => getDeploymentBaseUrl(), []);
  const [pathScope, setPathScope] = useState<PathScope>("user");
  const [scriptKind, setScriptKind] = useState<ScriptKind>(() =>
    typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "windows" : "unix",
  );
  const [copied, setCopied] = useState(false);

  const scriptText = useMemo(() => {
    if (!deploymentBase) return "";
    if (scriptKind === "windows") {
      return pathScope === "user"
        ? buildWindowsUserInstallScript(deploymentBase)
        : buildWindowsSystemInstallScript(deploymentBase);
    }
    return pathScope === "user"
      ? buildUnixUserInstallScript(deploymentBase)
      : buildUnixSystemInstallScript(deploymentBase);
  }, [deploymentBase, pathScope, scriptKind]);

  const copyScript = useCallback(async () => {
    if (!scriptText) return;
    try {
      await navigator.clipboard.writeText(scriptText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [scriptText]);

  const fileName =
    scriptKind === "windows"
      ? pathScope === "user"
        ? "install-envelope-cli-user.ps1"
        : "install-envelope-cli-system.ps1"
      : pathScope === "user"
        ? "install-envelope-cli-user.sh"
        : "install-envelope-cli-system.sh";

  return (
    <div className="not-prose mt-8 space-y-6 border-t border-border/60 pt-8">
      <h3 className="text-lg font-semibold text-slate-100">Install from this deployment</h3>
      <p className="text-sm leading-relaxed text-slate-400">
        The base URL below is detected from your browser address (including a gateway path prefix such as{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-200">/envelope</code> when
        used). Scripts download{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">/cli/envelope_run.py</code> and
        wrappers from this server.
      </p>

      <div className="rounded-lg border border-border/80 bg-[#121820] px-4 py-3 font-mono text-xs text-slate-300 break-all">
        {deploymentBase || "(open this page in the browser to detect URL)"}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            PATH scope
          </legend>
          <div className="flex flex-col gap-2 text-sm text-slate-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="pathScope"
                checked={pathScope === "user"}
                onChange={() => setPathScope("user")}
                className="accent-accent"
              />
              <span>
                <strong className="text-slate-200">User</strong> — your account only (recommended)
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="pathScope"
                checked={pathScope === "system"}
                onChange={() => setPathScope("system")}
                className="accent-accent"
              />
              <span>
                <strong className="text-slate-200">System</strong> — all users on this machine (
                {scriptKind === "windows"
                  ? "run PowerShell as Administrator"
                  : "script uses sudo for /usr/local"}
                )
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Script type
          </legend>
          <div className="flex flex-col gap-2 text-sm text-slate-300">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="scriptKind"
                checked={scriptKind === "unix"}
                onChange={() => setScriptKind("unix")}
                className="accent-accent"
              />
              Bash (macOS / Linux / Git Bash)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="scriptKind"
                checked={scriptKind === "windows"}
                onChange={() => setScriptKind("windows")}
                className="accent-accent"
              />
              PowerShell (Windows)
            </label>
          </div>
        </fieldset>
      </div>

      {pathScope === "system" && (
        <p className="text-sm text-amber-200/90">
          System scope changes shared PATH settings. On Windows you must run the generated script in an elevated
          PowerShell window; on Unix the script invokes <code className="font-mono">sudo</code> where needed.
        </p>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Save as {fileName} (or run with <code className="font-mono text-slate-400">bash</code> /{" "}
            <code className="font-mono text-slate-400">pwsh</code>)
          </span>
          <button
            type="button"
            onClick={() => void copyScript()}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-[#0b0f14] hover:opacity-90"
          >
            {copied ? "Copied" : "Copy script"}
          </button>
        </div>
        <pre className="max-h-[min(480px,50vh)] overflow-auto rounded-lg border border-border/60 bg-[#0b0f14] p-4 text-xs leading-relaxed text-slate-300">
          {scriptText || "…"}
        </pre>
      </div>

      <ul className="list-inside list-disc text-sm text-slate-400">
        <li>
          After installation, use <code className="font-mono text-slate-300">envelope-run</code> (Unix user/system
          symlinks) or run <code className="font-mono text-slate-300">python envelope_run.py</code> from the install
          folder.
        </li>
        <li>
          Pass <code className="font-mono text-slate-300">--envelope-url</code> with the same deployment base as
          above and your opaque <code className="font-mono text-slate-300">--token</code>.
        </li>
        <li>
          For CI, see{" "}
          <Link
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:opacity-90"
            to="/help/github-actions"
          >
            GitHub Actions
          </Link>{" "}
          (reusable action and step-by-step tutorial).
        </li>
      </ul>
    </div>
  );
}
