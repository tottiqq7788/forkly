export type ResolvedRepoPath = {
  kind: "repo";
  path: string;
  fragment: string;
};

export type ResolvedExternal = {
  kind: "external";
  href: string;
};

export type ResolvedFragment = {
  kind: "fragment";
  fragment: string;
};

export type ResolvedBlocked = {
  kind: "blocked";
  reason: string;
};

export type ResolvedLink =
  | ResolvedRepoPath
  | ResolvedExternal
  | ResolvedFragment
  | ResolvedBlocked;

export type ResolvedImage =
  | { kind: "repo"; path: string }
  | { kind: "remote"; href: string }
  | { kind: "data"; href: string }
  | ResolvedBlocked;

const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+=*$/i;

/** Keep relative/https URLs; also allow safe data-image URLs for Markdown images. */
export function forklyUrlTransform(url: string): string {
  const compact = (url || "").replace(/\s+/g, "");
  if (SAFE_IMAGE_DATA.test(compact)) return compact;
  // Same allowlist as react-markdown default (no data:/javascript:).
  const colon = url.indexOf(":");
  const questionMark = url.indexOf("?");
  const numberSign = url.indexOf("#");
  const slash = url.indexOf("/");
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    /^(https?|ircs?|mailto|xmpp)$/i.test(url.slice(0, colon))
  ) {
    return url;
  }
  return "";
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

function decodeMaybe(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Case-insensitive `.git` / `.git/...` / nested `foo/.git` (macOS APFS default is case-insensitive). */
export function isGitMetaPath(rel: string): boolean {
  const lower = rel.replace(/\\/g, "/").toLowerCase();
  if (lower === ".git" || lower.startsWith(".git/")) return true;
  return lower.split("/").some((part) => part === ".git");
}

/** Normalize a repo-relative path. Leading `/` means project root, not OS absolute. */
export function normalizeRepoPath(ownerPath: string, rawHref: string): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;

  const noQuery = trimmed.split("?")[0] ?? "";
  const noHash = noQuery.split("#")[0] ?? "";
  if (!noHash) return null;

  let decoded = decodeMaybe(noHash).replace(/\\/g, "/");
  // Project-root relative: "/docs/a.md" → "docs/a.md"
  if (decoded.startsWith("/")) {
    decoded = decoded.replace(/^\/+/, "");
  } else {
    const base = dirname(ownerPath);
    decoded = base ? `${base}/${decoded}` : decoded;
  }

  const parts: string[] = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null; // escape repo root
      parts.pop();
      continue;
    }
    if (segment.startsWith("-")) return null;
    if (segment.toLowerCase() === ".git") return null;
    parts.push(segment);
  }

  const joined = parts.join("/");
  if (!joined) return null;
  if (isGitMetaPath(joined)) return null;
  return joined;
}

function splitHref(href: string): { pathPart: string; fragment: string } {
  const hash = href.indexOf("#");
  if (hash < 0) return { pathPart: href, fragment: "" };
  return { pathPart: href.slice(0, hash), fragment: href.slice(hash + 1) };
}

function hasScheme(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function isDangerousScheme(href: string): boolean {
  const lower = href.trim().toLowerCase();
  return (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("data:text/html") ||
    lower.startsWith("//")
  );
}

export function resolveMarkdownLink(ownerPath: string, href: string): ResolvedLink {
  const raw = (href || "").trim();
  if (!raw) return { kind: "blocked", reason: "空链接" };
  if (isDangerousScheme(raw)) return { kind: "blocked", reason: "危险协议" };

  if (raw.startsWith("#")) {
    return { kind: "fragment", fragment: decodeMaybe(raw.slice(1)) };
  }

  if (hasScheme(raw)) {
    const lower = raw.toLowerCase();
    if (lower.startsWith("https:") || lower.startsWith("http:") || lower.startsWith("mailto:")) {
      return { kind: "external", href: raw };
    }
    return { kind: "blocked", reason: "不支持的协议" };
  }

  const { pathPart, fragment } = splitHref(raw);
  if (!pathPart) {
    return { kind: "fragment", fragment: decodeMaybe(fragment) };
  }

  const path = normalizeRepoPath(ownerPath, pathPart);
  if (!path) return { kind: "blocked", reason: "路径无效或越界" };
  return { kind: "repo", path, fragment: decodeMaybe(fragment) };
}

export function resolveMarkdownImage(ownerPath: string, src: string): ResolvedImage {
  const raw = (src || "").trim();
  if (!raw) return { kind: "blocked", reason: "空图片地址" };
  if (isDangerousScheme(raw)) return { kind: "blocked", reason: "危险协议" };

  if (SAFE_IMAGE_DATA.test(raw.replace(/\s+/g, ""))) {
    return { kind: "data", href: raw.replace(/\s+/g, "") };
  }
  if (raw.toLowerCase().startsWith("data:")) {
    return { kind: "blocked", reason: "不支持的 data URL" };
  }

  if (hasScheme(raw)) {
    if (raw.toLowerCase().startsWith("https:")) {
      return { kind: "remote", href: raw };
    }
    // http images are not auto-loaded (mixed content / tracking); plan allows HTTPS only for remote images
    return { kind: "blocked", reason: "仅支持 HTTPS 远程图片" };
  }

  const { pathPart } = splitHref(raw);
  const path = normalizeRepoPath(ownerPath, pathPart);
  if (!path) return { kind: "blocked", reason: "路径无效或越界" };
  // Local SVG stays blocked in preview (backend treats as binary; avoid XSS).
  if (/\.svg$/i.test(path)) {
    return { kind: "blocked", reason: "不支持内联本地 SVG" };
  }
  return { kind: "repo", path };
}

export function parentDirsOf(filePath: string): string[] {
  const parts = filePath.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    dirs.push(parts.slice(0, i + 1).join("/"));
  }
  return dirs;
}
