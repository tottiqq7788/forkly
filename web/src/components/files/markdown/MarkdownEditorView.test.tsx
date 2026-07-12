import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("@muyajs/core", () => {
  class FakeMuya {
    constructor(_el: HTMLElement, _options: Record<string, unknown>) {}
    init() {}
    destroy() {}
    hideAllFloatTools() {}
    on() {}
    off() {}
    flush() {}
    getTOC() {
      return [];
    }
    scrollToHeading() {
      return false;
    }
    getMarkdown() {
      return "# hello";
    }
    get domNode() {
      return document.createElement("div");
    }
    setContent() {}
    format() {}
    updateParagraph() {}
    undo() {}
    redo() {}
    search() {
      return { matches: [], index: -1 };
    }
    find() {
      return { matches: [], index: -1 };
    }
    replace() {
      return { matches: [], index: -1 };
    }
    focus() {}
  }
  const plugin = (name: string) =>
    class {
      static pluginName = name;
    };
  return {
    Muya: FakeMuya,
    zhCN: { name: "zh-CN", resource: {} },
    TableChessboard: plugin("tablePicker"),
    ParagraphQuickInsertMenu: plugin("quickInsert"),
    CodeBlockLanguageSelector: plugin("codePicker"),
    EmojiSelector: plugin("emojiPicker"),
    ImagePathPicker: plugin("imagePathPicker"),
    ImageEditTool: plugin("imageSelector"),
    ImageResizeBar: plugin("imageResizeBar"),
    ImageToolBar: plugin("imageToolbar"),
    InlineFormatToolbar: plugin("formatPicker"),
    ParagraphFrontButton: plugin("frontMenuButton"),
    ParagraphFrontMenu: plugin("frontMenu"),
    PreviewToolBar: plugin("previewTools"),
    LinkTools: plugin("linkTools"),
    FootnoteTool: plugin("footnoteTool"),
    TableColumnToolbar: plugin("tableColumnTools"),
    TableDragBar: plugin("tableDragBar"),
    TableRowColumMenu: plugin("tableRowColumMenu"),
  };
});

// tsconfig paths map the package to this shim during tests.
vi.mock("../../../shims/muyajs-core", async () => import("@muyajs/core"));

const { MarkdownEditorView } = await import("./MarkdownEditorView");

describe("MarkdownEditorView", () => {
  it("creates an imperative mount node and removes it on unmount (StrictMode)", async () => {
    const { container, unmount } = render(
      <StrictMode>
        <MarkdownEditorView markdown="# hello" projectID="p1" markdownPath="a.md" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(container.querySelector(".forkly-muya-mount")).toBeTruthy();
    });

    unmount();
    expect(container.querySelector(".forkly-muya-mount")).toBeNull();
  });
});
