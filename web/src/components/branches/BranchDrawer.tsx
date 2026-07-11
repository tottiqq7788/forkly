import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwise, Check, GitBranch, PencilSimple, Trash } from "@phosphor-icons/react";
import { api, BranchList, BranchResult, StatusSnapshot } from "../../api";
import { Drawer } from "../../Drawer";

type Props = {
  projectID: string;
  onClose: () => void;
  onSwitched: (status: StatusSnapshot, branch: string) => void;
};

function formatBranchDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clientValidateName(name: string): string {
  const n = name.trim();
  if (!n) return "分支名不能为空";
  if (n.length > 255) return "分支名过长";
  if (n.startsWith("-")) return "分支名无效";
  if (/^(head|fetch_head|orig_head|merge_head)$/i.test(n)) return "分支名无效";
  if (/^refs\//i.test(n) || n.includes("..") || n.includes("@{") || n.includes("\\")) return "分支名无效";
  if (n.startsWith("/") || n.endsWith("/") || n.includes("//")) return "分支名无效";
  if (n.endsWith(".") || n.endsWith(".lock")) return "分支名无效";
  if (/[\s~^:?*\[]/.test(n)) return "分支名无效";
  if (/^[0-9a-f]{7,40}$/i.test(n)) return "分支名不能是提交哈希";
  return "";
}

export function BranchDrawer({ projectID, onClose, onSwitched }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ["branches", projectID],
    queryFn: () => api<BranchList>(`/local-api/v1/projects/${projectID}/branches`),
  });

  const filtered = useMemo(() => {
    const list = branches.data?.branches ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.subject || "").toLowerCase().includes(q) ||
        (b.short || "").toLowerCase().includes(q),
    );
  }, [branches.data?.branches, search]);

  async function invalidateAfterBranchChange() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["branches", projectID] }),
      qc.invalidateQueries({ queryKey: ["status", projectID] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["workspace-tree", projectID] }),
      qc.invalidateQueries({ queryKey: ["file-preview", projectID] }),
      qc.invalidateQueries({ queryKey: ["diff", projectID] }),
      qc.invalidateQueries({ queryKey: ["history", projectID] }),
      qc.invalidateQueries({ queryKey: ["commit", projectID] }),
      qc.invalidateQueries({ queryKey: ["commit-diff", projectID] }),
      qc.invalidateQueries({ queryKey: ["dashboard-activity"] }),
    ]);
  }

  const switchBranch = useMutation({
    mutationFn: (name: string) =>
      api<BranchResult>(`/local-api/v1/projects/${projectID}/branches/switch`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async (data) => {
      setErr("");
      qc.setQueryData(["status", projectID], data.status);
      await invalidateAfterBranchChange();
      onSwitched(data.status, data.branch);
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const createBranch = useMutation({
    mutationFn: (name: string) =>
      api<BranchResult>(`/local-api/v1/projects/${projectID}/branches/create`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async (data) => {
      setErr("");
      setNewName("");
      qc.setQueryData(["status", projectID], data.status);
      await invalidateAfterBranchChange();
      onSwitched(data.status, data.branch);
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const renameBranch = useMutation({
    mutationFn: ({ oldName, newName: next }: { oldName: string; newName: string }) =>
      api<BranchResult>(`/local-api/v1/projects/${projectID}/branches/rename`, {
        method: "POST",
        body: JSON.stringify({ oldName, newName: next }),
      }),
    onSuccess: async (data) => {
      setErr("");
      setRenameTarget(null);
      setRenameValue("");
      qc.setQueryData(["status", projectID], data.status);
      await invalidateAfterBranchChange();
      if (data.branch) {
        onSwitched(data.status, data.branch);
      }
    },
    onError: (e: Error) => setErr(e.message),
  });

  const deleteBranch = useMutation({
    mutationFn: (name: string) =>
      api<BranchResult>(`/local-api/v1/projects/${projectID}/branches/delete`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: async () => {
      setErr("");
      setDeleteTarget(null);
      await invalidateAfterBranchChange();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const data = branches.data;
  const busy =
    switchBranch.isPending ||
    createBranch.isPending ||
    renameBranch.isPending ||
    deleteBranch.isPending;
  const nameHint = clientValidateName(newName);
  const renameHint = renameTarget ? clientValidateName(renameValue) : "";

  return (
    <Drawer title="分支" width={440} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
          <div className="text-xs text-[var(--color-text-secondary)] mb-1">当前分支</div>
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch size={16} className="shrink-0 text-[var(--color-accent)]" />
            <div className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
              {data?.detached ? "detached HEAD" : data?.current || "…"}
            </div>
          </div>
          {data?.detached && (
            <p className="mt-2 text-xs text-[var(--color-warning-fg,var(--color-text-secondary))]">
              当前不在任何分支上。可切换到已有分支，或新建分支离开此状态。
            </p>
          )}
          {!!data?.blockers?.length && (
            <ul className="mt-2 space-y-1">
              {data.blockers.map((b) => (
                <li key={b} className="text-xs text-[var(--color-error-fg)]">
                  {b}
                </li>
              ))}
            </ul>
          )}
          {data?.dirty && (
            <p className="mt-2 text-xs text-[var(--color-error-fg)]">
              工作区有 {data.fileCount} 个未保存文件，请先保存版本或处理后再切换/新建分支。
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索分支…"
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={branches.isFetching}
            onClick={() => void branches.refetch()}
            className="shrink-0 inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            title="刷新"
          >
            <ArrowClockwise size={14} className={branches.isFetching ? "animate-spin" : undefined} />
          </button>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
          <div className="text-sm font-medium mb-2">新建分支</div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如 feature/login"
              disabled={!data?.canSwitch || busy}
              className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-1.5 text-sm font-mono disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!data?.canSwitch || busy || !!nameHint || !newName.trim()}
              onClick={() => createBranch.mutate(newName.trim())}
              className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              创建并切换
            </button>
          </div>
          {newName.trim() && nameHint && (
            <p className="mt-1.5 text-xs text-[var(--color-error-fg)]">{nameHint}</p>
          )}
        </div>

        <div>
          <div className="text-sm font-medium mb-2">本地分支</div>
          {branches.isLoading && (
            <p className="text-sm text-[var(--color-text-secondary)]">加载分支…</p>
          )}
          {branches.isError && (
            <p className="text-sm text-[var(--color-error-fg)]">
              {(branches.error as Error).message}
            </p>
          )}
          {!branches.isLoading && filtered.length === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">没有匹配的分支</p>
          )}
          <ul className="space-y-2">
            {filtered.map((b) => {
              const isCurrent = b.current && !data?.detached;
              return (
                <li
                  key={b.name}
                  className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 ${
                    isCurrent ? "bg-[var(--color-surface-active)]" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isCurrent && (
                          <Check size={12} weight="bold" className="shrink-0 text-[var(--color-accent)]" />
                        )}
                        <span className="truncate font-mono text-sm" title={b.name}>
                          {b.name}
                        </span>
                        {b.isUnborn && (
                          <span className="text-[10px] text-[var(--color-text-tertiary)]">未提交</span>
                        )}
                      </div>
                      {(b.subject || b.short) && (
                        <div className="mt-1 text-xs text-[var(--color-text-secondary)] truncate">
                          {b.short ? `${b.short} · ` : ""}
                          {b.subject || ""}
                          {b.date ? ` · ${formatBranchDate(b.date)}` : ""}
                        </div>
                      )}
                    </div>
                    {!isCurrent && (
                      <button
                        type="button"
                        disabled={!data?.canSwitch || busy}
                        onClick={() => {
                          setErr("");
                          switchBranch.mutate(b.name);
                        }}
                        className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                      >
                        切换
                      </button>
                    )}
                  </div>

                  {renameTarget === b.name ? (
                    <div className="mt-2 space-y-2">
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1.5 text-sm font-mono"
                        autoFocus
                      />
                      {renameHint && (
                        <p className="text-xs text-[var(--color-error-fg)]">{renameHint}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!data?.canMutate || busy || !!renameHint || !renameValue.trim()}
                          onClick={() =>
                            renameBranch.mutate({ oldName: b.name, newName: renameValue.trim() })
                          }
                          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1 text-xs disabled:opacity-50"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenameTarget(null);
                            setRenameValue("");
                          }}
                          className="px-2 py-1 text-xs"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : deleteTarget === b.name ? (
                    <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] p-2">
                      <p className="text-xs text-[var(--color-error-fg)] mb-2">
                        确认删除分支「{b.name}」？未合并的提交将导致删除失败（不会强制删除）。
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!data?.canMutate || busy || isCurrent}
                          onClick={() => deleteBranch.mutate(b.name)}
                          className="rounded-[var(--radius-sm)] bg-[var(--color-error-fg)] text-white px-2 py-1 text-xs disabled:opacity-50"
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(null)}
                          className="px-2 py-1 text-xs"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={!data?.canMutate || busy}
                        onClick={() => {
                          setErr("");
                          setDeleteTarget(null);
                          setRenameTarget(b.name);
                          setRenameValue(b.name);
                        }}
                        className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:opacity-50"
                      >
                        <PencilSimple size={12} /> 重命名
                      </button>
                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={!data?.canMutate || busy}
                          onClick={() => {
                            setErr("");
                            setRenameTarget(null);
                            setDeleteTarget(b.name);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-error-fg)] disabled:opacity-50"
                        >
                          <Trash size={12} /> 删除
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {err && <p className="text-sm text-[var(--color-error-fg)]">{err}</p>}
      </div>
    </Drawer>
  );
}
