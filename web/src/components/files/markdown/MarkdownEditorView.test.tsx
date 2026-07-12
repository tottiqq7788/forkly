import { createRef, StrictMode, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { MarkdownEditorHandle } from "./MarkdownEditorView";

const muyaState = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
}));

vi.mock("@muyajs/core", () => {
  class FakeMuya {
    domNode: HTMLElement;

    constructor(el: HTMLElement, options: Record<string, unknown>) {
      this.domNode = el;
      muyaState.options = options;
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

function editorProps(overrides: Partial<ComponentProps<typeof MarkdownEditorView>> = {}) {
  return {
    markdown: "# hello",
    documentKey: "project:p1:a.md",
    markdownPath: "a.md",
    assetURL: (path: string) => `/asset/${path}`,
    uploadAsset: async () => ({
      path: "images/image.png",
      relativePath: "images/image.png",
      mime: "image/png",
      size: 1,
    }),
    ...overrides,
  };
}

describe("MarkdownEditorView", () => {
  it("creates an imperative mount node and removes it on unmount (StrictMode)", async () => {
    const { container, unmount } = render(
      <StrictMode>
        <MarkdownEditorView {...editorProps()} />
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
      render(<MarkdownEditorView ref={ref} {...editorProps()} />);

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

  it("uses injected asset callbacks for relative images and uploads", async () => {
    const assetURL = vi.fn((path: string) => `/local-asset/${path}`);
    const uploadAsset = vi.fn(async (_file: Blob, filename?: string) => ({
      path: `images/${filename || "image.png"}`,
      relativePath: `images/${filename || "image.png"}`,
      mime: "image/png",
      size: 1,
    }));

    render(
      <MarkdownEditorView
        {...editorProps({
          documentKey: "local:file-1:docs/a.md",
          markdownPath: "docs/a.md",
          assetURL,
          uploadAsset,
        })}
      />,
    );

    await waitFor(() => {
      expect(muyaState.options).toBeTruthy();
    });

    const imageSrcResolver = muyaState.options?.imageSrcResolver as (src: string) => string | null;
    expect(imageSrcResolver("./img.png")).toBe("/local-asset/docs/img.png");
    expect(assetURL).toHaveBeenCalledWith("docs/img.png");

    const imageAction = muyaState.options?.imageAction as (state: {
      src: string;
      alt: string;
      title: string;
    }) => Promise<string>;
    const uploaded = await imageAction({
      src: `data:image/png;base64,${window.btoa("x")}`,
      alt: "",
      title: "",
    });

    expect(uploadAsset).toHaveBeenCalledTimes(1);
    expect(uploaded).toBe("images/image.png");
  });
});
