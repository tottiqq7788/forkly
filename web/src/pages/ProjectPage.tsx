import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowClockwise, FolderSimple, Plus } from "@phosphor-icons/react";
import { api, DiffResult, FileStatus, Project, StatusSnapshot } from "../api";
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
  const [pendingProjectID, setPendingProjectID] = useState("");
  const [switchCloseSignal, setSwitchCloseSignal] = useState(0);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setFilter("all");
    setSelected(new Set());
    setActivePath("");
    setCommitOpen(false);
    setSwitchOpen(false);
    setAddOpen(false);
    setPendingProjectID("");
    setMessage("");
    setErr("");
    setRefreshing(false);
  }, [id]);

  function setTab(next: ProjectTab) {
    const base = `/projects/${id}`;
    nav(next === "history" ? `${base}/history` : base, { replace: true });
  }

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
  const projectList = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
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
  const fileCounts = useMemo(() => {
    const counts: Record<string, number> = { all: status.data?.files.length || 0 };
    for (const file of status.data?.files || []) {
      counts[file.kind] = (counts[file.kind] || 0) + 1;
    }
    return counts;
  }, [status.data]);
  const changeTree = useMemo(
    () => compactChangeTree(buildChangeTree(files)),
    [files],
  );

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
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">
            当前分支 {health?.branch || "…"} · {(status.data?.files || []).length} 个修改
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
                  className={`relative text-xs px-2 py-1 rounded-full ${
                    filter === k ? "bg-[var(--color-surface-active)] font-medium" : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {labelFilter(k)}
                  {(fileCounts[k] || 0) > 0 && (
                    <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-[var(--color-error-fg)] px-1 text-[10px] leading-4 text-white text-center font-medium">
                      {fileCounts[k]}
                    </span>
                  )}
                </button>
              ))}
              <button
                type="button"
                disabled={selected.size === 0 || !!blocked}
                onClick={() => {
                  setErr("");
                  setCommitOpen(true);
                }}
                className="ml-auto rounded-full bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1 text-xs font-medium disabled:opacity-40"
              >
                提交
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
                  onToggle={(path) => {
                    const next = new Set(selected);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
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

function ProjectHistoryPanel({ projectID }: { projectID: string }) {
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected("");
  }, [projectID]);
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

  const commits = history.data?.commits || [];

  return (
    <div className="flex flex-1 min-h-0">
      <ul className="w-[320px] border-r border-[var(--color-border)] overflow-auto">
        {history.isLoading && <li className="p-4 text-sm text-[var(--color-text-secondary)]">加载历史…</li>}
        {!history.isLoading && commits.length === 0 && (
          <li className="p-4 text-sm text-[var(--color-text-secondary)]">还没有任何版本</li>
        )}
        {commits.map((c) => (
          <li key={c.sha}>
            <button
              type="button"
              onClick={() => setSelected(c.sha)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--color-border)] ${
                selected === c.sha ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
              }`}
            >
              <div className="truncate font-medium text-sm">{c.subject}</div>
              <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                {c.author} · {formatDate(c.date)} · <span className="font-mono">{c.short}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex-1 p-5 overflow-auto">
        {!selected && <p className="text-[var(--color-text-secondary)]">选择一次提交查看详情</p>}
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
            <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
              {detail.data.files.map((f) => (
                <li key={f.path} className="px-3 py-2 flex items-center gap-3 text-sm">
                  <span className="font-mono flex-1 truncate">{f.path}</span>
                  <span className="text-[var(--color-success-fg)] text-xs">+{f.additions}</span>
                  <span className="text-[var(--color-error-fg)] text-xs">-{f.deletions}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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

const TREE_INDENT_STEP = 8;
const TREE_INDENT_MAX = 24;

function ChangeTreeView({
  rootName,
  nodes,
  selected,
  activePath,
  onToggle,
  onOpen,
}: {
  rootName: string;
  nodes: ChangeTreeNode[];
  selected: Set<string>;
  activePath: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="px-2">
      <div className="px-1 py-1 text-xs font-medium text-[var(--color-text-secondary)] truncate" title={rootName}>
        {rootName}/
      </div>
      {nodes.map((node, index) => (
        <ChangeTreeNodeRow
          key={`${node.kind}:${node.path}`}
          node={node}
          depth={0}
          isLast={index === nodes.length - 1}
          selected={selected}
          activePath={activePath}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function ChangeTreeNodeRow({
  node,
  depth,
  isLast,
  selected,
  activePath,
  onToggle,
  onOpen,
}: {
  node: ChangeTreeNode;
  depth: number;
  isLast: boolean;
  selected: Set<string>;
  activePath: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const indent = Math.min(depth * TREE_INDENT_STEP, TREE_INDENT_MAX);
  const connector = isLast ? "└─" : "├─";

  if (node.kind === "dir") {
    return (
      <div>
        <div
          className="flex items-center gap-1 px-1 py-0.5 text-xs text-[var(--color-text-secondary)]"
          style={{ paddingLeft: 4 + indent }}
        >
          <span className="font-mono text-[10px] text-[var(--color-text-tertiary)] shrink-0 w-4 text-center">
            {connector}
          </span>
          <span className="truncate font-mono" title={`${node.path}/`}>
            {node.name}/
          </span>
        </div>
        {node.children.map((child, index) => (
          <ChangeTreeNodeRow
            key={`${child.kind}:${child.path}`}
            node={child}
            depth={depth + 1}
            isLast={index === node.children.length - 1}
            selected={selected}
            activePath={activePath}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  const file = node.file!;
  const active = activePath === file.path;
  const oldName = file.oldPath ? file.oldPath.split("/").pop() : undefined;

  return (
    <div
      className={`flex items-start gap-1 px-1 py-0.5 rounded-[var(--radius-sm)] ${
        active ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
      }`}
      style={{ paddingLeft: 4 + indent }}
    >
      <span className="font-mono text-[10px] text-[var(--color-text-tertiary)] shrink-0 w-4 text-center leading-5">
        {connector}
      </span>
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        checked={selected.has(file.path)}
        onChange={() => onToggle(file.path)}
        onClick={(e) => e.stopPropagation()}
      />
      <button type="button" className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => onOpen(file.path)}>
        <div className="truncate text-sm font-mono" title={file.path}>
          {node.name}
        </div>
        {file.kind === "renamed" && oldName && (
          <div className="truncate text-[11px] text-[var(--color-text-tertiary)]">
            {oldName} → {node.name}
          </div>
        )}
      </button>
      <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)] leading-5">{kindLabel(file.kind)}</span>
    </div>
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
