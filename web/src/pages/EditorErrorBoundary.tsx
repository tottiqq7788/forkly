import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  resetKey?: string | number;
  title?: string;
  fallbackBody?: string;
  onFallback?: (err: Error) => void;
  /** When true, render nothing on error (parent shows its own banner). */
  silent?: boolean;
};

type State = { error: Error | null };

/** Catches render/effect errors so a markdown editor crash cannot blank the whole app. */
export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown editor failed", error, info);
    this.props.onFallback?.(error);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;

    const title = this.props.title ?? "编辑器出错";
    const body =
      this.props.fallbackBody ??
      (this.state.error.message || "发生未知错误。可以尝试重新加载编辑器。");

    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">{title}</h1>
          <p className="text-[var(--color-text-secondary)] mb-4 break-words">{body}</p>
          <button
            type="button"
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
