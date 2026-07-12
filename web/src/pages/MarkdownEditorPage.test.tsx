import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { MarkdownSaveGuardProvider } from "../components/files/markdown/MarkdownSaveGuard";

const fetchSessionMe = vi.fn();
const fetchFileContent = vi.fn();
const fetchLocalFileContent = vi.fn();
const openLocalRelativeFile = vi.fn();
const apiMock = vi.fn();
const editorUndo = vi.fn();
const editorRedo = vi.fn();
const editorFormat = vi.fn();
const editorUpdateParagraph = vi.fn();
const editorFind = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchSessionMe: (...args: unknown[]) => fetchSessionMe(...args),
    fetchFileContent: (...args: unknown[]) => fetchFileContent(...args),
    fetchLocalFileContent: (...args: unknown[]) => fetchLocalFileContent(...args),
    openLocalRelativeFile: (...args: unknown[]) => openLocalRelativeFile(...args),
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
    }: {
      onTocChange?: (toc: { content: string; lvl: number; slug: string; githubSlug: string }[]) => void;
      onReady?: () => void;
      onOpenPath?: (path: string) => void;
    },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      flush: () => undefined,
      getMarkdown: () => "# Hello",
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
    }));
    React.useEffect(() => {
      onTocChange?.([{ content: "Hello", lvl: 1, slug: "s1", githubSlug: "hello" }]);
      onReady?.();
    }, [onTocChange, onReady]);
    return React.createElement(
      "div",
      { "data-testid": "fake-editor", className: "forkly-markdown-editor" },
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
    fetchSessionMe.mockReset();
    fetchFileContent.mockReset();
    fetchLocalFileContent.mockReset();
    openLocalRelativeFile.mockReset();
    apiMock.mockReset();
    editorUndo.mockReset();
    editorRedo.mockReset();
    editorFormat.mockReset();
    editorUpdateParagraph.mockReset();
    editorFind.mockReset();
    editorFind.mockReturnValue({ matches: [], index: -1 });
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

  it("rejects non-markdown path", async () => {
    renderAt("/projects/p1/editor?path=a.txt");
    expect(await screen.findByText("仅支持 Markdown")).toBeInTheDocument();
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
    expect(screen.getByText("docs/a.md")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Markdown 格式" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "标题目录" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
    });
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
    expect(screen.getByText("本地文件")).toBeInTheDocument();
    const displayPath = screen.getByText("Notes/note.md");
    expect(displayPath).toBeInTheDocument();
    expect(displayPath.closest(".forkly-md-editor-path")).toHaveAttribute(
      "title",
      "/Users/me/Notes/note.md",
    );
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
});
