import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { FileContent } from "../../../api";
import { MarkdownEditorView, type MarkdownEditorHandle, type SearchResult } from "./MarkdownEditorView";
import { useMarkdownDocument } from "./useMarkdownDocument";
import { useRegisterMarkdownSaveGuard } from "./MarkdownSaveGuard";

const MarkdownPreviewView = lazy(() => import("./MarkdownPreviewView"));

type ViewMode = "edit" | "preview" | "source";

type Props = {
  file: FileContent;
  projectID: string;
  onOpenPath?: (path: string, fragment?: string) => void;
  pendingFragment?: string;
  onFragmentConsumed?: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  clean: "已保存",
  dirty: "未保存",
  saving: "保存中…",
  conflict: "冲突",
  error: "保存失败",
};

export function MarkdownDocumentView({
  file,
  projectID,
  onOpenPath,
  pendingFragment = "",
  onFragmentConsumed,
}: Props) {
  const slash = file.path.lastIndexOf("/");
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  const dir = slash >= 0 ? file.path.slice(0, slash) : "";
  const sourceLabel = file.source === "head" ? "版本" : "目录";
  const truncated = !!file.truncated;
  const editable = !!file.editable && file.source === "worktree" && !truncated;
  const canPreview = !truncated && file.content != null;

  const [mode, setMode] = useState<ViewMode>(editable ? "edit" : "preview");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findWord, setFindWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findInfo, setFindInfo] = useState<{ count: number; index: number; error?: string }>({
    count: 0,
    index: -1,
  });
  const [editorError, setEditorError] = useState<Error | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);

  useEffect(() => {
    setMode(editable ? "edit" : "preview");
    setEditorError(null);
    setFindOpen(false);
    setEditorKey((k) => k + 1);
  }, [file.path, file.source, editable]);

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
    projectID,
    source: file.source,
    path: file.path,
    initial: file,
    enabled: editable,
  });

  const isBlocking =
    editable &&
    (saveStatus === "dirty" ||
      saveStatus === "saving" ||
      saveStatus === "conflict" ||
      saveStatus === "error");

  useRegisterMarkdownSaveGuard(flush, isBlocking);

  useEffect(() => {
    registerSerializer({
      flush: () => editorRef.current?.flush(),
      getMarkdown: () => editorRef.current?.getMarkdown() ?? draftMarkdown,
    });
    return () => registerSerializer(null);
  }, [registerSerializer, draftMarkdown]);

  const effectiveMode: ViewMode = (() => {
    if (!canPreview && mode === "preview") return "source";
    if (!editable && mode === "edit") return canPreview ? "preview" : "source";
    if (editorError && mode === "edit") return canPreview ? "preview" : "source";
    return mode;
  })();

  useEffect(() => {
    if (effectiveMode !== "edit") {
      editorRef.current?.hideAllFloatTools();
    }
  }, [effectiveMode]);

  const runSearch = useCallback(
    (query: string) => {
      if (!editorRef.current) return;
      if (findRegex) {
        try {
          // Validate before handing to Muya.
          void new RegExp(query);
        } catch {
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
        isCaseSensitive: findCase,
        isWholeWord: findWord,
        isRegexp: findRegex,
      });
      applySearchResult(result);
    },
    [findCase, findRegex, findWord],
  );

  function applySearchResult(result: SearchResult) {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    setFindInfo({ count: matches.length, index: result.index, error: undefined });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        if (!editable) return;
        e.preventDefault();
        void flush();
        return;
      }
      if (mod && e.key.toLowerCase() === "f" && effectiveMode === "edit") {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        editorRef.current?.search("");
        editorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, effectiveMode, findOpen, flush]);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftMarkdown);
    } catch {
      // ignore
    }
  }

  async function onDiscard() {
    await discardDraft();
    setEditorKey((k) => k + 1);
  }

  async function onOverwrite() {
    await overwriteWithDraft();
  }

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-[var(--color-text)]">{name || file.path}</div>
          {dir ? <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{dir}/</div> : null}
          <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {sourceLabel}
            {file.size != null ? ` · ${formatByteSize(file.size)}` : ""}
            {truncated ? (
              <span className="ml-2 text-[var(--color-warning-fg)]">仅显示部分内容</span>
            ) : null}
            {!editable && file.source === "worktree" && !truncated ? (
              <span className="ml-2 text-[var(--color-text-tertiary)]">只读</span>
            ) : null}
          </div>
        </div>
        <div
          className="ml-auto flex shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-canvas-subtle)] p-0.5"
          role="group"
          aria-label="Markdown 显示模式"
        >
          {editable ? (
            <ModeButton active={effectiveMode === "edit"} onClick={() => setMode("edit")}>
              编辑
            </ModeButton>
          ) : null}
          <ModeButton
            active={effectiveMode === "preview"}
            disabled={!canPreview}
            onClick={() => setMode("preview")}
          >
            预览
          </ModeButton>
          <ModeButton active={effectiveMode === "source"} onClick={() => setMode("source")}>
            源码
          </ModeButton>
        </div>
      </div>

      {saveStatus === "conflict" ? (
        <div className="forkly-md-conflict">
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
            <button type="button" onClick={() => void onDiscard()}>
              放弃草稿并重载
            </button>
            <button type="button" onClick={() => void onOverwrite()}>
              以草稿覆盖磁盘
            </button>
          </div>
        </div>
      ) : null}

      {editable && effectiveMode === "edit" && !editorError ? (
        <>
          <FormatToolbar
            onCommand={(cmd) => {
              const ed = editorRef.current;
              if (!ed) return;
              if (cmd === "undo") ed.undo();
              else if (cmd === "redo") ed.redo();
              else if (cmd.startsWith("para:")) ed.updateParagraph(cmd.slice(5));
              else ed.format(cmd);
            }}
            status={saveStatus}
            statusLabel={STATUS_LABEL[saveStatus] ?? ""}
            error={lastError}
            onRetry={() => void retry()}
            onFind={() => setFindOpen(true)}
          />
          {findOpen ? (
            <div className="forkly-md-findbar">
              <input
                type="text"
                placeholder="查找"
                value={findQuery}
                autoFocus
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
                    setFindCase(e.target.checked);
                    setTimeout(() => runSearch(findQuery), 0);
                  }}
                />
                大小写
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findWord}
                  onChange={(e) => {
                    setFindWord(e.target.checked);
                    setTimeout(() => runSearch(findQuery), 0);
                  }}
                />
                全词
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findRegex}
                  onChange={(e) => {
                    setFindRegex(e.target.checked);
                    setTimeout(() => runSearch(findQuery), 0);
                  }}
                />
                正则
              </label>
              <span className="text-[var(--color-text-tertiary)]">
                {findInfo.count > 0 ? `${findInfo.index + 1}/${findInfo.count}` : "无匹配"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFindOpen(false);
                  editorRef.current?.search("");
                  editorRef.current?.focus();
                }}
              >
                关闭
              </button>
              {findInfo.error ? <div className="forkly-md-find-hint">{findInfo.error}</div> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {file.content === "" && effectiveMode === "source" ? (
        <p className="text-sm text-[var(--color-text-secondary)]">空文件</p>
      ) : null}

      {editable ? (
        <EditorErrorBoundary
          onFallback={() => {
            setEditorError(new Error("编辑器崩溃"));
            setMode("preview");
          }}
        >
          <MarkdownEditorView
            key={editorKey}
            ref={editorRef}
            markdown={draftMarkdown}
            projectID={projectID}
            markdownPath={file.path}
            hidden={effectiveMode !== "edit" || !!editorError}
            onChange={() => setDraftFromEditor()}
            onOpenPath={onOpenPath}
            onError={(err) => {
              setEditorError(err);
              setMode(canPreview ? "preview" : "source");
            }}
          />
        </EditorErrorBoundary>
      ) : null}

      {canPreview ? (
        <div
          className={effectiveMode === "preview" ? undefined : "hidden"}
          aria-hidden={effectiveMode !== "preview"}
        >
          <MarkdownErrorBoundary
            onShowSource={() => setMode("source")}
            fallback={<SourceBlock content={draftMarkdown} />}
          >
            <Suspense
              fallback={
                <p className="text-sm text-[var(--color-text-secondary)]">加载 Markdown 预览…</p>
              }
            >
              <MarkdownPreviewView
                content={draftMarkdown}
                projectID={projectID}
                source={file.source}
                ownerPath={file.path}
                onOpenPath={onOpenPath ?? (() => undefined)}
                pendingFragment={pendingFragment}
                onFragmentConsumed={onFragmentConsumed}
              />
            </Suspense>
          </MarkdownErrorBoundary>
        </div>
      ) : null}

      {effectiveMode === "source" || (!canPreview && !editable) ? (
        <SourceBlock content={draftMarkdown || file.content || ""} />
      ) : null}

      {editorError && editable ? (
        <p className="mt-2 text-sm text-[var(--color-warning-fg)]">
          编辑器加载失败，已回退到预览/源码。{editorError.message}
        </p>
      ) : null}
    </div>
  );
}

function FormatToolbar({
  onCommand,
  status,
  statusLabel,
  error,
  onRetry,
  onFind,
}: {
  onCommand: (cmd: string) => void;
  status: string;
  statusLabel: string;
  error: string | null;
  onRetry: () => void;
  onFind: () => void;
}) {
  const btn = (label: string, cmd: string, title?: string) => (
    <button type="button" title={title || label} onClick={() => onCommand(cmd)}>
      {label}
    </button>
  );
  return (
    <div className="forkly-md-toolbar" role="toolbar" aria-label="Markdown 格式">
      {btn("撤销", "undo")}
      {btn("重做", "redo")}
      <span className="forkly-md-toolbar-sep" />
      {btn("段", "para:paragraph", "段落")}
      {btn("H1", "para:heading 1")}
      {btn("H2", "para:heading 2")}
      {btn("H3", "para:heading 3")}
      {btn("H4", "para:heading 4")}
      {btn("H5", "para:heading 5")}
      {btn("H6", "para:heading 6")}
      {btn("引用", "para:blockquote")}
      {btn("•", "para:ul-bullet", "无序列表")}
      {btn("1.", "para:ol-order", "有序列表")}
      {btn("☑", "para:ul-task", "任务列表")}
      <span className="forkly-md-toolbar-sep" />
      {btn("B", "strong", "粗体")}
      {btn("I", "em", "斜体")}
      {btn("S", "del", "删除线")}
      {btn("``", "inline_code", "行内代码")}
      {btn("链", "link", "链接")}
      {btn("图", "image", "图片")}
      {btn("ƒ", "inline_math", "行内公式")}
      {btn("∑", "para:mathblock", "块公式")}
      {btn("<>", "para:pre", "代码块")}
      {btn("表", "para:table", "表格")}
      {btn("—", "para:hr", "分隔线")}
      <button type="button" title="查找" onClick={onFind}>
        查找
      </button>
      <div className="forkly-md-save-status" data-status={status}>
        <span>
          {statusLabel}
          {error ? ` · ${error}` : ""}
        </span>
        {(status === "error" || status === "dirty") && (
          <button type="button" onClick={onRetry}>
            重试
          </button>
        )}
      </div>
    </div>
  );
}

function SourceBlock({ content }: { content: string }) {
  return (
    <pre className="text-[12px] font-mono leading-[1.5] whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas-subtle)] p-3">
      {content}
    </pre>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-[var(--radius-sm)] px-3 py-1 text-sm transition-colors ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

class MarkdownErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onShowSource: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown preview failed", error, info);
  }

  componentDidUpdate(prevProps: { children: ReactNode }) {
    if (prevProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] p-4">
          <p className="text-sm font-medium text-[var(--color-error-fg)] mb-2">Markdown 预览失败</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            {this.state.error.message || "解析出错"}
          </p>
          <button
            type="button"
            className="text-sm text-[var(--color-accent-muted)] underline"
            onClick={() => {
              this.setState({ error: null });
              this.props.onShowSource();
            }}
          >
            查看源码
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

class EditorErrorBoundary extends Component<
  { children: ReactNode; onFallback: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown editor failed", error, info);
    this.props.onFallback();
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

function formatByteSize(n: number): string {
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default MarkdownDocumentView;
