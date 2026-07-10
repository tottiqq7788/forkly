import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClockCounterClockwise, ArrowClockwise } from "@phosphor-icons/react";
import { api, DiffResult, FileStatus, Project, StatusSnapshot } from "../api";
import { Drawer } from "../Drawer";

export default function ProjectPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string>("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<Project>(`/local-api/v1/projects/${id}`),
  });
  const status = useQuery({
    queryKey: ["status", id],
    queryFn: () => api<StatusSnapshot>(`/local-api/v1/projects/${id}/status`),
    refetchInterval: 3000,
  });
  const diff = useQuery({
    queryKey: ["diff", id, activePath],
    queryFn: () => api<DiffResult>(`/local-api/v1/projects/${id}/diff?path=${encodeURIComponent(activePath)}`),
    enabled: !!activePath,
  });

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    const started = Date.now();
    try {
      await Promise.all([
        project.refetch(),
        status.refetch({ cancelRefetch: false }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        activePath ? diff.refetch({ cancelRefetch: false }) : Promise.resolve(),
      ]);
    } finally {
      // Keep spinning for at least one full rotation (1s matches animate-spin).
      const remain = 1000 - (Date.now() - started);
      if (remain > 0) {
        await new Promise((resolve) => setTimeout(resolve, remain));
      }
      setRefreshing(false);
    }
  }

  const files = useMemo(() => {
    const list = status.data?.files || [];
    if (filter === "all") return list;
    return list.filter((f) => f.kind === filter);
  }, [status.data, filter]);

  const commit = useMutation({
    mutationFn: () =>
      api(`/local-api/v1/projects/${id}/commit`, {
        method: "POST",
        body: JSON.stringify({
          paths: [...selected],
          message,
          fingerprint: status.data?.fingerprint,
        }),
      }),
    onSuccess: async () => {
      setCommitOpen(false);
      setMessage("");
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["status", id] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const health = status.data?.health;
  const blocked = health && !health.ok;

  return (
    <div className="flex flex-col h-full">
      <header className="h-12 border-b border-[var(--color-border)] px-4 flex items-center gap-3 shrink-0">
        <Link to="/" className="text-[var(--color-text-secondary)]">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{project.data?.name || "项目"}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">
            当前分支 {health?.branch || "…"} · {(status.data?.files || []).length} 个修改
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] disabled:opacity-60"
          title="刷新"
        >
          <ArrowClockwise size={16} className={refreshing ? "animate-spin" : undefined} />
        </button>
        <Link
          to={`/projects/${id}/history`}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-text-secondary)] px-2 py-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)]"
        >
          <ClockCounterClockwise size={16} />
          历史
        </Link>
        <button
          type="button"
          disabled={selected.size === 0 || !!blocked}
          onClick={() => {
            setErr("");
            setCommitOpen(true);
          }}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          保存版本
        </button>
      </header>

      {blocked && (
        <div className="mx-4 mt-3 rounded-[var(--radius-lg)] border border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] px-4 py-3 text-sm">
          <div className="font-medium text-[var(--color-error-fg)] mb-1">已暂停保存版本</div>
          <p className="text-[var(--color-text-secondary)]">
            {(health?.blockers || []).join("；")}。你的文件没有被更改。请先用熟悉的工具完成或中止，再回来刷新。
          </p>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <section className="w-[280px] border-r border-[var(--color-border)] flex flex-col min-h-0">
          <div className="p-2 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {(["all", "modified", "untracked", "deleted", "renamed"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`text-xs px-2 py-1 rounded-full ${
                  filter === k ? "bg-[var(--color-surface-active)] font-medium" : "text-[var(--color-text-secondary)]"
                }`}
              >
                {labelFilter(k)}
              </button>
            ))}
          </div>
          <ul className="overflow-auto flex-1">
            {files.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                checked={selected.has(f.path)}
                active={activePath === f.path}
                onToggle={() => {
                  const next = new Set(selected);
                  if (next.has(f.path)) next.delete(f.path);
                  else next.add(f.path);
                  setSelected(next);
                }}
                onOpen={() => setActivePath(f.path)}
              />
            ))}
            {files.length === 0 && (
              <li className="p-4 text-sm text-[var(--color-text-secondary)]">没有待保存的修改</li>
            )}
          </ul>
          <div className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            已选择 {selected.size} 个文件
          </div>
        </section>

        <section className="flex-1 min-w-0 overflow-auto p-4">
          {!activePath && (
            <p className="text-[var(--color-text-secondary)]">选择一个文件查看差异</p>
          )}
          {activePath && diff.isLoading && <p>加载差异…</p>}
          {activePath && diff.data && <DiffView diff={diff.data} />}
          {diff.isError && <p className="text-[var(--color-error-fg)]">{(diff.error as Error).message}</p>}
        </section>
      </div>

      {commitOpen && (
        <Drawer title="保存版本" stackIndex={1} width={420} onClose={() => setCommitOpen(false)}>
          <div className="min-h-full flex flex-col">
            <h2 className="text-lg font-semibold mb-3">保存版本</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">将包含 {selected.size} 个文件</p>
            <ul className="mb-4 max-h-40 overflow-auto text-sm space-y-1">
              {[...selected].map((p) => (
                <li key={p} className="font-mono text-xs truncate">
                  {p}
                </li>
              ))}
            </ul>
            <label className="block space-y-1.5 mb-4">
              <span className="text-sm font-medium">版本说明 *</span>
              <textarea
                className="w-full h-28 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="说明这次修改的目的"
              />
            </label>
            <p className="text-xs text-[var(--color-text-tertiary)] mb-4">保存后仍只存在于这个本地项目。</p>
            {err && <p className="text-sm text-[var(--color-error-fg)] mb-3">{err}</p>}
            <div className="mt-auto flex justify-end gap-2">
              <button type="button" onClick={() => setCommitOpen(false)} className="px-3 py-1.5 text-sm">
                取消
              </button>
              <button
                type="button"
                disabled={!message.trim() || commit.isPending}
                onClick={() => commit.mutate()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}

function labelFilter(k: string) {
  switch (k) {
    case "modified":
      return "修改";
    case "untracked":
      return "新增";
    case "deleted":
      return "删除";
    case "renamed":
      return "重命名";
    default:
      return "全部";
  }
}

function FileRow({
  file,
  checked,
  active,
  onToggle,
  onOpen,
}: {
  file: FileStatus;
  checked: boolean;
  active: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <li
      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer ${
        active ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="truncate text-sm font-mono">{file.path}</div>
        <div className="text-[11px] text-[var(--color-text-secondary)]">{kindLabel(file.kind)}</div>
      </button>
    </li>
  );
}

function kindLabel(k: string) {
  const map: Record<string, string> = {
    modified: "修改",
    untracked: "新增",
    added: "新增",
    deleted: "删除",
    renamed: "重命名",
    conflicted: "冲突",
  };
  return map[k] || k;
}

function DiffView({ diff }: { diff: DiffResult }) {
  if (diff.kind === "image") {
    return (
      <div>
        <div className="mb-3 text-sm">
          <span className="font-mono">{diff.path}</span>
          <span className="text-[var(--color-text-secondary)] ml-2">图片</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <figure>
            <figcaption className="text-xs text-[var(--color-text-secondary)] mb-2">上一个版本</figcaption>
            {diff.oldImage ? (
              <img src={diff.oldImage} alt="old" className="max-w-full border border-[var(--color-border)] rounded-[var(--radius-sm)]" />
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)]">无先前版本</p>
            )}
          </figure>
          <figure>
            <figcaption className="text-xs text-[var(--color-text-secondary)] mb-2">当前文件</figcaption>
            {diff.newImage ? (
              <img src={diff.newImage} alt="new" className="max-w-full border border-[var(--color-border)] rounded-[var(--radius-sm)]" />
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)]">{diff.message || "无法预览"}</p>
            )}
          </figure>
        </div>
      </div>
    );
  }
  if (diff.kind === "binary") {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
        <div className="font-mono text-sm mb-2">{diff.path}</div>
        <p className="text-[var(--color-text-secondary)]">{diff.message || "二进制文件"}</p>
        {diff.newSize != null && (
          <p className="text-xs font-mono mt-2 text-[var(--color-text-tertiary)]">{diff.newSize} 字节</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-sm">{diff.path}</span>
        <span className="text-xs text-[var(--color-success-fg)]">+{diff.additions || 0}</span>
        <span className="text-xs text-[var(--color-error-fg)]">-{diff.deletions || 0}</span>
        {diff.truncated && <span className="text-xs text-[var(--color-warning-fg)]">已截断</span>}
      </div>
      <pre className="text-[12px] font-mono leading-[1.45] overflow-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas-subtle)] p-3">
        {(diff.patch || "").split("\n").map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith("+") && !line.startsWith("+++")
                ? "bg-[var(--color-diff-add)]"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "bg-[var(--color-diff-del)]"
                  : line.startsWith("@@")
                    ? "text-[var(--color-text-secondary)]"
                    : ""
            }
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
