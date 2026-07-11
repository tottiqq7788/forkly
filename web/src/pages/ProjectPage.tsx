import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwise,
  ArrowsLeftRight,
  FolderSimple,
  GearSix,
  Minus,
  PencilSimple,
  Plus,
  WarningCircle,
} from "@phosphor-icons/react";
import { api, DiffResult, FileStatus, Project, SessionMe, StatusSnapshot } from "../api";
import { Drawer } from "../Drawer";
import AddProjectPage from "./AddProjectPage";

type ProjectTab = "changes" | "history";

type Commit = {
  sha: string;
  short: string;
  subject: string;
  author: string;
  email: string;
  date: string;
};

type CommitFile = {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
};

export default function ProjectPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tab: ProjectTab = location.pathname.endsWith("/history") ? "history" : "changes";
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string>("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [pendingProjectID, setPendingProjectID] = useState("");
  const [switchCloseSignal, setSwitchCloseSignal] = useState(0);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [settingsErr, setSettingsErr] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityErr, setIdentityErr] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setFilter("all");
    setSelected(new Set());
    setActivePath("");
    setCommitOpen(false);
    setSwitchOpen(false);
    setAddOpen(false);
    setSettingsOpen(false);
    setIdentityOpen(false);
    setRemoveConfirm(false);
    setPendingProjectID("");
    setMessage("");
    setErr("");
    setSettingsErr("");
    setIdentityErr("");
    setRefreshing(false);
  }, [id]);

  function setTab(next: ProjectTab) {
    const base = `/projects/${id}`;
    nav(next === "history" ? `${base}/history` : base, { replace: true });
  }

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<{ id: string; name: string; path: string }>(`/local-api/v1/projects/${id}`),
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
  const projectList = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
  });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<SessionMe>("/local-api/v1/session/me"),
  });

  const projectMeta = projectList.data?.projects.find((p) => p.id === id);
  const projectMissing = projectMeta ? !projectMeta.exists : false;

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
      const remain = 1000 - (Date.now() - started);
      if (remain > 0) {
        await new Promise((resolve) => setTimeout(resolve, remain));
      }
      setRefreshing(false);
    }
  }

  function openCommitFlow() {
    setErr("");
    if (me.isLoading) return;
    if (me.isError) {
      setErr("无法确认提交身份，请刷新后重试");
      return;
    }
    if (me.data?.identityConfigured === false) {
      setIdentityName("");
      setIdentityEmail("");
      setIdentityErr("");
      setIdentityOpen(true);
      return;
    }
    setCommitOpen(true);
  }

  const saveIdentity = useMutation({
    mutationFn: () => {
      const name = identityName.trim();
      const email = identityEmail.trim();
      if (!name || !email) {
        throw new Error("请填写名称和邮箱");
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("邮箱格式不正确");
      }
      return api("/local-api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({
          identity: { name, email },
        }),
      });
    },
    onSuccess: async () => {
      setIdentityOpen(false);
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      setCommitOpen(true);
    },
    onError: (e: Error) => setIdentityErr(e.message),
  });

  const revealProject = useMutation({
    mutationFn: () => api(`/local-api/v1/projects/${id}/reveal`, { method: "POST", body: "{}" }),
    onError: (e: Error) => setSettingsErr(e.message),
  });

  const relocateProject = useMutation({
    mutationFn: async () => {
      const picked = await api<{ path: string }>("/local-api/v1/dialog/folder", {
        method: "POST",
        body: "{}",
      });
      return api<{ ok: boolean; path: string }>(`/local-api/v1/projects/${id}/relocate`, {
        method: "POST",
        body: JSON.stringify({ path: picked.path }),
      });
    },
    onSuccess: async () => {
      setSettingsErr("");
      setSettingsOpen(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", id] }),
        qc.invalidateQueries({ queryKey: ["status", id] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-activity"] }),
      ]);
    },
    onError: (e: Error) => setSettingsErr(e.message),
  });

  const removeProject = useMutation({
    mutationFn: () => api(`/local-api/v1/projects/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setSettingsOpen(false);
      setRemoveConfirm(false);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      const remaining = (projectList.data?.projects || []).filter((p) => p.id !== id);
      if (remaining[0]) {
        nav(`/projects/${remaining[0].id}`, { replace: true });
      } else {
        nav("/", { replace: true });
      }
    },
    onError: (e: Error) => setSettingsErr(e.message),
  });

  const files = useMemo(() => {
    const list = status.data?.files || [];
    if (filter === "all") return list;
    return list.filter((f) => f.kind === filter);
  }, [status.data, filter]);
  const fileCounts = useMemo(() => {
    const list = status.data?.files ?? [];
    const counts: Record<string, number> = { all: list.length };
    for (const file of list) {
      counts[file.kind] = (counts[file.kind] || 0) + 1;
    }
    return counts;
  }, [status.data]);
  const changeTree = useMemo(
    () => compactChangeTree(buildChangeTree(files)),
    [files],
  );

  useEffect(() => {
    const paths = collectAllFilePaths(changeTree);
    setActivePath((current) => {
      if (paths.length === 0) return "";
      if (current && paths.includes(current)) return current;
      return paths[0];
    });
  }, [changeTree]);

  const commit = useMutation({
    mutationFn: () => {
      const paths = new Set<string>();
      for (const path of selected) {
        paths.add(path);
        const file = (status.data?.files ?? []).find((f) => f.path === path);
        if (file?.kind === "renamed" && file.oldPath) {
          paths.add(file.oldPath);
        }
      }
      return api(`/local-api/v1/projects/${id}/commit`, {
        method: "POST",
        body: JSON.stringify({
          paths: [...paths],
          message,
          fingerprint: status.data?.fingerprint,
        }),
      });
    },
    onSuccess: async () => {
      setCommitOpen(false);
      setMessage("");
      setSelected(new Set());
      setActivePath("");
      await qc.invalidateQueries({ queryKey: ["status", id] });
      await qc.invalidateQueries({ queryKey: ["history", id] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
    },
    onError: (e: Error) => setErr(e.message),
  });

  const health = status.data?.health;
  const blocked = health && !health.ok;

  return (
    <div className="flex flex-col h-full">
      <header className="relative h-12 border-b border-[var(--color-border)] px-4 flex items-center gap-3 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setSwitchOpen(true)}
              className="min-w-0 truncate font-medium text-left rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] px-1 -ml-1 cursor-pointer"
              title="切换项目"
            >
              {project.data?.name || "项目"}
            </button>
            <Link
              to={{ search: "drawer=add" }}
              title="添加项目"
              aria-label="添加项目"
              className="shrink-0 inline-flex items-center justify-center rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              <Plus size={14} weight="bold" />
            </Link>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="shrink-0 inline-flex items-center justify-center rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] disabled:opacity-60"
              title="刷新"
            >
              <ArrowClockwise size={14} className={refreshing ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsErr("");
                setRemoveConfirm(false);
                setSettingsOpen(true);
              }}
              className="shrink-0 inline-flex items-center justify-center rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
              title="项目设置"
              aria-label="项目设置"
            >
              <GearSix size={14} />
            </button>
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">
            当前分支：{health?.branch || "…"}
          </div>
        </div>
        <div className="ml-auto flex rounded-[var(--radius-sm)] bg-[var(--color-canvas-subtle)] p-0.5">
          <ProjectTabButton active={tab === "changes"} onClick={() => setTab("changes")}>
            变更
          </ProjectTabButton>
          <ProjectTabButton active={tab === "history"} onClick={() => setTab("history")}>
            历史
          </ProjectTabButton>
        </div>
      </header>

      {projectMissing && (
        <div className="mx-4 mt-3 rounded-[var(--radius-lg)] border border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] px-4 py-3 text-sm">
          <div className="font-medium text-[var(--color-error-fg)] mb-1">找不到项目目录</div>
          <p className="text-[var(--color-text-secondary)] mb-3">
            目录可能已被移动或删除。你可以重新定位到新路径，或从 Forkly 移除登记（不会删除磁盘文件）。
          </p>
          <button
            type="button"
            onClick={() => {
              setSettingsErr("");
              setRemoveConfirm(false);
              setSettingsOpen(true);
            }}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-xs font-medium"
          >
            打开项目设置
          </button>
        </div>
      )}

      {tab === "changes" && blocked && (
        <div className="mx-4 mt-3 rounded-[var(--radius-lg)] border border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] px-4 py-3 text-sm">
          <div className="font-medium text-[var(--color-error-fg)] mb-1">已暂停保存版本</div>
          <p className="text-[var(--color-text-secondary)]">
            {(health?.blockers || []).join("；")}。你的文件没有被更改。请先用熟悉的工具完成或中止，再回来刷新。
          </p>
        </div>
      )}

      {tab === "changes" ? (
        <div className="flex flex-1 min-h-0">
          <section className="w-[340px] border-r border-[var(--color-border)] flex flex-col min-h-0">
            <div className="p-2 flex flex-wrap gap-2 border-b border-[var(--color-border)]">
              {(["all", "modified", "untracked", "deleted", "renamed"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`relative inline-flex items-center justify-center text-xs h-6 rounded-full ${
                    k === "renamed" ? "w-[52px]" : "w-10"
                  } ${
                    filter === k ? "bg-[var(--color-surface-active)] font-medium" : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {labelFilter(k)}
                  {(fileCounts[k] || 0) > 0 && (
                    <sup className="pointer-events-none absolute -right-0.5 -top-0.5 text-[9px] font-normal text-[var(--color-text-tertiary)] leading-none">
                      {fileCounts[k]}
                    </sup>
                  )}
                </button>
              ))}
              <button
                type="button"
                disabled={selected.size === 0 || !!blocked || projectMissing}
                onClick={openCommitFlow}
                className="ml-auto rounded-full bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1 text-xs font-medium disabled:opacity-40"
              >
                保存版本
              </button>
            </div>
            <div className="overflow-auto flex-1 py-1">
              {files.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-text-secondary)]">没有待保存的修改</p>
              ) : (
                <ChangeTreeView
                  rootName={project.data?.name || "项目"}
                  nodes={changeTree}
                  selected={selected}
                  activePath={activePath}
                  onTogglePaths={(paths) => {
                    const next = new Set(selected);
                    const allOn = paths.length > 0 && paths.every((p) => next.has(p));
                    if (allOn) {
                      for (const p of paths) next.delete(p);
                    } else {
                      for (const p of paths) next.add(p);
                    }
                    setSelected(next);
                  }}
                  onOpen={setActivePath}
                />
              )}
            </div>
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
      ) : (
        <ProjectHistoryPanel projectID={id} />
      )}

      {commitOpen && (
        <Drawer title="保存版本" stackIndex={1} width={420} onClose={() => setCommitOpen(false)}>
          <div className="min-h-full flex flex-col">
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

      {switchOpen && (
        <Drawer
          title="切换项目"
          stackIndex={1}
          width={420}
          closeSignal={switchCloseSignal}
          onClose={() => setSwitchOpen(false)}
          onBeforeClose={() => {
            if (!pendingProjectID || pendingProjectID === id) {
              setPendingProjectID("");
              return;
            }
            const nextID = pendingProjectID;
            setPendingProjectID("");
            nav(`/projects/${nextID}`);
          }}
        >
          <div className="min-h-full flex flex-col">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-text-secondary)]">选择要打开的本地项目。</p>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] px-2 py-1 text-sm hover:bg-[var(--color-surface-hover)]"
              >
                <Plus size={14} weight="bold" />
                添加项目
              </button>
            </div>
            <ul className="space-y-1">
              {(projectList.data?.projects || []).map((p) => {
                const active = p.id === id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingProjectID(p.id);
                        setSwitchCloseSignal((value) => value + 1);
                      }}
                      className={`w-full flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left cursor-pointer ${
                        active
                          ? "bg-[var(--color-surface-active)] text-[var(--color-text)] font-medium"
                          : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                      }`}
                    >
                      <FolderSimple size={18} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="block truncate text-xs font-mono text-[var(--color-text-tertiary)]">
                          {p.path}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {projectList.data?.projects.length === 0 && (
              <p className="text-sm text-[var(--color-text-secondary)]">还没有项目。</p>
            )}
          </div>
        </Drawer>
      )}

      {addOpen && <AddProjectPage stackIndex={2} onClose={() => setAddOpen(false)} />}

      {identityOpen && (
        <Drawer title="设置提交身份" stackIndex={1} width={420} onClose={() => setIdentityOpen(false)}>
          <div className="min-h-full flex flex-col">
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              首次保存版本前，请设置会写入历史记录的名称和邮箱。
            </p>
            <label className="block space-y-1.5 mb-3">
              <span className="text-sm font-medium">名称 *</span>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                value={identityName}
                onChange={(e) => setIdentityName(e.target.value)}
                placeholder="例如：张三"
              />
            </label>
            <label className="block space-y-1.5 mb-4">
              <span className="text-sm font-medium">邮箱 *</span>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                value={identityEmail}
                onChange={(e) => setIdentityEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </label>
            {identityErr && <p className="text-sm text-[var(--color-error-fg)] mb-3">{identityErr}</p>}
            <div className="mt-auto flex justify-end gap-2">
              <button type="button" onClick={() => setIdentityOpen(false)} className="px-3 py-1.5 text-sm">
                取消
              </button>
              <button
                type="button"
                disabled={saveIdentity.isPending}
                onClick={() => saveIdentity.mutate()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                保存并继续
              </button>
            </div>
          </div>
        </Drawer>
      )}

      {settingsOpen && (
        <Drawer
          title="项目设置"
          stackIndex={1}
          width={420}
          onClose={() => {
            setSettingsOpen(false);
            setRemoveConfirm(false);
          }}
        >
          <div className="min-h-full flex flex-col gap-4">
            <div>
              <div className="text-sm font-medium mb-1">{project.data?.name || "项目"}</div>
              <p className="text-xs font-mono text-[var(--color-text-tertiary)] break-all">
                {project.data?.path || "…"}
              </p>
              {projectMissing && (
                <p className="mt-2 text-sm text-[var(--color-error-fg)]">当前登记路径找不到目录。</p>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                disabled={revealProject.isPending || projectMissing}
                onClick={() => revealProject.mutate()}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
              >
                在访达中显示
              </button>
              <button
                type="button"
                disabled={relocateProject.isPending}
                onClick={() => relocateProject.mutate()}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
              >
                重新定位文件夹…
              </button>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
              <div className="text-sm font-medium mb-1">从 Forkly 移除</div>
              <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                只移除本应用中的登记，不会删除磁盘上的文件夹或 `.git` 历史。
              </p>
              {!removeConfirm ? (
                <button
                  type="button"
                  onClick={() => setRemoveConfirm(true)}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-error-fg)]/40 text-[var(--color-error-fg)] px-3 py-1.5 text-sm"
                >
                  移除项目
                </button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={removeProject.isPending}
                    onClick={() => removeProject.mutate()}
                    className="rounded-[var(--radius-sm)] bg-[var(--color-error-fg)] text-white px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    确认移除
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoveConfirm(false)}
                    className="px-3 py-1.5 text-sm"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>

            {settingsErr && <p className="text-sm text-[var(--color-error-fg)]">{settingsErr}</p>}
          </div>
        </Drawer>
      )}
    </div>
  );
}

function ProjectTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[var(--radius-sm)] px-3 py-1 text-sm transition-colors ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

type HistoryTreeNode =
  | {
      kind: "group";
      key: string;
      label: string;
      children: HistoryTreeNode[];
    }
  | {
      kind: "commit";
      key: string;
      commit: Commit;
      timeLabel: string;
    };

function ProjectHistoryPanel({ projectID }: { projectID: string }) {
  const [selected, setSelected] = useState("");
  const [activeFile, setActiveFile] = useState("");
  useEffect(() => {
    setSelected("");
    setActiveFile("");
  }, [projectID]);
  useEffect(() => {
    setActiveFile("");
  }, [selected]);
  const history = useQuery({
    queryKey: ["history", projectID],
    queryFn: () => api<{ commits: Commit[] }>(`/local-api/v1/projects/${projectID}/history`),
  });
  const detail = useQuery({
    queryKey: ["commit", projectID, selected],
    queryFn: () =>
      api<{ commit: Commit; files: CommitFile[] }>(`/local-api/v1/projects/${projectID}/commits/${selected}`),
    enabled: !!selected,
  });
  const commitDiff = useQuery({
    queryKey: ["commit-diff", projectID, selected, activeFile],
    queryFn: () =>
      api<DiffResult>(
        `/local-api/v1/projects/${projectID}/commits/${selected}/diff?path=${encodeURIComponent(activeFile)}`,
      ),
    enabled: !!selected && !!activeFile,
  });

  const commits = history.data?.commits;
  const historyTree = useMemo(() => buildHistoryTree(commits ?? []), [commits]);

  useEffect(() => {
    const list = commits ?? [];
    const shas = new Set(list.map((c) => c.sha));
    setSelected((current) => {
      if (shas.size === 0) return "";
      if (current && shas.has(current)) return current;
      return firstHistoryCommitSha(historyTree);
    });
  }, [commits, historyTree]);

  return (
    <div className="flex flex-1 min-h-0">
      <div className="w-[240px] border-r border-[var(--color-border)] overflow-auto py-1">
        {history.isLoading && <p className="p-4 text-sm text-[var(--color-text-secondary)]">加载历史…</p>}
        {!history.isLoading && (commits?.length ?? 0) === 0 && (
          <p className="p-4 text-sm text-[var(--color-text-secondary)]">还没有任何版本</p>
        )}
        {!history.isLoading && (commits?.length ?? 0) > 0 && (
          <div className="px-2">
            {historyTree.map((node, index) => (
              <HistoryTreeNodeRow
                key={node.key}
                node={node}
                isLast={index === historyTree.length - 1}
                ancestorContinues={[]}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 p-5 overflow-auto">
        {!selected && !history.isLoading && (
          <p className="text-[var(--color-text-secondary)]">选择一次提交查看详情</p>
        )}
        {detail.isLoading && <p className="text-[var(--color-text-secondary)]">加载提交详情…</p>}
        {detail.data && (
          <div>
            <h2 className="text-lg font-semibold mb-2">{detail.data.commit.subject}</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              {detail.data.commit.author} · {formatDate(detail.data.commit.date)} ·{" "}
              <button
                type="button"
                className="font-mono text-[var(--color-accent-muted)]"
                onClick={() => navigator.clipboard.writeText(detail.data!.commit.sha)}
              >
                {detail.data.commit.short} 复制
              </button>
            </p>
            <h3 className="text-sm font-medium mb-2">修改的文件</h3>
            <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-lg)] mb-5">
              {detail.data.files.map((f) => {
                const active = activeFile === f.path;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setActiveFile(f.path)}
                      className={`w-full px-3 py-2 flex items-center gap-3 text-sm text-left cursor-pointer ${
                        active
                          ? "bg-[var(--color-surface-active)]"
                          : "hover:bg-[var(--color-surface-hover)]"
                      }`}
                    >
                      <span className="font-mono flex-1 truncate" title={f.path}>
                        {f.path}
                      </span>
                      <span className="text-[var(--color-success-fg)] text-xs">+{f.additions}</span>
                      <span className="text-[var(--color-error-fg)] text-xs">-{f.deletions}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {activeFile && (
              <div>
                <h3 className="text-sm font-medium mb-2">文件差异</h3>
                {commitDiff.isLoading && (
                  <p className="text-sm text-[var(--color-text-secondary)]">加载差异…</p>
                )}
                {commitDiff.isError && (
                  <p className="text-sm text-[var(--color-error-fg)]">
                    {(commitDiff.error as Error).message}
                  </p>
                )}
                {commitDiff.data && <DiffView diff={commitDiff.data} />}
              </div>
            )}
            {selected && !activeFile && (
              <p className="text-sm text-[var(--color-text-tertiary)]">点击上方文件查看该版本的文本差异</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function buildHistoryTree(commits: Commit[]): HistoryTreeNode[] {
  type MutableGroup = {
    key: string;
    label: string;
    children: Map<string, MutableGroup>;
    commits: HistoryTreeNode[];
    order: string[];
  };

  const root: MutableGroup = { key: "root", label: "", children: new Map(), commits: [], order: [] };

  function ensureGroup(parent: MutableGroup, key: string, label: string): MutableGroup {
    let group = parent.children.get(key);
    if (!group) {
      group = { key, label, children: new Map(), commits: [], order: [] };
      parent.children.set(key, group);
      parent.order.push(key);
    }
    return group;
  }

  for (const commit of commits) {
    const parts = historyDateParts(commit.date);
    const year = ensureGroup(root, `y:${parts.year}`, parts.year);
    const month = ensureGroup(year, `m:${parts.year}-${parts.month}`, parts.month);
    const day = ensureGroup(month, `d:${parts.year}-${parts.month}-${parts.day}`, parts.day);
    const authorKey = commit.author || "未知身份";
    const author = ensureGroup(day, `a:${parts.year}-${parts.month}-${parts.day}:${authorKey}`, authorKey);
    author.commits.push({
      kind: "commit",
      key: `c:${commit.sha}`,
      commit,
      timeLabel: parts.time,
    });
  }

  function toArray(group: MutableGroup): HistoryTreeNode[] {
    const groups = group.order.map((key) => {
      const child = group.children.get(key)!;
      return {
        kind: "group" as const,
        key: child.key,
        label: child.label,
        children: toArray(child),
      };
    });
    return [...groups, ...group.commits];
  }

  return toArray(root);
}

function firstHistoryCommitSha(nodes: HistoryTreeNode[]): string {
  for (const node of nodes) {
    if (node.kind === "commit") return node.commit.sha;
    const nested = firstHistoryCommitSha(node.children);
    if (nested) return nested;
  }
  return "";
}

function historyDateParts(iso: string): { year: string; month: string; day: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { year: "未知日期", month: "未知", day: "未知", time: "--:--:--" };
  }
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const time = [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
  return { year, month, day, time };
}

function HistoryTreeNodeRow({
  node,
  isLast,
  ancestorContinues,
  selected,
  onSelect,
}: {
  node: HistoryTreeNode;
  isLast: boolean;
  ancestorContinues: boolean[];
  selected: string;
  onSelect: (sha: string) => void;
}) {
  if (node.kind === "group") {
    return (
      <div>
        <div className="flex items-stretch gap-1 px-1 text-xs text-[var(--color-text-secondary)]">
          <TreeBranchGuides isLast={isLast} ancestorContinues={ancestorContinues} />
          <div className="flex min-w-0 flex-1 items-center py-0.5">
            <span className="min-w-0 flex-1 truncate font-medium" title={node.label}>
              {node.label}
            </span>
          </div>
        </div>
        {node.children.map((child, index) => (
          <HistoryTreeNodeRow
            key={child.key}
            node={child}
            isLast={index === node.children.length - 1}
            ancestorContinues={[...ancestorContinues, !isLast]}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const active = selected === node.commit.sha;
  return (
    <div
      className={`flex items-stretch gap-1 px-1 rounded-[var(--radius-sm)] ${
        active ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      <TreeBranchGuides isLast={isLast} ancestorContinues={ancestorContinues} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left py-0.5 cursor-pointer"
        onClick={() => onSelect(node.commit.sha)}
      >
        <div className="truncate text-xs font-medium" title={node.commit.subject}>
          {node.commit.subject || "（无说明）"}
        </div>
        <div className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">{node.timeLabel}</div>
      </button>
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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

type ChangeTreeNode = {
  name: string;
  kind: "dir" | "file";
  path: string;
  file?: FileStatus;
  children: ChangeTreeNode[];
};

function buildChangeTree(files: FileStatus[]): ChangeTreeNode[] {
  type Mutable = {
    name: string;
    kind: "dir" | "file";
    path: string;
    file?: FileStatus;
    children: Map<string, Mutable>;
  };

  const root = new Map<string, Mutable>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let current = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      prefix = prefix ? `${prefix}/${part}` : part;
      let node = current.get(part);
      if (!node) {
        node = {
          name: part,
          kind: isFile ? "file" : "dir",
          path: prefix,
          children: new Map(),
        };
        current.set(part, node);
      }
      if (isFile) {
        node.kind = "file";
        node.file = file;
        node.path = file.path;
      } else {
        node.kind = "dir";
        current = node.children;
      }
    }
  }

  function toArray(map: Map<string, Mutable>): ChangeTreeNode[] {
    return [...map.values()].map((node) => ({
      name: node.name,
      kind: node.kind,
      path: node.path,
      file: node.file,
      children: toArray(node.children),
    }));
  }

  return toArray(root);
}

function compactChangeTree(nodes: ChangeTreeNode[]): ChangeTreeNode[] {
  return sortChangeNodes(
    nodes.map((node) => {
      let current: ChangeTreeNode = {
        ...node,
        children: compactChangeTree(node.children),
      };
      while (
        current.kind === "dir" &&
        current.children.length === 1 &&
        current.children[0].kind === "dir"
      ) {
        const only = current.children[0];
        current = {
          ...only,
          name: `${current.name}/${only.name}`,
          path: only.path,
          children: only.children,
        };
      }
      return current;
    }),
  );
}

function sortChangeNodes(nodes: ChangeTreeNode[]): ChangeTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

const TREE_GUIDE_WIDTH = 16;

function collectFilePaths(node: ChangeTreeNode): string[] {
  if (node.kind === "file" && node.file) return [node.file.path];
  return node.children.flatMap(collectFilePaths);
}

function collectAllFilePaths(nodes: ChangeTreeNode[]): string[] {
  return nodes.flatMap(collectFilePaths);
}

function selectionState(paths: string[], selected: Set<string>): { checked: boolean; indeterminate: boolean } {
  if (paths.length === 0) return { checked: false, indeterminate: false };
  const n = paths.filter((p) => selected.has(p)).length;
  return { checked: n === paths.length, indeterminate: n > 0 && n < paths.length };
}

function HoverSelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate;
      }}
      className={`shrink-0 cursor-pointer accent-[var(--color-accent)] ${
        checked || indeterminate ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      }`}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function TreeBranchGuides({
  isLast,
  ancestorContinues,
}: {
  isLast: boolean;
  ancestorContinues: boolean[];
}) {
  const line = "bg-[var(--color-border-strong)]";
  return (
    <span className="flex shrink-0 self-stretch" aria-hidden>
      {ancestorContinues.map((cont, i) => (
        <span key={i} className="relative" style={{ width: TREE_GUIDE_WIDTH }}>
          {cont && (
            <span className={`absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 ${line}`} />
          )}
        </span>
      ))}
      <span className="relative" style={{ width: TREE_GUIDE_WIDTH }}>
        <span
          className={`absolute left-1/2 top-0 w-px -translate-x-1/2 ${line} ${
            isLast ? "h-1/2" : "bottom-0"
          }`}
        />
        <span className={`absolute left-1/2 top-1/2 right-0.5 h-px ${line}`} />
      </span>
    </span>
  );
}

function ChangeTreeView({
  rootName,
  nodes,
  selected,
  activePath,
  onTogglePaths,
  onOpen,
}: {
  rootName: string;
  nodes: ChangeTreeNode[];
  selected: Set<string>;
  activePath: string;
  onTogglePaths: (paths: string[]) => void;
  onOpen: (path: string) => void;
}) {
  const allPaths = collectAllFilePaths(nodes);
  const rootSel = selectionState(allPaths, selected);

  return (
    <div className="px-2">
      <div className="group flex items-center gap-1 px-1 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
        <span className="min-w-0 flex-1 truncate" title={rootName}>
          {rootName}/
        </span>
        <HoverSelectCheckbox
          checked={rootSel.checked}
          indeterminate={rootSel.indeterminate}
          label={`选择 ${rootName} 下全部文件`}
          onChange={() => onTogglePaths(allPaths)}
        />
      </div>
      {nodes.map((node, index) => (
        <ChangeTreeNodeRow
          key={`${node.kind}:${node.path}`}
          node={node}
          isLast={index === nodes.length - 1}
          ancestorContinues={[]}
          selected={selected}
          activePath={activePath}
          onTogglePaths={onTogglePaths}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ChangeTreeNodeRow({
  node,
  isLast,
  ancestorContinues,
  selected,
  activePath,
  onTogglePaths,
  onOpen,
}: {
  node: ChangeTreeNode;
  isLast: boolean;
  ancestorContinues: boolean[];
  selected: Set<string>;
  activePath: string;
  onTogglePaths: (paths: string[]) => void;
  onOpen: (path: string) => void;
}) {
  if (node.kind === "dir") {
    const paths = collectFilePaths(node);
    const dirSel = selectionState(paths, selected);
    return (
      <div>
        <div className="group flex items-stretch gap-1 px-1 text-xs text-[var(--color-text-secondary)]">
          <TreeBranchGuides isLast={isLast} ancestorContinues={ancestorContinues} />
          <div className="flex min-w-0 flex-1 items-center gap-1 py-0.5">
            <span className="min-w-0 flex-1 truncate font-mono" title={`${node.path}/`}>
              {node.name}/
            </span>
            <HoverSelectCheckbox
              checked={dirSel.checked}
              indeterminate={dirSel.indeterminate}
              label={`选择 ${node.name}/ 下全部文件`}
              onChange={() => onTogglePaths(paths)}
            />
          </div>
        </div>
        {node.children.map((child, index) => (
          <ChangeTreeNodeRow
            key={`${child.kind}:${child.path}`}
            node={child}
            isLast={index === node.children.length - 1}
            ancestorContinues={[...ancestorContinues, !isLast]}
            selected={selected}
            activePath={activePath}
            onTogglePaths={onTogglePaths}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  const file = node.file!;
  const active = activePath === file.path;
  const oldName = file.oldPath ? file.oldPath.split("/").pop() : undefined;
  const checked = selected.has(file.path);

  return (
    <div
      className={`group flex items-stretch gap-1 px-1 rounded-[var(--radius-sm)] ${
        active ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      <TreeBranchGuides isLast={isLast} ancestorContinues={ancestorContinues} />
      <div className="flex min-w-0 flex-1 items-center gap-1 py-0.5">
        <button type="button" className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => onOpen(file.path)}>
          <div className="flex items-center gap-1 min-w-0">
            <KindIcon kind={file.kind} />
            <div className="truncate text-xs font-mono" title={`${kindLabel(file.kind)} · ${file.path}`}>
              {node.name}
            </div>
          </div>
          {file.kind === "renamed" && oldName && (
            <div className="truncate text-[11px] text-[var(--color-text-tertiary)] pl-[14px]">
              {oldName} → {node.name}
            </div>
          )}
        </button>
        <HoverSelectCheckbox
          checked={checked}
          label={`选择 ${node.name}`}
          onChange={() => onTogglePaths([file.path])}
        />
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const cls = "shrink-0";
  const size = 12;
  switch (kind) {
    case "modified":
      return <PencilSimple className={`${cls} text-[var(--color-warning-fg)]`} size={size} weight="bold" aria-hidden />;
    case "untracked":
    case "added":
      return <Plus className={`${cls} text-[var(--color-success-fg)]`} size={size} weight="bold" aria-hidden />;
    case "deleted":
      return <Minus className={`${cls} text-[var(--color-error-fg)]`} size={size} weight="bold" aria-hidden />;
    case "renamed":
      return <ArrowsLeftRight className={`${cls} text-[var(--color-accent-muted)]`} size={size} weight="bold" aria-hidden />;
    case "conflicted":
      return <WarningCircle className={`${cls} text-[var(--color-error-fg)]`} size={size} weight="bold" aria-hidden />;
    default:
      return <span className="shrink-0 w-3" aria-hidden />;
  }
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
      {!diff.patch && diff.message ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{diff.message}</p>
      ) : (
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
      )}
    </div>
  );
}
