import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export async function downloadEncryptedBackup(passphrase: string): Promise<void> {
  const csrf = await fetchCsrf();
  const res = await fetch("/api/v1/system/backup/database", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/octet-stream",
      "X-CSRF-Token": csrf,
    },
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition");
  let name = "envelope.envelope-db";
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

export async function restoreDatabase(file: File, passphrase: string): Promise<string> {
  const csrf = await fetchCsrf();
  const fd = new FormData();
  fd.append("file", file);
  if (passphrase) fd.append("passphrase", passphrase);
  const res = await fetch("/api/v1/system/restore/database", {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRF-Token": csrf },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  try {
    const j = JSON.parse(text) as { message?: string };
    return j.message ?? text;
  } catch {
    return text;
  }
}
