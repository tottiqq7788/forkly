export type Project = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  openedAt: string;
  exists: boolean;
  branch?: string;
  changeCount: number;
  summary: string;
  blockers?: string[];
  kindCounts?: Record<string, number>;
};

export type DashboardActivity = {
  days: number;
  totalCommits: number;
  recentCommits: number;
  series: { date: string; count: number }[];
  scannedProjects: number;
  unavailable: number;
};

export type FileStatus = {
  path: string;
  oldPath?: string;
  kind: string;
  staged: boolean;
  unstaged: boolean;
};

export type StatusSnapshot = {
  health: {
    ok: boolean;
    hasHead: boolean;
    branch: string;
    detached: boolean;
    blockers: string[];
    mergeInProgress?: boolean;
    rebaseInProgress?: boolean;
    cherryPick?: boolean;
    revert?: boolean;
    indexLocked?: boolean;
  };
  files: FileStatus[];
  fingerprint: string;
};

export type BranchInfo = {
  name: string;
  current: boolean;
  short?: string;
  subject?: string;
  date?: string;
  isUnborn?: boolean;
};

export type BranchList = {
  current: string;
  detached: boolean;
  hasHead: boolean;
  branches: BranchInfo[];
  dirty: boolean;
  fileCount: number;
  blockers?: string[];
  canSwitch: boolean;
  canMutate: boolean;
};

export type BranchResult = {
  ok: boolean;
  branch: string;
  status: StatusSnapshot;
};

export type DiffResult = {
  path: string;
  kind: string;
  patch?: string;
  truncated?: boolean;
  additions?: number;
  deletions?: number;
  oldImage?: string;
  newImage?: string;
  oldSize?: number;
  newSize?: number;
  mime?: string;
  message?: string;
};

export type BrowseSource = "worktree" | "head";

export type TreeEntry = {
  name: string;
  path: string;
  kind: "file" | "dir" | "symlink";
  size?: number;
  linkTarget?: string;
};

export type TreeListing = {
  path: string;
  source: BrowseSource;
  entries: TreeEntry[];
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
  emptyHead?: boolean;
};

export type FileContent = {
  path: string;
  source: BrowseSource;
  kind: string;
  mime?: string;
  size?: number;
  content?: string;
  dataUrl?: string;
  truncated?: boolean;
  message?: string;
  revision?: string;
  editable?: boolean;
  lineEnding?: string;
  hasUtf8Bom?: boolean;
  hasFinalNewline?: boolean;
};

export type WriteContentResult = {
  path: string;
  revision: string;
  size: number;
};

export type UploadAssetResult = {
  path: string;
  relativePath: string;
  mime: string;
  size: number;
  revision?: string;
};

export type ContentConflictDetails = {
  path?: string;
  expectedRevision?: string;
  currentRevision?: string;
};

export class APIError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "APIError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|; )forkly_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("X-Forkly-CSRF", csrfToken());
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (!isFormData && !headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
  }
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; code?: string; details?: unknown };
    throw new APIError(body.error || res.statusText, res.status, body.code, body.details);
  }
  return data as T;
}

/** Content unchanged under If-None-Match. */
export const CONTENT_NOT_MODIFIED = Symbol("CONTENT_NOT_MODIFIED");

export async function fetchFileContent(
  projectID: string,
  source: BrowseSource,
  path: string,
  opts?: { etag?: string },
): Promise<FileContent | typeof CONTENT_NOT_MODIFIED> {
  const headers = new Headers();
  if (opts?.etag) headers.set("If-None-Match", opts.etag);
  const res = await fetch(
    `/local-api/v1/projects/${projectID}/content?source=${source}&path=${encodeURIComponent(path)}`,
    { headers, credentials: "same-origin" },
  );
  if (res.status === 304) return CONTENT_NOT_MODIFIED;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as { error?: string; code?: string; details?: unknown };
    throw new APIError(body.error || res.statusText, res.status, body.code, body.details);
  }
  return data as FileContent;
}

export function putFileContent(
  projectID: string,
  body: { path: string; content: string; revision: string },
): Promise<WriteContentResult> {
  return api<WriteContentResult>(`/local-api/v1/projects/${projectID}/content`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function uploadMarkdownAsset(
  projectID: string,
  markdownPath: string,
  file: Blob,
  filename?: string,
): Promise<UploadAssetResult> {
  const form = new FormData();
  form.set("path", markdownPath);
  form.set("file", file, filename || "image.png");
  return api<UploadAssetResult>(`/local-api/v1/projects/${projectID}/assets`, {
    method: "POST",
    body: form,
  });
}

export function assetURL(
  projectID: string,
  source: BrowseSource,
  path: string,
): string {
  return `/local-api/v1/projects/${projectID}/asset?source=${source}&path=${encodeURIComponent(path)}`;
}

export type SessionMe = {
  git: { version: string; bundled: boolean };
  identity?: { name: string; email: string };
  identityConfigured?: boolean;
  preferences?: { theme: string; backgroundChecks: boolean };
};

/** Load session; in Vite DEV, auto-bootstrap via /session/dev-login when no menu-bar claim. */
export async function fetchSessionMe(): Promise<SessionMe> {
  try {
    return await api<SessionMe>("/local-api/v1/session/me");
  } catch (first) {
    if (!import.meta.env.DEV) {
      throw first;
    }
    let res: Response;
    try {
      res = await fetch("/local-api/v1/session/dev-login", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      throw first;
    }
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("开发 API 未开启 DevMode，请用 FORKLY_DEV=1 启动");
      }
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || res.statusText || "dev-login failed");
    }
    return await api<SessionMe>("/local-api/v1/session/me");
  }
}
