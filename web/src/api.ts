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
  };
  files: FileStatus[];
  fingerprint: string;
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

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|; )forkly_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("X-Forkly-CSRF", csrfToken());
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
  }
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  return data as T;
}

export type SessionMe = { git: { version: string; bundled: boolean } };

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
