import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

const apiMock = vi.hoisted(() => vi.fn());
const fetchFileContentMock = vi.hoisted(() => vi.fn());
const createProjectEntryMock = vi.hoisted(() => vi.fn());
const renameProjectEntryMock = vi.hoisted(() => vi.fn());
const deleteProjectEntryMock = vi.hoisted(() => vi.fn());
const revealProjectPathMock = vi.hoisted(() => vi.fn());
const clipboardWriteMock = vi.hoisted(() => vi.fn());

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
    fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
    createProjectEntry: (...args: unknown[]) => createProjectEntryMock(...args),
    renameProjectEntry: (...args: unknown[]) => renameProjectEntryMock(...args),
    deleteProjectEntry: (...args: unknown[]) => deleteProjectEntryMock(...args),
    revealProjectPath: (...args: unknown[]) => revealProjectPathMock(...args),
  };
});

function contentPath(url: string): string {
  return new URL(url, "http://localhost").searchParams.get("path") || "";
}

function treePath(url: string): string {
  return new URL(url, "http://localhost").searchParams.get("path") || "";
}

function treeListing(path: string, entries: Array<{ name: string; path: string; kind: string }>) {
  return {
    path,
    source: "worktree",
    entries,
    offset: 0,
    limit: 200,
    hasMore: false,
  };
}

function requestedTreePaths(): string[] {
  return apiMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/tree?"))
    .map((url) => treePath(url));
}

describe("ProjectFilesPanel selection", () => {
  beforeEach(() => {
    apiMock.mockReset();
    fetchFileContentMock.mockReset();
    createProjectEntryMock.mockReset();
    renameProjectEntryMock.mockReset();
    deleteProjectEntryMock.mockReset();
    revealProjectPathMock.mockReset();
    clipboardWriteMock.mockReset();
    createProjectEntryMock.mockResolvedValue({ entry: { name: "new.md", path: "new.md", kind: "file" } });
    renameProjectEntryMock.mockResolvedValue({ entry: { name: "renamed.txt", path: "renamed.txt", kind: "file" } });
    deleteProjectEntryMock.mockResolvedValue({ ok: true });
    revealProjectPathMock.mockResolvedValue({ ok: true });
    clipboardWriteMock.mockResolvedValue(undefined);
    fetchFileContentMock.mockImplementation(async (_projectID: string, source: string, path: string) => ({
      path,
      source,
      kind: "text",
      content: path,
      size: path.length,
      editable: true,
      revision: "r1",
    }));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText: clipboardWriteMock },
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText: clipboardWriteMock },
    });
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        return {
          path: "",
          source: "worktree",
          entries: [
            { name: "a.txt", path: "a.txt", kind: "file" },
            { name: "b.txt", path: "b.txt", kind: "file" },
          ],
          offset: 0,
          limit: 200,
          hasMore: false,
        };
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source: "worktree", kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });
  });

  it("does not restore the old URL path while router props catch up", async () => {
    const user = userEvent.setup();
    const onPathChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel
          projectID="p1"
          projectName="demo"
          preferredPath="a.txt"
          onPathChange={onPathChange}
        />
      </QueryClientProvider>,
    );

    const oldFile = await screen.findByTitle("a.txt");
    const newFile = screen.getByTitle("b.txt");
    await waitFor(() => {
      expect(oldFile.parentElement).toHaveClass("bg-[var(--color-surface-active)]");
    });

    await user.click(newFile);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onPathChange).toHaveBeenCalledWith("b.txt");
    expect(newFile.parentElement).toHaveClass("bg-[var(--color-surface-active)]");
    expect(oldFile.parentElement).not.toHaveClass("bg-[var(--color-surface-active)]");

    // Router now publishes the requested URL, then a later external URL
    // change must still remain authoritative.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel
          projectID="p1"
          projectName="demo"
          preferredPath="b.txt"
          onPathChange={onPathChange}
        />
      </QueryClientProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel
          projectID="p1"
          projectName="demo"
          preferredPath="a.txt"
          onPathChange={onPathChange}
        />
      </QueryClientProvider>,
    );

    expect((await screen.findByTitle("a.txt")).parentElement).toHaveClass(
      "bg-[var(--color-surface-active)]",
    );
  });

  it("shows edit affordance for worktree files and gates by content type", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        return {
          path: "",
          source: "worktree",
          entries: [
            { name: "note.md", path: "note.md", kind: "file" },
            { name: "a.txt", path: "a.txt", kind: "file" },
            { name: "photo.png", path: "photo.png", kind: "file" },
            { name: "huge.log", path: "huge.log", kind: "file" },
            { name: "link", path: "link", kind: "symlink" },
          ],
          offset: 0,
          limit: 200,
          hasMore: false,
        };
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        if (path === "photo.png") {
          return { path, source: "worktree", kind: "binary", size: 12 };
        }
        if (path === "huge.log") {
          return { path, source: "worktree", kind: "too_large", size: 2_000_000 };
        }
        return {
          path,
          source: "worktree",
          kind: "text",
          content: path.endsWith(".md") ? "# Hi" : path,
          size: 4,
          editable: true,
          revision: "r1",
        };
      }
      throw new Error(`unexpected API: ${url}`);
    });
    fetchFileContentMock.mockImplementation(async (_id: string, source: string, path: string) => {
      if (path === "photo.png") {
        return { path, source, kind: "binary", size: 12 };
      }
      if (path === "huge.log") {
        return { path, source, kind: "too_large", size: 2_000_000 };
      }
      return {
        path,
        source,
        kind: "text",
        content: path.endsWith(".md") ? "# Hi" : "plain",
        size: 4,
        editable: true,
        revision: "r1",
      };
    });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" preferredPath="note.md" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "编辑 note.md" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "预览" })).not.toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "源码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 a.txt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 photo.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 huge.log" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑 link" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "编辑 note.md" }));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "/projects/p1/editor?path=note.md",
        "_blank",
        "noopener,noreferrer",
      );
    });

    await user.click(screen.getByRole("button", { name: "编辑 a.txt" }));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "/projects/p1/editor?path=a.txt",
        "_blank",
        "noopener,noreferrer",
      );
    });

    await user.click(screen.getByRole("button", { name: "编辑 photo.png" }));
    expect(await screen.findByRole("status")).toHaveTextContent("二进制文件暂不支持编辑");

    await user.click(screen.getByRole("button", { name: "编辑 huge.log" }));
    expect(await screen.findByRole("status")).toHaveTextContent("文件过大暂不支持编辑");

    // Stale editable:false must not block opening UTF-8 text (content cache / old backend).
    fetchFileContentMock.mockResolvedValueOnce({
      path: "a.txt",
      source: "worktree",
      kind: "text",
      content: "plain",
      size: 5,
      editable: false,
      revision: "r-stale",
    });
    openSpy.mockClear();
    await user.click(screen.getByRole("button", { name: "编辑 a.txt" }));
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "/projects/p1/editor?path=a.txt",
        "_blank",
        "noopener,noreferrer",
      );
    });

    await user.click(screen.getByTitle("a.txt"));
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Markdown 显示模式" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "预览" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "源码" })).not.toBeDisabled();
    });

    openSpy.mockRestore();
  });

  it("keeps preview/source toggle for non-markdown text and remembers mode", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        return {
          path: "",
          source: "worktree",
          entries: [
            { name: "note.md", path: "note.md", kind: "file" },
            { name: "readme.txt", path: "readme.txt", kind: "file" },
            { name: "photo.png", path: "photo.png", kind: "file" },
          ],
          offset: 0,
          limit: 200,
          hasMore: false,
        };
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        if (path === "photo.png") {
          return { path, source: "worktree", kind: "binary", size: 12 };
        }
        return {
          path,
          source: "worktree",
          kind: "text",
          content: path.endsWith(".md") ? "# Note" : "# Readme\n\nplain text markdown",
          size: 20,
          editable: true,
          revision: "r1",
        };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Host() {
      const [path, setPath] = useState("note.md");
      return (
        <ProjectFilesPanel
          projectID="p1"
          projectName="demo"
          preferredPath={path}
          onPathChange={setPath}
        />
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Host />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "编辑 note.md" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "预览" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
    });
    await user.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByTitle("readme.txt"));
    await waitFor(() => {
      expect(screen.getByTitle("readme.txt").parentElement).toHaveClass(
        "bg-[var(--color-surface-active)]",
      );
      expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "源码" })).not.toBeDisabled();
    });
    expect(await screen.findByText(/# Readme/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "预览" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Readme" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByTitle("photo.png"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "预览" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "源码" })).toBeDisabled();
      // Keep preferred mode chrome active; do not fake "源码" while neither works.
      expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
    });
    // Preference remembered: after leaving binary, restore previous preview choice.
    await user.click(screen.getByTitle("note.md"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "预览" })).not.toBeDisabled();
    });
  });

  it("hides edit affordance in HEAD version view", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        const source = url.includes("source=head") ? "head" : "worktree";
        return {
          path: "",
          source,
          entries: [{ name: "note.md", path: "note.md", kind: "file" }],
          offset: 0,
          limit: 200,
          hasMore: false,
        };
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return {
          path,
          source: url.includes("source=head") ? "head" : "worktree",
          kind: "text",
          content: "# Hi",
          size: 4,
          editable: false,
          revision: "r1",
        };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" preferredPath="note.md" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "编辑 note.md" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "版本" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "编辑 note.md" })).toBeNull();
    });
  });

  it("opens the root context menu and creates a file", async () => {
    const user = userEvent.setup();
    const onPathChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel
          projectID="p1"
          projectName="demo"
          projectPath="/tmp/demo"
          onPathChange={onPathChange}
        />
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(await screen.findByText("demo/"), { clientX: 32, clientY: 40 });
    expect(await screen.findByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "刷新文件树" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制项目绝对路径" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "新建文件" }));
    await user.clear(screen.getByLabelText("文件名称"));
    await user.type(screen.getByLabelText("文件名称"), "new.md");
    await user.click(screen.getByRole("button", { name: "新建" }));

    await waitFor(() => {
      expect(createProjectEntryMock).toHaveBeenCalledWith("p1", {
        kind: "file",
        parentPath: "",
        name: "new.md",
      });
    });
    await waitFor(() => {
      expect(onPathChange).toHaveBeenCalledWith("new.md");
    });
  });

  it("opens a directory context menu without showing root-only actions", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        return {
          path: "",
          source: "worktree",
          entries: [
            { name: "docs", path: "docs", kind: "dir" },
            { name: "a.txt", path: "a.txt", kind: "file" },
          ],
          offset: 0,
          limit: 200,
          hasMore: false,
        };
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source: "worktree", kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" projectPath="/tmp/demo" />
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(await screen.findByTitle("docs"), { clientX: 32, clientY: 40 });

    expect(await screen.findByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /展开|折叠/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制相对路径" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "刷新文件树" })).toBeNull();
  });

  it("copies a file relative path from the file context menu", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" projectPath="/tmp/demo" />
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(await screen.findByTitle("a.txt"), { clientX: 32, clientY: 40 });
    await user.click(await screen.findByRole("menuitem", { name: "复制相对路径" }));

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "复制相对路径" })).toBeNull();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the head source context menu read-only", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" projectPath="/tmp/demo" />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "版本" }));
    fireEvent.contextMenu(await screen.findByTitle("a.txt"), { clientX: 32, clientY: 40 });

    expect(await screen.findByRole("menuitem", { name: "打开" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制相对路径" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "重命名" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "复制绝对路径" })).toBeNull();
  });
});

describe("ProjectFilesPanel default expand", () => {
  beforeEach(() => {
    apiMock.mockReset();
    fetchFileContentMock.mockReset();
    createProjectEntryMock.mockReset();
    renameProjectEntryMock.mockReset();
    deleteProjectEntryMock.mockReset();
    revealProjectPathMock.mockReset();
    clipboardWriteMock.mockReset();
    fetchFileContentMock.mockImplementation(async (_projectID: string, source: string, path: string) => ({
      path,
      source,
      kind: "text",
      content: path,
      size: path.length,
      editable: true,
      revision: "r1",
    }));
  });

  it("expands only the first file's ancestor dirs and does not load sibling trees", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        const path = treePath(url);
        if (path === "") {
          return treeListing("", [
            { name: "docs", path: "docs", kind: "dir" },
            { name: "other", path: "other", kind: "dir" },
            { name: "readme.txt", path: "readme.txt", kind: "file" },
          ]);
        }
        if (path === "docs") {
          return treeListing("docs", [{ name: "nested", path: "docs/nested", kind: "dir" }]);
        }
        if (path === "docs/nested") {
          return treeListing("docs/nested", [
            { name: "note.md", path: "docs/nested/note.md", kind: "file" },
          ]);
        }
        throw new Error(`unexpected tree path: ${path}`);
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source: "worktree", kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const onPathChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" onPathChange={onPathChange} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTitle("docs/nested/note.md")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle("docs/nested/note.md").parentElement).toHaveClass(
        "bg-[var(--color-surface-active)]",
      );
      expect(onPathChange).toHaveBeenCalledWith("docs/nested/note.md");
    });
    expect(screen.queryByTitle("other/skip.txt")).toBeNull();
    expect(screen.queryByTitle("readme.txt")).toBeInTheDocument();

    await waitFor(() => {
      const paths = new Set(requestedTreePaths());
      expect(paths.has("")).toBe(true);
      expect(paths.has("docs")).toBe(true);
      expect(paths.has("docs/nested")).toBe(true);
      expect(paths.has("other")).toBe(false);
    });
  });

  it("does not treat a failed directory load as empty when probing the first file", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        const path = treePath(url);
        if (path === "") {
          return treeListing("", [
            { name: "broken", path: "broken", kind: "dir" },
            { name: "docs", path: "docs", kind: "dir" },
            { name: "readme.txt", path: "readme.txt", kind: "file" },
          ]);
        }
        if (path === "broken") {
          throw new Error("permission denied");
        }
        if (path === "docs") {
          return treeListing("docs", [{ name: "a.txt", path: "docs/a.txt", kind: "file" }]);
        }
        throw new Error(`unexpected tree path: ${path}`);
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source: "worktree", kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const onPathChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" onPathChange={onPathChange} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("permission denied")).toBeInTheDocument();
    expect(screen.queryByTitle("docs/a.txt")).toBeNull();
    expect(screen.queryByTitle("readme.txt")).toBeInTheDocument();
    await waitFor(() => {
      expect(onPathChange).not.toHaveBeenCalled();
    });
  });

  it("collapses empty dirs probed while locating the first file", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        const path = treePath(url);
        if (path === "") {
          return treeListing("", [
            { name: "empty", path: "empty", kind: "dir" },
            { name: "docs", path: "docs", kind: "dir" },
          ]);
        }
        if (path === "empty") {
          return treeListing("empty", []);
        }
        if (path === "docs") {
          return treeListing("docs", [{ name: "a.txt", path: "docs/a.txt", kind: "file" }]);
        }
        throw new Error(`unexpected tree path: ${path}`);
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source: "worktree", kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" />
      </QueryClientProvider>,
    );

    expect(await screen.findByTitle("docs/a.txt")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("目录为空")).toBeNull();
      expect(screen.queryByTitle("docs/a.txt")).toBeInTheDocument();
    });
    // empty was probed (so its tree was fetched) but should not stay open
    expect(requestedTreePaths()).toContain("empty");
    expect(screen.queryByTitle("docs/a.txt")).toBeInTheDocument();
    const emptyRow = screen.getByTitle("empty");
    const emptyCaret = emptyRow.querySelector("svg");
    expect(emptyCaret?.classList.contains("rotate-90")).toBe(false);
    const docsRow = screen.getByTitle("docs");
    const docsCaret = docsRow.querySelector("svg");
    expect(docsCaret?.classList.contains("rotate-90")).toBe(true);
  });

  it("re-expands activePath ancestors after source switch clears loaded dirs", async () => {
    apiMock.mockImplementation(async (url: string) => {
      const source = url.includes("source=head") ? "head" : "worktree";
      if (url.includes("/tree?")) {
        const path = treePath(url);
        if (path === "") {
          return {
            ...treeListing("", [
              { name: "docs", path: "docs", kind: "dir" },
              { name: "other", path: "other", kind: "dir" },
            ]),
            source,
          };
        }
        if (path === "docs") {
          return {
            ...treeListing("docs", [{ name: "note.md", path: "docs/note.md", kind: "file" }]),
            source,
          };
        }
        if (path === "other") {
          return {
            ...treeListing("other", [{ name: "skip.txt", path: "other/skip.txt", kind: "file" }]),
            source,
          };
        }
        throw new Error(`unexpected tree path: ${path}`);
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source, kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" />
      </QueryClientProvider>,
    );

    expect(await screen.findByTitle("docs/note.md")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle("docs/note.md").parentElement).toHaveClass(
        "bg-[var(--color-surface-active)]",
      );
    });

    await user.click(screen.getByRole("button", { name: "版本" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "版本" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(await screen.findByTitle("docs/note.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "目录" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(await screen.findByTitle("docs/note.md")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle("docs/note.md").parentElement).toHaveClass(
        "bg-[var(--color-surface-active)]",
      );
    });
    expect(screen.queryByTitle("other/skip.txt")).toBeNull();
  });

  it("expands only preferredPath ancestors without probing the first-file branch", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        const path = treePath(url);
        if (path === "") {
          return treeListing("", [
            { name: "first", path: "first", kind: "dir" },
            { name: "second", path: "second", kind: "dir" },
          ]);
        }
        if (path === "first") {
          return treeListing("first", [{ name: "skip.txt", path: "first/skip.txt", kind: "file" }]);
        }
        if (path === "second") {
          return treeListing("second", [
            { name: "target.md", path: "second/target.md", kind: "file" },
          ]);
        }
        throw new Error(`unexpected tree path: ${path}`);
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return { path, source: "worktree", kind: "text", content: path, size: path.length };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" preferredPath="second/target.md" />
      </QueryClientProvider>,
    );

    expect(await screen.findByTitle("second/target.md")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTitle("second/target.md").parentElement).toHaveClass(
        "bg-[var(--color-surface-active)]",
      );
    });
    expect(screen.queryByTitle("first/skip.txt")).toBeNull();

    await waitFor(() => {
      const paths = new Set(requestedTreePaths());
      expect(paths.has("")).toBe(true);
      expect(paths.has("second")).toBe(true);
      expect(paths.has("first")).toBe(false);
    });
  });
});
