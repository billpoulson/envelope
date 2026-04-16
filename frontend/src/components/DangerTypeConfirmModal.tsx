import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

export type DangerTypeConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Intro copy above the danger box (warnings, consequences). */
  description: ReactNode;
  /** Inner content inside the red danger panel (optional extra lines). */
  dangerDetail?: ReactNode;
  /** User must type this string exactly (compared after trim). */
  confirmationPhrase: string;
  /** Accessible label for the text field. */
  typeFieldLabel: string;
  /** Placeholder / hint, e.g. “Stack name” */
  typeFieldHint?: string;
  confirmButtonLabel: string;
  onConfirm: () => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
};

export function DangerTypeConfirmModal({
  open,
  onClose,
  title,
  description,
  dangerDetail,
  confirmationPhrase,
  typeFieldLabel,
  typeFieldHint,
  confirmButtonLabel,
  onConfirm,
  pending = false,
  error,
}: DangerTypeConfirmModalProps) {
  const id = useId();
  const fieldId = `${id}-confirm-input`;
  const [input, setInput] = useState("");

  useEffect(() => {
    if (open) setInput("");
  }, [open]);

  if (!open) return null;

  const expected = confirmationPhrase.trim();
  const matches = input.trim() === expected;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${id}-title`} className="mb-3 text-lg font-semibold text-white">
          {title}
        </h2>
        <div className="mb-4 text-sm text-slate-400">{description}</div>

        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
          {dangerDetail ? <div className="mb-3 text-sm text-slate-300">{dangerDetail}</div> : null}
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-300/90">Confirmation</p>
          <p className="mb-2 text-xs text-slate-500">
            {typeFieldLabel}{" "}
            <span className="font-mono text-slate-300">{expected}</span>
          </p>
          <label className="mb-1 block text-xs text-slate-500" htmlFor={fieldId}>
            {typeFieldHint ?? "Type to confirm"}
          </label>
          <input
            id={fieldId}
            className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            placeholder={expected}
          />
        </div>

        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!matches || pending}
            className="bg-red-900/90 text-white hover:bg-red-800 disabled:opacity-50"
            onClick={() => void onConfirm()}
          >
            {pending ? "Working…" : confirmButtonLabel}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
