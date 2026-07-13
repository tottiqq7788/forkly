import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Copy,
  Eye,
  FolderOpen,
} from "@phosphor-icons/react";
import { ContextMenuItem, ContextMenuPortal, ContextMenuSeparator } from "../ui/ContextMenu";

export type HistoryCommitInfo = {
  sha: string;
  short: string;
  subject: string;
  author: string;
  email: string;
  date: string;
};

export type HistoryTreeContextTarget =
  | { kind: "root" }
  | { kind: "group"; key: string; label: string; copyValue: string; isExpanded: boolean; latestSha: string }
  | { kind: "commit"; commit: HistoryCommitInfo };

export type HistoryTreeContextMenuState = {
  x: number;
  y: number;
  target: HistoryTreeContextTarget;
};

type Props = {
  state: HistoryTreeContextMenuState;
  anyCollapsed: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onOpenLocation: () => void;
  onCopyProjectPath: () => void;
  onSelectCommit: (sha: string) => void;
  onToggleGroup: (key: string) => void;
  onCopyText: (text: string) => void;
};

export function HistoryTreeContextMenu({
  state,
  anyCollapsed,
  onClose,
  onRefresh,
  onExpandAll,
  onCollapseAll,
  onOpenLocation,
  onCopyProjectPath,
  onSelectCommit,
  onToggleGroup,
  onCopyText,
}: Props) {
  return (
    <ContextMenuPortal x={state.x} y={state.y} onClose={onClose}>
      {renderMenuItems(state.target, {
        anyCollapsed,
        onRefresh,
        onExpandAll,
        onCollapseAll,
        onOpenLocation,
        onCopyProjectPath,
        onSelectCommit,
        onToggleGroup,
        onCopyText,
      })}
    </ContextMenuPortal>
  );
}

type MenuHandlers = Omit<Props, "state" | "onClose">;

function formatCommitInfo(commit: HistoryCommitInfo): string {
  const parsed = new Date(commit.date);
  const date = Number.isNaN(parsed.getTime()) ? commit.date : parsed.toLocaleString();
  return [
    `SHA: ${commit.sha}`,
    `作者: ${commit.author}${commit.email ? ` <${commit.email}>` : ""}`,
    `时间: ${date}`,
    `说明: ${commit.subject || "（无说明）"}`,
  ].join("\n");
}

function renderMenuItems(target: HistoryTreeContextTarget, handlers: MenuHandlers) {
  if (target.kind === "root") {
    return (
      <>
        <ContextMenuItem icon={<ArrowsClockwise />} onSelect={handlers.onRefresh}>
          刷新历史
        </ContextMenuItem>
        <ContextMenuItem
          icon={handlers.anyCollapsed ? <CaretDown /> : <CaretRight />}
          onSelect={handlers.anyCollapsed ? handlers.onExpandAll : handlers.onCollapseAll}
        >
          {handlers.anyCollapsed ? "全部展开" : "全部折叠"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<FolderOpen />} onSelect={handlers.onOpenLocation}>
          打开项目文件夹
        </ContextMenuItem>
        <ContextMenuItem icon={<Copy />} onSelect={handlers.onCopyProjectPath}>
          复制项目绝对路径
        </ContextMenuItem>
      </>
    );
  }

  if (target.kind === "group") {
    return (
      <>
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onToggleGroup(target.key)}>
          {target.isExpanded ? "折叠" : "展开"}
        </ContextMenuItem>
        {target.latestSha ? (
          <ContextMenuItem icon={<Eye />} onSelect={() => handlers.onSelectCommit(target.latestSha)}>
            查看组内最新提交
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyText(target.copyValue)}>
          复制分组名称
        </ContextMenuItem>
      </>
    );
  }

  return (
    <>
      <ContextMenuItem icon={<Eye />} onSelect={() => handlers.onSelectCommit(target.commit.sha)}>
        查看详情
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyText(target.commit.sha)}>
        复制完整 SHA
      </ContextMenuItem>
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyText(target.commit.subject || "（无说明）")}>
        复制提交说明
      </ContextMenuItem>
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyText(formatCommitInfo(target.commit))}>
        复制完整提交信息
      </ContextMenuItem>
    </>
  );
}
