import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitHubAccountPanel } from "./GitHubAccountPanel";

const fetchGitHubSettingsMock = vi.hoisted(() => vi.fn());
const startGitHubWebOAuthMock = vi.hoisted(() => vi.fn());

vi.mock("../../githubApi", async () => {
  const actual = await vi.importActual<typeof import("../../githubApi")>("../../githubApi");
  return {
    ...actual,
    fetchGitHubSettings: (...args: unknown[]) => fetchGitHubSettingsMock(...args),
    startGitHubWebOAuth: (...args: unknown[]) => startGitHubWebOAuthMock(...args),
    startGitHubDevice: vi.fn(),
    gitHubDeviceStatus: vi.fn(),
    cancelGitHubDevice: vi.fn(),
    setGitHubPAT: vi.fn(),
    logoutGitHub: vi.fn(),
  };
});

describe("GitHubAccountPanel", () => {
  beforeEach(() => {
    fetchGitHubSettingsMock.mockReset();
    startGitHubWebOAuthMock.mockReset();
    fetchGitHubSettingsMock.mockResolvedValue({
      oauthConfigured: true,
      webOAuthConfigured: true,
      deviceFlowConfigured: true,
      account: null,
    });
    startGitHubWebOAuthMock.mockResolvedValue({
      authorizationUrl: "https://github.com/login/oauth/authorize?state=abc",
      state: "abc",
    });
    vi.stubGlobal("location", { assign: vi.fn() });
  });

  it("shows web oauth primary button and starts flow", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GitHubAccountPanel projectId="p1" returnTo="/projects/p1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "连接 GitHub 并关联" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "连接 GitHub 并关联" }));
    expect(startGitHubWebOAuthMock).toHaveBeenCalledWith({ projectId: "p1", returnTo: "/projects/p1" });
    expect(window.location.assign).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?state=abc");
  });

  it("falls back to device flow when web oauth unavailable", async () => {
    fetchGitHubSettingsMock.mockResolvedValue({
      oauthConfigured: true,
      webOAuthConfigured: false,
      deviceFlowConfigured: true,
      account: null,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GitHubAccountPanel />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "开始设备码授权" })).toBeInTheDocument();
  });
});
