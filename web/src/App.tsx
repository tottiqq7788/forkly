import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { House, Gear, FolderSimple } from "@phosphor-icons/react";
import { api, fetchSessionMe, Project } from "./api";
import AddProjectPage from "./pages/AddProjectPage";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  // 有项目时「添加」用抽屉；无项目时走 /add 整页，不再叠在首页上，避免侧栏双高亮。
  const showAddDrawer = new URLSearchParams(location.search).get("drawer") === "add";
  const isProjectRoute = location.pathname.startsWith("/projects/");

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
  const projectList = projects.data?.projects ?? [];
  const firstProject = projectList[0];
  const hasProjects = projectList.length > 0;
  // 无项目时进入 /add 整页；有项目时进入第一个项目。
  const projectEntryPath = firstProject ? `/projects/${firstProject.id}` : "/add";

  useEffect(() => {
    if (!projects.isSuccess) return;
    // 无项目却打开添加抽屉 → 改为整页添加，避免叠在首页上双高亮。
    if (!hasProjects && showAddDrawer) {
      navigate("/add", { replace: true });
      return;
    }
    // 已有项目却访问 /add → 回到项目页并以抽屉添加。
    if (hasProjects && location.pathname === "/add" && firstProject) {
      navigate(`/projects/${firstProject.id}?drawer=add`, { replace: true });
    }
  }, [
    projects.isSuccess,
    hasProjects,
    showAddDrawer,
    location.pathname,
    firstProject,
    navigate,
  ]);

  if (me.isError) {
    const isDev = import.meta.env.DEV;
    const msg = me.error instanceof Error ? me.error.message : String(me.error);
    const apiDown = /failed to fetch|networkerror|load failed/i.test(msg);
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">
            {isDev && apiDown ? "本地 API 未启动" : isDev ? "无法建立开发会话" : "需要从托盘打开"}
          </h1>
          <p className="text-[var(--color-text-secondary)] mb-4">
            {isDev && apiDown
              ? "请在另一个终端执行：FORKLY_DEV=1 go run ./cmd/forkly，然后刷新本页。"
              : isDev
                ? msg
                : "请点击系统托盘或菜单栏中的 Forkly 图标，选择「打开控制台」以建立本地会话。"}
          </p>
          {isDev && (
            <button
              type="button"
              onClick={() => void me.refetch()}
              className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium"
            >
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-20 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-canvas-subtle)] flex flex-col overflow-hidden">
        <div className="h-12 shrink-0 flex items-center justify-center px-0">
          <div className="whitespace-nowrap font-semibold tracking-tight text-[var(--color-text)]">Forkly</div>
        </div>
        <nav className="px-2 flex flex-col gap-2 flex-1 min-h-0 overflow-auto">
          <SideLink to="/" icon={<House size={18} />} match={(path) => path === "/"}>
            首页
          </SideLink>
          <SideLink
            to={projectEntryPath}
            icon={<FolderSimple size={18} />}
            match={(path) => path === "/add" || path.startsWith("/projects")}
          >
            项目
          </SideLink>
        </nav>
        <div className="mt-auto px-2 pb-2 pt-1">
          <SideLink to="/settings" icon={<Gear size={18} />}>
            设置
          </SideLink>
        </div>
      </aside>
      <main
        className={`flex-1 min-w-0 min-h-0 ${
          isProjectRoute ? "overflow-hidden" : "overflow-auto"
        }`}
      >
        <Outlet />
        {showAddDrawer && hasProjects && <AddProjectPage />}
      </main>
    </div>
  );
}

function SideLink({
  to,
  children,
  icon,
  match,
}: {
  to: string;
  children: React.ReactNode;
  icon: React.ReactNode;
  /** 显式控制选中，避免 NavLink 默认匹配导致多项同时高亮 */
  match?: (pathname: string) => boolean;
}) {
  const location = useLocation();
  const active = match ? match(location.pathname) : location.pathname === to;

  return (
    <NavLink
      to={to}
      className={() =>
        `group flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 py-2 text-[11px] leading-none transition-[background-color,color,box-shadow] duration-200 ${
          active
            ? "bg-[var(--color-surface)] text-[var(--color-text)] font-semibold shadow-[inset_3px_0_0_0_var(--color-accent)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]/80 hover:text-[var(--color-text)]"
        }`
      }
      aria-current={active ? "page" : undefined}
    >
      <span
        className={`shrink-0 transition-opacity duration-200 ${
          active ? "opacity-100" : "opacity-70 group-hover:opacity-100"
        }`}
      >
        {icon}
      </span>
      <span
        className={`truncate max-w-full transition-opacity duration-200 ${
          active ? "opacity-100" : "opacity-70 group-hover:opacity-100"
        }`}
      >
        {children}
      </span>
    </NavLink>
  );
}
