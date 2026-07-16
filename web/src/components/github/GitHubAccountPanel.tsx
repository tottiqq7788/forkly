import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelGitHubDevice,
  fetchGitHubSettings,
  gitHubDeviceStatus,
  logoutGitHub,
  setGitHubPAT,
  startGitHubDevice,
  startGitHubWebOAuth,
} from "../../githubApi";

type Props = {
  projectId?: string;
  returnTo?: string;
  compact?: boolean;
};

export function GitHubAccountPanel({ projectId, returnTo, compact }: Props) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["github-settings"],
    queryFn: fetchGitHubSettings,
  });
  const [pat, setPat] = useState("");
  const [err, setErr] = useState("");
  const [flowId, setFlowId] = useState("");
  const [userCode, setUserCode] = useState("");
  const [verifyUri, setVerifyUri] = useState("");
  const [webStarting, setWebStarting] = useState(false);

  const deviceStatus = useQuery({
    queryKey: ["github-device", flowId],
    queryFn: () => gitHubDeviceStatus(flowId),
    enabled: !!flowId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (!s || s === "pending") return 2000;
      return false;
    },
  });

  useEffect(() => {
    if (deviceStatus.data?.status === "complete") {
      setFlowId("");
      setUserCode("");
      setVerifyUri("");
      void qc.invalidateQueries({ queryKey: ["github-settings"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    }
  }, [deviceStatus.data?.status, qc]);

  const startDevice = useMutation({
    mutationFn: startGitHubDevice,
    onSuccess: (d) => {
      setErr("");
      setFlowId(d.flowId);
      setUserCode(d.userCode);
      setVerifyUri(d.verificationUri);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const savePat = useMutation({
    mutationFn: () => setGitHubPAT(pat),
    onSuccess: async () => {
      setPat("");
      setErr("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["github-settings"] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
        qc.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const logout = useMutation({
    mutationFn: logoutGitHub,
    onSuccess: async () => {
      setErr("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["github-settings"] }),
        qc.invalidateQueries({ queryKey: ["me"] }),
        qc.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    },
    onError: (e: Error) => setErr(e.message),
  });

  async function startWebOAuth() {
    setErr("");
    setWebStarting(true);
    try {
      const path =
        returnTo ||
        (projectId ? `/projects/${projectId}${compact ? "?drawer=settings" : ""}` : "/settings");
      const start = await startGitHubWebOAuth({ projectId, returnTo: path });
      window.location.assign(start.authorizationUrl);
    } catch (e) {
      setWebStarting(false);
      setErr((e as Error).message);
    }
  }

  const account = settings.data?.account;
  const webOAuthConfigured = settings.data?.webOAuthConfigured ?? false;
  const deviceFlowConfigured = settings.data?.deviceFlowConfigured ?? settings.data?.oauthConfigured ?? false;

  return (
    <div className="space-y-3">
      {account ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
          <div className="text-sm font-medium">已连接 @{account.login}</div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            认证方式：{account.authKind === "oauth" ? "GitHub 授权" : "个人访问令牌"}
          </p>
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            退出 GitHub 账号
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {webOAuthConfigured ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 space-y-2">
              <div className="text-sm font-medium">使用 GitHub 登录</div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                在当前标签页完成浏览器授权后，Forkly 会把令牌写入系统安全存储
                {projectId ? "，并尝试关联本项目的现有远端。" : "。"}
              </p>
              <button
                type="button"
                disabled={webStarting}
                onClick={() => void startWebOAuth()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {webStarting ? "正在跳转…" : projectId ? "连接 GitHub 并关联" : "连接 GitHub"}
              </button>
            </div>
          ) : deviceFlowConfigured ? (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 space-y-2">
              <div className="text-sm font-medium">使用设备码登录</div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                当前构建未启用浏览器 OAuth，请在另一设备或浏览器输入设备码完成授权。
              </p>
              {!flowId ? (
                <button
                  type="button"
                  disabled={startDevice.isPending}
                  onClick={() => startDevice.mutate()}
                  className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  开始设备码授权
                </button>
              ) : (
                <div className="space-y-2 text-sm">
                  <p>
                    打开{" "}
                    <a
                      href={verifyUri}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--color-accent)] underline"
                    >
                      {verifyUri}
                    </a>
                  </p>
                  <p>
                    输入代码：
                    <span className="ml-2 font-mono font-semibold tracking-wider">{userCode}</span>
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    状态：{deviceStatus.data?.status || "pending"}
                    {deviceStatus.data?.errorMessage ? ` · ${deviceStatus.data.errorMessage}` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void cancelGitHubDevice(flowId);
                      setFlowId("");
                    }}
                    className="text-xs text-[var(--color-text-secondary)]"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-secondary)]">
              当前构建未配置 GitHub OAuth，请使用个人访问令牌。
            </p>
          )}

          {!compact && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3 space-y-2">
              <div className="text-sm font-medium">个人访问令牌（备用）</div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                推荐细粒度令牌，至少授予 Contents 读写；创建仓库还需 Administration。令牌只保存在系统钥匙串。
              </p>
              <input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="github_pat_… 或 ghp_…"
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                disabled={!pat.trim() || savePat.isPending}
                onClick={() => savePat.mutate()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                保存令牌
              </button>
            </div>
          )}
        </div>
      )}
      {err && <p className="text-sm text-[var(--color-error-fg)]">{err}</p>}
    </div>
  );
}
