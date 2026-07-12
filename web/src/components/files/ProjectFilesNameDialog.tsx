import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
};

export function ProjectFilesNameDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  submitLabel,
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 px-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <label className="mt-3 block text-xs text-[var(--color-text-secondary)]">
          {label}
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!trimmed}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-canvas)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
