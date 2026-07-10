import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function AddProjectPage() {
  const [tab, setTab] = useState<"add" | "create">("add");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [init, setInit] = useState(true);
  const [error, setError] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();

  const pick = useMutation({
    mutationFn: () => api<{ path: string }>("/local-api/v1/dialog/folder", { method: "POST", body: "{}" }),
    onSuccess: (d) => setPath(d.path),
    onError: (e: Error) => setError(e.message),
  });

  const add = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/local-api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          path,
          name: name || undefined,
          init: tab === "add" ? init : true,
          create: tab === "create",
        }),
      }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["projects"] });
      nav(`/projects/${p.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-lg font-semibold mb-4">添加项目</h1>
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
            ? "Forkly 会在需要时创建 .git，不会移动、删除或自动提交现有文件。"
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

        {tab === "add" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={init} onChange={(e) => setInit(e.target.checked)} />
            若还不是 Git 仓库则初始化
          </label>
        )}

        {error && <p className="text-sm text-[var(--color-error-fg)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => nav(-1)} className="px-3 py-1.5 text-sm">
            取消
          </button>
          <button
            type="button"
            disabled={!path || add.isPending}
            onClick={() => {
              setError("");
              add.mutate();
            }}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {tab === "create" ? "创建并添加" : "初始化并添加"}
          </button>
        </div>
      </div>
    </div>
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
