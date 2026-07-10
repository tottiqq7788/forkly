import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";
import { api, Project } from "../api";

export default function HomePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
  });

  const projects = data?.projects || [];

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">最近项目</h1>
        <Link
          to={{ search: "drawer=add" }}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium active:scale-[0.98]"
        >
          <Plus size={16} />
          添加项目
        </Link>
      </div>

      {isLoading && <p className="text-[var(--color-text-secondary)]">加载中…</p>}
      {error && <p className="text-[var(--color-error-fg)]">{(error as Error).message}</p>}

      {!isLoading && projects.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-8 py-16 text-center">
          <h2 className="text-[22px] font-semibold mb-2">把本地文件夹纳入版本管理</h2>
          <p className="text-[var(--color-text-secondary)] mb-6">
            在本地目录工作，由 Forkly 记录每次变更
          </p>
          <Link
            to={{ search: "drawer=add" }}
            className="inline-flex rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-4 py-2 text-sm font-medium"
          >
            添加现有文件夹
          </Link>
        </div>
      )}

      <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              to={`/projects/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-hover)]"
            >
              <span
                className={`w-0.5 self-stretch rounded-full ${
                  !p.exists
                    ? "bg-[var(--color-error-fg)]"
                    : p.changeCount > 0
                      ? "bg-[var(--color-warning-fg)]"
                      : "bg-[var(--color-success-fg)]"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{p.name}</div>
                <div className="text-xs text-[var(--color-text-secondary)] font-mono truncate">
                  {p.path}
                </div>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  !p.exists
                    ? "bg-[var(--color-error-bg)] text-[var(--color-error-fg)]"
                    : p.changeCount > 0
                      ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]"
                      : "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]"
                }`}
              >
                {p.summary}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
