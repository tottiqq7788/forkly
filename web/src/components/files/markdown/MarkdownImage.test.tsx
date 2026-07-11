import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarkdownImage } from "./MarkdownImage";

const apiMock = vi.fn();

vi.mock("../../../api", async () => {
  const actual = await vi.importActual<typeof import("../../../api")>("../../../api");
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
  };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("MarkdownImage", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("loads repo image via content api dataUrl", async () => {
    apiMock.mockResolvedValue({
      path: "docs/a.png",
      source: "worktree",
      kind: "image",
      mime: "image/png",
      dataUrl: "data:image/png;base64,aaa",
    });
    wrap(
      <MarkdownImage
        src="./a.png"
        alt="pic"
        projectID="p1"
        source="worktree"
        ownerPath="docs/x.md"
      />,
    );
    await waitFor(() => {
      const img = screen.getByAltText("pic") as HTMLImageElement;
      expect(img.src).toContain("data:image/png;base64,aaa");
    });
    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining("/content?source=worktree&path=docs%2Fa.png"),
    );
  });

  it("renders https remote images", () => {
    wrap(
      <MarkdownImage
        src="https://cdn.example/a.png"
        alt="remote"
        projectID="p1"
        source="worktree"
        ownerPath="docs/x.md"
      />,
    );
    const img = screen.getByAltText("remote") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example/a.png");
    expect(img.getAttribute("referrerpolicy") || img.referrerPolicy).toBe("no-referrer");
  });

  it("blocks local svg and binary responses", async () => {
    wrap(
      <MarkdownImage
        src="./icon.svg"
        alt="svg"
        projectID="p1"
        source="worktree"
        ownerPath="docs/x.md"
      />,
    );
    expect(screen.getByText("[svg]")).toBeInTheDocument();

    apiMock.mockResolvedValue({
      path: "docs/a.bin",
      source: "worktree",
      kind: "binary",
      message: "二进制文件，仅显示元数据",
    });
    wrap(
      <MarkdownImage
        src="./a.bin"
        alt="bin"
        projectID="p1"
        source="worktree"
        ownerPath="docs/x.md"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/二进制|bin|无法预览/)).toBeInTheDocument();
    });
  });
});
