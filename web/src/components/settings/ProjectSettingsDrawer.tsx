import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, Project } from "../../api";
import { Drawer } from "../../Drawer";
import { GitHubRemotePanel } from "../github/GitHubRemotePanel";

type Props = {
  projectID: string;
  projectName: string;
  projectPath: string;
  hideRules?: string[];
  projectMissing: boolean;
  onClose: () => void;
};

export function ProjectSettingsDrawer({
  projectID,
  projectName,
  projectPath,
  hideRules,
  projectMissing,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [settingsErr, setSettingsErr] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [hideRulesText, setHideRulesText] = useState("*.DS*");
  const [hideRulesSaved, setHideRulesSaved] = useState(false);

  useEffect(() => {
    setHideRulesText((hideRules ?? ["*.DS*"]).join("\n"));
  }, [hideRules]);

  const projectList = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ projects: Project[] }>("/local-api/v1/projects"),
  });

  const revealProject = useMutation({
    mutationFn: () => api(`/local-api/v1/projects/${projectID}/reveal`, { method: "POST", body: "{}" }),
    onError: (e: Error) => setSettingsErr(e.message),
  });

  const relocateProject = useMutation({
    mutationFn: async () => {
      const picked = await api<{ path: string }>("/local-api/v1/dialog/folder", {
        method: "POST",
        body: "{}",
      });
      return api<{ ok: boolean; path: string }>(`/local-api/v1/projects/${projectID}/relocate`, {
        method: "POST",
        body: JSON.stringify({ path: picked.path }),
      });
    },
    onSuccess: async () => {
      setSettingsErr("");
      onClose();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", projectID] }),
        qc.invalidateQueries({ queryKey: ["status", projectID] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-activity"] }),
        qc.invalidateQueries({ queryKey: ["remote", projectID] }),
      ]);
    },
    onError: (e: Error) => setSettingsErr(e.message),
  });

  const saveHideRules = useMutation({
    mutationFn: () => {
      const rules = hideRulesText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return api<{ ok: boolean; hideRules: string[] }>(`/local-api/v1/projects/${projectID}`, {
        method: "PUT",
        body: JSON.stringify({ hideRules: rules }),
      });
    },
    onSuccess: async (data) => {
      setSettingsErr("");
      setHideRulesText((data.hideRules ?? []).join("\n"));
      setHideRulesSaved(true);
      window.setTimeout(() => setHideRulesSaved(false), 1500);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", projectID] }),
        qc.invalidateQueries({ queryKey: ["workspace-tree", projectID] }),
      ]);
    },
    onError: (e: Error) => setSettingsErr(e.message),
  });

  const removeProject = useMutation({
    mutationFn: () => api(`/local-api/v1/projects/${projectID}`, { method: "DELETE" }),
    onSuccess: async () => {
      onClose();
      setRemoveConfirm(false);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-activity"] });
      const remaining = (projectList.data?.projects || []).filter((p) => p.id !== projectID);
      if (remaining[0]) {
        nav(`/projects/${remaining[0].id}`, { replace: true });
      } else {
        nav("/", { replace: true });
      }
    },
    onError: (e: Error) => setSettingsErr(e.message),
  });

  return (
    <Drawer
      title="项目设置"
      stackIndex={1}
      width={420}
      onClose={() => {
        onClose();
        setRemoveConfirm(false);
      }}
    >
      <div className="min-h-full flex flex-col gap-4">
        <div>
          <div className="text-sm font-medium mb-1">{projectName || "项目"}</div>
          <p className="text-xs font-mono text-[var(--color-text-tertiary)] break-all">
            {projectPath || "…"}
          </p>
          {projectMissing && (
            <p className="mt-2 text-sm text-[var(--color-error-fg)]">当前登记路径找不到目录。</p>
          )}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            disabled={revealProject.isPending || projectMissing}
            onClick={() => revealProject.mutate()}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            在文件管理器中显示
          </button>
          <button
            type="button"
            disabled={relocateProject.isPending}
            onClick={() => relocateProject.mutate()}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            重新定位文件夹…
          </button>
        </div>

        <GitHubRemotePanel
          projectID={projectID}
          projectName={projectName || "项目"}
          projectMissing={projectMissing}
          onErr={setSettingsErr}
        />

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
          <div className="text-sm font-medium mb-1">隐藏项</div>
          <p className="text-xs text-[var(--color-text-secondary)] mb-2">
            一行一条规则，匹配文件名的项不会出现在「文件」页目录树中。支持通配符，如{" "}
            <span className="font-mono">*.DS*</span>。
          </p>
          <textarea
            value={hideRulesText}
            onChange={(e) => {
              setHideRulesText(e.target.value);
              setHideRulesSaved(false);
            }}
            onBlur={() => saveHideRules.mutate()}
            rows={4}
            spellCheck={false}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-mono leading-relaxed resize-y min-h-[88px]"
            placeholder={"*.DS*"}
          />
          <div className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">
            {saveHideRules.isPending
              ? "保存中…"
              : hideRulesSaved
                ? "已保存"
                : "失焦后自动保存"}
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
          <div className="text-sm font-medium mb-1">从 Forkly 移除</div>
          <p className="text-xs text-[var(--color-text-secondary)] mb-3">
            只移除本应用中的登记，不会删除磁盘上的文件夹或 `.git` 历史。
          </p>
          {!removeConfirm ? (
            <button
              type="button"
              onClick={() => setRemoveConfirm(true)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-error-fg)]/40 text-[var(--color-error-fg)] px-3 py-1.5 text-sm"
            >
              移除项目
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={removeProject.isPending}
                onClick={() => removeProject.mutate()}
                className="rounded-[var(--radius-sm)] bg-[var(--color-error-fg)] text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                确认移除
              </button>
              <button type="button" onClick={() => setRemoveConfirm(false)} className="px-3 py-1.5 text-sm">
                取消
              </button>
            </div>
          )}
        </div>

        {settingsErr && <p className="text-sm text-[var(--color-error-fg)]">{settingsErr}</p>}
      </div>
    </Drawer>
  );
}
