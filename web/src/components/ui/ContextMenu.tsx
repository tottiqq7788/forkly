import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ContextMenuPosition = {
  x: number;
  y: number;
};

type PortalMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
};

export function ContextMenuPortal({ x, y, onClose, children }: PortalMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const position = clampMenuPosition(x, y);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-56 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-xs text-[var(--color-text)] shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  children,
  icon,
  destructive,
  onSelect,
}: {
  children: ReactNode;
  icon: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors ${
        destructive
          ? "text-[var(--color-error-fg)] hover:bg-[var(--color-error-bg)]"
          : "hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-[var(--color-border)]" />;
}

export function clampMenuPosition(x: number, y: number) {
  const menuWidth = 224;
  const menuHeight = 320;
  const padding = 8;
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding)),
  };
}
