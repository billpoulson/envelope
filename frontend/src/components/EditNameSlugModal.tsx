import { Button } from "@/components/ui";

export type EditNameSlugModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  nameValue: string;
  slugValue: string;
  onNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  onSave: () => void;
  savePending: boolean;
  error?: string | null;
  saveLabel?: string;
};

export function EditNameSlugModal({
  open,
  onClose,
  title,
  nameValue,
  slugValue,
  onNameChange,
  onSlugChange,
  onSave,
  savePending,
  error,
  saveLabel = "Save",
}: EditNameSlugModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-border bg-[#121820] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-name-slug-title"
      >
        <h2 id="edit-name-slug-title" className="mb-4 text-lg font-semibold text-white">
          {title}
        </h2>
        {error ? <p className="mb-4 text-sm text-red-400">{error}</p> : null}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="edit-name-slug-display">
              Name
            </label>
            <input
              id="edit-name-slug-display"
              className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 text-sm text-slate-200"
              value={nameValue}
              onChange={(e) => onNameChange(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="edit-name-slug-segment">
              Slug
            </label>
            <input
              id="edit-name-slug-segment"
              className="w-full rounded border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-200"
              value={slugValue}
              onChange={(e) => onSlugChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used in URLs (lowercase letters, numbers, <code className="text-slate-400">.</code>,{" "}
              <code className="text-slate-400">_</code>, <code className="text-slate-400">-</code>
              ). Changing it updates links.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" disabled={savePending} onClick={() => onSave()}>
            {savePending ? "Saving…" : saveLabel}
          </Button>
          <Button type="button" variant="secondary" disabled={savePending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
