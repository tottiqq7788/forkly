import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

type Settings = {
  identity: { name: string; email: string };
  preferences: { theme: string; backgroundChecks: boolean };
  git: { version: string; bundled: boolean; path: string };
  configPath: string;
  logDir: string;
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<Settings>("/local-api/v1/settings"),
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [theme, setTheme] = useState("system");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.identity.name);
    setEmail(data.identity.email);
    setTheme(data.preferences.theme);
    applyTheme(data.preferences.theme);
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      if (!trimmedName || !trimmedEmail) {
        throw new Error("名称和邮箱不能为空");
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        throw new Error("邮箱格式不正确");
      }
      return api("/local-api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({
          identity: { name: trimmedName, email: trimmedEmail },
          preferences: { theme, backgroundChecks: data?.preferences.backgroundChecks ?? true },
        }),
      });
    },
    onSuccess: async () => {
      applyTheme(theme);
      setMsg("已保存");
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <div className="p-6 max-w-xl space-y-8">
      <h1 className="text-lg font-semibold">设置</h1>

      <section className="space-y-3">
        <h2 className="font-medium">Git 身份</h2>
        <label className="block space-y-1.5">
          <span className="text-sm">名称</span>
          <input
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm">邮箱</span>
          <input
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">外观</h2>
        <div className="flex gap-3 text-sm">
          {(["system", "light", "dark"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} />
              {t === "system" ? "跟随系统" : t === "light" ? "浅色" : "深色"}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Git 运行时</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {data?.git.bundled ? "内置 Git" : "系统 Git"} · {data?.git.version}
        </p>
        <p className="text-xs font-mono text-[var(--color-text-tertiary)] break-all">{data?.git.path}</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">日志与诊断</h2>
        <p className="text-xs font-mono text-[var(--color-text-tertiary)] break-all">配置：{data?.configPath}</p>
        <p className="text-xs font-mono text-[var(--color-text-tertiary)] break-all">日志：{data?.logDir}</p>
      </section>

      <section>
        <h2 className="font-medium mb-1">关于</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">Forkly 0.1.45 · 本地可视化 Git</p>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate()}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium"
        >
          保存设置
        </button>
        {msg && <span className="text-sm text-[var(--color-text-secondary)]">{msg}</span>}
      </div>
    </div>
  );
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}
