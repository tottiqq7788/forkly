import {
  CONTENT_NOT_MODIFIED,
  assetURL,
  fetchFileContent,
  fetchLocalFileContent,
  localAssetURL,
  openLocalRelativeFile,
  putFileContent,
  putLocalFileContent,
  uploadLocalMarkdownAsset,
  uploadMarkdownAsset,
  type FileContent,
  type LocalFileContent,
  type UploadAssetResult,
  type WriteContentResult,
} from "../../../api";

export type DocumentTransport = {
  scopeKey: string;
  remountKey: string;
  displayLabel: string;
  displayPath: string;
  titleName: string;
  absPathTooltip?: string;
  markdownPath: string;
  load: (opts?: { etag?: string }) => Promise<FileContent | typeof CONTENT_NOT_MODIFIED>;
  save: (content: string, revision: string) => Promise<WriteContentResult>;
  assetURL: (relPath: string) => string;
  uploadAsset: (file: Blob, filename?: string) => Promise<UploadAssetResult>;
  openRelativeMarkdown?: (relPath: string) => Promise<{ href: string }>;
  openNonMarkdownHref?: (relPath: string) => string;
};

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || normalized || "Markdown";
}

function localDisplayPath(file: Partial<LocalFileContent>): string {
  if (file.displayPath?.trim()) return file.displayPath;
  const name = file.name || basename(file.path || "");
  return file.parentName ? `${file.parentName}/${name}` : name;
}

function localMarkdownPath(file: Partial<LocalFileContent>): string {
  return file.path || file.name || basename(file.displayPath || "");
}

export function createProjectDocumentTransport(args: {
  projectID: string;
  projectName: string;
  path: string;
}): DocumentTransport {
  const { projectID, projectName, path } = args;
  return {
    scopeKey: `project:${projectID}`,
    remountKey: `project:${projectID}:${path}`,
    displayLabel: projectName,
    displayPath: path,
    titleName: basename(path),
    markdownPath: path,
    load: (opts) => fetchFileContent(projectID, "worktree", path, opts),
    save: (content, revision) => putFileContent(projectID, { path, content, revision }),
    assetURL: (relPath) => assetURL(projectID, "worktree", relPath),
    uploadAsset: (file, filename) => uploadMarkdownAsset(projectID, path, file, filename),
    openRelativeMarkdown: async (relPath) => ({
      href: `/projects/${projectID}/editor?path=${encodeURIComponent(relPath)}`,
    }),
    openNonMarkdownHref: (relPath) => `/projects/${projectID}?path=${encodeURIComponent(relPath)}`,
  };
}

export function createLocalDocumentTransport(args: {
  fileId: string;
  file: LocalFileContent;
}): DocumentTransport {
  const { fileId, file } = args;
  const absPath = file.absPath?.trim() || "";
  const displayPath = absPath || localDisplayPath(file);
  const markdownPath = localMarkdownPath(file);
  const titleName = file.name || basename(displayPath);
  return {
    scopeKey: `local:${fileId}`,
    remountKey: `local:${fileId}:${markdownPath}`,
    displayLabel: "",
    displayPath,
    titleName,
    absPathTooltip: absPath || undefined,
    markdownPath,
    load: (opts) => fetchLocalFileContent(fileId, opts),
    save: (content, revision) => putLocalFileContent(fileId, { content, revision }),
    assetURL: (relPath) => localAssetURL(fileId, relPath),
    uploadAsset: (fileBlob, filename) => uploadLocalMarkdownAsset(fileId, fileBlob, filename),
    openRelativeMarkdown: async (relPath) => {
      const next = await openLocalRelativeFile(fileId, relPath);
      return { href: `/editor/local/${encodeURIComponent(next.fileId)}` };
    },
  };
}
