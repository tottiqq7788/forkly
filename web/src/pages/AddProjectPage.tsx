import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Drawer } from "../Drawer";
import { cloneGitHubRepo, fetchGitHubSettings, listGitHubRepos } from "../githubApi";
import { GitHubAccountPanel } from "../components/github/GitHubAccountPanel";

type InspectResult = {
  path: string;
  name: string;
  isRepo: boolean;
  bare: boolean;
};

export default function AddProjectPage({
  stackIndex = 1,
  onClose,
  variant = "drawer",
}: {
  stackIndex?: number;
  onClose?: () => void;
  /** page：无项目时作为主内容；drawer：有项目时侧滑添加 */
  variant?: "drawer" | "page";
}) {
  const [tab, setTab] = useState<"add" | "create" | "clone">("add");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [repoChoice, setRepoChoice] = useState<InspectResult | null>(null);
  const [cloneURL, setCloneURL] = useState("");
  const [cloneParent, setCloneParent] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const isPage = variant === "page";

  const github = useQuery({
    queryKey: ["github-settings"],
    queryFn: fetchGitHubSettings,
    enabled: tab === "clone",
  });

  const repos = useQuery({
    queryKey: ["github-repos", repoSearch],
    queryFn: () => listGitHubRepos(repoSearch, 1),
    enabled: tab === "clone" && !!github.data?.account,
  });

  function closeDrawer() {
    if (onClose) {
      onClose();
      return;
    }
    if (location.pathname === "/add") {
      nav("/", { replace: true });
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete("drawer");
    const search = params.toString();
    nav(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true },
    );
  }

  const pick = useMutation({
    mutationFn: () => api<{ path: string }>("/local-api/v1/dialog/folder", { method: "POST", body: "{}" }),
    onSuccess: (d) => {
      if (tab === "clone") setCloneParent(d.path);
      else setPath(d.path);
    },
    onError: (e: Error) => setError(e.message),
  });

  const inspect = useMutation({
    mutationFn: () =>
      api<InspectResult>("/local-api/v1/projects/inspect", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),
    onSuccess: (info) => {
      if (info.bare) {
        setError("不支持 bare 仓库");
        return;
      }
      if (info.isRepo) {
        setRepoChoice(info);
        return;
      }
      submitAdd(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const add = useMutation({
    mutationFn: ({ resetGit }: { resetGit: boolean }) =>
      api<{ id: string }>("/local-api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          path,
          name: name || undefined,
          init: true,
          create: tab === "create",
          resetGit,
        }),
      }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["projects"] });
      onClose?.();
      nav(`/projects/${p.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const clone = useMutation({
    mutationFn: () =>
      cloneGitHubRepo({
        url: cloneURL.trim(),
        parentPath: cloneParent.trim(),
        name: cloneName.trim() || undefined,
      }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["projects"] });
      onClose?.();
      nav(`/projects/${p.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function submitAdd(resetGit: boolean) {
    setError("");
    setRepoChoice(null);
    add.mutate({ resetGit });
  }

  function handlePrimary() {
    setError("");
    if (tab === "clone") {
      clone.mutate();
      return;
    }
    if (tab === "create") {
      submitAdd(false);
      return;
    }
    inspect.mutate();
  }

  const form = (
    <>
      <div
        className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas-subtle)] p-0.5 mb-4"
        role="tablist"
        aria-label="添加方式"
      >
        <Tab active={tab === "add"} onClick={() => setTab("add")}>
          添加现有文件夹
        </Tab>
        <Tab active={tab === "create"} onClick={() => setTab("create")}>
          新建空项目
        </Tab>
        <Tab active={tab === "clone"} onClick={() => setTab("clone")}>
          从 GitHub 克隆
        </Tab>
      </div>

      {tab === "clone" ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
          {!github.data?.account ? (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">克隆前请先连接 GitHub 账号。</p>
              <GitHubAccountPanel />
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">
                将仓库克隆到选定父目录下的新文件夹，并自动登记到 Forkly。
              </p>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">仓库地址</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 font-mono text-sm"
                  value={cloneURL}
                  onChange={(e) => setCloneURL(e.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                />
              </label>
              <div className="space-y-2">
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-sm"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder="搜索已授权仓库…"
                />
                <ul className="max-h-40 overflow-auto space-y-1">
                  {(repos.data?.repos || []).slice(0, 20).map((r) => (
                    <li key={r.fullName}>
                      <button
                        type="button"
                        onClick={() => {
                          setCloneURL(r.cloneUrl);
                          setCloneName(r.name);
                        }}
                        className="w-full text-left rounded-[var(--radius-sm)] px-2 py-1.5 text-xs hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="font-medium">{r.fullName}</span>
                        {r.private ? (
                          <span className="ml-2 text-[var(--color-text-tertiary)]">私有</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">父目录</span>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                    value={cloneParent}
                    onChange={(e) => setCloneParent(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => pick.mutate()}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] px-3 py-2 text-sm"
                  >
                    选择…
                  </button>
                </div>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">文件夹名称（可选）</span>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                />
              </label>
            </>
          )}
          {error && <p className="text-sm text-[var(--color-error-fg)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeDrawer} className="px-3 py-1.5 text-sm">
              {isPage ? "返回首页" : "取消"}
            </button>
            <button
              type="button"
              disabled={!cloneURL || !cloneParent || clone.isPending || !github.data?.account}
              onClick={handlePrimary}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {clone.isPending ? "克隆中…" : "克隆并添加"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {tab === "add"
              ? "若文件夹不是 Git 仓库，Forkly 会自动初始化；若已经是 Git 仓库，会先询问是否复用。"
              : "将在选定父路径下创建新文件夹并初始化 Git。"}
          </p>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{tab === "create" ? "父目录" : "文件夹路径"}</span>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/you/Documents/project"
              />
              <button
                type="button"
                onClick={() => pick.mutate()}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] px-3 py-2 text-sm"
              >
                选择…
              </button>
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">支持中文路径与空格</span>
          </label>

          {tab === "create" && (
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">项目名称</span>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}

          {error && <p className="text-sm text-[var(--color-error-fg)]">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeDrawer} className="px-3 py-1.5 text-sm">
              {isPage ? "返回首页" : "取消"}
            </button>
            <button
              type="button"
              disabled={!path || add.isPending || inspect.isPending}
              onClick={handlePrimary}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {tab === "create" ? "创建并添加" : inspect.isPending ? "检查中…" : "添加"}
            </button>
          </div>
        </div>
      )}
    </>
  );

  const repoChoicePanel = repoChoice && (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-base font-semibold mb-2">已检测到 Git 仓库</h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
        <span className="font-mono text-[var(--color-text)]">{repoChoice.path}</span>{" "}
        已经包含 Git 历史。你可以复用现有仓库，或清空 `.git` 后从当前文件重新开始。
      </p>
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas-subtle)] p-3 text-sm text-[var(--color-text-secondary)] mb-4">
        默认推荐复用现有仓库；清空重新提交只会移除 `.git` 历史，不会删除项目文件。
      </div>
      {error && <p className="text-sm text-[var(--color-error-fg)] mb-3">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => submitAdd(false)} className="px-3 py-1.5 text-sm">
          复用现有仓库
        </button>
        <button
          type="button"
          disabled={add.isPending}
          onClick={() => submitAdd(true)}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          清空重新提交
        </button>
      </div>
    </div>
  );

  if (isPage) {
    return (
      <div className="min-h-full p-6 md:p-8">
        <div className="max-w-xl">
          <h1 className="text-xl font-semibold tracking-tight mb-1">添加项目</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6">
            还没有项目。添加本地文件夹或从 GitHub 克隆后，即可在这里查看变更与版本历史。
          </p>
          {form}
          {repoChoicePanel}
        </div>
      </div>
    );
  }

  return (
    <>
      <Drawer title="添加项目" stackIndex={stackIndex} width={576} onClose={closeDrawer}>
        {form}
      </Drawer>

      {repoChoice && (
        <Drawer title="已检测到 Git 仓库" stackIndex={stackIndex + 1} width={440} onClose={() => setRepoChoice(null)}>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            <span className="font-mono text-[var(--color-text)]">{repoChoice.path}</span>{" "}
            已经包含 Git 历史。你可以复用现有仓库，或清空 `.git` 后从当前文件重新开始。
          </p>
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-canvas-subtle)] p-3 text-sm text-[var(--color-text-secondary)] mb-4">
            默认推荐复用现有仓库；清空重新提交只会移除 `.git` 历史，不会删除项目文件。
          </div>
          {error && <p className="text-sm text-[var(--color-error-fg)] mb-3">{error}</p>}
          <div className="mt-auto flex justify-end gap-2">
            <button type="button" onClick={() => submitAdd(false)} className="px-3 py-1.5 text-sm">
              复用现有仓库
            </button>
            <button
              type="button"
              disabled={add.isPending}
              onClick={() => submitAdd(true)}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              清空重新提交
            </button>
          </div>
        </Drawer>
      )}
    </>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-[3px] px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-sm"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}
