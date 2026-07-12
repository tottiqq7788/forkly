import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalFileContent } from "../../../api";

const fetchFileContent = vi.hoisted(() => vi.fn());
const putFileContent = vi.hoisted(() => vi.fn());
const uploadMarkdownAsset = vi.hoisted(() => vi.fn());
const fetchLocalFileContent = vi.hoisted(() => vi.fn());
const putLocalFileContent = vi.hoisted(() => vi.fn());
const uploadLocalMarkdownAsset = vi.hoisted(() => vi.fn());
const openLocalRelativeFile = vi.hoisted(() => vi.fn());

vi.mock("../../../api", async () => {
  const actual = await vi.importActual<typeof import("../../../api")>("../../../api");
  return {
    ...actual,
    fetchFileContent: (...args: unknown[]) => fetchFileContent(...args),
    putFileContent: (...args: unknown[]) => putFileContent(...args),
    uploadMarkdownAsset: (...args: unknown[]) => uploadMarkdownAsset(...args),
    fetchLocalFileContent: (...args: unknown[]) => fetchLocalFileContent(...args),
    putLocalFileContent: (...args: unknown[]) => putLocalFileContent(...args),
    uploadLocalMarkdownAsset: (...args: unknown[]) => uploadLocalMarkdownAsset(...args),
    openLocalRelativeFile: (...args: unknown[]) => openLocalRelativeFile(...args),
  };
});

const { createLocalDocumentTransport, createProjectDocumentTransport } = await import("./documentTransport");

function localFile(overrides: Partial<LocalFileContent> = {}): LocalFileContent {
  return {
    fileId: "lf1",
    name: "note.md",
    displayPath: "Notes/note.md",
    absPath: "/Users/me/Notes/note.md",
    parentName: "Notes",
    path: "note.md",
    source: "worktree",
    kind: "text",
    content: "# Local",
    editable: true,
    revision: "rev-1",
    size: 7,
    ...overrides,
  };
}

describe("documentTransport", () => {
  beforeEach(() => {
    fetchFileContent.mockReset();
    putFileContent.mockReset();
    uploadMarkdownAsset.mockReset();
    fetchLocalFileContent.mockReset();
    putLocalFileContent.mockReset();
    uploadLocalMarkdownAsset.mockReset();
    openLocalRelativeFile.mockReset();
  });

  it("builds project transport around existing project APIs", async () => {
    const transport = createProjectDocumentTransport({
      projectID: "p1",
      projectName: "demo",
      path: "docs/a.md",
    });

    expect(transport.scopeKey).toBe("project:p1");
    expect(transport.remountKey).toBe("project:p1:docs/a.md");
    expect(transport.displayLabel).toBe("demo");
    expect(transport.displayPath).toBe("docs/a.md");
    expect(transport.titleName).toBe("a.md");
    expect(transport.assetURL("docs/img.png")).toBe(
      "/local-api/v1/projects/p1/asset?source=worktree&path=docs%2Fimg.png",
    );

    await transport.load({ etag: '"rev-1"' });
    expect(fetchFileContent).toHaveBeenCalledWith("p1", "worktree", "docs/a.md", {
      etag: '"rev-1"',
    });

    await transport.save("# x", "rev-1");
    expect(putFileContent).toHaveBeenCalledWith("p1", {
      path: "docs/a.md",
      content: "# x",
      revision: "rev-1",
    });

    const blob = new Blob(["x"], { type: "image/png" });
    await transport.uploadAsset(blob, "img.png");
    expect(uploadMarkdownAsset).toHaveBeenCalledWith("p1", "docs/a.md", blob, "img.png");
    await expect(transport.openRelativeMarkdown?.("docs/b.md")).resolves.toEqual({
      href: "/projects/p1/editor?path=docs%2Fb.md",
    });
    expect(transport.openNonMarkdownHref?.("docs/a.txt")).toBe("/projects/p1?path=docs%2Fa.txt");
  });

  it("builds local transport around local file APIs", async () => {
    openLocalRelativeFile.mockResolvedValue({ fileId: "lf2" });
    const transport = createLocalDocumentTransport({
      fileId: "lf1",
      file: localFile(),
    });

    expect(transport.scopeKey).toBe("local:lf1");
    expect(transport.remountKey).toBe("local:lf1:note.md");
    expect(transport.displayLabel).toBe("本地文件");
    expect(transport.displayPath).toBe("Notes/note.md");
    expect(transport.absPathTooltip).toBe("/Users/me/Notes/note.md");
    expect(transport.assetURL("images/img.png")).toBe(
      "/local-api/v1/local-files/lf1/asset?path=images%2Fimg.png",
    );

    await transport.load({ etag: '"rev-1"' });
    expect(fetchLocalFileContent).toHaveBeenCalledWith("lf1", { etag: '"rev-1"' });

    await transport.save("# local", "rev-1");
    expect(putLocalFileContent).toHaveBeenCalledWith("lf1", {
      content: "# local",
      revision: "rev-1",
    });

    const blob = new Blob(["x"], { type: "image/png" });
    await transport.uploadAsset(blob, "img.png");
    expect(uploadLocalMarkdownAsset).toHaveBeenCalledWith("lf1", blob, "img.png");
    await expect(transport.openRelativeMarkdown?.("docs/next.md")).resolves.toEqual({
      href: "/editor/local/lf2",
    });
    expect(openLocalRelativeFile).toHaveBeenCalledWith("lf1", "docs/next.md");
  });
});
