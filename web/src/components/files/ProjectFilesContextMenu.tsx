import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const ref = useRef<HTMLDivElement>(null);
  const position = clampMenuPosition(state.x, state.y);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 w-56 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-xs text-[var(--color-text)] shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
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
    </div>,
    document.body,
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
            <MenuItem icon={<FilePlus />} onSelect={() => handlers.onCreateFile(target.path)}>
              新建文件
            </MenuItem>
            <MenuItem icon={<FolderPlus />} onSelect={() => handlers.onCreateFolder(target.path)}>
              新建文件夹
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={<ArrowsClockwise />} onSelect={handlers.onRefresh}>
          刷新文件树
        </MenuItem>
        {writable ? (
          <>
            <MenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.path)}>
              打开项目文件夹
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.path)}>
              复制项目绝对路径
            </MenuItem>
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
            <MenuItem icon={<FilePlus />} onSelect={() => handlers.onCreateFile(target.entry.path)}>
              新建文件
            </MenuItem>
            <MenuItem icon={<FolderPlus />} onSelect={() => handlers.onCreateFolder(target.entry.path)}>
              新建文件夹
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem icon={<FolderOpen />} onSelect={() => handlers.onToggleDirectory(target.entry.path)}>
          {target.isExpanded ? "折叠" : "展开"}
        </MenuItem>
        {writable ? (
          <MenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.entry.path)}>
            在访达中打开
          </MenuItem>
        ) : null}
        <MenuSeparator />
        {writable ? (
          <MenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.entry.path)}>
            复制绝对路径
          </MenuItem>
        ) : null}
        <MenuItem icon={<Copy />} onSelect={() => handlers.onCopyRelativePath(target.entry.path)}>
          复制相对路径
        </MenuItem>
        {writable ? (
          <>
            <MenuSeparator />
            <MenuItem icon={<PencilSimple />} onSelect={() => handlers.onRename(target.entry.path, target.entry.name, target.entry.kind)}>
              重命名
            </MenuItem>
            <MenuItem destructive icon={<Trash />} onSelect={() => handlers.onDelete(target.entry.path, target.entry.kind)}>
              删除
            </MenuItem>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <MenuItem icon={<FileText />} onSelect={() => handlers.onOpenFile(target.entry.path)}>
        打开
      </MenuItem>
      {writable && target.isMarkdown ? (
        <MenuItem icon={<PencilSimple />} onSelect={() => handlers.onEditMarkdown(target.entry.path)}>
          在新标签页编辑
        </MenuItem>
      ) : null}
      {writable ? (
        <MenuItem icon={<FolderOpen />} onSelect={() => handlers.onOpenLocation(target.entry.path)}>
          在访达中显示
        </MenuItem>
      ) : null}
      <MenuSeparator />
      {writable ? (
        <MenuItem icon={<Copy />} onSelect={() => handlers.onCopyAbsolutePath(target.entry.path)}>
          复制绝对路径
        </MenuItem>
      ) : null}
      <MenuItem icon={<Copy />} onSelect={() => handlers.onCopyRelativePath(target.entry.path)}>
        复制相对路径
      </MenuItem>
      {writable ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<PencilSimple />} onSelect={() => handlers.onRename(target.entry.path, target.entry.name, target.entry.kind)}>
            重命名
          </MenuItem>
          <MenuItem destructive icon={<Trash />} onSelect={() => handlers.onDelete(target.entry.path, target.entry.kind)}>
            删除
          </MenuItem>
        </>
      ) : null}
    </>
  );
}

function MenuItem({
  children,
  icon,
  destructive,
  onSelect,
}: {
  children: ReactNode;
  icon: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors ${
        destructive
          ? "text-[var(--color-error-fg)] hover:bg-[var(--color-error-bg)]"
          : "hover:bg-[var(--color-surface-hover)]"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-[var(--color-border)]" />;
}

function clampMenuPosition(x: number, y: number) {
  const menuWidth = 224;
  const menuHeight = 320;
  const padding = 8;
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding)),
  };
}
