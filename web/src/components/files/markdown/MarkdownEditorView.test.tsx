import { createRef, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { MarkdownEditorHandle } from "./MarkdownEditorView";

vi.mock("@muyajs/core", () => {
  class FakeMuya {
    domNode: HTMLElement;

    constructor(el: HTMLElement, _options: Record<string, unknown>) {
      this.domNode = el;
    }

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
    setContent() {}
    format() {}
    updateParagraph() {}
    undo() {}
    redo() {}
    setActiveSearchMatch() {
      this.domNode.innerHTML = '<span class="mu-highlight">hello</span>';
      return { matches: [{ block: { domNode: this.domNode }, start: 0, end: 5 }], index: 0 };
    }
    search(value: string) {
      if (!value) {
        this.domNode.innerHTML = "";
        return { matches: [], index: -1 };
      }
      return this.setActiveSearchMatch();
    }
    find() {
      return this.setActiveSearchMatch();
    }
    replace() {
      return this.setActiveSearchMatch();
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

  it("scrolls the active search match after search navigation and replace", async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      render(<MarkdownEditorView ref={ref} markdown="# hello" projectID="p1" markdownPath="a.md" />);

      await waitFor(() => {
        expect(ref.current).toBeTruthy();
      });

      ref.current?.search("hello");
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          block: "center",
          inline: "nearest",
          behavior: "smooth",
        });
      });

      scrollIntoView.mockClear();
      ref.current?.find("next");
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });

      scrollIntoView.mockClear();
      ref.current?.replace("hi", { isSingle: true });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
