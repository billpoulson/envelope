import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ENV_LINK_HIGHLIGHT_SHA256_PARAM } from "@/envLinkHighlight";

const ROW_ID_PREFIX = "env-link-row-";

/**
 * Reads `highlight_sha256` from the URL, pins matching `token_sha256` for styling, scrolls/focuses the row,
 * then removes the param from the address bar (replace).
 */
export function useEnvLinkRowHighlight(
  rows: { id: number; token_sha256: string }[],
  routeKey: string,
): { isHighlighted: (tokenSha256: string) => boolean } {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pinnedSha, setPinnedSha] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    setPinnedSha(null);
  }, [routeKey]);

  useEffect(() => {
    if (doneRef.current) return;
    const raw = searchParams.get(ENV_LINK_HIGHLIGHT_SHA256_PARAM);
    if (raw === null) return;

    const h = raw.trim().replace(/\s+/g, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) {
      doneRef.current = true;
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete(ENV_LINK_HIGHLIGHT_SHA256_PARAM);
          return n;
        },
        { replace: true },
      );
      return;
    }

    if (!rows.length) return;

    const match = rows.find((r) => r.token_sha256 === h);
    doneRef.current = true;
    if (!match) {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.delete(ENV_LINK_HIGHLIGHT_SHA256_PARAM);
          return n;
        },
        { replace: true },
      );
      return;
    }

    setPinnedSha(h);
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete(ENV_LINK_HIGHLIGHT_SHA256_PARAM);
        return n;
      },
      { replace: true },
    );

    requestAnimationFrame(() => {
      const el = document.getElementById(`${ROW_ID_PREFIX}${match.id}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus();
    });
  }, [rows, searchParams, setSearchParams]);

  return {
    isHighlighted: (tokenSha256: string) => pinnedSha !== null && pinnedSha === tokenSha256,
  };
}

export function envLinkRowId(id: number): string {
  return `${ROW_ID_PREFIX}${id}`;
}
