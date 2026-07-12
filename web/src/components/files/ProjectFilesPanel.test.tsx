import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../../api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

function contentPath(url: string): string {
  return new URL(url, "http://localhost").searchParams.get("path") || "";
}

describe("ProjectFilesPanel selection", () => {
  beforeEach(() => {
    apiMock.mockReset();
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

  it("shows markdown mode footer and edit affordance for worktree markdown", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/tree?")) {
        return {
          path: "",
          source: "worktree",
          entries: [
            { name: "note.md", path: "note.md", kind: "file" },
            { name: "a.txt", path: "a.txt", kind: "file" },
          ],
          offset: 0,
          limit: 200,
          hasMore: false,
        };
      }
      if (url.includes("/content?")) {
        const path = contentPath(url);
        return {
          path,
          source: "worktree",
          kind: "text",
          content: path.endsWith(".md") ? "# Hi" : path,
          size: 4,
          editable: path.endsWith(".md"),
          revision: "r1",
        };
      }
      throw new Error(`unexpected API: ${url}`);
    });

    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectFilesPanel projectID="p1" projectName="demo" preferredPath="note.md" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "预览" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "源码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 note.md" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑 note.md" }));
    expect(openSpy).toHaveBeenCalledWith(
      "/projects/p1/editor?path=note.md",
      "_blank",
      "noopener,noreferrer",
    );

    await user.click(screen.getByTitle("a.txt"));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "预览" })).toBeNull();
    });

    openSpy.mockRestore();
  });
});
