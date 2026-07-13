import { describe, expect, it, vi } from "vitest";
import {
  copyHeadingAnchor,
  copyHeadingMarkdownLink,
  escapeMarkdownLinkLabel,
  headingAnchorForClipboard,
  headingMarkdownLinkForClipboard,
} from "./copyHeadingAnchor";
import {
  collectCollapsibleTocSlugs,
  formatTocOutlineMarkdown,
  hasTocChildren,
  isTocItemVisible,
  pruneCollapsedTocSlugs,
  visibleTocIndexes,
} from "./tocTree";

describe("headingAnchorForClipboard", () => {
  const toc = [
    { slug: "uid-1", githubSlug: "getting-started", content: "Getting Started" },
    { slug: "uid-2", githubSlug: "api", content: "API" },
  ];

  it("returns #githubSlug for a unique matching stable slug", () => {
    expect(headingAnchorForClipboard(toc, "uid-1")).toBe("#getting-started");
  });

  it("returns null when the key is missing", () => {
    expect(headingAnchorForClipboard(toc, "missing")).toBeNull();
  });

  it("returns null when githubSlug is empty", () => {
    expect(headingAnchorForClipboard([{ slug: "a", githubSlug: "" }], "a")).toBeNull();
  });

  it("returns null when githubSlug is duplicated", () => {
    const dup = [
      { slug: "a", githubSlug: "same", content: "A" },
      { slug: "b", githubSlug: "same", content: "B" },
    ];
    expect(headingAnchorForClipboard(dup, "a")).toBeNull();
    expect(headingAnchorForClipboard(dup, "b")).toBeNull();
  });
});

describe("headingMarkdownLinkForClipboard", () => {
  it("builds a markdown link for unique anchors", () => {
    expect(
      headingMarkdownLinkForClipboard(
        [{ slug: "uid-1", githubSlug: "hello", content: "Hello" }],
        "uid-1",
      ),
    ).toBe("[Hello](#hello)");
  });

  it("escapes brackets and backslashes in the link label", () => {
    expect(escapeMarkdownLinkLabel(`a[b]\\c`)).toBe(`a\\[b\\]\\\\c`);
    expect(
      headingMarkdownLinkForClipboard(
        [{ slug: "uid-1", githubSlug: "x", content: "A [B] \\C" }],
        "uid-1",
      ),
    ).toBe("[A \\[B\\] \\\\C](#x)");
  });

  it("returns null for empty or duplicate anchors", () => {
    expect(
      headingMarkdownLinkForClipboard([{ slug: "a", githubSlug: "", content: "中文" }], "a"),
    ).toBeNull();
    expect(
      headingMarkdownLinkForClipboard(
        [
          { slug: "a", githubSlug: "same", content: "A" },
          { slug: "b", githubSlug: "same", content: "B" },
        ],
        "a",
      ),
    ).toBeNull();
  });
});

describe("copyHeadingAnchor / copyHeadingMarkdownLink", () => {
  it("writes the anchor to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(
      copyHeadingAnchor([{ slug: "uid-1", githubSlug: "hello" }], "uid-1"),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("#hello");
  });

  it("writes the markdown link to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(
      copyHeadingMarkdownLink(
        [{ slug: "uid-1", githubSlug: "hello", content: "Hello" }],
        "uid-1",
      ),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("[Hello](#hello)");
  });

  it("skips clipboard when TOC lookup fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyHeadingAnchor([], "uid-1")).resolves.toBe(false);
    await expect(copyHeadingMarkdownLink([], "uid-1")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("tocTree helpers", () => {
  const items = [
    { slug: "a", content: "A", lvl: 1 },
    { slug: "b", content: "B", lvl: 2 },
    { slug: "c", content: "C", lvl: 3 },
    { slug: "d", content: "D", lvl: 2 },
    { slug: "e", content: "E", lvl: 1 },
  ];

  it("detects collapsible headings and formats outline markdown", () => {
    expect(hasTocChildren(items, 0)).toBe(true);
    expect(hasTocChildren(items, 2)).toBe(false);
    expect(collectCollapsibleTocSlugs(items)).toEqual(["a", "b"]);
    expect(formatTocOutlineMarkdown(items)).toBe(
      ["- A", "  - B", "    - C", "  - D", "- E"].join("\n"),
    );
  });

  it("hides descendants of collapsed ancestors and prunes stale slugs", () => {
    const collapsed = new Set(["a"]);
    expect(isTocItemVisible(items, 0, collapsed)).toBe(true);
    expect(isTocItemVisible(items, 1, collapsed)).toBe(false);
    expect(isTocItemVisible(items, 4, collapsed)).toBe(true);
    expect(visibleTocIndexes(items, collapsed)).toEqual([0, 4]);

    const pruned = pruneCollapsedTocSlugs(
      [
        { slug: "e", content: "E", lvl: 1 },
        { slug: "f", content: "F", lvl: 1 },
      ],
      new Set(["a", "e"]),
    );
    expect([...pruned]).toEqual([]);
  });

  it("does not hide other branches when a sibling heading is collapsed", () => {
    const tree = [
      { slug: "a", content: "A", lvl: 1 },
      { slug: "b", content: "B", lvl: 2 },
      { slug: "c", content: "C", lvl: 3 },
      { slug: "d", content: "D", lvl: 2 },
      { slug: "e", content: "E", lvl: 3 },
    ];
    const collapsed = new Set(["b"]);
    expect(visibleTocIndexes(tree, collapsed)).toEqual([0, 1, 3, 4]);
    expect(isTocItemVisible(tree, 2, collapsed)).toBe(false);
    expect(isTocItemVisible(tree, 4, collapsed)).toBe(true);
  });
});
