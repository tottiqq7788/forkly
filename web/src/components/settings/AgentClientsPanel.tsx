import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";

type PendingPair = {
  id: string;
  userCode: string;
  clientName: string;
  preset: string;
  scopes: string[];
  state: string;
  createdAt: string;
  expiresAt: string;
};

type AgentClient = {
  id: string;
  name: string;
  scopes: string[];
  preset?: string;
  createdAt: string;
  lastUsedAt?: string;
};

const PRESETS: { id: string; label: string; scopes: string[] }[] = [
  { id: "readonly", label: "只读", scopes: ["read"] },
  {
    id: "collaborate",
    label: "项目协作",
    scopes: ["read", "file_write", "commit", "branch_write", "remote_write"],
  },
  {
    id: "full_control",
    label: "完全控制",
    scopes: [
      "read",
      "file_write",
      "project_admin",
      "commit",
      "branch_write",
      "remote_write",
      "account_admin",
      "ui_control",
    ],
  },
];

export function AgentClientsPanel() {
  const qc = useQueryClient();
  const [approvePreset, setApprovePreset] = useState<Record<string, string>>({});
  const [installMsg, setInstallMsg] = useState("");

  const pending = useQuery({
    queryKey: ["agent-pending"],
    queryFn: () => api<{ pending: PendingPair[] }>("/local-api/v1/agent/pair/pending"),
    refetchInterval: 3000,
  });
  const clients = useQuery({
    queryKey: ["agent-clients"],
    queryFn: () => api<{ clients: AgentClient[] }>("/local-api/v1/agent/clients"),
  });
  const cliStatus = useQuery({
    queryKey: ["cli-install"],
    queryFn: () => api<Record<string, unknown>>("/local-api/v1/cli/install"),
  });

  const approve = useMutation({
    mutationFn: ({ pairId, scopes }: { pairId: string; scopes?: string[] }) =>
      api("/local-api/v1/agent/pair/approve", {
        method: "POST",
        body: JSON.stringify({ pairId, scopes }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["agent-pending"] });
      await qc.invalidateQueries({ queryKey: ["agent-clients"] });
    },
  });
  const deny = useMutation({
    mutationFn: (pairId: string) =>
      api("/local-api/v1/agent/pair/deny", {
        method: "POST",
        body: JSON.stringify({ pairId }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["agent-pending"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/local-api/v1/agent/clients/${id}/revoke`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["agent-clients"] });
    },
  });
  const installCLI = useMutation({
    mutationFn: (scope: string) =>
      api<{ linkPath?: string; hint?: string }>("/local-api/v1/cli/install", {
        method: "POST",
        body: JSON.stringify({ scope }),
      }),
    onSuccess: async (res) => {
      setInstallMsg(
        res.linkPath
          ? `已安装到 ${res.linkPath}${res.hint ? `。${res.hint}` : ""}`
          : "安装完成",
      );
      await qc.invalidateQueries({ queryKey: ["cli-install"] });
    },
    onError: (e: Error) => setInstallMsg(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        允许 Cursor / Codex 等通过 <code className="font-mono text-xs">forklyctl</code> 调用本机
        Forkly。首次需核对配对码并批准一次。完全控制覆盖现有用户业务能力，不会开放 reset /
        force push 等产品边界外操作。
      </p>

      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 space-y-2">
        <h3 className="text-sm font-medium">安装命令行工具</h3>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          将签名的 <code className="font-mono">forklyctl</code> 链接到 PATH（优先{" "}
          <code className="font-mono">~/.local/bin</code>，可选{" "}
          <code className="font-mono">/usr/local/bin</code>）。Windows 安装程序会写入用户 PATH。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={installCLI.isPending}
            onClick={() => installCLI.mutate("user")}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            安装到 ~/.local/bin
          </button>
          <button
            type="button"
            disabled={installCLI.isPending}
            onClick={() => installCLI.mutate("system")}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            安装到 /usr/local/bin
          </button>
        </div>
        {installMsg && <p className="text-xs text-[var(--color-text-secondary)]">{installMsg}</p>}
        {cliStatus.data && (
          <pre className="text-[10px] overflow-auto text-[var(--color-text-tertiary)]">
            {JSON.stringify(cliStatus.data, null, 2)}
          </pre>
        )}
      </div>

      {(pending.data?.pending || []).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">待确认请求</h3>
          {pending.data!.pending.map((p) => {
            const chosen = approvePreset[p.id] || p.preset || "collaborate";
            const preset = PRESETS.find((x) => x.id === chosen) || PRESETS[1];
            return (
              <div
                key={p.id}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 space-y-2"
              >
                <div className="text-sm">
                  <span className="font-medium">{p.clientName}</span>
                  <span className="ml-2 text-xs text-[var(--color-text-secondary)]">
                    请求预设 {p.preset}
                  </span>
                </div>
                <div className="font-mono text-lg tracking-widest">{p.userCode}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {PRESETS.map((pr) => (
                    <label key={pr.id} className="flex items-center gap-1">
                      <input
                        type="radio"
                        name={`preset-${p.id}`}
                        checked={chosen === pr.id}
                        onChange={() =>
                          setApprovePreset((prev) => ({ ...prev, [p.id]: pr.id }))
                        }
                      />
                      {pr.label}
                    </label>
                  ))}
                </div>
                <div className="text-xs text-[var(--color-text-tertiary)]">
                  将授予：{preset.scopes.join(", ")}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({
                        pairId: p.id,
                        scopes: chosen === p.preset ? undefined : preset.scopes,
                      })
                    }
                    className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-2 py-1 text-xs"
                  >
                    批准
                  </button>
                  <button
                    type="button"
                    disabled={deny.isPending}
                    onClick={() => deny.mutate(p.id)}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs"
                  >
                    拒绝
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">已授权客户端</h3>
        {(clients.data?.clients || []).length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)]">
            暂无。在终端运行 <code className="font-mono">forklyctl pair</code>。
          </p>
        ) : (
          <ul className="space-y-2">
            {clients.data!.clients.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    {(c.scopes || []).join(", ")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke.mutate(c.id)}
                  className="shrink-0 text-xs text-[var(--color-error-fg)]"
                >
                  撤销
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
