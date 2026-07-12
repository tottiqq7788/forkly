import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  CaretRight,
  File as FileIcon,
  FolderSimple,
  LinkSimple,
  PencilSimple,
} from "@phosphor-icons/react";
import { api, BrowseSource, FileContent, TreeEntry, TreeListing } from "../../api";
import { FilePreviewView } from "./FilePreviewView";
import { useMarkdownSaveGuard } from "./markdown/MarkdownSaveGuard";
import { isMarkdownPath } from "./markdown/isMarkdown";
import type { MarkdownViewerMode } from "./markdown/MarkdownDocumentView";
import { isGitMetaPath, parentDirsOf } from "./markdown/markdownPath";

type Props = {
  projectID: string;
  projectName: string;
  branchKey?: string;
  /** From URL on refresh; empty when entering the tab so we default to the first file. */
  preferredPath?: string;
  onPathChange?: (path: string) => void;
};

type SourceSelection = {
  path: string;
};

function emptyExpandedBySource(): Record<BrowseSource, Set<string>> {
  return {
    worktree: new Set([""]),
    head: new Set([""]),
  };
}

export function ProjectFilesPanel({
  projectID,
  projectName,
  branchKey = "",
  preferredPath = "",
  onPathChange,
}: Props) {
  const [source, setSource] = useState<BrowseSource>("worktree");
  const [expandedBySource, setExpandedBySource] = useState(emptyExpandedBySource);
  const [selection, setSelection] = useState<Record<BrowseSource, SourceSelection>>({
    worktree: { path: "" },
    head: { path: "" },
  });
  const [loadedDirs, setLoadedDirs] = useState<Record<string, TreeEntry[]>>({});
  const [pendingFragment, setPendingFragment] = useState("");
  const [mdViewMode, setMdViewMode] = useState<MarkdownViewerMode>("preview");
  const knownBranchKey = useRef("");
  // A local click updates selection before React Router delivers the new URL
  // prop. Ignore the old preferredPath during that short hand-off, otherwise
  // the highlight visibly jumps old → new → old → new.
  const pendingPathChange = useRef("");
  const { flush: flushMarkdown } = useMarkdownSaveGuard();

  const expanded = expandedBySource[source];
  const activePath = selection[source].path;

  useEffect(() => {
    knownBranchKey.current = "";
    setExpandedBySource(emptyExpandedBySource());
    setSelection({ worktree: { path: "" }, head: { path: "" } });
    setSource("worktree");
    setLoadedDirs({});
    pendingPathChange.current = "";
  }, [projectID]);

  useEffect(() => {
    if (!branchKey) return;
    // First time we learn the branch after mount — keep cascade expand, don't wipe.
    if (!knownBranchKey.current) {
      knownBranchKey.current = branchKey;
      return;
    }
    if (knownBranchKey.current === branchKey) return;
    knownBranchKey.current = branchKey;
    setExpandedBySource(emptyExpandedBySource());
    setSelection({ worktree: { path: "" }, head: { path: "" } });
    setLoadedDirs({});
    pendingPathChange.current = "";
  }, [branchKey]);

  useEffect(() => {
    setLoadedDirs({});
  }, [source]);

  const expandDirs = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      setExpandedBySource((prev) => {
        const current = prev[source];
        let changed = false;
        const next = new Set(current);
        for (const path of paths) {
          if (!next.has(path)) {
            next.add(path);
            changed = true;
          }
        }
        if (!changed) return prev;
        return { ...prev, [source]: next };
      });
    },
    [source],
  );

  const reportEntries = useCallback((dirPath: string, entries: TreeEntry[]) => {
    setLoadedDirs((prev) => {
      const old = prev[dirPath];
      if (
        old &&
        old.length === entries.length &&
        old.every((entry, index) => entry.path === entries[index]?.path && entry.kind === entries[index]?.kind)
      ) {
        return prev;
      }
      return { ...prev, [dirPath]: entries };
    });
  }, []);

  const rootQuery = useInfiniteQuery({
    queryKey: ["workspace-tree", projectID, source, ""],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<TreeListing>(
        `/local-api/v1/projects/${projectID}/tree?source=${source}&path=&offset=${pageParam}&limit=200`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
  });

  const rootEntries = useMemo(
    () => rootQuery.data?.pages.flatMap((p) => p.entries) ?? [],
    [rootQuery.data],
  );
  const emptyHead = rootQuery.data?.pages[0]?.emptyHead === true;

  useEffect(() => {
    expandDirs(dirPaths(rootEntries));
  }, [expandDirs, rootEntries, projectID, branchKey]);

  useEffect(() => {
    if (rootQuery.isLoading && !rootQuery.data) return;
    reportEntries("", rootEntries);
  }, [reportEntries, rootEntries, rootQuery.data, rootQuery.isLoading]);

  useEffect(() => {
    if (rootQuery.hasNextPage && !rootQuery.isFetchingNextPage) {
      void rootQuery.fetchNextPage();
    }
  }, [rootQuery.hasNextPage, rootQuery.isFetchingNextPage, rootQuery.data, rootQuery.fetchNextPage]);

  useEffect(() => {
    if (rootQuery.isLoading || rootQuery.isError) return;
    if (emptyHead && source === "head") return;

    const pendingPath = pendingPathChange.current;
    if (pendingPath) {
      if (preferredPath === pendingPath) {
        // Router caught up with the click; normal URL syncing can resume.
        pendingPathChange.current = "";
      } else if (activePath === pendingPath) {
        // preferredPath is still the previous URL value. Do not paint it.
        return;
      } else {
        pendingPathChange.current = "";
      }
    }

    if (preferredPath) {
      const preferredKnown = pathKnownInTree(preferredPath, loadedDirs);
      if (preferredKnown === "unknown") return;
      if (preferredKnown === "yes") {
        if (activePath !== preferredPath) {
          setSelection((prev) => ({ ...prev, [source]: { path: preferredPath } }));
        }
        return;
      }
      // preferred path missing in tree — fall through to first file
    }

    if (activePath) {
      const activeKnown = pathKnownInTree(activePath, loadedDirs);
      if (activeKnown === "yes" || activeKnown === "unknown") return;
    }

    const firstFile = findFirstFileDFS(loadedDirs[""] ?? [], loadedDirs);
    if (firstFile) {
      setSelection((prev) => ({ ...prev, [source]: { path: firstFile } }));
    }
  }, [
    activePath,
    emptyHead,
    loadedDirs,
    preferredPath,
    rootQuery.isError,
    rootQuery.isLoading,
    source,
  ]);

  const preview = useQuery({
    queryKey: ["file-preview", projectID, source, activePath],
    queryFn: () =>
      api<FileContent>(
        `/local-api/v1/projects/${projectID}/content?source=${source}&path=${encodeURIComponent(activePath)}`,
      ),
    enabled: !!activePath,
  });

  async function selectFile(path: string) {
    if (path === activePath) return;
    const ok = await flushMarkdown();
    if (!ok) return;
    setPendingFragment("");
    if (onPathChange) pendingPathChange.current = path;
    setSelection((prev) => ({ ...prev, [source]: { path } }));
    onPathChange?.(path);
  }

  async function openFromMarkdown(path: string, fragment?: string) {
    if (isGitMetaPath(path)) return;
    if (path !== activePath) {
      const ok = await flushMarkdown();
      if (!ok) return;
    }
    const parents = parentDirsOf(path);
    if (parents.length > 0) expandDirs(parents);
    setPendingFragment(fragment || "");
    if (onPathChange) pendingPathChange.current = path;
    setSelection((prev) => ({ ...prev, [source]: { path } }));
    onPathChange?.(path);
  }

  async function switchSource(next: BrowseSource) {
    if (next === source) return;
    const ok = await flushMarkdown();
    if (!ok) return;
    setSource(next);
  }

  function openMarkdownEditor(path: string) {
    const url = `/projects/${projectID}/editor?path=${encodeURIComponent(path)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function toggleDir(path: string) {
    setExpandedBySource((prev) => {
      const next = new Set(prev[source]);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { ...prev, [source]: next };
    });
  }

  const activeIsMarkdown =
    !!activePath && isMarkdownPath(activePath) && preview.data?.kind !== "binary";
  const previewDisabled = !!preview.data?.truncated || preview.data?.content == null;

  return (
    <div className="flex flex-1 min-h-0">
      <section className="w-[340px] border-r border-[var(--color-border)] flex flex-col min-h-0">
        <div className="p-2 border-b border-[var(--color-border)] flex gap-1">
          <SourceButton active={source === "worktree"} onClick={() => void switchSource("worktree")}>
            目录
          </SourceButton>
          <SourceButton active={source === "head"} onClick={() => void switchSource("head")}>
            版本
          </SourceButton>
        </div>
        <div className="overflow-auto flex-1 py-1 px-2">
          {rootQuery.isLoading && (
            <p className="p-3 text-sm text-[var(--color-text-secondary)]">加载文件树…</p>
          )}
          {rootQuery.isError && (
            <p className="p-3 text-sm text-[var(--color-error-fg)]">
              {(rootQuery.error as Error).message}
            </p>
          )}
          {!rootQuery.isLoading && !rootQuery.isError && emptyHead && source === "head" && (
            <p className="p-3 text-sm text-[var(--color-text-secondary)]">
              当前分支还没有任何提交
            </p>
          )}
          {!rootQuery.isLoading && !rootQuery.isError && !emptyHead && (
            <>
              <div className="px-1 py-1 text-xs font-medium text-[var(--color-text-secondary)] truncate">
                {projectName}/
              </div>
              {rootEntries.length === 0 ? (
                <p className="p-3 text-sm text-[var(--color-text-secondary)]">目录为空</p>
              ) : (
                rootEntries.map((entry) => (
                  <TreeNode
                    key={entry.path}
                    projectID={projectID}
                    source={source}
                    entry={entry}
                    depth={0}
                    expanded={expanded}
                    activePath={activePath}
                    onToggleDir={toggleDir}
                    onExpandDirs={expandDirs}
                    onEntriesLoaded={reportEntries}
                    onSelectFile={selectFile}
                    onEditMarkdown={openMarkdownEditor}
                  />
                ))
              )}
            </>
          )}
        </div>
        {activeIsMarkdown ? (
          <div
            className="shrink-0 border-t border-[var(--color-border)] p-2 flex gap-1"
            role="group"
            aria-label="Markdown 显示模式"
          >
            <ModeButton
              active={mdViewMode === "preview"}
              disabled={previewDisabled}
              onClick={() => setMdViewMode("preview")}
            >
              预览
            </ModeButton>
            <ModeButton active={mdViewMode === "source"} onClick={() => setMdViewMode("source")}>
              源码
            </ModeButton>
          </div>
        ) : null}
      </section>

      <section className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Shift the native scrollbar beyond the clipped pane as a WebKit fallback. */}
        <div className="absolute inset-y-0 left-0 right-[-24px] overflow-y-auto overflow-x-hidden scrollbar-none">
          <div className="min-h-full p-4 pr-10">
            {!activePath && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {emptyHead && source === "head" ? "当前分支还没有任何提交" : "选择一个文件查看内容"}
              </p>
            )}
            {activePath && preview.isLoading && (
              <p className="text-sm text-[var(--color-text-secondary)]">加载预览…</p>
            )}
            {activePath && preview.isError && (
              <p className="text-sm text-[var(--color-error-fg)]">{(preview.error as Error).message}</p>
            )}
            {activePath && preview.data && (
              <FilePreviewView
                file={preview.data}
                projectID={projectID}
                viewMode={mdViewMode}
                onOpenPath={openFromMarkdown}
                pendingFragment={pendingFragment}
                onFragmentConsumed={() => setPendingFragment("")}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SourceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs transition-colors ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs transition-colors ${
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] font-medium shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function dirPaths(entries: TreeEntry[]): string[] {
  return entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path);
}

/** Depth-first first file: enter dirs before later siblings; wait if a dir is not loaded yet. */
function findFirstFileDFS(entries: TreeEntry[], loaded: Record<string, TreeEntry[]>): string {
  for (const entry of entries) {
    if (entry.kind === "file") return entry.path;
    if (entry.kind === "dir") {
      const children = loaded[entry.path];
      // Dir listed before sibling files must be fully walked first.
      if (!children) return "";
      const found = findFirstFileDFS(children, loaded);
      if (found) return found;
    }
  }
  return "";
}

/** Whether `path` is known to exist as a file/symlink in the loaded tree. */
function pathKnownInTree(path: string, loaded: Record<string, TreeEntry[]>): "yes" | "no" | "unknown" {
  if (!path) return "no";
  const parts = path.split("/").filter(Boolean);
  let dir = "";
  for (let i = 0; i < parts.length; i++) {
    const entries = loaded[dir];
    if (!entries) return "unknown";
    const full = dir ? `${dir}/${parts[i]}` : parts[i]!;
    const entry = entries.find((e) => e.path === full);
    if (!entry) return "no";
    if (i === parts.length - 1) {
      return entry.kind === "file" || entry.kind === "symlink" ? "yes" : "no";
    }
    if (entry.kind !== "dir") return "no";
    dir = full;
  }
  return "no";
}

function TreeNode({
  projectID,
  source,
  entry,
  depth,
  expanded,
  activePath,
  onToggleDir,
  onExpandDirs,
  onEntriesLoaded,
  onSelectFile,
  onEditMarkdown,
}: {
  projectID: string;
  source: BrowseSource;
  entry: TreeEntry;
  depth: number;
  expanded: Set<string>;
  activePath: string;
  onToggleDir: (path: string) => void;
  onExpandDirs: (paths: string[]) => void;
  onEntriesLoaded: (dirPath: string, entries: TreeEntry[]) => void;
  onSelectFile: (path: string) => void | Promise<void>;
  onEditMarkdown: (path: string) => void;
}) {
  const isDir = entry.kind === "dir";
  const isOpen = isDir && expanded.has(entry.path);
  const active = activePath === entry.path;
  const canEditMarkdown =
    source === "worktree" && entry.kind === "file" && isMarkdownPath(entry.path);

  const childQuery = useInfiniteQuery({
    queryKey: ["workspace-tree", projectID, source, entry.path],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<TreeListing>(
        `/local-api/v1/projects/${projectID}/tree?source=${source}&path=${encodeURIComponent(entry.path)}&offset=${pageParam}&limit=200`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextOffset : undefined),
    enabled: isOpen,
  });

  const childEntries = useMemo(
    () => childQuery.data?.pages.flatMap((p) => p.entries) ?? [],
    [childQuery.data],
  );

  useEffect(() => {
    if (!isOpen) return;
    onExpandDirs(dirPaths(childEntries));
  }, [childEntries, isOpen, onExpandDirs]);

  useEffect(() => {
    if (!isOpen) return;
    // Avoid treating "still loading" as an empty directory (would skip into later siblings).
    if (childQuery.isLoading && !childQuery.data) return;
    onEntriesLoaded(entry.path, childEntries);
  }, [childEntries, childQuery.data, childQuery.isLoading, entry.path, isOpen, onEntriesLoaded]);

  useEffect(() => {
    if (!isOpen) return;
    if (childQuery.hasNextPage && !childQuery.isFetchingNextPage) {
      void childQuery.fetchNextPage();
    }
  }, [
    isOpen,
    childQuery.hasNextPage,
    childQuery.isFetchingNextPage,
    childQuery.data,
    childQuery.fetchNextPage,
  ]);

  return (
    <div>
      <div
        className={`group w-full flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-1 text-xs ${
          active ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
        }`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => {
            if (isDir) onToggleDir(entry.path);
            else onSelectFile(entry.path);
          }}
          className="min-w-0 flex-1 flex items-center gap-1 text-left"
          title={entry.path}
        >
          <span className="w-3 shrink-0 text-[var(--color-text-tertiary)]">
            {isDir ? (
              <CaretRight
                size={12}
                className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
            ) : null}
          </span>
          <span className="shrink-0 text-[var(--color-text-secondary)]">
            {isDir ? (
              <FolderSimple size={14} />
            ) : entry.kind === "symlink" ? (
              <LinkSimple size={14} />
            ) : (
              <FileIcon size={14} />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
        </button>
        {canEditMarkdown ? (
          <button
            type="button"
            className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-accent-muted)] hover:bg-[var(--color-surface)]"
            title="在新标签页编辑"
            aria-label={`编辑 ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onEditMarkdown(entry.path);
            }}
          >
            <PencilSimple size={14} />
          </button>
        ) : null}
      </div>
      {isOpen && (
        <div>
          {childQuery.isLoading && (
            <p
              className="text-xs text-[var(--color-text-tertiary)] py-1"
              style={{ paddingLeft: 18 + depth * 14 }}
            >
              加载中…
            </p>
          )}
          {childQuery.isError && (
            <p
              className="text-xs text-[var(--color-error-fg)] py-1"
              style={{ paddingLeft: 18 + depth * 14 }}
            >
              {(childQuery.error as Error).message}
            </p>
          )}
          {childEntries.map((child) => (
            <TreeNode
              key={child.path}
              projectID={projectID}
              source={source}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              activePath={activePath}
              onToggleDir={onToggleDir}
              onExpandDirs={onExpandDirs}
              onEntriesLoaded={onEntriesLoaded}
              onSelectFile={onSelectFile}
              onEditMarkdown={onEditMarkdown}
            />
          ))}
        </div>
      )}
    </div>
  );
}
