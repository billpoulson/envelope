import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type ResourceListItem = {
  name: string;
  /** Primary destination (typically edit / variables / layers). */
  href: string;
  /** Secondary links shown on the right (e.g. env links, key graph). */
  extras?: { label: string; to: string }[];
};

const extraBtnClass =
  "inline-flex items-center justify-center rounded-lg border border-border/80 bg-[#141a22] px-3 py-1.5 text-xs font-medium text-slate-200 shadow-sm transition hover:border-border hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

type Props = {
  items: ResourceListItem[];
  emptyMessage: string;
  /** Shown inside the dashed empty state for emphasis. */
  emptyHint?: ReactNode;
  /** Render shortcut extras as compact buttons instead of text links (e.g. bundle env / sealed). */
  extrasAsButtons?: boolean;
};

/**
 * Shared list shell for bundle/stack name lists: bordered panel, row hover, optional shortcut links.
 */
export function ResourceList({ items, emptyMessage, emptyHint, extrasAsButtons }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-[#0b0f14]/40 px-6 py-12 text-center">
        <p className="text-sm text-slate-400">{emptyMessage}</p>
        {emptyHint ? <p className="mt-2 text-xs text-slate-600">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <ul className="overflow-hidden rounded-xl border border-border/70 bg-gradient-to-b from-[#0f161d]/90 to-[#0b0f14]/95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
      {items.map((item) => (
        <li key={item.name} className="border-b border-border/45 last:border-0">
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <Link
              to={item.href}
              className="group flex min-w-0 items-baseline gap-2 sm:max-w-[min(100%,42rem)]"
            >
              <span className="truncate font-mono text-sm font-medium tracking-tight text-slate-100 transition group-hover:text-white">
                {item.name}
              </span>
              <span
                className="shrink-0 text-xs text-slate-600 opacity-0 transition group-hover:text-accent group-hover:opacity-100"
                aria-hidden="true"
              >
                →
              </span>
            </Link>
            {item.extras && item.extras.length > 0 ? (
              <nav
                className="flex flex-wrap items-center gap-2 border-t border-border/35 pt-3 sm:border-0 sm:pt-0"
                aria-label={`Shortcuts for ${item.name}`}
              >
                {item.extras.map((ex) =>
                  extrasAsButtons ? (
                    <Link
                      key={ex.to}
                      to={ex.to}
                      className={`${extraBtnClass} whitespace-nowrap`}
                      aria-label={ex.label === "Open" ? `Open ${item.name}` : undefined}
                    >
                      {ex.label}
                    </Link>
                  ) : (
                    <Link
                      key={ex.to}
                      to={ex.to}
                      className="whitespace-nowrap text-xs font-medium text-slate-500 underline-offset-2 transition hover:text-accent hover:underline"
                    >
                      {ex.label}
                    </Link>
                  ),
                )}
              </nav>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
