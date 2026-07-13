import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { MarkdownSaveGuardProvider } from "../components/files/markdown/MarkdownSaveGuard";

const apiMock = vi.hoisted(() => vi.fn());
const revealProjectPathMock = vi.hoisted(() => vi.fn());
const clipboardWriteMock = vi.hoisted(() => vi.fn());

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
    revealProjectPath: (...args: unknown[]) => revealProjectPathMock(...args),
  };
});

vi.mock("../components/files/ProjectFilesPanel", () => ({
  ProjectFilesPanel: () => <div data-testid="files-panel">files</div>,
}));

const { default: ProjectPage } = await import("./ProjectPage");

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/projects/:id/*",
        element: (
          <MarkdownSaveGuardProvider>
            <ProjectPage />
          </MarkdownSaveGuardProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("ProjectPage sidebar context menus", () => {
  beforeEach(() => {
    apiMock.mockReset();
    revealProjectPathMock.mockReset();
    clipboardWriteMock.mockReset();
    revealProjectPathMock.mockResolvedValue({ ok: true });
    clipboardWriteMock.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText: clipboardWriteMock },
    });

    apiMock.mockImplementation(async (url: string) => {
      if (url.includes("/session/me")) {
        return { authenticated: true, identity: { name: "me", email: "me@example.com" } };
      }
      if (url === "/local-api/v1/projects") {
        return { projects: [{ id: "p1", name: "demo", path: "/tmp/demo", exists: true }] };
      }
      if (url === "/local-api/v1/projects/p1") {
        return { id: "p1", name: "demo", path: "/tmp/demo", hideRules: [] };
      }
      if (url.includes("/status")) {
        return {
          health: { ok: true, hasHead: true, branch: "main", detached: false, blockers: [] },
          files: [
            { path: "docs/a.txt", kind: "modified", staged: false, unstaged: true },
            { path: "gone.txt", kind: "deleted", staged: false, unstaged: true },
          ],
          fingerprint: "fp1",
        };
      }
      if (url.includes("/diff?")) {
        return { path: "docs/a.txt", kind: "text", patch: "+hello", additions: 1, deletions: 0 };
      }
      if (url.includes("/history")) {
        return {
          commits: [
            {
              sha: "abcdef1234567890",
              short: "abcdef1",
              subject: "你好",
              author: "本机身份",
              email: "me@example.com",
              date: "2026-07-11T00:10:16+08:00",
            },
          ],
        };
      }
      if (url.includes("/commits/")) {
        if (url.includes("/diff?")) {
          return { path: "docs/a.txt", kind: "text", patch: "+hello", additions: 1, deletions: 0 };
        }
        return {
          commit: {
            sha: "abcdef1234567890",
            short: "abcdef1",
            subject: "你好",
            author: "本机身份",
            email: "me@example.com",
            date: "2026-07-11T00:10:16+08:00",
          },
          files: [{ path: "docs/a.txt", status: "M", additions: 1, deletions: 0 }],
        };
      }
      throw new Error(`unexpected API: ${url}`);
    });
  });

  it("opens change file menu and copies path silently", async () => {
    const user = userEvent.setup();
    renderAt("/projects/p1/changes");

    fireEvent.contextMenu(await screen.findByTitle("修改 · docs/a.txt"), {
      clientX: 40,
      clientY: 80,
    });

    expect(await screen.findByRole("menuitem", { name: "查看差异" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "加入本次保存" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "在文件管理器中显示" })).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "复制相对路径" }));
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "复制相对路径" })).toBeNull();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hides reveal for deleted change files", async () => {
    renderAt("/projects/p1/changes");
    fireEvent.contextMenu(await screen.findByTitle("删除 · gone.txt"), {
      clientX: 40,
      clientY: 100,
    });
    expect(await screen.findByRole("menuitem", { name: "查看差异" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "在文件管理器中显示" })).toBeNull();
  });

  it("opens history commit menu and copies sha", async () => {
    const user = userEvent.setup();
    renderAt("/projects/p1/history");

    fireEvent.contextMenu(await screen.findByTitle("你好"), { clientX: 24, clientY: 60 });
    expect(await screen.findByRole("menuitem", { name: "查看详情" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制完整 SHA" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制完整提交信息" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "复制完整 SHA" }));
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "复制完整 SHA" })).toBeNull();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens history group menu with semantic copy value", async () => {
    const user = userEvent.setup();
    renderAt("/projects/p1/history");

    fireEvent.contextMenu(await screen.findByTitle("11"), { clientX: 24, clientY: 40 });
    expect(await screen.findByRole("menuitem", { name: "折叠" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "查看组内最新提交" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "复制分组名称" }));
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "复制分组名称" })).toBeNull();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("expands collapsed ancestors when viewing the latest commit in a group", async () => {
    const user = userEvent.setup();
    renderAt("/projects/p1/history");

    expect(await screen.findByTitle("你好")).toBeInTheDocument();
    await user.click(screen.getByTitle("2026"));
    await waitFor(() => {
      expect(screen.queryByTitle("你好")).toBeNull();
    });

    fireEvent.contextMenu(screen.getByTitle("2026").closest("[data-history-tree-node='true']")!, {
      clientX: 20,
      clientY: 20,
    });
    await user.click(await screen.findByRole("menuitem", { name: "查看组内最新提交" }));
    expect(await screen.findByTitle("你好")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "你好" })).toBeInTheDocument();
  });

  it("toggles change directories with caret clicks", async () => {
    const user = userEvent.setup();
    renderAt("/projects/p1/changes");

    expect(await screen.findByTitle("修改 · docs/a.txt")).toBeInTheDocument();
    await user.click(screen.getByTitle("docs/"));
    await waitFor(() => {
      expect(screen.queryByTitle("修改 · docs/a.txt")).toBeNull();
    });
    await user.click(screen.getByTitle("docs/"));
    expect(await screen.findByTitle("修改 · docs/a.txt")).toBeInTheDocument();
  });
});
