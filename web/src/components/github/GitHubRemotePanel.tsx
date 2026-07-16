import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowClockwise, CloudArrowDown, CloudArrowUp, GithubLogo } from "@phosphor-icons/react";
import {
  createGitHubRepo,
  fetchGitHubSettings,
  fetchOperation,
  fetchRemoteStatus,
  linkRemote,
  startRemoteOp,
  unlinkRemote,
} from "../../githubApi";
import { GitHubAccountPanel } from "./GitHubAccountPanel";
import { APIError } from "../../api";

type Props = {
  projectID: string;
  projectName: string;
  projectMissing?: boolean;
  onErr: (msg: string) => void;
};

async function invalidateSync(qc: ReturnType<typeof useQueryClient>, projectID: string) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["remote", projectID] }),
    qc.invalidateQueries({ queryKey: ["status", projectID] }),
    qc.invalidateQueries({ queryKey: ["history", projectID] }),
    qc.invalidateQueries({ queryKey: ["branches", projectID] }),
    qc.invalidateQueries({ queryKey: ["projects"] }),
    qc.invalidateQueries({ queryKey: ["workspace-tree", projectID] }),
    qc.invalidateQueries({ queryKey: ["github-settings"] }),
  ]);
}

function readOAuthReturn(search: string) {
  const params = new URLSearchParams(search);
  const oauth = params.get("gh_oauth");
  if (!oauth) return null;
  return {
    oauth,
    link: params.get("gh_link") || "",
    message: params.get("gh_msg") || "",
    fetch: params.get("gh_fetch") === "1",
  };
}

export function GitHubRemotePanel({ projectID, projectName, projectMissing, onErr }: Props) {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const remote = useQuery({
    queryKey: ["remote", projectID],
    queryFn: () => fetchRemoteStatus(projectID),
    refetchInterval: (q) => (q.state.data?.activeOp ? 1000 : false),
  });
  const githubSettings = useQuery({
    queryKey: ["github-settings"],
    queryFn: fetchGitHubSettings,
  });
  const [url, setUrl] = useState("");
  const [replaceRemote, setReplaceRemote] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [deleteGitRemote, setDeleteGitRemote] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState(projectName);
  const [createPrivate, setCreatePrivate] = useState(true);
  const [createDesc, setCreateDesc] = useState("");
  const [opId, setOpId] = useState("");
  const [busyKind, setBusyKind] = useState("");
  const [oauthBanner, setOauthBanner] = useState("");

  const oauthReturn = useMemo(() => readOAuthReturn(location.search), [location.search]);

  useEffect(() => {
    if (!oauthReturn) return;
    const params = new URLSearchParams(location.search);
    params.delete("gh_oauth");
    params.delete("gh_link");
    params.delete("gh_msg");
    params.delete("gh_fetch");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });

    void invalidateSync(qc, projectID);
    if (oauthReturn.oauth === "ok") {
      if (oauthReturn.link === "linked") {
        setOauthBanner(oauthReturn.fetch ? "GitHub 已连接并关联，正在获取远端更新…" : "GitHub 已连接并关联本项目。");
        onErr("");
      } else if (oauthReturn.link === "failed") {
        setOauthBanner("");
        onErr(oauthReturn.message || "授权成功，但自动关联远端失败，请手动关联。");
      } else {
        setOauthBanner("GitHub 账号已连接。");
        onErr("");
      }
    } else {
      onErr(oauthReturn.message || "GitHub 授权未完成");
    }
  }, [oauthReturn, location.pathname, location.search, navigate, onErr, projectID, qc]);

  const op = useQuery({
    queryKey: ["operation", opId],
    queryFn: () => fetchOperation(opId),
    enabled: !!opId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "running" || s === "queued") return 800;
      return false;
    },
  });

  useEffect(() => {
    const s = op.data?.status;
    if (!s || s === "running" || s === "queued") return;
    setBusyKind("");
    if (s === "failed") onErr(op.data?.error || "远端操作失败");
    void invalidateSync(qc, projectID);
    setOpId("");
  }, [op.data?.status, op.data?.error, onErr, qc, projectID]);

  const link = useMutation({
    mutationFn: (body: { url?: string; useExisting?: boolean; replace?: boolean; strictAccess?: boolean }) =>
      linkRemote(projectID, { remoteName: "origin", ...body }),
    onSuccess: async () => {
      onErr("");
      setUrl("");
      setReplaceRemote(false);
      await invalidateSync(qc, projectID);
    },
    onError: (e: Error) => {
      if (e instanceof APIError && e.code === "remote_conflict") {
        onErr(e.message);
        setReplaceRemote(true);
      } else {
        onErr(e.message);
      }
    },
  });

  const unlink = useMutation({
    mutationFn: () => unlinkRemote(projectID, deleteGitRemote),
    onSuccess: async () => {
      setUnlinkConfirm(false);
      setDeleteGitRemote(false);
      onErr("");
      await invalidateSync(qc, projectID);
    },
    onError: (e: Error) => onErr(e.message),
  });

  const createRepo = useMutation({
    mutationFn: () =>
      createGitHubRepo(projectID, {
        name: createName.trim() || projectName,
        description: createDesc,
        private: createPrivate,
      }),
    onSuccess: async (st) => {
      setCreateOpen(false);
      if (st.pushError) {
        onErr(st.pushError + (st.createdHtmlUrl ? `（${st.createdHtmlUrl}）` : ""));
      } else {
        onErr("");
      }
      await invalidateSync(qc, projectID);
    },
    onError: (e: Error) => onErr(e.message),
  });

  async function runOp(kind: "fetch" | "pull" | "push") {
    onErr("");
    setBusyKind(kind);
    try {
      const res = await startRemoteOp(projectID, kind);
      setOpId(res.operationId);
    } catch (e) {
      setBusyKind("");
      onErr((e as Error).message);
    }
  }

  const data = remote.data;
  const busy = !!busyKind || link.isPending || unlink.isPending || createRepo.isPending;
  const webOAuthConfigured = githubSettings.data?.webOAuthConfigured ?? false;
  const detected = data?.detectedOrigin;
  const canOneClick =
    !data?.authConfigured &&
    detected?.isGithub &&
    detected.owner &&
    detected.repo &&
    webOAuthConfigured;

  if (remote.isLoading) {
    return <p className="text-sm text-[var(--color-text-secondary)]">加载 GitHub 状态…</p>;
  }

  if (!data?.authConfigured) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GithubLogo size={16} /> GitHub
        </div>
        {canOneClick ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 space-y-2">
            <p className="text-xs text-[var(--color-text-secondary)]">
              检测到现有远端{" "}
              <span className="font-medium">
                {detected.owner}/{detected.repo}
              </span>
              。点击下方按钮将在浏览器完成授权，并自动关联此仓库。
            </p>
            <GitHubAccountPanel
              projectId={projectID}
              returnTo={`/projects/${projectID}?drawer=settings`}
              compact
            />
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--color-text-secondary)]">先连接 GitHub 账号，再关联本项目仓库。</p>
            {detected?.isGithub && (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                已检测到 {detected.owner}/{detected.repo}，连接账号后可一键关联。
              </p>
            )}
            <GitHubAccountPanel projectId={projectID} returnTo={`/projects/${projectID}?drawer=settings`} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <GithubLogo size={16} /> GitHub
        </div>
        <button
          type="button"
          disabled={remote.isFetching}
          onClick={() => void remote.refetch()}
          className="inline-flex items-center justify-center rounded-[var(--radius-sm)] p-1 hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          title="刷新"
        >
          <ArrowClockwise size={14} className={remote.isFetching ? "animate-spin" : undefined} />
        </button>
      </div>

      {oauthBanner && (
        <p className="text-xs text-[var(--color-accent)] bg-[var(--color-canvas-subtle)] rounded-[var(--radius-sm)] p-2">
          {oauthBanner}
        </p>
      )}

      {data.connected ? (
        <>
          <div className="text-sm">
            <span className="font-medium">
              {data.owner}/{data.repo}
            </span>
            {data.accountLogin && (
              <span className="ml-2 text-xs text-[var(--color-text-secondary)]">@{data.accountLogin}</span>
            )}
          </div>
          <p className="text-xs font-mono text-[var(--color-text-tertiary)] break-all">{data.fetchUrl}</p>
          <div className="text-xs text-[var(--color-text-secondary)] space-y-1">
            <div>
              领先 {data.ahead} · 落后 {data.behind}
              {data.diverged ? " · 已分叉" : ""}
              {data.hasUpstream ? ` · 跟踪 ${data.upstream}` : " · 尚未设置跟踪分支"}
            </div>
            {data.lastFetchAt && (
              <div>上次成功获取：{new Date(data.lastFetchAt).toLocaleString("zh-CN")}</div>
            )}
            {(data.pushHints || []).map((h) => (
              <div key={h}>{h}</div>
            ))}
            {(data.pullBlockers || []).map((h) => (
              <div key={h} className="text-[var(--color-error-fg)]">
                {h}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!data.canFetch || busy || projectMissing}
              onClick={() => void runOp("fetch")}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs disabled:opacity-50"
            >
              <ArrowClockwise size={12} className={busyKind === "fetch" ? "animate-spin" : undefined} />
              {busyKind === "fetch" ? "获取中…" : "获取更新"}
            </button>
            <button
              type="button"
              disabled={!data.canPull || busy || projectMissing}
              onClick={() => void runOp("pull")}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs disabled:opacity-50"
              title={(data.pullBlockers || []).join("；")}
            >
              <CloudArrowDown size={12} />
              {busyKind === "pull" ? "拉取中…" : "拉取"}
            </button>
            <button
              type="button"
              disabled={!data.canPush || busy || projectMissing}
              onClick={() => void runOp("push")}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              <CloudArrowUp size={12} />
              {busyKind === "push" ? "推送中…" : "推送"}
            </button>
          </div>

          {!unlinkConfirm ? (
            <button
              type="button"
              onClick={() => setUnlinkConfirm(true)}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-error-fg)]"
            >
              解除关联…
            </button>
          ) : (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] p-2 space-y-2">
              <p className="text-xs text-[var(--color-error-fg)]">
                默认只移除 Forkly 中的关联，保留本地 `.git` 的 remote。
              </p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={deleteGitRemote}
                  onChange={(e) => setDeleteGitRemote(e.target.checked)}
                />
                同时删除本地 remote（需二次确认）
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate()}
                  className="rounded-[var(--radius-sm)] bg-[var(--color-error-fg)] text-white px-2 py-1 text-xs disabled:opacity-50"
                >
                  确认解除
                </button>
                <button type="button" onClick={() => setUnlinkConfirm(false)} className="px-2 py-1 text-xs">
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {data.detectedOrigin?.isGithub && (
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-canvas-subtle)] p-2 text-xs space-y-2">
              <p>
                检测到已有远端 {data.detectedOrigin.owner}/{data.detectedOrigin.repo}
              </p>
              <button
                type="button"
                disabled={busy || projectMissing}
                onClick={() => link.mutate({ useExisting: true, strictAccess: true })}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1 text-xs disabled:opacity-50"
              >
                使用现有远端
              </button>
            </div>
          )}
          {data.detectedOrigin && !data.detectedOrigin.isGithub && data.detectedOrigin.message && (
            <p className="text-xs text-[var(--color-error-fg)]">{data.detectedOrigin.message}</p>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium">关联 GitHub 仓库</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git 或 owner/repo"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={replaceRemote}
              onChange={(e) => setReplaceRemote(e.target.checked)}
            />
            若已存在同名 remote，替换其地址
          </label>
          <button
            type="button"
            disabled={!url.trim() || busy || projectMissing}
            onClick={() => link.mutate({ url: url.trim(), replace: replaceRemote })}
            className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            连接
          </button>

          {!createOpen ? (
            <button
              type="button"
              onClick={() => {
                setCreateName(projectName);
                setCreateOpen(true);
              }}
              className="block text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
            >
              在 GitHub 创建新仓库…
            </button>
          ) : (
            <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
              <div className="text-xs font-medium">创建 GitHub 仓库</div>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1.5 text-sm"
                placeholder="仓库名"
              />
              <input
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-2 py-1.5 text-sm"
                placeholder="描述（可选）"
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={createPrivate}
                  onChange={(e) => setCreatePrivate(e.target.checked)}
                />
                私有仓库
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={createRepo.isPending || projectMissing}
                  onClick={() => createRepo.mutate()}
                  className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1 text-xs disabled:opacity-50"
                >
                  创建、连接并首次推送
                </button>
                <button type="button" onClick={() => setCreateOpen(false)} className="px-2 py-1 text-xs">
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
