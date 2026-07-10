import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { House, Gear, FolderSimple } from "@phosphor-icons/react";
import { api, fetchSessionMe, Project } from "./api";
import HomePage from "./pages/HomePage";
import ProjectPage from "./pages/ProjectPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import AddProjectPage from "./pages/AddProjectPage";

const SIDEBAR_KEY = "forkly.sidebarCollapsed";

export default function App() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved === null) return true;
      return saved === "1";
    } catch {
      return true;
    }
  });

  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchSessionMe,
    retry: 1,
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
    enabled: me.isSuccess,
  });

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (me.isError) {
    const isDev = import.meta.env.DEV;
    const msg = me.error instanceof Error ? me.error.message : String(me.error);
    const apiDown = /failed to fetch|networkerror|load failed/i.test(msg);
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">
            {isDev && apiDown ? "本地 API 未启动" : isDev ? "无法建立开发会话" : "需要从菜单栏打开"}
          </h1>
          <p className="text-[var(--color-text-secondary)]">
            {isDev && apiDown
              ? "请在另一个终端执行：FORKLY_DEV=1 go run ./cmd/forkly，然后刷新本页。"
              : isDev
                ? msg
                : "请点击菜单栏 Forkly 图标中的「打开控制台」，以建立本地会话。"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside
        className={`shrink-0 border-r border-[var(--color-border)] bg-[var(--color-canvas-subtle)] flex flex-col overflow-hidden transition-[width] duration-200 ease-out ${
          collapsed ? "w-14" : "w-[248px]"
        }`}
      >
        <div
          className={`h-12 shrink-0 flex items-center ${collapsed ? "justify-center px-0" : "px-4"}`}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            className="font-semibold tracking-tight text-[var(--color-text)] hover:opacity-70 transition-opacity duration-200"
          >
            {collapsed ? "F" : "Forkly"}
          </button>
        </div>
        <nav className="px-2 flex flex-col gap-0.5 flex-1 min-h-0 overflow-auto">
          <SideLink to="/" icon={<House size={18} />} end collapsed={collapsed}>
            首页
          </SideLink>
          {!collapsed && (
            <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
              项目
            </div>
          )}
          {(projects.data?.projects || []).map((p) => (
            <SideLink
              key={p.id}
              to={`/projects/${p.id}`}
              icon={<FolderSimple size={18} />}
              collapsed={collapsed}
              title={p.name}
            >
              {p.name}
            </SideLink>
          ))}
        </nav>
        <div className="mt-auto px-2 pb-2 pt-1">
          <SideLink to="/settings" icon={<Gear size={18} />} collapsed={collapsed}>
            设置
          </SideLink>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/add" element={<><HomePage /><AddProjectPage /></>} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/projects/:id/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function SideLink({
  to,
  children,
  icon,
  end,
  collapsed,
  title,
}: {
  to: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  end?: boolean;
  collapsed?: boolean;
  title?: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={title ?? (typeof children === "string" ? children : undefined)}
      className={({ isActive }) =>
        `flex items-center rounded-[var(--radius-sm)] py-2 text-sm transition-colors duration-200 ${
          collapsed ? "justify-center px-0" : "gap-2 px-3"
        } ${
          isActive
            ? "bg-[var(--color-surface-active)] text-[var(--color-text)] font-medium"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        }`
      }
    >
      {icon}
      {!collapsed && <span className="truncate">{children}</span>}
    </NavLink>
  );
}
