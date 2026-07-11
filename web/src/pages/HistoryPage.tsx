import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "@phosphor-icons/react";
import { api } from "../api";

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

export default function HistoryPage() {
  const { id = "" } = useParams();
  const [selected, setSelected] = useState("");
  const history = useQuery({
    queryKey: ["history", id],
    queryFn: () => api<{ commits: Commit[] }>(`/local-api/v1/projects/${id}/history`),
  });
  const detail = useQuery({
    queryKey: ["commit", id, selected],
    queryFn: () =>
      api<{ commit: Commit; files: CommitFile[] }>(`/local-api/v1/projects/${id}/commits/${selected}`),
    enabled: !!selected,
  });

  const commits = history.data?.commits || [];

  return (
    <div className="flex flex-col h-full">
      <header className="h-12 border-b border-[var(--color-border)] px-4 flex items-center gap-3">
        <Link to={`/projects/${id}`} className="text-[var(--color-text-secondary)]">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="font-semibold">历史</h1>
      </header>
      <div className="flex flex-1 min-h-0">
        <ul className="w-[320px] border-r border-[var(--color-border)] overflow-auto">
          {commits.length === 0 && (
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
          {detail.data && (
            <div>
              <h2 className="text-lg font-semibold mb-2">{detail.data.commit.subject}</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                {detail.data.commit.author} · {formatDate(detail.data.commit.date)} ·{" "}
                <span className="font-mono text-[var(--color-accent-muted)]">
                  {detail.data.commit.short}
                </span>
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
