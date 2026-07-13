import { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchCursorFindNext = vi.fn();
const cmApi = {
  getValue: vi.fn(() => "# Title\n\nbody"),
  setValue: vi.fn(),
  getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
  setCursor: vi.fn(),
  setSelection: vi.fn(),
  getScrollInfo: vi.fn(() => ({ left: 0, top: 0 })),
  scrollTo: vi.fn(),
  focus: vi.fn(),
  execCommand: vi.fn(),
  heightAtLine: vi.fn(() => 12),
  on: vi.fn(),
  getSearchCursor: vi.fn(() => ({
    findNext: searchCursorFindNext,
    from: () => ({ line: 0, ch: 2 }),
    to: () => ({ line: 0, ch: 7 }),
  })),
  replaceRange: vi.fn(),
};

vi.mock("codemirror", () => {
  const factory = vi.fn(() => cmApi);
  return { default: factory };
});

vi.mock("codemirror/lib/codemirror.css", () => ({}));
vi.mock("codemirror/mode/markdown/markdown", () => ({}));
vi.mock("codemirror/addon/search/searchcursor", () => ({}));
vi.mock("codemirror/addon/selection/active-line", () => ({}));

const { MarkdownSourceEditorView } = await import("./MarkdownSourceEditorView");
type Handle = import("./MarkdownSourceEditorView").MarkdownSourceEditorHandle;

describe("MarkdownSourceEditorView", () => {
  beforeEach(() => {
    searchCursorFindNext.mockReset();
    searchCursorFindNext.mockReturnValueOnce(true).mockReturnValue(false);
    cmApi.getValue.mockReset();
    cmApi.setValue.mockReset();
    cmApi.getCursor.mockReset();
    cmApi.setCursor.mockReset();
    cmApi.setSelection.mockReset();
    cmApi.getScrollInfo.mockReset();
    cmApi.scrollTo.mockReset();
    cmApi.focus.mockReset();
    cmApi.execCommand.mockReset();
    cmApi.heightAtLine.mockReset();
    cmApi.on.mockReset();
    cmApi.getSearchCursor.mockReset();
    cmApi.replaceRange.mockReset();

    cmApi.getValue.mockReturnValue("# Title\n\nbody");
    cmApi.getCursor.mockReturnValue({ line: 0, ch: 0 });
    cmApi.getScrollInfo.mockReturnValue({ left: 0, top: 0 });
    cmApi.heightAtLine.mockReturnValue(12);
    cmApi.getSearchCursor.mockReturnValue({
      findNext: searchCursorFindNext,
      from: () => ({ line: 0, ch: 2 }),
      to: () => ({ line: 0, ch: 7 }),
    });
  });

  it("exposes get/set value, cursor, and search/undo commands", async () => {
    const ref = createRef<Handle>();
    render(<MarkdownSourceEditorView ref={ref} markdown="# Title\n\nbody" />);

    await waitFor(() => {
      expect(ref.current).toBeTruthy();
    });

    expect(ref.current?.getValue()).toBe("# Title\n\nbody");

    ref.current?.setValue("# Updated");
    expect(cmApi.setValue).toHaveBeenCalledWith("# Updated");

    ref.current?.setIndexCursor({
      anchor: { line: 0, ch: 2 },
      focus: { line: 0, ch: 5 },
    });
    expect(cmApi.setSelection).toHaveBeenCalledWith(
      { line: 0, ch: 2 },
      { line: 0, ch: 5 },
      { scroll: true },
    );

    cmApi.getCursor.mockImplementation((side?: string) =>
      side === "anchor" ? { line: 0, ch: 2 } : { line: 0, ch: 5 },
    );
    expect(ref.current?.getIndexCursor()).toEqual({
      anchor: { line: 0, ch: 2 },
      focus: { line: 0, ch: 5 },
    });

    ref.current?.undo();
    ref.current?.redo();
    expect(cmApi.execCommand).toHaveBeenCalledWith("undo");
    expect(cmApi.execCommand).toHaveBeenCalledWith("redo");

    const result = ref.current?.search("Title");
    expect(result?.index).toBe(0);
    expect(result?.matches).toHaveLength(1);
  });
});
