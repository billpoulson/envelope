import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BundleSubnav } from "@/components/BundleSubnav";

type Props = {
  bundleName: string;
  subnavSlug?: string;
  subtitle: string;
  tertiaryLink?: { to: string; label: string };
  /** Optional row below the subnav (e.g. Variables: Copy key names, Add entry). */
  belowSubnav?: ReactNode;
  children: ReactNode;
};

/**
 * Sticky header + subnav for bundle detail routes inside the main scroll column.
 */
export function BundlePageShell({
  bundleName,
  subnavSlug,
  subtitle,
  tertiaryLink,
  belowSubnav,
  children,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 -mx-4 mb-6 shrink-0 border-b border-border/60 bg-[#0b0f14]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-all font-mono text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {bundleName}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="shrink-0">
            <BundleSubnav projectSlug={subnavSlug} bundleName={bundleName} variant="embedded" />
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
