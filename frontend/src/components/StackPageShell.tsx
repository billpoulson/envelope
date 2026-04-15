import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StackSubnav } from "@/components/StackSubnav";

export type StackTertiaryLink = { to: string; label: string };

type Props = {
  stackName: string;
  subnavSlug?: string;
  subtitle: string;
  tertiaryLink?: StackTertiaryLink;
  /** Set when Layout renders this route full-width (no max-width column), e.g. layers, env links, key graph. */
  fullBleed?: boolean;
  children: ReactNode;
};

/**
 * Sticky header + subnav for stack detail routes inside the main scroll column (matches key graph framing).
 */
export function StackPageShell({
  stackName,
  subnavSlug,
  subtitle,
  tertiaryLink,
  fullBleed,
  children,
}: Props) {
  const headerBleed = fullBleed
    ? "px-4 backdrop-blur sm:px-6"
    : "-mx-4 px-4 backdrop-blur sm:px-6";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={`sticky top-0 z-10 mb-6 shrink-0 border-b border-border/60 bg-[#0b0f14]/95 py-4 ${headerBleed}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-all font-mono text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {stackName}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
          </div>
          <StackSubnav projectSlug={subnavSlug} stackName={stackName} variant="embedded" />
        </div>
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
      <div
        className={
          fullBleed
            ? "min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6"
            : "min-h-0 flex-1"
        }
      >
        {children}
      </div>
    </div>
  );
}
