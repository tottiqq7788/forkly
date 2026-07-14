import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProjectSettingsDrawer } from "./ProjectSettingsDrawer";

const apiMock = vi.hoisted(() => vi.fn());
const fetchRemoteStatusMock = vi.hoisted(() => vi.fn());
const fetchGitHubSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

vi.mock("../../githubApi", async () => {
  const actual = await vi.importActual<typeof import("../../githubApi")>("../../githubApi");
  return {
    ...actual,
    fetchRemoteStatus: (...args: unknown[]) => fetchRemoteStatusMock(...args),
    fetchGitHubSettings: (...args: unknown[]) => fetchGitHubSettingsMock(...args),
    linkRemote: vi.fn(),
    unlinkRemote: vi.fn(),
    startRemoteOp: vi.fn(),
  };
});

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ProjectSettingsDrawer
          projectID="p1"
          projectName="demo"
          projectPath="/tmp/demo"
          hideRules={["*.DS*"]}
          projectMissing={false}
          onClose={() => {}}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ProjectSettingsDrawer", () => {
  beforeEach(() => {
    apiMock.mockReset();
    fetchRemoteStatusMock.mockReset();
    fetchGitHubSettingsMock.mockReset();
    apiMock.mockImplementation(async (url: string) => {
      if (url === "/local-api/v1/projects") return { projects: [] };
      return {};
    });
    fetchGitHubSettingsMock.mockResolvedValue({
      oauthConfigured: false,
      account: { accountId: "gh_1", login: "octocat", authKind: "pat", linkedAt: new Date().toISOString() },
    });
    fetchRemoteStatusMock.mockResolvedValue({
      connected: false,
      authConfigured: true,
      oauthAvailable: false,
      remotes: [],
      ahead: 0,
      behind: 0,
      dirty: false,
      fileCount: 0,
      hasUpstream: false,
      canFetch: false,
      canPull: false,
      canPush: false,
      diverged: false,
    });
  });

  it("shows existing settings and github section", async () => {
    renderDrawer();
    expect(await screen.findByText("demo")).toBeInTheDocument();
    expect(screen.getByText("在文件管理器中显示")).toBeInTheDocument();
    expect(screen.getByText("隐藏项")).toBeInTheDocument();
    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("关联 GitHub 仓库")).toBeInTheDocument();
  });

  it("shows connected remote actions", async () => {
    fetchRemoteStatusMock.mockResolvedValue({
      connected: true,
      authConfigured: true,
      oauthAvailable: false,
      remotes: [],
      owner: "octo",
      repo: "hello",
      fetchUrl: "https://github.com/octo/hello.git",
      ahead: 1,
      behind: 0,
      dirty: false,
      fileCount: 0,
      hasUpstream: true,
      canFetch: true,
      canPull: false,
      canPush: true,
      pullBlockers: ["已是最新，无需拉取"],
      diverged: false,
      accountLogin: "octocat",
    });
    renderDrawer();
    expect(await screen.findByText("octo/hello")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "获取更新" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "推送" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "拉取" })).toBeDisabled();
  });

  it("two-step remove still works", async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(await screen.findByRole("button", { name: "移除项目" }));
    expect(screen.getByRole("button", { name: "确认移除" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });
  });
});
