import { api } from "./api";

export type GitHubAccount = {
  accountId: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  authKind: "oauth" | "pat" | string;
  linkedAt: string;
};

export type RemoteInfo = {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
};

export type DetectedRemote = {
  name: string;
  fetchUrl: string;
  owner?: string;
  repo?: string;
  isGithub: boolean;
  message?: string;
};

export type Operation = {
  id: string;
  kind: string;
  projectId?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  phase?: string;
  progress?: number;
  message?: string;
  error?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type RemoteStatus = {
  connected: boolean;
  provider?: string;
  accountId?: string;
  accountLogin?: string;
  authConfigured: boolean;
  oauthAvailable: boolean;
  remotes: RemoteInfo[];
  remoteName?: string;
  fetchUrl?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  upstream?: string;
  defaultBranch?: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  fileCount: number;
  hasUpstream: boolean;
  canFetch: boolean;
  canPull: boolean;
  canPush: boolean;
  pullBlockers?: string[];
  pushHints?: string[];
  diverged: boolean;
  linkedAt?: string;
  lastFetchAt?: string;
  detectedOrigin?: DetectedRemote | null;
  activeOp?: Operation | null;
  createdHtmlUrl?: string;
  pushError?: string;
  health?: {
    ok: boolean;
    branch: string;
    detached: boolean;
    blockers: string[];
  };
};

export type DeviceStart = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
};

export type DeviceStatus = {
  status: string;
  errorMessage?: string;
  accountId?: string;
  login?: string;
  expiresIn?: number;
};

export type ListedRepo = {
  fullName: string;
  name: string;
  ownerLogin: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
  description: string;
  updatedAt: string;
};

export function fetchGitHubSettings() {
  return api<{
    oauthConfigured: boolean;
    webOAuthConfigured?: boolean;
    deviceFlowConfigured?: boolean;
    account: GitHubAccount | null;
  }>("/local-api/v1/settings/github");
}

export type WebOAuthStart = {
  authorizationUrl: string;
  state: string;
};

export function startGitHubWebOAuth(body: { projectId?: string; returnTo?: string }) {
  return api<WebOAuthStart>("/local-api/v1/github/oauth/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function logoutGitHub() {
  return api<{ ok: boolean }>("/local-api/v1/settings/github", { method: "DELETE" });
}

export function startGitHubDevice() {
  return api<DeviceStart>("/local-api/v1/github/device/start", { method: "POST", body: "{}" });
}

export function gitHubDeviceStatus(flowId: string) {
  return api<DeviceStatus>(`/local-api/v1/github/device/status?flowId=${encodeURIComponent(flowId)}`);
}

export function cancelGitHubDevice(flowId: string) {
  return api<{ ok: boolean }>("/local-api/v1/github/device/cancel", {
    method: "POST",
    body: JSON.stringify({ flowId }),
  });
}

export function setGitHubPAT(token: string) {
  return api<{ ok: boolean; account: GitHubAccount }>("/local-api/v1/github/pat", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function fetchRemoteStatus(projectID: string) {
  return api<RemoteStatus>(`/local-api/v1/projects/${projectID}/remote`);
}

export function linkRemote(
  projectID: string,
  body: { url?: string; remoteName?: string; replace?: boolean; useExisting?: boolean; strictAccess?: boolean },
) {
  return api<RemoteStatus>(`/local-api/v1/projects/${projectID}/remote`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function unlinkRemote(projectID: string, deleteGitRemote = false) {
  return api<{ ok: boolean }>(`/local-api/v1/projects/${projectID}/remote`, {
    method: "DELETE",
    body: JSON.stringify({ deleteGitRemote }),
  });
}

export function startRemoteOp(projectID: string, kind: "fetch" | "pull" | "push") {
  return api<{ operationId: string; operation: Operation }>(
    `/local-api/v1/projects/${projectID}/remote/${kind}`,
    { method: "POST", body: "{}" },
  );
}

export function fetchOperation(operationId: string) {
  return api<Operation>(`/local-api/v1/operations/${operationId}`);
}

export function cancelOperation(operationId: string) {
  return api<{ ok: boolean }>(`/local-api/v1/operations/${operationId}`, { method: "DELETE" });
}

export function listGitHubRepos(q = "", page = 1) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("page", String(page));
  return api<{ repos: ListedRepo[] }>(`/local-api/v1/github/repos?${params}`);
}

export function cloneGitHubRepo(body: { url: string; parentPath: string; name?: string }) {
  return api<{ id: string }>("/local-api/v1/projects/clone", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createGitHubRepo(
  projectID: string,
  body: { name: string; description?: string; private?: boolean },
) {
  return api<RemoteStatus>(`/local-api/v1/projects/${projectID}/remote/create-repo`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
