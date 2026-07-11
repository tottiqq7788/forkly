import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { FilePreviewView } from "./FilePreviewView";
import { MarkdownSaveGuardProvider } from "./markdown/MarkdownSaveGuard";
import type { FileContent } from "../../api";

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
  it("defaults to preview for non-editable markdown", async () => {
    wrap(<FilePreviewView file={mdFile()} projectID="p1" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Hello" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
  });

  it("shows edit mode for editable worktree markdown", async () => {
    wrap(<FilePreviewView file={mdFile({ editable: true, revision: "abc" })} projectID="p1" />);
    expect(await screen.findByRole("button", { name: "编辑" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("can switch to source", async () => {
    const user = userEvent.setup();
    wrap(<FilePreviewView file={mdFile()} projectID="p1" />);
    await screen.findByRole("heading", { level: 1, name: "Hello" });
    await user.click(screen.getByRole("button", { name: "源码" }));
    expect(screen.getByText(/# Hello/)).toBeInTheDocument();
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
      <FilePreviewView file={mdFile({ truncated: true, content: "# partial" })} projectID="p1" />,
    );
    expect(await screen.findByRole("button", { name: "预览" })).toBeDisabled();
    expect(screen.getByText(/# partial/)).toBeInTheDocument();
  });

  it("resets to preview when path changes", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Host({ file }: { file: FileContent }) {
      return (
        <MarkdownSaveGuardProvider>
          <FilePreviewView file={file} projectID="p1" />
        </MarkdownSaveGuardProvider>
      );
    }
    const router = createMemoryRouter([{ path: "/", element: <Host file={mdFile()} /> }], {
      initialEntries: ["/"],
    });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { level: 1, name: "Hello" });
    await user.click(screen.getByRole("button", { name: "源码" }));

    const router2 = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <Host file={mdFile({ path: "docs/other.md", content: "# Other" })} />
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    rerender(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router2} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Other" })).toBeInTheDocument();
    });
  });
});
