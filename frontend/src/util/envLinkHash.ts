/**
 * Env link URLs use GET /env/{token}; the server stores SHA-256(UTF-8(token)).
 * These helpers mirror app/services/env_links.py (token_sha256_hex).
 */

/**
 * If the field contains only a 64-digit hex digest (optional spaces), return lowercase hex.
 * Otherwise null — not a pasted `token_sha256` from the list UI.
 */
export function parseDigestOnlyInput(raw: string): string | null {
  const compact = raw.trim().replace(/\s+/g, "").toLowerCase();
  if (compact.length !== 64) return null;
  if (!/^[0-9a-f]{64}$/.test(compact)) return null;
  return compact;
}

/** Lowercase hex SHA-256 of UTF-8 bytes of `text`. Requires a secure context for subtle crypto. */
export async function sha256HexUtf8(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type ParsedEnvToken = { token: string } | { error: string };

const SLASH_ENV = "/env/";

/**
 * Parse a full URL (any origin or path prefix), or a bare token string.
 * Token must be 16–256 characters (same bounds as the download route).
 */
export function parseEnvLinkInput(raw: string): ParsedEnvToken {
  const t = raw.trim();
  if (!t) {
    return { error: "Paste a full URL or the secret path segment only." };
  }

  // Bare token: single segment, typical url-safe string
  if (!t.includes("/") && !t.includes(":")) {
    if (t.length >= 16 && t.length <= 256) {
      return { token: t };
    }
    return { error: "Bare token must be between 16 and 256 characters." };
  }

  let pathname: string;
  try {
    pathname = new URL(t, "https://placeholder.invalid").pathname;
  } catch {
    return { error: "Could not parse as a URL. Include https:// or paste only the token." };
  }

  const idx = pathname.indexOf(SLASH_ENV);
  if (idx === -1) {
    return { error: "No /env/… segment found in the path." };
  }

  const rest = pathname.slice(idx + SLASH_ENV.length);
  const first = rest.split("/").filter(Boolean)[0];
  if (!first) {
    return { error: "Missing token after /env/." };
  }

  let token: string;
  try {
    token = decodeURIComponent(first);
  } catch {
    return { error: "Invalid percent-encoding in the path." };
  }

  if (token.length < 16 || token.length > 256) {
    return { error: "Token length must be between 16 and 256 characters." };
  }

  return { token };
}
