/**
 * Typecheck-only shim for `@muyajs/core`.
 * Vite resolves the real package from node_modules; `tsc` uses this via tsconfig paths
 * so it does not typecheck vendored Muya sources.
 */

export type ILocale = {
  name: string;
  resource: Record<string, string>;
};

export const zhCN: ILocale = { name: "zh-CN", resource: {} };

export class Muya {
  options: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_element: HTMLElement, _options?: Record<string, unknown>) {}
  init() {}
  destroy() {}
  flush() {}
  getMarkdown() {
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setContent(_content: string | unknown[], _autoFocus?: boolean) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  format(_type: string) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateParagraph(_type: string) {}
  undo() {}
  redo() {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  search(_value: string, _opts?: Record<string, unknown>) {
    return { matches: [] as unknown[], index: -1 };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  find(_action: "previous" | "next") {
    return { matches: [] as unknown[], index: -1 };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  replace(_replaceValue: string, _opt?: { isSingle?: boolean; isRegexp?: boolean }) {
    return { matches: [] as unknown[], index: -1 };
  }
  hideAllFloatTools() {}
  focus() {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  on(_event: string, _listener: (...args: unknown[]) => void) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  off(_event: string, _listener: (...args: unknown[]) => void) {}
}

type PluginCtor = {
  pluginName: string;
  new (muya: unknown, options?: Record<string, unknown>): unknown;
};

function plugin(name: string): PluginCtor {
  return class {
    static pluginName = name;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_muya: unknown, _options?: Record<string, unknown>) {}
  };
}

export const TableChessboard = plugin("tablePicker");
export const ParagraphQuickInsertMenu = plugin("quickInsert");
export const CodeBlockLanguageSelector = plugin("codePicker");
export const EmojiSelector = plugin("emojiPicker");
export const ImagePathPicker = plugin("imagePathPicker");
export const ImageEditTool = plugin("imageSelector");
export const ImageResizeBar = plugin("imageResizeBar");
export const ImageToolBar = plugin("imageToolbar");
export const InlineFormatToolbar = plugin("formatPicker");
export const ParagraphFrontButton = plugin("frontMenuButton");
export const ParagraphFrontMenu = plugin("frontMenu");
export const PreviewToolBar = plugin("previewTools");
export const LinkTools = plugin("linkTools");
export const FootnoteTool = plugin("footnoteTool");
export const TableColumnToolbar = plugin("tableColumnTools");
export const TableDragBar = plugin("tableDragBar");
export const TableRowColumMenu = plugin("tableRowColumMenu");
