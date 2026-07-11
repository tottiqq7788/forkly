import { FileContent } from "../../api";

export function FilePreviewView({ file }: { file: FileContent }) {
  const slash = file.path.lastIndexOf("/");
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  const dir = slash >= 0 ? file.path.slice(0, slash) : "";
  const sourceLabel = file.source === "head" ? "已提交版本" : "工作区";
  const showText = (file.kind === "text" || file.kind === "too_large") && file.content != null;
  const showImage = file.kind === "image" && !!file.dataUrl;
  const showMeta =
    !showText &&
    !showImage &&
    (file.kind === "binary" || file.kind === "image" || !!file.message);

  return (
    <div>
      <div className="mb-4">
        <div className="text-base font-medium text-[var(--color-text)]">{name || file.path}</div>
        {dir ? <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{dir}/</div> : null}
        <div className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {sourceLabel}
          {file.size != null ? ` · ${formatByteSize(file.size)}` : ""}
          {file.truncated ? (
            <span className="ml-2 text-[var(--color-warning-fg)]">仅显示部分内容</span>
          ) : null}
        </div>
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
          <pre className="text-[12px] font-mono leading-[1.5] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas-subtle)] p-3">
            {file.content}
          </pre>
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

function formatByteSize(n: number): string {
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
