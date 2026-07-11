import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { FileContent } from "../../api";
import { isMarkdownPath } from "./markdown/isMarkdown";

const MarkdownPreviewView = lazy(() => import("./markdown/MarkdownPreviewView"));

type Props = {
  file: FileContent;
  projectID: string;
  onOpenPath?: (path: string, fragment?: string) => void;
  pendingFragment?: string;
  onFragmentConsumed?: () => void;
};

type ViewMode = "preview" | "source";

export function FilePreviewView({
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
  const showText = (file.kind === "text" || file.kind === "too_large") && file.content != null;
  const showImage = file.kind === "image" && !!file.dataUrl;
  const showMeta =
    !showText &&
    !showImage &&
    (file.kind === "binary" || file.kind === "image" || !!file.message);

  const isMarkdown = showText && isMarkdownPath(file.path);
  const truncated = !!file.truncated;
  const canPreview = isMarkdown && !truncated && file.content !== "";
  const [mode, setMode] = useState<ViewMode>("preview");

  useEffect(() => {
    setMode("preview");
  }, [file.path, file.source]);

  const effectiveMode: ViewMode = canPreview ? mode : "source";

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
          </div>
        </div>
        {isMarkdown && file.content != null ? (
          <div
            className="ml-auto flex shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-canvas-subtle)] p-0.5"
            role="group"
            aria-label="Markdown 显示模式"
          >
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
        ) : null}
      </div>

      {showImage ? (
        <img
          src={file.dataUrl}
          alt={file.path}
          className="max-w-full border border-[var(--color-border)] rounded-[var(--radius-sm)]"
        />
      ) : null}

      {showText ? (
        file.content === "" ? (
          <p className="text-sm text-[var(--color-text-secondary)]">空文件</p>
        ) : (
          <>
            {canPreview ? (
              <div
                className={effectiveMode === "preview" ? undefined : "hidden"}
                aria-hidden={effectiveMode !== "preview"}
              >
                <MarkdownErrorBoundary
                  onShowSource={() => setMode("source")}
                  fallback={<SourceBlock content={file.content!} />}
                >
                  <Suspense
                    fallback={
                      <p className="text-sm text-[var(--color-text-secondary)]">加载 Markdown 预览…</p>
                    }
                  >
                    <MarkdownPreviewView
                      content={file.content!}
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
            {effectiveMode === "source" || !canPreview ? (
              <SourceBlock content={file.content!} />
            ) : null}
          </>
        )
      ) : null}

      {showMeta ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {file.message || "无法预览此文件"}
          </p>
        </div>
      ) : null}
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

function formatByteSize(n: number): string {
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
