import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { FileContent } from "../../../api";

const MarkdownPreviewView = lazy(() => import("./MarkdownPreviewView"));

export type MarkdownViewerMode = "preview" | "source";

type Props = {
  file: FileContent;
  projectID: string;
  viewMode?: MarkdownViewerMode;
  onOpenPath?: (path: string, fragment?: string) => void;
  pendingFragment?: string;
  onFragmentConsumed?: () => void;
};

export function MarkdownDocumentView({
  file,
  projectID,
  viewMode = "preview",
  onOpenPath,
  pendingFragment = "",
  onFragmentConsumed,
}: Props) {
  const truncated = !!file.truncated;
  const canPreview = !truncated && file.content != null;
  const content = file.content ?? "";

  const [mode, setMode] = useState<MarkdownViewerMode>(() =>
    canPreview ? viewMode : "source",
  );

  useEffect(() => {
    setMode(canPreview ? viewMode : "source");
  }, [file.path, file.source, viewMode, canPreview]);

  const effectiveMode: MarkdownViewerMode =
    !canPreview && mode === "preview" ? "source" : mode;

  return (
    <div>
      {file.content === "" && effectiveMode === "source" ? (
        <p className="text-sm text-[var(--color-text-secondary)]">空文件</p>
      ) : null}

      {canPreview ? (
        <div
          className={effectiveMode === "preview" ? undefined : "hidden"}
          aria-hidden={effectiveMode !== "preview"}
        >
          <MarkdownErrorBoundary
            onShowSource={() => setMode("source")}
            fallback={<SourceBlock content={content} />}
          >
            <Suspense
              fallback={
                <p className="text-sm text-[var(--color-text-secondary)]">加载 Markdown 预览…</p>
              }
            >
              <MarkdownPreviewView
                content={content}
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

      {effectiveMode === "source" || !canPreview ? <SourceBlock content={content} /> : null}
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

export default MarkdownDocumentView;
