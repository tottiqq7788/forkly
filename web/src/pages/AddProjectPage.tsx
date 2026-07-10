import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Drawer } from "../Drawer";

type InspectResult = {
  path: string;
  name: string;
  isRepo: boolean;
  bare: boolean;
};

export default function AddProjectPage() {
  const [tab, setTab] = useState<"add" | "create">("add");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [repoChoice, setRepoChoice] = useState<InspectResult | null>(null);
  const nav = useNavigate();
  const qc = useQueryClient();

  const pick = useMutation({
    mutationFn: () => api<{ path: string }>("/local-api/v1/dialog/folder", { method: "POST", body: "{}" }),
    onSuccess: (d) => setPath(d.path),
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
    if (tab === "create") {
      submitAdd(false);
      return;
    }
    inspect.mutate();
  }

  return (
    <>
      <Drawer title="添加项目" stackIndex={1} width={576} onClose={() => nav("/")}>
        <div className="flex gap-2 mb-4">
          <Tab active={tab === "add"} onClick={() => setTab("add")}>
            添加现有文件夹
          </Tab>
          <Tab active={tab === "create"} onClick={() => setTab("create")}>
            新建空项目
          </Tab>
        </div>

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
            <button type="button" onClick={() => nav("/")} className="px-3 py-1.5 text-sm">
              取消
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
      </Drawer>

      {repoChoice && (
        <Drawer title="初始化" stackIndex={2} width={440} onClose={() => setRepoChoice(null)}>
          <h2 className="text-lg font-semibold mb-3">已检测到 Git 仓库</h2>
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
      onClick={onClick}
      className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-sm ${
        active ? "bg-[var(--color-surface-active)] font-medium" : "text-[var(--color-text-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}
