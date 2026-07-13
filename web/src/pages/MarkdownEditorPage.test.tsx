import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { MarkdownSaveGuardProvider } from "../components/files/markdown/MarkdownSaveGuard";

const fetchSessionMe = vi.fn();
const fetchFileContent = vi.fn();
const fetchLocalFileContent = vi.fn();
const openLocalRelativeFile = vi.fn();
const putFileContent = vi.fn();
const putLocalFileContent = vi.fn();
const apiMock = vi.fn();
const editorUndo = vi.fn();
const editorRedo = vi.fn();
const editorFormat = vi.fn();
const editorUpdateParagraph = vi.fn();
const editorFind = vi.fn();
const editorReplaceContent = vi.fn();
const editorSetCursorByOffset = vi.fn();
const sourceUndo = vi.fn();
const sourceRedo = vi.fn();
const sourceFind = vi.fn();
let fakeMarkdown = "# Hello";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchSessionMe: (...args: unknown[]) => fetchSessionMe(...args),
    fetchFileContent: (...args: unknown[]) => fetchFileContent(...args),
    fetchLocalFileContent: (...args: unknown[]) => fetchLocalFileContent(...args),
    openLocalRelativeFile: (...args: unknown[]) => openLocalRelativeFile(...args),
    putFileContent: (...args: unknown[]) => putFileContent(...args),
    putLocalFileContent: (...args: unknown[]) => putLocalFileContent(...args),
    api: (...args: unknown[]) => apiMock(...args),
  };
});

vi.mock("../components/files/markdown/MarkdownEditorView", async () => {
  const React = await import("react");
  const Fake = React.forwardRef(function Fake(
    {
      onTocChange,
      onReady,
      onOpenPath,
      hidden,
    }: {
      onTocChange?: (toc: { content: string; lvl: number; slug: string; githubSlug: string }[]) => void;
      onReady?: () => void;
      onOpenPath?: (path: string) => void;
      hidden?: boolean;
    },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      flush: () => undefined,
      getMarkdown: () => fakeMarkdown,
      format: (...args: unknown[]) => editorFormat(...args),
      updateParagraph: (...args: unknown[]) => editorUpdateParagraph(...args),
      undo: (...args: unknown[]) => editorUndo(...args),
      redo: (...args: unknown[]) => editorRedo(...args),
      search: () => ({ matches: [], index: -1 }),
      find: (...args: unknown[]) => editorFind(...args),
      replace: () => ({ matches: [], index: -1 }),
      hideAllFloatTools: () => undefined,
      focus: () => undefined,
      setContent: () => undefined,
      getTOC: () => [{ content: "Hello", lvl: 1, slug: "s1", githubSlug: "hello" }],
      scrollToHeading: () => true,
      getSelectionSnapshot: () => ({ kind: "selection" }),
      getCursorOffset: () => ({
        anchor: { line: 0, ch: 1 },
        focus: { line: 0, ch: 1 },
      }),
      replaceContent: (...args: unknown[]) => {
        fakeMarkdown = String(args[0] ?? "");
        return editorReplaceContent(...args);
      },
      setCursorByOffset: (...args: unknown[]) => editorSetCursorByOffset(...args),
    }));
    React.useEffect(() => {
      onTocChange?.([{ content: "Hello", lvl: 1, slug: "s1", githubSlug: "hello" }]);
      onReady?.();
      // Call once on mount; parent callbacks are stabilized in Workspace.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement(
      "div",
      {
        "data-testid": "fake-editor",
        className: "forkly-markdown-editor",
        style: hidden ? { display: "none" } : undefined,
        "aria-hidden": hidden || undefined,
      },
      "editor",
      React.createElement(
        "button",
        { type: "button", onClick: () => onOpenPath?.("docs/next.md") },
        "open relative markdown",
      ),
    );
  });
  return { MarkdownEditorView: Fake };
});

vi.mock("../components/files/markdown/MarkdownSourceEditorView", async () => {
  const React = await import("react");
  const Fake = React.forwardRef(function Fake(
    {
      markdown,
      languageMode = "markdown",
      onChange,
      onReady,
    }: {
      markdown: string;
      languageMode?: "markdown" | "text/plain";
      onChange?: () => void;
      onReady?: () => void;
    },
    ref: React.Ref<unknown>,
  ) {
    const [value, setValue] = React.useState(markdown);
    const valueRef = React.useRef(value);
    valueRef.current = value;
    React.useImperativeHandle(ref, () => ({
      getValue: () => valueRef.current,
      setValue: (next: string) => {
        setValue(next);
        valueRef.current = next;
      },
      getIndexCursor: () => ({
        anchor: { line: 0, ch: 0 },
        focus: { line: 0, ch: 0 },
      }),
      setIndexCursor: () => undefined,
      focus: () => undefined,
      undo: (...args: unknown[]) => sourceUndo(...args),
      redo: (...args: unknown[]) => sourceRedo(...args),
      search: () => ({ matches: [], index: -1 }),
      find: (...args: unknown[]) => sourceFind(...args),
      replace: () => ({ matches: [], index: -1 }),
      scrollToLine: () => undefined,
      heightAtLine: () => 0,
    }));
    React.useEffect(() => {
      onReady?.();
      // Mount callback once; parent may pass a new inline function each render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement("textarea", {
      "data-testid": "markdown-source-editor",
      "data-language-mode": languageMode,
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = e.target.value;
        valueRef.current = next;
        setValue(next);
        onChange?.();
      },
    });
  });
  return { MarkdownSourceEditorView: Fake, default: Fake };
});

const { default: MarkdownEditorPage } = await import("./MarkdownEditorPage");
const { default: LocalMarkdownEditorPage } = await import("./LocalMarkdownEditorPage");

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/projects/:id/editor",
        element: (
          <MarkdownSaveGuardProvider>
            <MarkdownEditorPage />
          </MarkdownSaveGuardProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function renderLocalAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/editor/local/:fileId",
        element: (
          <MarkdownSaveGuardProvider>
            <LocalMarkdownEditorPage />
          </MarkdownSaveGuardProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("MarkdownEditorPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    fakeMarkdown = "# Hello";
    fetchSessionMe.mockReset();
    fetchFileContent.mockReset();
    fetchLocalFileContent.mockReset();
    openLocalRelativeFile.mockReset();
    putFileContent.mockReset();
    putLocalFileContent.mockReset();
    apiMock.mockReset();
    editorUndo.mockReset();
    editorRedo.mockReset();
    editorFormat.mockReset();
    editorUpdateParagraph.mockReset();
    editorFind.mockReset();
    editorReplaceContent.mockReset();
    editorSetCursorByOffset.mockReset();
    sourceUndo.mockReset();
    sourceRedo.mockReset();
    sourceFind.mockReset();
    editorFind.mockReturnValue({ matches: [], index: -1 });
    editorReplaceContent.mockReturnValue(true);
    editorSetCursorByOffset.mockReturnValue(true);
    sourceFind.mockReturnValue({ matches: [], index: -1 });
    putFileContent.mockResolvedValue({ revision: "abc2" });
    putLocalFileContent.mockResolvedValue({ revision: "local-rev-2" });
    fetchSessionMe.mockResolvedValue({ user: "dev" });
    apiMock.mockResolvedValue({ id: "p1", name: "demo" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects missing path", async () => {
    renderAt("/projects/p1/editor");
    expect(await screen.findByText("缺少文件路径")).toBeInTheDocument();
  });

  it("rejects binary files opened via direct URL", async () => {
    fetchFileContent.mockResolvedValue({
      path: "photo.png",
      source: "worktree",
      kind: "binary",
      size: 12,
    });
    renderAt("/projects/p1/editor?path=photo.png");
    expect(await screen.findByText("暂不支持编辑")).toBeInTheDocument();
    expect(screen.getByText("二进制文件暂不支持编辑。")).toBeInTheDocument();
  });

  it("rejects non-editable markdown", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# x",
      editable: false,
    });
    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByText("文件不可编辑")).toBeInTheDocument();
  });

  it("defaults markdown documents to preview mode", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });
    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByTestId("fake-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("markdown-source-editor")).toBeNull();
  });

  it("defaults plain text documents to source mode and allows markdown preview", async () => {
    fetchFileContent.mockResolvedValue({
      path: "notes.txt",
      source: "worktree",
      kind: "text",
      content: "hello text",
      editable: true,
      revision: "abc",
    });
    renderAt("/projects/p1/editor?path=notes.txt");
    expect(await screen.findByTestId("markdown-source-editor")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-source-editor")).toHaveAttribute(
      "data-language-mode",
      "text/plain",
    );
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("fake-editor")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.queryByTestId("markdown-source-editor")).toBeNull();
    expect(editorReplaceContent).toHaveBeenCalled();
  });

  it("saves plain text edits from source mode", async () => {
    fetchFileContent.mockResolvedValue({
      path: "notes.txt",
      source: "worktree",
      kind: "text",
      content: "hello",
      editable: true,
      revision: "abc",
    });
    renderAt("/projects/p1/editor?path=notes.txt");
    const source = await screen.findByTestId("markdown-source-editor");
    fireEvent.change(source, { target: { value: "hello world" } });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }));
    await waitFor(() => {
      expect(putFileContent).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ path: "notes.txt", content: "hello world", revision: "abc" }),
      );
    });
  });

  it("renders three-column editor chrome for editable markdown", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });
    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByTestId("fake-editor")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Markdown 格式" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "标题目录" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
    });
    expect(document.querySelector(".forkly-md-editor-path")?.textContent).toBe("demo / docs / a.md");
  });

  it("routes mod+z / mod+shift+z / mod+y to editor undo and redo", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });
    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByTestId("fake-editor")).toBeInTheDocument();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    expect(editorUndo).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true }),
    );
    expect(editorRedo).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
    expect(editorRedo).toHaveBeenCalledTimes(2);
  });

  it("routes common editor shortcuts to paragraph, link, and find commands", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });
    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    const editor = await screen.findByTestId("fake-editor");

    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", metaKey: true, bubbles: true }));
    expect(editorUpdateParagraph).toHaveBeenCalledWith("heading 1");

    editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "7", code: "Digit7", metaKey: true, shiftKey: true, bubbles: true }),
    );
    expect(editorUpdateParagraph).toHaveBeenCalledWith("ol-order");

    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    expect(editorFormat).toHaveBeenCalledWith("link");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", metaKey: true, bubbles: true }));
    expect(editorFind).toHaveBeenCalledWith("next");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", metaKey: true, shiftKey: true, bubbles: true }));
    expect(editorFind).toHaveBeenCalledWith("previous");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, altKey: true, bubbles: true }));
    await waitFor(() => expect(screen.getByPlaceholderText("替换")).toHaveFocus());
  });

  it("restores the editor scroll position after refresh for the same file", async () => {
    sessionStorage.setItem(
      "forkly:md-editor-scroll:project:p1:docs/a.md",
      JSON.stringify({ top: 480, scrollHeight: 2000 }),
    );
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello\n\n".repeat(80),
      editable: true,
      revision: "abc",
    });

    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByTestId("fake-editor")).toBeInTheDocument();

    const scrollRoot = document.querySelector(".forkly-md-editor-scroll") as HTMLElement;
    expect(scrollRoot).toBeTruthy();
    Object.defineProperty(scrollRoot, "clientHeight", { configurable: true, value: 700 });
    Object.defineProperty(scrollRoot, "scrollHeight", { configurable: true, value: 2000 });

    await waitFor(() => {
      expect(scrollRoot.scrollTop).toBe(480);
    });
  });

  it("opens project relative markdown links through the project editor route", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });

    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    fireEvent.click(await screen.findByRole("button", { name: "open relative markdown" }));

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        "/projects/p1/editor?path=docs%2Fnext.md",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("renders local markdown editor chrome with local file labels", async () => {
    fetchLocalFileContent.mockResolvedValue({
      fileId: "lf1",
      name: "note.md",
      displayPath: "Notes/note.md",
      absPath: "/Users/me/Notes/note.md",
      parentName: "Notes",
      path: "note.md",
      source: "worktree",
      kind: "text",
      content: "# Local",
      editable: true,
      revision: "local-rev",
      size: 7,
    });

    renderLocalAt("/editor/local/lf1");

    expect(await screen.findByTestId("fake-editor")).toBeInTheDocument();
    expect(screen.queryByText("本地文件")).not.toBeInTheDocument();
    const pathEl = document.querySelector(".forkly-md-editor-path");
    expect(pathEl?.textContent).toBe("/ Users / me / Notes / note.md");
    expect(pathEl).toHaveAttribute("title", "/Users/me/Notes/note.md");
    expect(document.title).toBe("note.md · Forkly");
  });

  it("opens local relative markdown links through a new local file session", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fetchLocalFileContent.mockResolvedValue({
      fileId: "lf1",
      name: "note.md",
      displayPath: "Notes/note.md",
      absPath: "/Users/me/Notes/note.md",
      parentName: "Notes",
      path: "note.md",
      source: "worktree",
      kind: "text",
      content: "# Local",
      editable: true,
      revision: "local-rev",
      size: 7,
    });
    openLocalRelativeFile.mockResolvedValue({
      fileId: "lf2",
      name: "next.md",
      displayPath: "Notes/next.md",
      absPath: "/Users/me/Notes/next.md",
      parentName: "Notes",
      editable: true,
      revision: "next-rev",
      size: 8,
    });

    renderLocalAt("/editor/local/lf1");
    fireEvent.click(await screen.findByRole("button", { name: "open relative markdown" }));

    await waitFor(() => {
      expect(openLocalRelativeFile).toHaveBeenCalledWith("lf1", "docs/next.md");
      expect(open).toHaveBeenCalledWith("/editor/local/lf2", "_blank", "noopener,noreferrer");
    });
  });

  it("switches between preview and source mode with replaceContent handoff", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });

    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByTestId("fake-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    const source = await screen.findByTestId("markdown-source-editor");
    expect(source).toBeInTheDocument();
    expect(screen.getByTestId("fake-editor")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(source, { target: { value: "# Hello\n\nedited" } });
    fireEvent.click(screen.getByRole("button", { name: "预览" }));

    await waitFor(() => {
      expect(editorReplaceContent).toHaveBeenCalledWith("# Hello\n\nedited", { kind: "selection" });
      expect(editorSetCursorByOffset).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("markdown-source-editor")).toBeNull();
    expect(screen.getByTestId("fake-editor")).not.toHaveAttribute("aria-hidden");
  });

  it("does not mark dirty when peeking source mode without edits", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });

    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    expect(await screen.findByRole("status", { name: "已保存" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "源码" }));
    expect(await screen.findByTestId("markdown-source-editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "预览" }));

    await waitFor(() => {
      expect(screen.queryByTestId("markdown-source-editor")).toBeNull();
    });
    expect(editorReplaceContent).toHaveBeenCalledWith("# Hello", { kind: "selection" });
    expect(screen.getByRole("status", { name: "已保存" })).toBeInTheDocument();
    expect(putFileContent).not.toHaveBeenCalled();
  });

  it("routes undo shortcuts to the source editor while in source mode", async () => {
    fetchFileContent.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# Hello",
      editable: true,
      revision: "abc",
    });

    renderAt("/projects/p1/editor?path=docs%2Fa.md");
    fireEvent.click(await screen.findByRole("button", { name: "源码" }));
    expect(await screen.findByTestId("markdown-source-editor")).toBeInTheDocument();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    expect(sourceUndo).toHaveBeenCalledTimes(1);
    expect(editorUndo).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true }),
    );
    expect(sourceRedo).toHaveBeenCalledTimes(1);
  });
});
