import { useEffect, useRef } from "react";

/** Heroicons-style chevron-down (20×20), `currentColor` for the control. */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type Props = {
  variableKey: string;
  /** When true, show Encrypt; when false, show Declassify (matches bundle storage). */
  isPlain: boolean;
  /** Controlled open state — parent should lift this so the table row can use a higher z-index. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onEncrypt: () => void | Promise<void>;
  onDeclassify: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
};

/**
 * Multifunction control for one bundle variable row — same idea as Jinja
 * `bundle-var-actions-menu` (summary “Actions” + panel).
 *
 * Must be controlled from the parent so the host `<tr>` can set `z-index` while open;
 * otherwise the panel stacks under the next row and clicks pass through.
 */
export function BundleVarActionsMenu({
  variableKey,
  isPlain,
  open,
  onOpenChange,
  onEdit,
  onEncrypt,
  onDeclassify,
  onRemove,
}: Props) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const label = `Actions for ${variableKey}`;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      onOpenChangeRef.current(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  function closeThen(fn: () => void) {
    onOpenChange(false);
    fn();
  }

  return (
    <details
      ref={rootRef}
      data-bundle-var-actions
      className="relative block w-full min-w-[6.5rem]"
      open={open}
      onToggle={(e) => {
        onOpenChange(e.currentTarget.open);
      }}
    >
      <summary
        className="list-none flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-accent/90 bg-[#0b0f14] px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-[#121820] [&::-webkit-details-marker]:hidden"
        aria-label={label}
      >
        <span>Actions</span>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 opacity-90 transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
        />
      </summary>
      <div
        className="absolute right-0 z-[300] mt-1 min-w-[11rem] rounded-lg border border-slate-600/90 bg-[#141a22] py-1 shadow-2xl ring-1 ring-black/40"
        role="group"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="block w-full border-b border-slate-600/80 bg-[#141a22] px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800/90"
          onClick={() => closeThen(onEdit)}
        >
          Edit…
        </button>
        {isPlain ? (
          <button
            type="button"
            className="block w-full border-b border-slate-600/80 bg-[#141a22] px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800/90"
            title="Encrypt with Fernet (no need to retype the value)"
            onClick={() => {
              onOpenChange(false);
              void onEncrypt();
            }}
          >
            Encrypt
          </button>
        ) : (
          <button
            type="button"
            className="block w-full border-b border-slate-600/80 bg-[#141a22] px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-slate-800/90"
            title="Store decrypted value as plain text"
            onClick={() => {
              onOpenChange(false);
              void onDeclassify();
            }}
          >
            Declassify…
          </button>
        )}
        <button
          type="button"
          className="block w-full bg-[#141a22] px-3 py-2 text-left text-sm text-red-400 transition hover:bg-red-950/50"
          onClick={() => {
            onOpenChange(false);
            void onRemove();
          }}
        >
          Remove…
        </button>
      </div>
    </details>
  );
}
