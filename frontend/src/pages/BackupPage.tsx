import { useState } from "react";
import { downloadEncryptedBackup, restoreDatabase } from "@/api/system";
import { Button } from "@/components/ui";

/**
 * Raw SQLite download uses the session cookie; same-origin from /app in production
 * or Vite proxy in dev.
 */
async function downloadRawBackup(): Promise<void> {
  const res = await fetch("/api/v1/system/backup/database", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition");
  let name = "envelope-backup.db";
  if (cd) {
    const m = /filename="([^"]+)"/.exec(cd);
    if (m) name = m[1] ?? name;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BackupPage() {
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="mb-2 text-2xl font-semibold text-white">Backup</h1>
        <p className="text-slate-400">
          Full SQLite snapshots (admin only). Raw download is unencrypted; passphrase export wraps the
          database for safer transport.
        </p>
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {ok ? <p className="text-sm text-green-400">{ok}</p> : null}

      <section>
        <h2 className="mb-3 text-lg text-white">Download</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setErr(null);
              setOk(null);
              setBusy(true);
              void downloadRawBackup()
                .catch((e: unknown) =>
                  setErr(e instanceof Error ? e.message : "Download failed"),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Working…" : "Download raw database"}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg text-white">Encrypted download</h2>
        <p className="mb-3 text-sm text-slate-500">
          Uses <code className="font-mono text-slate-400">POST /api/v1/system/backup/database</code>{" "}
          with your passphrase.
        </p>
        <label className="mb-2 block text-sm text-slate-400">Passphrase</label>
        <input
          type="password"
          className="mb-3 w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="new-password"
        />
        <div>
          <Button
            type="button"
            disabled={busy || !passphrase.trim()}
            onClick={() => {
              setErr(null);
              setOk(null);
              setBusy(true);
              void downloadEncryptedBackup(passphrase)
                .then(() => setOk("Encrypted backup downloaded."))
                .catch((e: unknown) =>
                  setErr(e instanceof Error ? e.message : "Encrypted download failed"),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Working…" : "Download encrypted backup"}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg text-white">Restore</h2>
        <p className="mb-3 text-sm text-amber-200/90">
          Restoring replaces the SQLite file on the server. Requires{" "}
          <code className="font-mono">ENVELOPE_RESTORE_ENABLED=true</code> and is rate-limited.
        </p>
        <label className="mb-2 block text-sm text-slate-400">Backup file</label>
        <input
          type="file"
          className="mb-3 block text-sm text-slate-300"
          accept=".db,.envelope-db,application/octet-stream"
          onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
        />
        <label className="mb-2 block text-sm text-slate-400">Passphrase (if encrypted)</label>
        <input
          type="password"
          className="mb-3 w-full max-w-md rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm"
          value={restorePass}
          onChange={(e) => setRestorePass(e.target.value)}
          autoComplete="new-password"
        />
        <div>
          <Button
            type="button"
            variant="secondary"
            className="border-amber-900/80 text-amber-100"
            disabled={busy || !restoreFile}
            onClick={() => {
              if (!restoreFile) return;
              if (
                !confirm(
                  "This will replace the live database with your upload. Continue?",
                )
              ) {
                return;
              }
              setErr(null);
              setOk(null);
              setBusy(true);
              void restoreDatabase(restoreFile, restorePass)
                .then((msg) => setOk(msg || "Restore completed."))
                .catch((e: unknown) =>
                  setErr(e instanceof Error ? e.message : "Restore failed"),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Restoring…" : "Restore database"}
          </Button>
        </div>
      </section>
    </div>
  );
}
