/** Pretty-print JSON-ish stack values (mirrors static/stack-key-graph.js). */

export function parseJsonish(raw: unknown): unknown | null {
  const s = String(raw).trim();
  if (s.length < 2) return null;
  const c0 = s.charAt(0);
  if (c0 !== "{" && c0 !== "[" && c0 !== '"') return null;
  try {
    let v: unknown = JSON.parse(s);
    if (typeof v === "string") {
      const inner = v.trim();
      if (inner.length < 2) return null;
      const i0 = inner.charAt(0);
      if (i0 !== "{" && i0 !== "[") return null;
      v = JSON.parse(inner);
    }
    if (v !== null && typeof v === "object") return v;
    return null;
  } catch {
    return null;
  }
}

function formatParsedValue(v: unknown): { text: string; mode: "json" | "list" } | null {
  if (Array.isArray(v)) {
    if (v.length === 0) return { text: "[ ]", mode: "json" };
    const onlyPrimitives = v.every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
    if (onlyPrimitives) {
      const lines = v.map((item) => (item === null ? "• null" : `• ${String(item)}`));
      return { text: lines.join("\n"), mode: "list" };
    }
    return { text: JSON.stringify(v, null, 2), mode: "json" };
  }
  if (typeof v === "object" && v !== null) {
    return { text: JSON.stringify(v, null, 2), mode: "json" };
  }
  return null;
}

export function tryPrettyJson(raw: string): { ok: true; text: string; mode: "json" | "list" } | { ok: false; text: string } {
  const parsed = parseJsonish(raw);
  if (parsed === null) return { ok: false, text: String(raw) };
  const out = formatParsedValue(parsed);
  if (!out) return { ok: false, text: String(raw) };
  return { ok: true, ...out };
}

export function hasProvidedCellValue(v: string | null | undefined): boolean {
  if (v == null) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}
