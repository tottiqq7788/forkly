import {
  ArrowsClockwise,
  Copy,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import type { BrowseSource, TreeEntry } from "../../api";
import { ContextMenuItem, ContextMenuPortal, ContextMenuSeparator } from "../ui/ContextMenu";

export type ProjectFilesContextTarget =
  | { kind: "root"; path: "" }
  | { kind: "directory"; entry: TreeEntry; isExpanded: boolean }
  | { kind: "file"; entry: TreeEntry; isMarkdown: boolean };

export type ProjectFilesContextMenuState = {
  x: number;
  y: number;
  target: ProjectFilesContextTarget;
};

type Props = {
  state: ProjectFilesContextMenuState;
  source: BrowseSource;
  onClose: () => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRefresh: () => void;
  onOpenLocation: (path: string) => void;
  onCopyAbsolutePath: (path: string) => void;
  onCopyRelativePath: (path: string) => void;
  onRename: (path: string, currentName: string, entryKind: TreeEntry["kind"]) => void;
  onDelete: (path: string, entryKind: TreeEntry["kind"]) => void;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  onEditMarkdown: (path: string) => void;
};

export function ProjectFilesContextMenu({
  state,
  source,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onOpenLocation,
  onCopyAbsolutePath,
  onCopyRelativePath,
  onRename,
  onDelete,
  onToggleDirectory,
  onOpenFile,
  onEditMarkdown,
}: Props) {
  return (
    <ContextMenuPortal x={state.x} y={state.y} onClose={onClose}>
      {renderMenuItems(state.target, source, {
        onCreateFile,
        onCreateFolder,
        onRefresh,
        onOpenLocation,
        onCopyAbsolutePath,
        onCopyRelativePath,
        onRename,
        onDelete,
        onToggleDirectory,
        onOpenFile,
        onEditMarkdown,
      })}
    </ContextMenuPortal>
  );
}

type MenuHandlers = Omit<Props, "state" | "source" | "onClose">;

function renderMenuItems(target: ProjectFilesContextTarget, source: BrowseSource, handlers: MenuHandlers) {
  const writable = source === "worktree";

  if (target.kind === "root") {
    return (
      <>
        {writable ? (
          <>
            <ContextMenuItem icon={<FilePlus />} onSelect={() => handlers.onCreateFile(target.path)}>
              新建文件
            </ContextMenuItem>
            <ContextMenuItem icon={<FolderPlus />} onSelect={() => handlers.onCreateFolder(target.path)}>
              新建文件夹
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem icon={<ArrowsClockwise />} onSelect={handlers.onRefresh}>
          刷新文件树
        </ContextMenuItem>
        {writable ? (
          <>
            <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.path)}>
              打开项目文件夹
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.path)}>
              复制项目绝对路径
            </ContextMenuItem>
          </>
        ) : null}
      </>
    );
  }

  if (target.kind === "directory") {
    return (
      <>
        {writable ? (
          <>
            <ContextMenuItem icon={<FilePlus />} onSelect={() => handlers.onCreateFile(target.entry.path)}>
              新建文件
            </ContextMenuItem>
            <ContextMenuItem icon={<FolderPlus />} onSelect={() => handlers.onCreateFolder(target.entry.path)}>
              新建文件夹
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onToggleDirectory(target.entry.path)}>
          {target.isExpanded ? "折叠" : "展开"}
        </ContextMenuItem>
        {writable ? (
          <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.entry.path)}>
            在文件管理器中打开
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        {writable ? (
          <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.entry.path)}>
            复制绝对路径
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyRelativePath(target.entry.path)}>
          复制相对路径
        </ContextMenuItem>
        {writable ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              icon={<PencilSimple />}
              onSelect={() => handlers.onRename(target.entry.path, target.entry.name, target.entry.kind)}
            >
              重命名
            </ContextMenuItem>
            <ContextMenuItem
              destructive
              icon={<Trash />}
              onSelect={() => handlers.onDelete(target.entry.path, target.entry.kind)}
            >
              删除
            </ContextMenuItem>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <ContextMenuItem icon={<FileText />} onSelect={() => handlers.onOpenFile(target.entry.path)}>
        打开
      </ContextMenuItem>
      {writable && target.isMarkdown ? (
        <ContextMenuItem icon={<PencilSimple />} onSelect={() => handlers.onEditMarkdown(target.entry.path)}>
          在新标签页编辑
        </ContextMenuItem>
      ) : null}
      {writable ? (
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.entry.path)}>
          在文件管理器中显示
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      {writable ? (
        <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.entry.path)}>
          复制绝对路径
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyRelativePath(target.entry.path)}>
        复制相对路径
      </ContextMenuItem>
      {writable ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={<PencilSimple />}
            onSelect={() => handlers.onRename(target.entry.path, target.entry.name, target.entry.kind)}
          >
            重命名
          </ContextMenuItem>
          <ContextMenuItem
            destructive
            icon={<Trash />}
            onSelect={() => handlers.onDelete(target.entry.path, target.entry.kind)}
          >
            删除
          </ContextMenuItem>
        </>
      ) : null}
    </>
  );
}
