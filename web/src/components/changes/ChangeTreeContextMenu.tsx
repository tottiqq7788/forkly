import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CheckSquare,
  Copy,
  Eye,
  FolderOpen,
  Square,
} from "@phosphor-icons/react";
import type { FileStatus } from "../../api";
import { ContextMenuItem, ContextMenuPortal, ContextMenuSeparator } from "../ui/ContextMenu";

export type ChangeTreeContextTarget =
  | { kind: "root" }
  | { kind: "directory"; path: string; name: string; isExpanded: boolean; selected: boolean }
  | { kind: "file"; path: string; name: string; file: FileStatus; selected: boolean };

export type ChangeTreeContextMenuState = {
  x: number;
  y: number;
  target: ChangeTreeContextTarget;
};

type Props = {
  state: ChangeTreeContextMenuState;
  allSelected: boolean;
  anyCollapsed: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onToggleSelectAll: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onOpenLocation: (path: string) => void;
  onCopyAbsolutePath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onToggleSelect: (paths: string[]) => void;
  onToggleDirectory: (path: string) => void;
  collectDirectoryPaths: (path: string) => string[];
};

export function ChangeTreeContextMenu({
  state,
  allSelected,
  anyCollapsed,
  onClose,
  onRefresh,
  onToggleSelectAll,
  onExpandAll,
  onCollapseAll,
  onOpenLocation,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onOpenDiff,
  onToggleSelect,
  onToggleDirectory,
  collectDirectoryPaths,
}: Props) {
  return (
    <ContextMenuPortal x={state.x} y={state.y} onClose={onClose}>
      {renderMenuItems(state.target, {
        allSelected,
        anyCollapsed,
        onRefresh,
        onToggleSelectAll,
        onExpandAll,
        onCollapseAll,
        onOpenLocation,
        onCopyAbsolutePath,
        onCopyRelativePath,
        onOpenDiff,
        onToggleSelect,
        onToggleDirectory,
        collectDirectoryPaths,
      })}
    </ContextMenuPortal>
  );
}

type MenuHandlers = Omit<Props, "state" | "onClose">;

function renderMenuItems(target: ChangeTreeContextTarget, handlers: MenuHandlers) {
  if (target.kind === "root") {
    return (
      <>
        <ContextMenuItem icon={<ArrowsClockwise />} onSelect={handlers.onRefresh}>
          刷新变更
        </ContextMenuItem>
        <ContextMenuItem
          icon={handlers.allSelected ? <Square /> : <CheckSquare />}
          onSelect={handlers.onToggleSelectAll}
        >
          {handlers.allSelected ? "清空选择" : "全选"}
        </ContextMenuItem>
        <ContextMenuItem
          icon={handlers.anyCollapsed ? <CaretDown /> : <CaretRight />}
          onSelect={handlers.anyCollapsed ? handlers.onExpandAll : handlers.onCollapseAll}
        >
          {handlers.anyCollapsed ? "全部展开" : "全部折叠"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation("")}>
          打开项目文件夹
        </ContextMenuItem>
        <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath("")}>
          复制项目绝对路径
        </ContextMenuItem>
      </>
    );
  }

  if (target.kind === "directory") {
    const paths = handlers.collectDirectoryPaths(target.path);
    return (
      <>
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onToggleDirectory(target.path)}>
          {target.isExpanded ? "折叠" : "展开"}
        </ContextMenuItem>
        <ContextMenuItem
          icon={target.selected ? <Square /> : <CheckSquare />}
          onSelect={() => handlers.onToggleSelect(paths)}
        >
          {target.selected ? "取消选择目录内变更" : "选择目录内全部变更"}
        </ContextMenuItem>
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.path)}>
          在文件管理器中打开
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.path)}>
          复制绝对路径
        </ContextMenuItem>
        <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyRelativePath(target.path)}>
          复制相对路径
        </ContextMenuItem>
      </>
    );
  }

  const canReveal = target.file.kind !== "deleted";
  return (
    <>
      <ContextMenuItem icon={<Eye />} onSelect={() => handlers.onOpenDiff(target.path)}>
        查看差异
      </ContextMenuItem>
      <ContextMenuItem
        icon={target.selected ? <Square /> : <CheckSquare />}
        onSelect={() => handlers.onToggleSelect([target.path])}
      >
        {target.selected ? "移出本次保存" : "加入本次保存"}
      </ContextMenuItem>
      {canReveal ? (
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.path)}>
          在文件管理器中显示
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.path)}>
        复制绝对路径
      </ContextMenuItem>
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyRelativePath(target.path)}>
        复制相对路径
      </ContextMenuItem>
    </>
  );
}
