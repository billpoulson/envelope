import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className = "",
  children,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  children?: ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-accent/90 text-white hover:bg-accent"
      : variant === "secondary"
        ? "border border-border bg-surface/80 hover:bg-surface"
        : "text-slate-300 hover:bg-white/5";
  return (
    <button type="button" className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border/80 bg-surface/60 p-6 shadow-sm backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}
