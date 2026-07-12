import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fetchFileContent, fetchSessionMe, type FileContent, type Project } from "../api";
import {
  MarkdownEditorView,
  type MarkdownEditorHandle,
  type SearchResult,
  type TocItem,
} from "../components/files/markdown/MarkdownEditorView";
import { MarkdownCategoryToolbar, type FormatCommand } from "../components/files/markdown/MarkdownCategoryToolbar";
import { MarkdownTocPanel } from "../components/files/markdown/MarkdownTocPanel";
import { useMarkdownDocument } from "../components/files/markdown/useMarkdownDocument";
import { useRegisterMarkdownSaveGuard } from "../components/files/markdown/MarkdownSaveGuard";
import { isMarkdownPath } from "../components/files/markdown/isMarkdown";
import "../components/files/markdown/markdown-editor.css";

const STATUS_LABEL: Record<string, string> = {
  clean: "已保存",
  dirty: "未保存",
  saving: "保存中…",
  conflict: "冲突",
  error: "保存失败",
};

export default function MarkdownEditorPage() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const path = search.get("path")?.trim() || "";

  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchSessionMe,
    retry: 1,
  });

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<Project>(`/local-api/v1/projects/${id}`),
    enabled: me.isSuccess && !!id,
  });

  const fileQuery = useQuery({
    queryKey: ["file-editor", id, path],
    queryFn: () => fetchFileContent(id, "worktree", path),
    enabled: me.isSuccess && !!id && !!path,
  });

  if (me.isError) {
    return (
      <FullPageMessage
        title="需要登录会话"
        body={me.error instanceof Error ? me.error.message : "无法建立本地会话"}
      />
    );
  }

  if (!path) {
    return <FullPageMessage title="缺少文件路径" body="请从项目文件树通过编辑按钮打开 Markdown。" />;
  }

  if (!isMarkdownPath(path)) {
    return <FullPageMessage title="仅支持 Markdown" body="独立编辑页只用于可编辑的 Markdown 文件。" />;
  }

  if (me.isLoading || fileQuery.isLoading || project.isLoading) {
    return <FullPageMessage title="加载中…" body="正在打开编辑器" />;
  }

  if (fileQuery.isError) {
    return (
      <FullPageMessage
        title="无法打开文件"
        body={fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error)}
      />
    );
  }

  const file = fileQuery.data as FileContent | undefined;
  if (!file) {
    return <FullPageMessage title="文件不存在" body={path} />;
  }

  const editable = !!file.editable && file.source === "worktree" && !file.truncated;
  if (!editable) {
    return (
      <FullPageMessage
        title="文件不可编辑"
        body="仅工作区中未超限的 Markdown 文件可在独立编辑页打开。"
      />
    );
  }

  return (
    <MarkdownEditorWorkspace
      key={`${id}:${path}:${file.revision ?? ""}`}
      projectID={id}
      projectName={(project.data as Project | undefined)?.name || id}
      file={file}
    />
  );
}

function MarkdownEditorWorkspace({
  projectID,
  projectName,
  file,
}: {
  projectID: string;
  projectName: string;
  file: FileContent;
}) {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeSlug, setActiveSlug] = useState("");
  const [editorError, setEditorError] = useState<Error | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findWord, setFindWord] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findInfo, setFindInfo] = useState<{ count: number; index: number; error?: string }>({
    count: 0,
    index: -1,
  });

  const {
    draftMarkdown,
    saveStatus,
    lastError,
    conflictDiskContent,
    flush,
    retry,
    discardDraft,
    overwriteWithDraft,
    setDraftFromEditor,
    registerSerializer,
  } = useMarkdownDocument({
    projectID,
    source: "worktree",
    path: file.path,
    initial: file,
    enabled: true,
  });

  const isBlocking =
    saveStatus === "dirty" ||
    saveStatus === "saving" ||
    saveStatus === "conflict" ||
    saveStatus === "error";

  useRegisterMarkdownSaveGuard(flush, isBlocking);

  useEffect(() => {
    registerSerializer({
      flush: () => editorRef.current?.flush(),
      getMarkdown: () => editorRef.current?.getMarkdown() ?? draftMarkdown,
    });
    return () => registerSerializer(null);
  }, [registerSerializer, draftMarkdown]);

  useEffect(() => {
    document.title = `${file.path.split("/").pop() || file.path} · Forkly`;
  }, [file.path]);

  const runSearch = useCallback(
    (query: string) => {
      if (!editorRef.current) return;
      if (findRegex) {
        try {
          void new RegExp(query);
        } catch {
          setFindInfo({ count: 0, index: -1, error: "无效的正则表达式" });
          return;
        }
      }
      if (!query) {
        editorRef.current.search("");
        setFindInfo({ count: 0, index: -1 });
        return;
      }
      const result = editorRef.current.search(query, {
        isCaseSensitive: findCase,
        isWholeWord: findWord,
        isRegexp: findRegex,
      });
      applySearchResult(result);
    },
    [findCase, findRegex, findWord],
  );

  function applySearchResult(result: SearchResult) {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    setFindInfo({ count: matches.length, index: result.index, error: undefined });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        editorRef.current?.search("");
        editorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen, flush]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || toc.length === 0) return;

    const onScroll = () => {
      const headings = Array.from(
        root.querySelectorAll<HTMLElement>(".forkly-muya-mount h1, .forkly-muya-mount h2, .forkly-muya-mount h3, .forkly-muya-mount h4, .forkly-muya-mount h5, .forkly-muya-mount h6"),
      );
      if (headings.length === 0) return;
      const top = root.getBoundingClientRect().top + 24;
      let current = toc[0]?.slug ?? "";
      for (let i = 0; i < headings.length; i++) {
        const rect = headings[i]!.getBoundingClientRect();
        if (rect.top <= top) {
          current = toc[i]?.slug ?? current;
        } else {
          break;
        }
      }
      setActiveSlug((prev) => (prev === current ? prev : current));
    };

    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [toc]);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draftMarkdown);
    } catch {
      // ignore
    }
  }

  function handleCommand(cmd: FormatCommand) {
    const ed = editorRef.current;
    if (!ed) return;
    if (cmd === "undo") ed.undo();
    else if (cmd === "redo") ed.redo();
    else if (cmd === "find:open") setFindOpen(true);
    else if (cmd === "find:previous") {
      setFindOpen(true);
      const r = ed.find("previous");
      applySearchResult(r);
    } else if (cmd === "find:next") {
      setFindOpen(true);
      const r = ed.find("next");
      applySearchResult(r);
    } else if (cmd === "find:replace") {
      setFindOpen(true);
      const r = ed.replace(replaceQuery, { isSingle: true, isRegexp: findRegex });
      applySearchResult(r);
      setDraftFromEditor();
    } else if (cmd.startsWith("para:")) ed.updateParagraph(cmd.slice(5));
    else ed.format(cmd);
    ed.focus();
  }

  return (
    <div className="forkly-md-editor-page">
      <header className="forkly-md-editor-topbar">
        <div className="forkly-md-editor-path" title={file.path}>
          <span className="text-[var(--color-text-tertiary)]">{projectName}</span>
          <span className="text-[var(--color-text-tertiary)]"> / </span>
          <span>{file.path}</span>
        </div>
        <div className="forkly-md-save-status" data-status={saveStatus}>
          <span>
            {STATUS_LABEL[saveStatus] ?? ""}
            {lastError ? ` · ${lastError}` : ""}
          </span>
          {(saveStatus === "error" || saveStatus === "dirty") && (
            <button type="button" onClick={() => void retry()}>
              重试
            </button>
          )}
        </div>
      </header>

      {saveStatus === "conflict" ? (
        <div className="forkly-md-conflict forkly-md-editor-banner">
          <h3>内容冲突</h3>
          <p className="text-[var(--color-text-secondary)] m-0">
            磁盘上的文件已被外部修改。草稿已保留，自动保存已暂停。
          </p>
          <div className="forkly-md-conflict-compare">
            <div>
              <div className="text-xs text-[var(--color-text-secondary)] mb-1">磁盘版本</div>
              <pre>{conflictDiskContent ?? "（无法读取）"}</pre>
            </div>
            <div>
              <div className="text-xs text-[var(--color-text-secondary)] mb-1">当前草稿</div>
              <pre>{draftMarkdown}</pre>
            </div>
          </div>
          <div className="forkly-md-conflict-actions">
            <button type="button" onClick={() => void copyDraft()}>
              复制草稿
            </button>
            <button
              type="button"
              onClick={() => {
                void discardDraft().then(() => setEditorKey((k) => k + 1));
              }}
            >
              放弃草稿并重载
            </button>
            <button type="button" onClick={() => void overwriteWithDraft()}>
              以草稿覆盖磁盘
            </button>
          </div>
        </div>
      ) : null}

      {editorError ? (
        <div className="forkly-md-editor-banner text-sm text-[var(--color-warning-fg)] px-4 py-2">
          编辑器加载失败：{editorError.message}
        </div>
      ) : null}

      <div className="forkly-md-editor-body">
        <MarkdownTocPanel
          items={toc}
          activeSlug={activeSlug}
          onSelect={(slug) => {
            const ok = editorRef.current?.scrollToHeading(slug);
            if (ok) setActiveSlug(slug);
          }}
        />

        <section className="forkly-md-editor-main">
          {findOpen ? (
            <div className="forkly-md-findbar">
              <input
                type="text"
                placeholder="查找"
                value={findQuery}
                autoFocus
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  runSearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const r = editorRef.current?.find(e.shiftKey ? "previous" : "next");
                    if (r) applySearchResult(r);
                  }
                }}
              />
              <input
                type="text"
                placeholder="替换"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.find("previous");
                  if (r) applySearchResult(r);
                }}
              >
                上一个
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.find("next");
                  if (r) applySearchResult(r);
                }}
              >
                下一个
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.replace(replaceQuery, {
                    isSingle: true,
                    isRegexp: findRegex,
                  });
                  if (r) applySearchResult(r);
                  setDraftFromEditor();
                }}
              >
                替换
              </button>
              <button
                type="button"
                onClick={() => {
                  const r = editorRef.current?.replace(replaceQuery, {
                    isSingle: false,
                    isRegexp: findRegex,
                  });
                  if (r) applySearchResult(r);
                  setDraftFromEditor();
                }}
              >
                全部替换
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={findCase}
                  onChange={(e) => {
                    setFindCase(e.target.checked);
                    setTimeout(() => runSearch(findQuery), 0);
                  }}
                />
                大小写
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findWord}
                  onChange={(e) => {
                    setFindWord(e.target.checked);
                    setTimeout(() => runSearch(findQuery), 0);
                  }}
                />
                全词
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={findRegex}
                  onChange={(e) => {
                    setFindRegex(e.target.checked);
                    setTimeout(() => runSearch(findQuery), 0);
                  }}
                />
                正则
              </label>
              <span className="text-[var(--color-text-tertiary)]">
                {findInfo.count > 0 ? `${findInfo.index + 1}/${findInfo.count}` : "无匹配"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFindOpen(false);
                  editorRef.current?.search("");
                  editorRef.current?.focus();
                }}
              >
                关闭
              </button>
              {findInfo.error ? <div className="forkly-md-find-hint">{findInfo.error}</div> : null}
            </div>
          ) : null}

          <div ref={scrollRootRef} className="forkly-md-editor-scroll">
            <EditorErrorBoundary
              onFallback={(err) => {
                setEditorError(err);
              }}
            >
              <MarkdownEditorView
                key={editorKey}
                ref={editorRef}
                markdown={draftMarkdown}
                projectID={projectID}
                markdownPath={file.path}
                onChange={() => setDraftFromEditor()}
                onTocChange={setToc}
                onError={(err) => setEditorError(err)}
              />
            </EditorErrorBoundary>
          </div>
        </section>

        <MarkdownCategoryToolbar
          onCommand={handleCommand}
          findOpen={findOpen}
          findQuery={findQuery}
        />
      </div>
    </div>
  );
}

function FullPageMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">{title}</h1>
        <p className="text-[var(--color-text-secondary)]">{body}</p>
      </div>
    </div>
  );
}

class EditorErrorBoundary extends Component<
  { children: ReactNode; onFallback: (err: Error) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown editor failed", error, info);
    this.props.onFallback(error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}
