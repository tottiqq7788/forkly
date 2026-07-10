import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, DashboardActivity, Project } from "../api";
import { ActivityBarChart, HorizontalBars, SegmentBar } from "../components/DashboardCharts";

const KIND_META: { key: string; label: string; color: string }[] = [
  { key: "modified", label: "修改", color: "var(--color-warning-fg)" },
  { key: "untracked", label: "未跟踪", color: "var(--color-accent-muted)" },
  { key: "added", label: "新增", color: "var(--color-success-fg)" },
  { key: "deleted", label: "删除", color: "var(--color-error-fg)" },
  { key: "renamed", label: "重命名", color: "#3d7ea6" },
  { key: "copied", label: "复制", color: "#0f7b6c" },
  { key: "conflicted", label: "冲突", color: "#c45500" },
  { key: "typechange", label: "类型变更", color: "var(--color-text-secondary)" },
];

function StatCard({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string | number;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
      <div className="text-xs text-[var(--color-text-secondary)] mb-2">{label}</div>
      {loading ? (
        <div className="h-8 w-16 rounded bg-[var(--color-canvas-subtle)] animate-pulse" />
      ) : (
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      )}
      {hint && <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      {children}
      {footer}
    </section>
  );
}

export default function HomePage() {
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
    staleTime: 15_000,
  });
  const activityQ = useQuery({
    queryKey: ["dashboard-activity", 30],
    queryFn: () => api<DashboardActivity>("/local-api/v1/dashboard/activity?days=30"),
    staleTime: 60_000,
  });

  const projects = projectsQ.data?.projects || [];

  const overview = useMemo(() => {
    let pendingFiles = 0;
    let clean = 0;
    let dirty = 0;
    let blocked = 0;
    let missing = 0;
    let unreadable = 0;
    const kindTotals: Record<string, number> = {};

    for (const p of projects) {
      pendingFiles += p.changeCount || 0;
      if (!p.exists) {
        missing++;
        continue;
      }
      if (p.summary === "无法读取状态") {
        unreadable++;
        continue;
      }
      if (p.blockers && p.blockers.length > 0) {
        blocked++;
      } else if (p.changeCount > 0) {
        dirty++;
      } else {
        clean++;
      }
      if (p.kindCounts) {
        for (const [k, n] of Object.entries(p.kindCounts)) {
          kindTotals[k] = (kindTotals[k] || 0) + n;
        }
      }
    }

    return {
      projectCount: projects.length,
      pendingFiles,
      clean,
      dirty,
      blocked,
      missing,
      unreadable,
      kindTotals,
    };
  }, [projects]);

  const statusSegments = [
    { key: "clean", label: "无修改", value: overview.clean, color: "var(--color-success-fg)" },
    { key: "dirty", label: "有待保存", value: overview.dirty, color: "var(--color-warning-fg)" },
    { key: "blocked", label: "已阻断", value: overview.blocked, color: "var(--color-error-fg)" },
    { key: "missing", label: "目录缺失", value: overview.missing, color: "var(--color-text-tertiary)" },
    {
      key: "unreadable",
      label: "读取失败",
      value: overview.unreadable,
      color: "var(--color-border-strong)",
    },
  ];

  const kindBars = KIND_META.map((m) => ({
    key: m.key,
    label: m.label,
    value: overview.kindTotals[m.key] || 0,
    color: m.color,
  })).filter((x) => x.value > 0);

  const emptyProjects = !projectsQ.isLoading && projects.length === 0;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">数据概览</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          基于本机已纳入 Forkly 的仓库汇总统计
        </p>
      </div>

      {projectsQ.isError && (
        <p className="mb-4 text-sm text-[var(--color-error-fg)]">
          {(projectsQ.error as Error).message}
        </p>
      )}

      {emptyProjects && (
        <div className="mb-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          当前还没有项目。可在「项目」页添加文件夹后，这里会显示统计数据。
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard label="项目总数" value={overview.projectCount} loading={projectsQ.isLoading} />
        <StatCard
          label="版本总数"
          value={activityQ.data?.totalCommits ?? 0}
          loading={activityQ.isLoading}
          hint={activityQ.isError ? "提交统计暂不可用" : undefined}
        />
        <StatCard
          label="近 30 天新增版本"
          value={activityQ.data?.recentCommits ?? 0}
          loading={activityQ.isLoading}
        />
        <StatCard label="待保存文件" value={overview.pendingFiles} loading={projectsQ.isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Panel
          title="近 30 天版本活动"
          footer={
            activityQ.isError ? (
              <p className="mt-3 text-xs text-[var(--color-warning-fg)]">
                无法加载提交活动，项目状态统计仍可用。
              </p>
            ) : activityQ.data && activityQ.data.unavailable > 0 ? (
              <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
                有 {activityQ.data.unavailable} 个仓库未能计入提交统计
              </p>
            ) : null
          }
        >
          {activityQ.isLoading ? (
            <div className="h-[180px] rounded bg-[var(--color-canvas-subtle)] animate-pulse" />
          ) : (
            <ActivityBarChart
              series={activityQ.data?.series || []}
              ariaLabel="近 30 天每日保存版本次数柱状图"
            />
          )}
          {!activityQ.isLoading &&
            (activityQ.data?.recentCommits ?? 0) === 0 &&
            !activityQ.isError && (
              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                近 30 天还没有保存版本记录
              </p>
            )}
        </Panel>

        <Panel title="项目状态分布">
          {projectsQ.isLoading ? (
            <div className="h-24 rounded bg-[var(--color-canvas-subtle)] animate-pulse" />
          ) : (
            <SegmentBar segments={statusSegments} ariaLabel="项目状态分布分段条" />
          )}
        </Panel>
      </div>

      <Panel title="待保存变更类型">
        {projectsQ.isLoading ? (
          <div className="h-28 rounded bg-[var(--color-canvas-subtle)] animate-pulse" />
        ) : kindBars.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">当前没有待保存的文件变更</p>
        ) : (
          <HorizontalBars items={kindBars} ariaLabel="待保存变更类型水平条形图" />
        )}
      </Panel>
    </div>
  );
}
