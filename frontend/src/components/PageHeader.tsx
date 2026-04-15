import type { ReactNode } from "react";

/** Core sticky bar (no horizontal bleed). Compose with `pageHeaderBleedInsetClasses` or `pageHeaderBleedFullClasses`. */
export const pageHeaderStripBaseClasses =
  "sticky top-0 z-10 mb-6 shrink-0 border-b border-border/60 bg-[#0b0f14]/95 py-4 backdrop-blur";

/** Inside Layout padded column: cancel horizontal padding then re-apply. */
export const pageHeaderBleedInsetClasses = "-mx-4 px-4 sm:px-6";

/** Full-bleed routes (no Layout side padding on main). */
export const pageHeaderBleedFullClasses = "px-4 sm:px-6";

/** Default: inset main column (most pages). */
export const pageHeaderStripClasses = `${pageHeaderStripBaseClasses} ${pageHeaderBleedInsetClasses}`;

export const pageTitleSansClasses = "text-xl font-semibold tracking-tight text-white sm:text-2xl";
export const pageTitleMonoClasses =
  "break-all font-mono text-xl font-semibold tracking-tight text-white sm:text-2xl";
export const pageSubtitleClasses = "mt-0.5 text-sm text-slate-500";

type Props = {
  title: ReactNode;
  /** Plain text uses `pageSubtitleClasses`; pass a React node for custom styling (e.g. mono project name). */
  subtitle?: ReactNode;
  titleVariant?: "sans" | "mono";
  actions?: ReactNode;
  /** Extra block under the title row (e.g. links). */
  below?: ReactNode;
  className?: string;
};

function Subtitle({ children }: { children: ReactNode }) {
  if (children === null || children === undefined) return null;
  if (typeof children === "string" || typeof children === "number") {
    return <p className={pageSubtitleClasses}>{children}</p>;
  }
  return <div className="mt-0.5">{children}</div>;
}

/**
 * Standard page title area: sticky bar, title + optional subtitle, optional right-side actions.
 */
export function PageHeader({
  title,
  subtitle,
  titleVariant = "sans",
  actions,
  below,
  className,
}: Props) {
  const titleClass = titleVariant === "mono" ? pageTitleMonoClasses : pageTitleSansClasses;
  return (
    <header className={className ? `${pageHeaderStripClasses} ${className}` : pageHeaderStripClasses}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className={titleClass}>{title}</h1>
          <Subtitle>{subtitle}</Subtitle>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {below ? <div className="mt-4">{below}</div> : null}
    </header>
  );
}
