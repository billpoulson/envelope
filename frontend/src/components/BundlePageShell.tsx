import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BundleSubnav } from "@/components/BundleSubnav";
import {
  pageHeaderBleedInsetClasses,
  pageHeaderStripBaseClasses,
  pageSubtitleClasses,
  pageTitleMonoClasses,
} from "@/components/PageHeader";

type Props = {
  /** URL slug segment (used in links). */
  bundleName: string;
  /** Optional display title in the header. */
  displayName?: string;
  subnavSlug?: string;
  /** Appends to bundle subnav links (e.g. `location.search` for `?env=`). */
  linkSearch?: string;
  subtitle: string;
  tertiaryLink?: { to: string; label: string };
  /** Renders inline next to the title (e.g. edit name/slug). */
  titleAccessory?: ReactNode;
  /** Optional row below the subnav (e.g. Variables: Copy key names, Add entry). */
  belowSubnav?: ReactNode;
  children: ReactNode;
};

/**
 * Sticky header + subnav for bundle detail routes inside the main scroll column.
 */
export function BundlePageShell({
  bundleName,
  displayName,
  subnavSlug,
  linkSearch = "",
  subtitle,
  tertiaryLink,
  titleAccessory,
  belowSubnav,
  children,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={`${pageHeaderStripBaseClasses} ${pageHeaderBleedInsetClasses}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1
                className={
                  displayName
                    ? "min-w-0 flex-1 truncate text-xl font-semibold tracking-tight text-slate-100"
                    : `${pageTitleMonoClasses} min-w-0 flex-1 truncate`
                }
              >
                {displayName ?? bundleName}
              </h1>
              {titleAccessory ? <span className="shrink-0">{titleAccessory}</span> : null}
            </div>
            <p className={pageSubtitleClasses}>{subtitle}</p>
          </div>
          <div className="shrink-0">
            <BundleSubnav
              projectSlug={subnavSlug}
              bundleName={bundleName}
              variant="embedded"
              linkSearch={linkSearch}
            />
          </div>
        </div>
        {belowSubnav ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3 sm:mt-4 sm:pt-4">
            {belowSubnav}
          </div>
        ) : null}
        {tertiaryLink ? (
          <div className="mt-4">
            <Link
              className="text-sm text-accent underline decoration-accent/50 underline-offset-2 hover:text-slate-200"
              to={tertiaryLink.to}
            >
              {tertiaryLink.label}
            </Link>
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
