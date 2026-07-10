import { ReactNode, useEffect, useRef, useState } from "react";

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
        className={`absolute inset-y-0 right-0 h-full bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-[-16px_0_40px_rgba(15,23,42,0.18)] pointer-events-auto transition-transform duration-[220ms] ease-out ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width }}
        aria-label={title}
      >
        <button
          type="button"
          onClick={requestClose}
          className="absolute left-[-40px] w-10 rounded-l-[var(--radius-lg)] border border-r-0 border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-2.5 text-xs font-semibold leading-none shadow-[-10px_8px_24px_rgba(15,23,42,0.16)] hover:bg-[var(--color-surface-hover)]"
          style={{ top: 16 }}
          title={`关闭${title}`}
        >
          <span className="flex flex-col items-center gap-1.5">
            {[...title].map((char, i) => (
              <span key={`${char}-${i}`}>{char}</span>
            ))}
          </span>
        </button>
        <div className="h-full overflow-auto p-6">{children}</div>
      </section>
    </div>
  );
}
