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
      expect(oldFile).toHaveClass("bg-[var(--color-surface-active)]");
    });

    await user.click(newFile);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(onPathChange).toHaveBeenCalledWith("b.txt");
    expect(newFile).toHaveClass("bg-[var(--color-surface-active)]");
    expect(oldFile).not.toHaveClass("bg-[var(--color-surface-active)]");

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

    expect(await screen.findByTitle("a.txt")).toHaveClass("bg-[var(--color-surface-active)]");
  });
});
