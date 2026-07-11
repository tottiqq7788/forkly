import { describe, expect, it } from "vitest";
import {
  normalizeRepoPath,
  resolveMarkdownImage,
  resolveMarkdownLink,
  parentDirsOf,
  forklyUrlTransform,
} from "./markdownPath";

describe("normalizeRepoPath", () => {
  it("resolves same-dir and parent paths", () => {
    expect(normalizeRepoPath("docs/guide.md", "./a.png")).toBe("docs/a.png");
    expect(normalizeRepoPath("docs/guide.md", "../img/b.webp")).toBe("img/b.webp");
  });

  it("treats leading slash as project root", () => {
    expect(normalizeRepoPath("docs/guide.md", "/assets/c.jpg")).toBe("assets/c.jpg");
  });

  it("supports chinese and spaces via decode", () => {
    expect(normalizeRepoPath("docs/x.md", "./%E4%B8%AD%E6%96%87.png")).toBe("docs/中文.png");
    expect(normalizeRepoPath("docs/x.md", "./my%20file.png")).toBe("docs/my file.png");
  });

  it("normalizes windows separators", () => {
    expect(normalizeRepoPath("docs/x.md", ".\\assets\\a.png")).toBe("docs/assets/a.png");
  });

  it("rejects root escape and .git", () => {
    expect(normalizeRepoPath("a.md", "../../etc/passwd")).toBeNull();
    expect(normalizeRepoPath("a.md", "../.git/config")).toBeNull();
    expect(normalizeRepoPath("a.md", ".git/HEAD")).toBeNull();
    expect(normalizeRepoPath("a.md", ".GIT/config")).toBeNull();
    expect(normalizeRepoPath("a.md", ".Git/HEAD")).toBeNull();
    expect(resolveMarkdownLink("a.md", ".GIT/config").kind).toBe("blocked");
    expect(resolveMarkdownImage("a.md", ".GIT/HEAD").kind).toBe("blocked");
  });
});

describe("resolveMarkdownLink", () => {
  it("handles fragment, repo, and external links", () => {
    expect(resolveMarkdownLink("docs/a.md", "#标题")).toEqual({
      kind: "fragment",
      fragment: "标题",
    });
    expect(resolveMarkdownLink("docs/a.md", "./b.md#sec")).toEqual({
      kind: "repo",
      path: "docs/b.md",
      fragment: "sec",
    });
    expect(resolveMarkdownLink("docs/a.md", "https://example.com")).toEqual({
      kind: "external",
      href: "https://example.com",
    });
    expect(resolveMarkdownLink("docs/a.md", "mailto:a@b.com").kind).toBe("external");
  });

  it("blocks dangerous schemes and protocol-relative urls", () => {
    expect(resolveMarkdownLink("a.md", "javascript:alert(1)").kind).toBe("blocked");
    expect(resolveMarkdownLink("a.md", "  javascript:alert(1)").kind).toBe("blocked");
    expect(resolveMarkdownLink("a.md", "vbscript:x").kind).toBe("blocked");
    expect(resolveMarkdownLink("a.md", "file:///etc/passwd").kind).toBe("blocked");
    expect(resolveMarkdownLink("a.md", "//evil.example/x").kind).toBe("blocked");
  });
});

describe("resolveMarkdownImage", () => {
  it("allows repo, https, and safe data urls", () => {
    expect(resolveMarkdownImage("docs/a.md", "./x.png")).toEqual({
      kind: "repo",
      path: "docs/x.png",
    });
    expect(resolveMarkdownImage("docs/a.md", "https://cdn.example/a.png")).toEqual({
      kind: "remote",
      href: "https://cdn.example/a.png",
    });
    const data = "data:image/png;base64,aaaa";
    expect(resolveMarkdownImage("docs/a.md", data).kind).toBe("data");
  });

  it("blocks http, svg, and dangerous data", () => {
    expect(resolveMarkdownImage("a.md", "http://example.com/a.png").kind).toBe("blocked");
    expect(resolveMarkdownImage("a.md", "./icon.svg").kind).toBe("blocked");
    expect(resolveMarkdownImage("a.md", "data:text/html;base64,xxxx").kind).toBe("blocked");
  });
});

describe("parentDirsOf", () => {
  it("lists ancestors", () => {
    expect(parentDirsOf("a/b/c.md")).toEqual(["a", "a/b"]);
    expect(parentDirsOf("c.md")).toEqual([]);
  });
});

describe("forklyUrlTransform", () => {
  it("keeps safe data images and strips dangerous schemes", () => {
    expect(forklyUrlTransform("data:image/png;base64,aaaa")).toBe("data:image/png;base64,aaaa");
    expect(forklyUrlTransform("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(forklyUrlTransform("./rel.png")).toBe("./rel.png");
    expect(forklyUrlTransform("javascript:alert(1)")).toBe("");
    expect(forklyUrlTransform("data:text/html;base64,xxxx")).toBe("");
  });
});
