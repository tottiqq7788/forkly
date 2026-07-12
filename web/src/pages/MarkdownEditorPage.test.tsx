import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { MarkdownSaveGuardProvider } from "../components/files/markdown/MarkdownSaveGuard";

const fetchSessionMe = vi.fn();
const fetchFileContent = vi.fn();
const apiMock = vi.fn();
const editorUndo = vi.fn();
const editorRedo = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchSessionMe: (...args: unknown[]) => fetchSessionMe(...args),
    fetchFileContent: (...args: unknown[]) => fetchFileContent(...args),
    api: (...args: unknown[]) => apiMock(...args),
  };
});

vi.mock("../components/files/markdown/MarkdownEditorView", async () => {
  const React = await import("react");
  const Fake = React.forwardRef(function Fake(
    {
      onTocChange,
      onReady,
    }: {
      onTocChange?: (toc: { content: string; lvl: number; slug: string; githubSlug: string }[]) => void;
      onReady?: () => void;
    },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      flush: () => undefined,
      getMarkdown: () => "# Hello",
      format: () => undefined,
      updateParagraph: () => undefined,
      undo: (...args: unknown[]) => editorUndo(...args),
      redo: (...args: unknown[]) => editorRedo(...args),
      search: () => ({ matches: [], index: -1 }),
      find: () => ({ matches: [], index: -1 }),
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
    return React.createElement("div", { "data-testid": "fake-editor" }, "editor");
  });
  return { MarkdownEditorView: Fake };
});

const { default: MarkdownEditorPage } = await import("./MarkdownEditorPage");

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

describe("MarkdownEditorPage", () => {
  beforeEach(() => {
    fetchSessionMe.mockReset();
    fetchFileContent.mockReset();
    apiMock.mockReset();
    editorUndo.mockReset();
    editorRedo.mockReset();
    fetchSessionMe.mockResolvedValue({ user: "dev" });
    apiMock.mockResolvedValue({ id: "p1", name: "demo" });
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
});
