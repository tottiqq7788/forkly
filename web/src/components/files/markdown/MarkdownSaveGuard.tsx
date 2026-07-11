import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";

export type MarkdownSaveGuardValue = {
  flush: () => Promise<boolean>;
  isBlocking: boolean;
  register: (flush: (() => Promise<boolean>) | null, isBlocking: boolean) => void;
};

const MarkdownSaveGuardContext = createContext<MarkdownSaveGuardValue | null>(null);

export function MarkdownSaveGuardProvider({ children }: { children: ReactNode }) {
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const [isBlocking, setIsBlocking] = useState(false);

  const register = useCallback((flush: (() => Promise<boolean>) | null, blocking: boolean) => {
    flushRef.current = flush ?? (async () => true);
    setIsBlocking(blocking);
  }, []);

  const flush = useCallback(async () => flushRef.current(), []);

  const value = useMemo(
    () => ({ flush, isBlocking, register }),
    [flush, isBlocking, register],
  );

  const blocker = useBlocker(isBlocking);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let cancelled = false;
    void (async () => {
      const ok = await flushRef.current();
      if (cancelled) return;
      if (ok) blocker.proceed();
      else blocker.reset();
    })();
    return () => {
      cancelled = true;
    };
  }, [blocker]);

  useEffect(() => {
    if (!isBlocking) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isBlocking]);

  return (
    <MarkdownSaveGuardContext.Provider value={value}>{children}</MarkdownSaveGuardContext.Provider>
  );
}

export function useMarkdownSaveGuard(): MarkdownSaveGuardValue {
  const ctx = useContext(MarkdownSaveGuardContext);
  if (!ctx) {
    return {
      flush: async () => true,
      isBlocking: false,
      register: () => undefined,
    };
  }
  return ctx;
}

/** Register a document session's flush/blocking into the nearest guard provider. */
export function useRegisterMarkdownSaveGuard(
  flush: () => Promise<boolean>,
  isBlocking: boolean,
) {
  const { register } = useMarkdownSaveGuard();
  useEffect(() => {
    register(flush, isBlocking);
    return () => register(null, false);
  }, [flush, isBlocking, register]);
}
