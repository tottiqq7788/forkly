import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { X } from "@phosphor-icons/react";
import type { FileContent } from "../api";
import {
  MarkdownEditorView,
  type MarkdownEditorHandle,
  type SearchResult,
  type SearchOpts,
  type TocItem,
} from "../components/files/markdown/MarkdownEditorView";
import { MarkdownCategoryToolbar, type FormatCommand } from "../components/files/markdown/MarkdownCategoryToolbar";
import { MarkdownTocPanel } from "../components/files/markdown/MarkdownTocPanel";
import { useMarkdownDocument } from "../components/files/markdown/useMarkdownDocument";
import { useRegisterMarkdownSaveGuard } from "../components/files/markdown/MarkdownSaveGuard";
import { isMarkdownPath } from "../components/files/markdown/isMarkdown";
import type { DocumentTransport } from "../components/files/markdown/documentTransport";
import { resolveActiveTocSlug, shouldApplyScrollDerivedTocActive } from "./tocScrollSync";
import {
  applyEditorScrollSnapshot,
  blurFocusedEditorIn,
  readEditorScrollSnapshot,
  resolveRestoredScrollTop,
  shouldPersistScrollSnapshot,
  snapshotFromScrollElement,
  writeEditorScrollSnapshot,
} from "./editorScrollRestore";
import "../components/files/markdown/markdown-editor.css";

const TOC_NAV_LOCK_MS = 2000;
const SCROLL_RESTORE_WATCH_MS = 4000;
const EDITOR_ROOT_SELECTOR = ".forkly-markdown-editor";

const STATUS_LABEL: Record<string, string> = {
  clean: "已保存",
  dirty: "未保存",
  saving: "保存中…",
  conflict: "冲突",
  error: "保存失败",
};

function isFormField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function isEditorKeyTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(EDITOR_ROOT_SELECTOR);
}

function paragraphShortcutFromEvent(e: KeyboardEvent): string | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;

  if (!e.shiftKey && (e.code === "Digit0" || e.key === "0")) return "paragraph";
  for (let level = 1; level <= 6; level += 1) {
    if (!e.shiftKey && (e.code === `Digit${level}` || e.key === String(level))) {
      return `heading ${level}`;
    }
  }

  if (e.shiftKey && (e.code === "Digit7" || e.key === "7")) return "ol-order";
  if (e.shiftKey && (e.code === "Digit8" || e.key === "8")) return "ul-bullet";
  if (e.shiftKey && (e.code === "Digit9" || e.key === "9")) return "ul-task";

  if (e.altKey && !e.shiftKey) {
    const key = e.key.toLowerCase();
    if (key === "q") return "blockquote";
    if (key === "o") return "ol-order";
    if (key === "u") return "ul-bullet";
    if (key === "x") return "ul-task";
    if (key === "m") return "mathblock";
    if (key === "c") return "pre";
    if (e.code === "Minus" || e.key === "-") return "hr";
  }

  if (e.shiftKey && !e.altKey && e.key.toLowerCase() === "t") return "table";

  return null;
}

export function MarkdownEditorWorkspace({
  transport,
  file,
}: {
  transport: DocumentTransport;
  file: FileContent;
}) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  /** While set, ignore scroll-derived TOC highlights so smooth navigation does not flash intermediates. */
  const tocNavLockRef = useRef<{ slug: string; timer: number | null } | null>(null);
  const syncActiveFromScrollRef = useRef<() => void>(() => undefined);
  const suppressScrollSaveRef = useRef(false);
  const tocRef = useRef<TocItem[]>([]);
  const [editorReadyTick, setEditorReadyTick] = useState(0);
  const [toc, setToc] = useState<TocItem[]>([]);
  tocRef.current = toc;
  const [activeSlug, setActiveSlug] = useState("");
  const [editorError, setEditorError] = useState<Error | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findMounted, setFindMounted] = useState(false);
  const [findFocusTarget, setFindFocusTarget] = useState<"find" | "replace">("find");
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findWord, setFindWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findInfo, setFindInfo] = useState<{ count: number; index: number; error?: string }>({
    count: 0,
    index: -1,
  });

  const {
    draftMarkdown,
    saveStatus,
    lastError,
    conflictDiskContent,
    flush,
    retry,
    discardDraft,
    overwriteWithDraft,
    setDraftFromEditor,
    registerSerializer,
  } = useMarkdownDocument({
    transport,
    initial: file,
    enabled: true,
  });

  const isBlocking =
    saveStatus === "dirty" ||
    saveStatus === "saving" ||
    saveStatus === "conflict" ||
    saveStatus === "error";

  useRegisterMarkdownSaveGuard(flush, isBlocking);

  useEffect(() => {
    registerSerializer({
      flush: () => editorRef.current?.flush(),
      getMarkdown: () => editorRef.current?.getMarkdown() ?? draftMarkdown,
    });
    return () => registerSerializer(null);
  }, [registerSerializer, draftMarkdown]);

  useEffect(() => {
    document.title = `${transport.titleName} · Forkly`;
  }, [transport.titleName]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    const persist = () => {
      if (suppressScrollSaveRef.current) return;
      const next = snapshotFromScrollElement(root, activeSlug || undefined);
      const previous = readEditorScrollSnapshot(
        sessionStorage,
        transport.scopeKey,
        transport.markdownPath,
      );
      if (!shouldPersistScrollSnapshot(next, previous)) return;
      writeEditorScrollSnapshot(sessionStorage, transport.scopeKey, transport.markdownPath, next);
    };

    let raf = 0;
    const onScroll = () => {
      if (suppressScrollSaveRef.current) return;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        persist();
      });
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", persist);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", persist);
      persist();
    };
  }, [transport.scopeKey, transport.markdownPath, activeSlug]);

  useEffect(() => {
    if (editorReadyTick === 0) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const saved = readEditorScrollSnapshot(sessionStorage, transport.scopeKey, transport.markdownPath);
    if (!saved || (saved.top <= 0 && !saved.slug)) return;

    let cancelled = false;
    let raf = 0;
    let settledFrames = 0;
    let lastHeight = 0;
    suppressScrollSaveRef.current = true;

    const apply = () => {
      if (cancelled || !scrollRootRef.current) return 0;
      const el = scrollRootRef.current;
      blurFocusedEditorIn(el);
      if (saved.top > 0) return applyEditorScrollSnapshot(el, saved, { blurFocused: true });
      return el.scrollTop;
    };

    apply();
    raf = window.requestAnimationFrame(() => {
      apply();
      syncActiveFromScrollRef.current();
    });

    const started = performance.now();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            apply();
          })
        : null;
    ro?.observe(root);
    // Diagrams / images live under the editor mount and keep growing after onReady.
    const mount = root.querySelector(".forkly-markdown-editor");
    if (mount instanceof HTMLElement) ro?.observe(mount);

    const finish = () => {
      if (cancelled) return;
      // If absolute scroll never stuck (caret/layout fight), jump via heading offset.
      if (saved.slug && root.scrollTop < Math.max(40, saved.top * 0.25)) {
        const headings = Array.from(
          root.querySelectorAll<HTMLElement>(
            ".forkly-muya-mount h1, .forkly-muya-mount h2, .forkly-muya-mount h3, .forkly-muya-mount h4, .forkly-muya-mount h5, .forkly-muya-mount h6",
          ),
        );
        const tocIndex = tocRef.current.findIndex((item) => item.slug === saved.slug);
        const target = tocIndex >= 0 ? headings[tocIndex] : null;
        if (target) {
          blurFocusedEditorIn(root);
          const top = target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 24;
          root.scrollTop = Math.max(0, top);
        } else if (saved.top > 0) {
          applyEditorScrollSnapshot(root, saved, { blurFocused: true });
        }
      }
      blurFocusedEditorIn(root);
      syncActiveFromScrollRef.current();
      suppressScrollSaveRef.current = false;
      const settled = snapshotFromScrollElement(root, saved.slug);
      const previous = readEditorScrollSnapshot(sessionStorage, transport.scopeKey, transport.markdownPath);
      if (shouldPersistScrollSnapshot(settled, previous ?? saved)) {
        writeEditorScrollSnapshot(sessionStorage, transport.scopeKey, transport.markdownPath, {
          ...settled,
          // Keep the original reading progress if we somehow landed near top.
          top: settled.top < 40 && saved.top >= 40 ? saved.top : settled.top,
          scrollHeight: Math.max(settled.scrollHeight, saved.scrollHeight),
          slug: settled.slug || saved.slug,
        });
      }
    };

    const timer = window.setInterval(() => {
      const top = apply();
      const height = root.scrollHeight;
      if (height === lastHeight && Math.abs(top - resolveRestoredScrollTop(root, saved)) <= 2) {
        settledFrames += 1;
      } else {
        settledFrames = 0;
        lastHeight = height;
      }
      const timedOut = performance.now() - started >= SCROLL_RESTORE_WATCH_MS;
      const stable = settledFrames >= 3 && height > root.clientHeight;
      if (!timedOut && !stable) return;
      window.clearInterval(timer);
      ro?.disconnect();
      finish();
    }, 80);

    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
      ro?.disconnect();
      suppressScrollSaveRef.current = false;
    };
  }, [editorReadyTick, transport.scopeKey, transport.markdownPath]);

  const runSearch = useCallback(
    (query: string, opts?: SearchOpts) => {
      if (!editorRef.current) return;
      const isCaseSensitive = opts?.isCaseSensitive ?? findCase;
      const isWholeWord = opts?.isWholeWord ?? findWord;
      const isRegexp = opts?.isRegexp ?? findRegex;
      if (isRegexp && query) {
        try {
          void new RegExp(query);
        } catch {
          editorRef.current.search("");
          setFindInfo({ count: 0, index: -1, error: "无效的正则表达式" });
          return;
        }
      }
      if (!query) {
        editorRef.current.search("");
        setFindInfo({ count: 0, index: -1 });
        return;
      }
      const result = editorRef.current.search(query, {
        isCaseSensitive,
        isWholeWord,
        isRegexp,
      });
      applySearchResult(result);
    },
    [findCase, findRegex, findWord],
  );

  function applySearchResult(result: SearchResult) {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    setFindInfo({ count: matches.length, index: result.index, error: undefined });
  }

  function openFind(focusTarget: "find" | "replace" = "find") {
    setFindFocusTarget(focusTarget);
    setFindMounted(true);
    setFindOpen(true);
  }

  function closeFind() {
    if (!findOpen && !findMounted) return;
    setFindOpen(false);
    editorRef.current?.search("", { selectHighlight: true });
    editorRef.current?.focus();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFindMounted(false);
    }
  }

  useEffect(() => {
    if (!findOpen || !findMounted) return;
    const id = window.requestAnimationFrame(() => {
      const input = findFocusTarget === "replace" ? replaceInputRef.current : findInputRef.current;
      input?.focus();
      input?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [findFocusTarget, findOpen, findMounted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.defaultPrevented) return;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openFind();
        return;
      }
      if (
        (mod && e.altKey && e.key.toLowerCase() === "f") ||
        (!e.metaKey && e.ctrlKey && e.key.toLowerCase() === "h")
      ) {
        e.preventDefault();
        openFind("replace");
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        openFind();
        const r = editorRef.current?.find(e.shiftKey ? "previous" : "next");
        if (r) applySearchResult(r);
        return;
      }
      // Muya does not bind undo/redo itself (MarkText wires these in Electron).
      // contenteditable native undo is useless after Muya rewrites the DOM.
      if (mod && e.key.toLowerCase() === "z") {
        const t = e.target;
        if (isFormField(t)) return;
        e.preventDefault();
        if (e.shiftKey) editorRef.current?.redo();
        else editorRef.current?.undo();
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "y") {
        const t = e.target;
        if (isFormField(t)) return;
        e.preventDefault();
        editorRef.current?.redo();
        return;
      }
      if (isEditorKeyTarget(e.target)) {
        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
          e.preventDefault();
          editorRef.current?.format("link");
          return;
        }

        const paragraphType = paragraphShortcutFromEvent(e);
        if (paragraphType) {
          e.preventDefault();
          editorRef.current?.updateParagraph(paragraphType);
          editorRef.current?.focus();
          return;
        }
      }
      if (e.key === "Escape" && findOpen) {
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen, flush]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || toc.length === 0) return;
    const scrollRoot = root;
    const tocSlugs = toc.map((item) => item.slug);

    function clearTocNavLock() {
      const lock = tocNavLockRef.current;
      if (!lock) return;
      if (lock.timer != null) window.clearTimeout(lock.timer);
      tocNavLockRef.current = null;
    }

    function syncActiveFromScroll() {
      const headings = Array.from(
        scrollRoot.querySelectorAll<HTMLElement>(
          ".forkly-muya-mount h1, .forkly-muya-mount h2, .forkly-muya-mount h3, .forkly-muya-mount h4, .forkly-muya-mount h5, .forkly-muya-mount h6",
        ),
      );
      if (headings.length === 0) return;
      const top = scrollRoot.getBoundingClientRect().top + 24;
      const current = resolveActiveTocSlug(
        headings.map((el) => el.getBoundingClientRect().top),
        tocSlugs,
        top,
      );

      const decision = shouldApplyScrollDerivedTocActive(tocNavLockRef.current?.slug, current);
      if (decision.clearLock) clearTocNavLock();
      if (!decision.apply) return;

      setActiveSlug((prev) => (prev === current ? prev : current));
    }

    function onUserScrollIntent() {
      if (!tocNavLockRef.current) return;
      clearTocNavLock();
      syncActiveFromScroll();
    }

    function onScrollEnd() {
      if (!tocNavLockRef.current) return;
      clearTocNavLock();
      syncActiveFromScroll();
    }

    syncActiveFromScrollRef.current = syncActiveFromScroll;
    syncActiveFromScroll();
    scrollRoot.addEventListener("scroll", syncActiveFromScroll, { passive: true });
    scrollRoot.addEventListener("scrollend", onScrollEnd);
    scrollRoot.addEventListener("wheel", onUserScrollIntent, { passive: true });
    scrollRoot.addEventListener("touchmove", onUserScrollIntent, { passive: true });
    return () => {
      clearTocNavLock();
      if (syncActiveFromScrollRef.current === syncActiveFromScroll) {
        syncActiveFromScrollRef.current = () => undefined;
      }
      scrollRoot.removeEventListener("scroll", syncActiveFromScroll);
      scrollRoot.removeEventListener("scrollend", onScrollEnd);
      scrollRoot.removeEventListener("wheel", onUserScrollIntent);
      scrollRoot.removeEventListener("touchmove", onUserScrollIntent);
    };
  }, [toc]);

  function selectTocHeading(slug: string) {
    setActiveSlug(slug);
    const ok = editorRef.current?.scrollToHeading(slug) ?? false;
    if (!ok) return;

    const prev = tocNavLockRef.current;
    if (prev?.timer != null) window.clearTimeout(prev.timer);
    // Deadman unlock when scrollend is unavailable; sync so highlight is not stuck.
    const timer = window.setTimeout(() => {
      if (tocNavLockRef.current?.slug !== slug) return;
      tocNavLockRef.current = null;
      syncActiveFromScrollRef.current();
    }, TOC_NAV_LOCK_MS);
    tocNavLockRef.current = { slug, timer };
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftMarkdown);
    } catch {
      // ignore
    }
  }

  function handleCommand(cmd: FormatCommand) {
    const ed = editorRef.current;
    if (!ed) return;
    // undo/redo restore their own caret via History; a trailing focus() can
    // collapse the selection to the start of the block after DOM rewrite.
    if (cmd === "undo") {
      ed.undo();
      return;
    }
    if (cmd === "redo") {
      ed.redo();
      return;
    }
    if (cmd === "find:open") {
      if (findOpen) closeFind();
      else openFind();
      return;
    } else if (cmd === "find:previous") {
      openFind();
      const r = ed.find("previous");
      applySearchResult(r);
    } else if (cmd === "find:next") {
      openFind();
      const r = ed.find("next");
      applySearchResult(r);
    } else if (cmd === "find:replace") {
      openFind();
      const r = ed.replace(replaceQuery, { isSingle: true, isRegexp: findRegex });
      applySearchResult(r);
      setDraftFromEditor();
    } else if (cmd.startsWith("para:")) ed.updateParagraph(cmd.slice(5));
    else ed.format(cmd);
    ed.focus();
  }

  const openHref = useCallback((href: string) => {
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  const handleOpenPath = useCallback(
    (targetPath: string) => {
      if (!isMarkdownPath(targetPath)) {
        const href = transport.openNonMarkdownHref?.(targetPath);
        if (href) openHref(href);
        return;
      }
      if (!transport.openRelativeMarkdown) return;
      void transport
        .openRelativeMarkdown(targetPath)
        .then(({ href }) => openHref(href))
        .catch((err) => {
          setEditorError(err instanceof Error ? err : new Error(String(err)));
        });
    },
    [openHref, transport],
  );

  return (
    <div className="forkly-md-editor-page">
      <header className="forkly-md-editor-topbar">
        <div className="forkly-md-editor-path" title={transport.absPathTooltip || transport.displayPath}>
          <span className="text-[var(--color-text-tertiary)]">{transport.displayLabel}</span>
          <span className="text-[var(--color-text-tertiary)]"> / </span>
          <span>{transport.displayPath}</span>
        </div>
        <div className="forkly-md-save-status" data-status={saveStatus}>
          <span>
            {STATUS_LABEL[saveStatus] ?? ""}
            {lastError ? ` · ${lastError}` : ""}
          </span>
          {(saveStatus === "error" || saveStatus === "dirty") && (
            <button type="button" onClick={() => void retry()}>
              重试
            </button>
          )}
        </div>
      </header>

      {saveStatus === "conflict" ? (
        <div className="forkly-md-conflict forkly-md-editor-banner">
          <h3>内容冲突</h3>
          <p className="text-[var(--color-text-secondary)] m-0">
            磁盘上的文件已被外部修改。草稿已保留，自动保存已暂停。
          </p>
          <div className="forkly-md-conflict-compare">
            <div>
              <div className="text-xs text-[var(--color-text-secondary)] mb-1">磁盘版本</div>
              <pre>{conflictDiskContent ?? "（无法读取）"}</pre>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-secondary)] mb-1">当前草稿</div>
              <pre>{draftMarkdown}</pre>
            </div>
          </div>
          <div className="forkly-md-conflict-actions">
            <button type="button" onClick={() => void copyDraft()}>
              复制草稿
            </button>
            <button
              type="button"
              onClick={() => {
                void discardDraft().then(() => setEditorKey((k) => k + 1));
              }}
            >
              放弃草稿并重载
            </button>
            <button type="button" onClick={() => void overwriteWithDraft()}>
              以草稿覆盖磁盘
            </button>
          </div>
        </div>
      ) : null}

      {editorError ? (
        <div className="forkly-md-editor-banner flex items-center gap-3 text-sm text-[var(--color-warning-fg)] px-4 py-2">
          <span className="min-w-0 flex-1">编辑器加载失败：{editorError.message}</span>
          <button
            type="button"
            className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)]"
            onClick={() => {
              setEditorError(null);
              setEditorKey((k) => k + 1);
            }}
          >
            重新加载编辑器
          </button>
        </div>
      ) : null}

      <div className="forkly-md-editor-body">
        <MarkdownTocPanel
          items={toc}
          activeSlug={activeSlug}
          onSelect={selectTocHeading}
        />

        <section className="forkly-md-editor-main">
          {findMounted ? (
            <div
              className={`forkly-md-findbar ${findOpen ? "is-entering" : "is-leaving"}`}
              onAnimationEnd={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.animationName !== "forkly-md-findbar-out") return;
                if (!findOpen) setFindMounted(false);
              }}
            >
              <input
                ref={findInputRef}
                type="text"
                placeholder="查找"
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  runSearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const r = editorRef.current?.find(e.shiftKey ? "previous" : "next");
                    if (r) applySearchResult(r);
                  }
                }}
              />
              <input
                ref={replaceInputRef}
                type="text"
                placeholder="替换"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.find("previous");
                  if (r) applySearchResult(r);
                }}
              >
                上一个
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.find("next");
                  if (r) applySearchResult(r);
                }}
              >
                下一个
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.replace(replaceQuery, {
                    isSingle: true,
                    isRegexp: findRegex,
                  });
                  if (r) applySearchResult(r);
                  setDraftFromEditor();
                }}
              >
                替换
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.replace(replaceQuery, {
                    isSingle: false,
                    isRegexp: findRegex,
                  });
                  if (r) applySearchResult(r);
                  setDraftFromEditor();
                }}
              >
                全部替换
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={findCase}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setFindCase(next);
                    runSearch(findQuery, { isCaseSensitive: next });
                  }}
                />
                大小写
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findWord}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setFindWord(next);
                    runSearch(findQuery, { isWholeWord: next });
                  }}
                />
                全词
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findRegex}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setFindRegex(next);
                    runSearch(findQuery, { isRegexp: next });
                  }}
                />
                正则
              </label>
              <span className="text-[var(--color-text-tertiary)]">
                {findInfo.count > 0 ? `${findInfo.index + 1}/${findInfo.count}` : "无匹配"}
              </span>
              <button
                type="button"
                className="forkly-md-findbar-close"
                title="关闭"
                aria-label="关闭"
                onClick={closeFind}
              >
                <X size={14} weight="bold" aria-hidden />
              </button>
              {findInfo.error ? <div className="forkly-md-find-hint">{findInfo.error}</div> : null}
            </div>
          ) : null}

          <div ref={scrollRootRef} className="forkly-md-editor-scroll">
            <EditorErrorBoundary
              resetKey={editorKey}
              onFallback={(err) => {
                setEditorError(err);
              }}
            >
              <MarkdownEditorView
                key={editorKey}
                ref={editorRef}
                markdown={draftMarkdown}
                syncExternalContent={saveStatus === "clean"}
                documentKey={transport.remountKey}
                markdownPath={transport.markdownPath}
                assetURL={transport.assetURL}
                uploadAsset={transport.uploadAsset}
                onChange={() => setDraftFromEditor()}
                onTocChange={setToc}
                onReady={() => {
                  const root = scrollRootRef.current;
                  if (root) blurFocusedEditorIn(root);
                  setEditorReadyTick((n) => n + 1);
                }}
                onOpenPath={handleOpenPath}
                onError={(err) => setEditorError(err)}
              />
            </EditorErrorBoundary>
          </div>
        </section>

        <MarkdownCategoryToolbar
          onCommand={handleCommand}
          findOpen={findOpen}
          findQuery={findQuery}
        />
      </div>
    </div>
  );
}

export function FullPageMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">{title}</h1>
        <p className="text-[var(--color-text-secondary)]">{body}</p>
      </div>
    </div>
  );
}

class EditorErrorBoundary extends Component<
  { children: ReactNode; resetKey: number; onFallback: (err: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown editor failed", error, info);
    this.props.onFallback(error);
  }

  componentDidUpdate(prevProps: { resetKey: number }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}
