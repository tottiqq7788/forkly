import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { FilePreviewView } from "./FilePreviewView";
import { MarkdownSaveGuardProvider } from "./markdown/MarkdownSaveGuard";
import type { FileContent } from "../../api";
import { useState } from "react";
import type { MarkdownViewerMode } from "./markdown/MarkdownDocumentView";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <MarkdownSaveGuardProvider>{ui}</MarkdownSaveGuardProvider>,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function mdFile(over: Partial<FileContent> = {}): FileContent {
  return {
    path: "docs/guide.md",
    source: "worktree",
    kind: "text",
    content: "# Hello\n\nworld",
    size: 12,
    ...over,
  };
}

describe("FilePreviewView markdown modes", () => {
  it("defaults to preview for markdown", async () => {
    wrap(<FilePreviewView file={mdFile()} projectID="p1" />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Hello" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("does not mount an inline editor for editable markdown", async () => {
    wrap(<FilePreviewView file={mdFile({ editable: true, revision: "abc" })} projectID="p1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(document.querySelector(".forkly-muya-mount")).toBeNull();
  });

  it("can switch to source via viewMode prop", async () => {
    wrap(<FilePreviewView file={mdFile()} projectID="p1" viewMode="source" />);
    expect(await screen.findByText(/# Hello/)).toBeInTheDocument();
  });

  it("does not show mode toggle for plain text", () => {
    wrap(
      <FilePreviewView
        file={{ path: "a.txt", source: "worktree", kind: "text", content: "plain" }}
        projectID="p1"
      />,
    );
    expect(screen.queryByRole("button", { name: "预览" })).toBeNull();
    expect(screen.getByText("plain")).toBeInTheDocument();
  });

  it("forces source for truncated markdown", async () => {
    wrap(
      <FilePreviewView
        file={mdFile({ truncated: true, content: "# partial" })}
        projectID="p1"
        viewMode="preview"
      />,
    );
    expect(await screen.findByText(/# partial/)).toBeInTheDocument();
  });

  it("follows viewMode when path changes", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Host({ file, mode }: { file: FileContent; mode: MarkdownViewerMode }) {
      return (
        <MarkdownSaveGuardProvider>
          <FilePreviewView file={file} projectID="p1" viewMode={mode} />
        </MarkdownSaveGuardProvider>
      );
    }
    function App() {
      const [mode, setMode] = useState<MarkdownViewerMode>("source");
      const [file, setFile] = useState(mdFile());
      return (
        <div>
          <button type="button" onClick={() => setMode("preview")}>
            to-preview
          </button>
          <button
            type="button"
            onClick={() => setFile(mdFile({ path: "docs/other.md", content: "# Other" }))}
          >
            change-file
          </button>
          <Host file={file} mode={mode} />
        </div>
      );
    }
    const router = createMemoryRouter([{ path: "/", element: <App /> }], {
      initialEntries: ["/"],
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/# Hello/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "change-file" }));
    await waitFor(() => {
      expect(screen.getByText(/# Other/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "to-preview" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Other" })).toBeInTheDocument();
  });
});
