import type { ReactNode } from "react";

type SegmentedButtonProps = {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** denser padding for compact toolbars (e.g. 目录 / 版本 tabs) */
  compact?: boolean;
};

export function SegmentedButton({
  active,
  disabled,
  onClick,
  children,
  compact = false,
}: SegmentedButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-[var(--radius-sm)] px-2 text-xs transition-colors ${
        compact ? "py-1" : "py-1.5"
      } ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

type SegmentedButtonGroupProps = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function SegmentedButtonGroup({ label, children, className = "" }: SegmentedButtonGroupProps) {
  return (
    <div
      className={`shrink-0 border-t border-[var(--color-border)] p-2 flex gap-1 ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
