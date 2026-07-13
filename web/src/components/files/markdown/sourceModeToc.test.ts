import { describe, expect, it, vi } from "vitest";
import { findMarkdownHeadingLine, scrollSourceEditorToLine } from "./sourceModeToc";

describe("findMarkdownHeadingLine", () => {
  it("finds ATX headings by index and skips fenced code", () => {
    const md = [
      "# One",
      "",
      "```",
      "# not a heading",
      "```",
      "",
      "## Two",
      "paragraph",
      "### Three",
    ].join("\n");

    expect(findMarkdownHeadingLine(md, 0)).toBe(0);
    expect(findMarkdownHeadingLine(md, 1)).toBe(6);
    expect(findMarkdownHeadingLine(md, 2)).toBe(8);
    expect(findMarkdownHeadingLine(md, 3)).toBe(-1);
  });

  it("supports setext headings", () => {
    const md = ["Title", "=====", "", "Sub", "-----"].join("\n");
    expect(findMarkdownHeadingLine(md, 0)).toBe(0);
    expect(findMarkdownHeadingLine(md, 1)).toBe(3);
  });
});

describe("scrollSourceEditorToLine", () => {
  it("sets cursor and scrolls the outer container", () => {
    const setCursor = vi.fn();
    const heightAtLine = vi.fn(() => 240);
    const scrollTo = vi.fn();
    scrollSourceEditorToLine(
      { setCursor, heightAtLine },
      4,
      { scrollTo } as unknown as HTMLElement,
    );
    expect(setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 }, null, { scroll: false });
    expect(heightAtLine).toHaveBeenCalledWith(4, "local");
    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "smooth" });
  });
});
