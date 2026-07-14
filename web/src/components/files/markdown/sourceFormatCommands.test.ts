import { describe, expect, it } from "vitest";
import {
  applyBlockFormat,
  applyInlineFormat,
  applySourceFormatCommand,
  insertSnippet,
} from "./sourceFormatCommands";

const caret = (line = 0, ch = 0) => ({
  anchor: { line, ch },
  head: { line, ch },
});

const range = (fromLine: number, fromCh: number, toLine: number, toCh: number) => ({
  anchor: { line: fromLine, ch: fromCh },
  head: { line: toLine, ch: toCh },
});

describe("sourceFormatCommands inline", () => {
  it("wraps a selection in bold and toggles off", () => {
    const wrapped = applyInlineFormat("hello world", range(0, 6, 0, 11), "strong");
    expect(wrapped.text).toBe("hello **world**");
    expect(wrapped.selection).toEqual(range(0, 6, 0, 15));

    const unwrapped = applyInlineFormat(wrapped.text, range(0, 6, 0, 15), "strong");
    expect(unwrapped.text).toBe("hello world");
  });

  it("inserts empty bold markers at the caret", () => {
    const result = applyInlineFormat("hi", caret(0, 2), "strong");
    expect(result.text).toBe("hi****");
    expect(result.selection).toEqual(caret(0, 4));
  });

  it("wraps with italics, strike, code, and math", () => {
    expect(applyInlineFormat("x", range(0, 0, 0, 1), "em").text).toBe("*x*");
    expect(applyInlineFormat("x", range(0, 0, 0, 1), "del").text).toBe("~~x~~");
    expect(applyInlineFormat("x", range(0, 0, 0, 1), "inline_code").text).toBe("`x`");
    expect(applyInlineFormat("x", range(0, 0, 0, 1), "inline_math").text).toBe("$x$");
  });

  it("inserts a link and places the caret inside the URL", () => {
    const result = applyInlineFormat("docs", range(0, 0, 0, 4), "link");
    expect(result.text).toBe("[docs]()");
    expect(result.selection).toEqual(caret(0, 7));
  });

  it("inserts an image template with optional selection label", () => {
    const empty = applyInlineFormat("", caret(), "image");
    expect(empty.text).toBe("![描述]()");
    expect(empty.selection).toEqual(caret(0, 6));

    const labeled = applyInlineFormat("shot", range(0, 0, 0, 4), "image");
    expect(labeled.text).toBe("![shot]()");
  });
});

describe("sourceFormatCommands block", () => {
  it("applies and toggles heading levels", () => {
    const h2 = applyBlockFormat("Title", caret(0, 0), "heading 2");
    expect(h2.text).toBe("## Title");

    const back = applyBlockFormat(h2.text, caret(0, 3), "heading 2");
    expect(back.text).toBe("Title");
  });

  it("converts between list types and paragraph", () => {
    const bullet = applyBlockFormat("item", caret(), "ul-bullet");
    expect(bullet.text).toBe("- item");

    const ordered = applyBlockFormat(bullet.text, caret(), "ol-order");
    expect(ordered.text).toBe("1. item");

    const task = applyBlockFormat(ordered.text, caret(), "ul-task");
    expect(task.text).toBe("- [ ] item");

    const plain = applyBlockFormat(task.text, caret(), "paragraph");
    expect(plain.text).toBe("item");
  });

  it("applies blockquote prefixes across a multi-line selection", () => {
    const result = applyBlockFormat("a\nb", range(0, 0, 1, 1), "blockquote");
    expect(result.text).toBe("> a\n> b");
  });

  it("inserts fenced code, math, table, and hr templates", () => {
    expect(applyBlockFormat("", caret(), "pre").text).toBe("```\n\n```");
    expect(applyBlockFormat("", caret(), "mathblock").text).toBe("$$\n\n$$");
    expect(applyBlockFormat("", caret(), "hr").text).toBe("---\n\n");
    expect(applyBlockFormat("", caret(), "table").text).toContain("| 列1 | 列2 |");
  });

  it("inserts a leading newline when the caret is mid-line for templates", () => {
    const result = applyBlockFormat("abc", caret(0, 1), "hr");
    expect(result.text).toBe("a\n---\n\nbc");
  });
});

describe("sourceFormatCommands command router", () => {
  it("routes FormatCommand strings for inline and para commands", () => {
    expect(applySourceFormatCommand("hi", caret(0, 2), "strong")?.text).toBe("hi****");
    expect(applySourceFormatCommand("Title", caret(), "para:heading 1")?.text).toBe("# Title");
    expect(applySourceFormatCommand("x", caret(), "undo")).toBeNull();
  });

  it("inserts a snippet with a selectable sub-range", () => {
    const result = insertSnippet("hello", caret(0, 5), "![描述](地址)", { start: 6, end: 8 });
    expect(result.text).toBe("hello![描述](地址)");
    expect(result.selection).toEqual(range(0, 11, 0, 13));
  });

  it("sanitizes labels that would break markdown link syntax", () => {
    const result = applyInlineFormat("a]b\nc", range(0, 0, 1, 1), "link");
    expect(result.text).toBe("[a b c]()");
  });
});
