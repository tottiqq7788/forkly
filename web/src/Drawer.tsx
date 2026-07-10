import { ReactNode, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";

const ANIMATION_MS = 220;

export function Drawer({
  title,
  stackIndex = 1,
  width = 520,
  closeSignal,
  onClose,
  onBeforeClose,
  children,
}: {
  title: string;
  stackIndex?: number;
  width?: number;
  closeSignal?: number;
  onClose: () => void;
  onBeforeClose?: () => void;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeSignalRef = useRef(closeSignal);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    };
  }, []);

  function requestClose() {
    if (closeTimer.current) return;
    setVisible(false);
    closeTimer.current = setTimeout(() => {
      onBeforeClose?.();
      onClose();
    }, ANIMATION_MS);
  }

  useEffect(() => {
    if (closeSignalRef.current === closeSignal) return;
    closeSignalRef.current = closeSignal;
    requestClose();
  }, [closeSignal]);

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 40 + stackIndex }}>
      <button
        type="button"
        aria-label={`关闭${title}`}
        onClick={requestClose}
        className={`absolute inset-0 bg-black/10 transition-opacity duration-[220ms] ease-out pointer-events-auto ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <section
        className={`absolute inset-y-0 right-0 h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-[-16px_0_40px_rgba(15,23,42,0.18)] pointer-events-auto transition-transform duration-[220ms] ease-out flex flex-col ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width }}
        aria-label={title}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between gap-3 shrink-0 border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label={`关闭${title}`}
            className="shrink-0 inline-flex items-center justify-center rounded-[var(--radius-sm)] p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
          >
            <X size={18} weight="bold" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-auto p-6">{children}</div>
      </section>
    </div>
  );
}
