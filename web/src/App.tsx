import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { House, Gear, FolderSimple } from "@phosphor-icons/react";
import { api, Project } from "./api";
import HomePage from "./pages/HomePage";
import ProjectPage from "./pages/ProjectPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import AddProjectPage from "./pages/AddProjectPage";

export default function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ git: { version: string; bundled: boolean } }>("/local-api/v1/session/me"),
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
  });

  if (me.isError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">需要从菜单栏打开</h1>
          <p className="text-[var(--color-text-secondary)]">
            请点击菜单栏 Forkly 图标中的「打开控制台」，以建立本地会话。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="w-[248px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-canvas-subtle)] flex flex-col">
        <div className="h-12 px-4 flex items-center font-semibold tracking-tight">Forkly</div>
        <nav className="px-2 flex flex-col gap-0.5">
          <SideLink to="/" icon={<House size={18} />} end>
            首页
          </SideLink>
          <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
            项目
          </div>
          {(projects.data?.projects || []).map((p) => (
            <SideLink key={p.id} to={`/projects/${p.id}`} icon={<FolderSimple size={18} />}>
              {p.name}
            </SideLink>
          ))}
          <SideLink to="/settings" icon={<Gear size={18} />}>
            设置
          </SideLink>
        </nav>
        <div className="mt-auto p-3 text-[11px] font-mono text-[var(--color-text-tertiary)]">
          {me.data?.git.bundled ? "内置 Git" : "系统 Git"} {me.data?.git.version?.replace("git version ", "")}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/add" element={<AddProjectPage />} />
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
}: {
  to: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors duration-200 ${
          isActive
            ? "bg-[var(--color-surface-active)] text-[var(--color-text)] font-medium"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        }`
      }
    >
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}
