import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CaretRight, File as FileIcon, FolderSimple, LinkSimple } from "@phosphor-icons/react";
import { api, BrowseSource, FileContent, TreeEntry, TreeListing } from "../../api";
import { FilePreviewView } from "./FilePreviewView";

type Props = {
  projectID: string;
  projectName: string;
};

type SourceSelection = {
  path: string;
};

export function ProjectFilesPanel({ projectID, projectName }: Props) {
  const [source, setSource] = useState<BrowseSource>("worktree");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selection, setSelection] = useState<Record<BrowseSource, SourceSelection>>({
    worktree: { path: "" },
    head: { path: "" },
  });

  const activePath = selection[source].path;

  useEffect(() => {
    setExpanded(new Set([""]));
    setSelection({ worktree: { path: "" }, head: { path: "" } });
  }, [projectID]);

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
    if (activePath) return;
    if (rootQuery.isLoading || rootQuery.isError) return;
    if (emptyHead && source === "head") return;
    const firstFile = findFirstFile(rootEntries);
    if (firstFile) {
      setSelection((prev) => ({ ...prev, [source]: { path: firstFile } }));
    }
  }, [activePath, emptyHead, rootEntries, rootQuery.isError, rootQuery.isLoading, source]);

  const preview = useQuery({
    queryKey: ["file-preview", projectID, source, activePath],
    queryFn: () =>
      api<FileContent>(
        `/local-api/v1/projects/${projectID}/content?source=${source}&path=${encodeURIComponent(activePath)}`,
      ),
    enabled: !!activePath,
  });

  function selectFile(path: string) {
    setSelection((prev) => ({ ...prev, [source]: { path } }));
  }

  function toggleDir(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="flex flex-1 min-h-0">
      <section className="w-[340px] border-r border-[var(--color-border)] flex flex-col min-h-0">
        <div className="p-2 border-b border-[var(--color-border)] flex gap-1">
          <SourceButton active={source === "worktree"} onClick={() => setSource("worktree")}>
            工作区
          </SourceButton>
          <SourceButton active={source === "head"} onClick={() => setSource("head")}>
            已提交版本
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
                    onSelectFile={selectFile}
                  />
                ))
              )}
              {rootQuery.hasNextPage && (
                <button
                  type="button"
                  className="mt-1 w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                  onClick={() => rootQuery.fetchNextPage()}
                  disabled={rootQuery.isFetchingNextPage}
                >
                  {rootQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <section className="flex-1 min-w-0 overflow-auto p-4">
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
        {activePath && preview.data && <FilePreviewView file={preview.data} />}
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

function findFirstFile(entries: TreeEntry[]): string {
  for (const entry of entries) {
    if (entry.kind === "file") return entry.path;
  }
  return "";
}

function TreeNode({
  projectID,
  source,
  entry,
  depth,
  expanded,
  activePath,
  onToggleDir,
  onSelectFile,
}: {
  projectID: string;
  source: BrowseSource;
  entry: TreeEntry;
  depth: number;
  expanded: Set<string>;
  activePath: string;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  const isDir = entry.kind === "dir";
  const isOpen = isDir && expanded.has(entry.path);
  const active = activePath === entry.path;

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

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDir) onToggleDir(entry.path);
          else onSelectFile(entry.path);
        }}
        className={`w-full flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-1 text-sm text-left ${
          active ? "bg-[var(--color-surface-active)]" : "hover:bg-[var(--color-surface-hover)]"
        }`}
        style={{ paddingLeft: 4 + depth * 14 }}
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
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
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
              onSelectFile={onSelectFile}
            />
          ))}
          {childQuery.hasNextPage && (
            <button
              type="button"
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] py-1"
              style={{ paddingLeft: 18 + depth * 14 }}
              onClick={() => childQuery.fetchNextPage()}
              disabled={childQuery.isFetchingNextPage}
            >
              {childQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
