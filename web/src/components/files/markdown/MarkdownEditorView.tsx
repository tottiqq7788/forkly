import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from "react";
import { assetURL, uploadMarkdownAsset } from "../../../api";
import { resolveMarkdownImage, resolveMarkdownLink } from "./markdownPath";
import "./markdown-editor.css";

export type MarkdownEditorHandle = {
  flush: () => void;
  getMarkdown: () => string;
  format: (type: string) => void;
  updateParagraph: (type: string) => void;
  undo: () => void;
  redo: () => void;
  search: (value: string, opts?: SearchOpts) => SearchResult;
  find: (action: "previous" | "next") => SearchResult;
  replace: (value: string, opt?: { isSingle?: boolean; isRegexp?: boolean }) => SearchResult;
  hideAllFloatTools: () => void;
  focus: () => void;
  setContent: (markdown: string) => void;
};

export type SearchOpts = {
  isCaseSensitive?: boolean;
  isWholeWord?: boolean;
  isRegexp?: boolean;
};

export type SearchResult = {
  matches: unknown[];
  index: number;
};

type Props = {
  markdown: string;
  projectID: string;
  markdownPath: string;
  hidden?: boolean;
  onChange?: () => void;
  onOpenPath?: (path: string, fragment?: string) => void;
  onReady?: () => void;
  onError?: (err: Error) => void;
};

type MuyaInstance = {
  init: () => void;
  destroy: () => void;
  flush: () => void;
  getMarkdown: () => string;
  format: (type: string) => void;
  updateParagraph: (type: string) => void;
  undo: () => void;
  redo: () => void;
  search: (value: string, opts?: SearchOpts) => SearchResult;
  find: (action: "previous" | "next") => SearchResult;
  replace: (value: string, opt?: { isSingle?: boolean; isRegexp?: boolean }) => SearchResult;
  hideAllFloatTools: () => void;
  focus: () => void;
  setContent: (content: string, autoFocus?: boolean) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  off: (event: string, listener: (...args: unknown[]) => void) => void;
  options: Record<string, unknown>;
};

const SAFE_UPLOAD_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,/i;
const EMPTY_SEARCH: SearchResult = { matches: [], index: -1 };

function isDarkTheme(): boolean {
  const root = document.documentElement;
  if (root.dataset.theme === "dark") return true;
  if (root.dataset.theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function dataURLtoBlob(dataURL: string): Blob | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataURL.replace(/\s+/g, ""));
  if (!m) return null;
  const mime = m[1]!;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function extForMime(mime: string): string {
  if (/jpeg/i.test(mime)) return "jpg";
  if (/png/i.test(mime)) return "png";
  if (/gif/i.test(mime)) return "gif";
  if (/webp/i.test(mime)) return "webp";
  return "png";
}

function stripPlantUMLFromQuickInsert(muya: MuyaInstance) {
  // ParagraphQuickInsertMenu stores renderData; filter plantuml after init.
  const plugins = (muya as unknown as { _uiPlugins?: Record<string, { renderData?: unknown }> })
    ._uiPlugins;
  const qi = plugins?.quickInsert as
    | { renderData?: { name: string; children: { label: string }[] }[] }
    | undefined;
  if (!qi?.renderData) return;
  qi.renderData = qi.renderData
    .map((group) => ({
      ...group,
      children: group.children.filter((c) => c.label !== "diagram plantuml"),
    }))
    .filter((group) => group.children.length > 0);
}

export const MarkdownEditorView = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditorView(
  { markdown, projectID, markdownPath, hidden = false, onChange, onOpenPath, onReady, onError },
  ref,
) {
  const outerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const muyaRef = useRef<MuyaInstance | null>(null);
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onOpenPathRef = useRef(onOpenPath);
  onOpenPathRef.current = onOpenPath;
  const projectIDRef = useRef(projectID);
  projectIDRef.current = projectID;
  const pathRef = useRef(markdownPath);
  pathRef.current = markdownPath;

  useImperativeHandle(ref, () => ({
    flush: () => muyaRef.current?.flush(),
    getMarkdown: () => muyaRef.current?.getMarkdown() ?? markdownRef.current,
    format: (type) => muyaRef.current?.format(type),
    updateParagraph: (type) => muyaRef.current?.updateParagraph(type),
    undo: () => muyaRef.current?.undo(),
    redo: () => muyaRef.current?.redo(),
    search: (value, opts) => muyaRef.current?.search(value, opts) ?? EMPTY_SEARCH,
    find: (action) => muyaRef.current?.find(action) ?? EMPTY_SEARCH,
    replace: (value, opt) => muyaRef.current?.replace(value, opt) ?? EMPTY_SEARCH,
    hideAllFloatTools: () => muyaRef.current?.hideAllFloatTools(),
    focus: () => muyaRef.current?.focus(),
    setContent: (md) => muyaRef.current?.setContent(md),
  }));

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const mount = document.createElement("div");
    mount.className = "forkly-muya-mount";
    mount.style.minHeight = "200px";
    outer.appendChild(mount);
    mountRef.current = mount;

    let cancelled = false;
    let muya: MuyaInstance | null = null;
    let changeHandler: ((...args: unknown[]) => void) | null = null;
    let ro: ResizeObserver | null = null;

    void (async () => {
      try {
        const mod = await import("@muyajs/core");
        if (cancelled || !mountRef.current) return;

        const {
          Muya,
          zhCN,
          TableChessboard,
          ParagraphQuickInsertMenu,
          CodeBlockLanguageSelector,
          EmojiSelector,
          ImagePathPicker,
          ImageEditTool,
          ImageResizeBar,
          ImageToolBar,
          InlineFormatToolbar,
          ParagraphFrontButton,
          ParagraphFrontMenu,
          PreviewToolBar,
          LinkTools,
          FootnoteTool,
          TableColumnToolbar,
          TableDragBar,
          TableRowColumMenu,
        } = mod;

        const dark = isDarkTheme();
        const plugins = [
          { plugin: TableChessboard },
          { plugin: ParagraphQuickInsertMenu },
          { plugin: CodeBlockLanguageSelector },
          { plugin: EmojiSelector },
          { plugin: ImagePathPicker },
          { plugin: ImageEditTool },
          { plugin: ImageResizeBar },
          { plugin: ImageToolBar },
          { plugin: InlineFormatToolbar },
          { plugin: ParagraphFrontButton },
          { plugin: ParagraphFrontMenu },
          { plugin: PreviewToolBar },
          {
            plugin: LinkTools,
            options: {
              jumpClick: (linkInfo: { href?: string | null } | null) => {
                const href = linkInfo?.href?.trim() || "";
                if (!href) return;
                const resolved = resolveMarkdownLink(pathRef.current, href);
                if (resolved.kind === "repo") {
                  onOpenPathRef.current?.(resolved.path, resolved.fragment || undefined);
                } else if (resolved.kind === "external") {
                  window.open(resolved.href, "_blank", "noopener,noreferrer");
                } else if (resolved.kind === "fragment") {
                  // In-editor heading jump: leave to Muya/TOC when available.
                }
              },
            },
          },
          { plugin: FootnoteTool },
          { plugin: TableColumnToolbar },
          { plugin: TableDragBar },
          { plugin: TableRowColumMenu },
        ];

        muya = new Muya(mountRef.current, {
          markdown: markdownRef.current,
          locale: zhCN,
          frontMatter: true,
          math: true,
          footnote: true,
          superSubScript: true,
          disableHtml: false,
          autoPairBracket: true,
          autoPairMarkdownSyntax: true,
          autoPairQuote: true,
          wrapCodeBlocks: true,
          preferLooseListItem: true,
          mermaidTheme: dark ? "dark" : "default",
          vegaTheme: dark ? "dark" : "latimes",
          plugins,
          imageSrcResolver: (src: string) => {
            const raw = (src || "").trim();
            if (!raw) return null;
            // HTTPS remote + safe data URLs only (block http / file / javascript).
            if (/^https:\/\//i.test(raw) || SAFE_UPLOAD_DATA.test(raw.replace(/\s+/g, ""))) {
              return raw;
            }
            if (/^(https?:|file:|javascript:|data:)/i.test(raw) || raw.startsWith("//")) {
              return "";
            }
            const resolved = resolveMarkdownImage(pathRef.current, raw);
            if (resolved.kind === "repo") {
              return assetURL(projectIDRef.current, "worktree", resolved.path);
            }
            if (resolved.kind === "remote" || resolved.kind === "data") {
              return resolved.href;
            }
            return "";
          },
          imageAction: async (state: { src: string; alt: string; title: string }) => {
            const src = (state.src || "").trim();
            if (!src) return src;
            // Keep existing relative/https paths; only persist Data URLs and local Files.
            if (/^https:\/\//i.test(src)) return src;
            if (/^(file:|http:)/i.test(src) || /\.svg($|\?)/i.test(src)) {
              throw new Error("不支持的图片类型");
            }
            const resolved = resolveMarkdownImage(pathRef.current, src);
            if (resolved.kind === "repo") return src;

            let blob: Blob | null = null;
            let filename = "image.png";
            if (SAFE_UPLOAD_DATA.test(src.replace(/\s+/g, ""))) {
              blob = dataURLtoBlob(src);
              const mime = blob?.type || "image/png";
              filename = `image.${extForMime(mime)}`;
            } else if (src.startsWith("blob:")) {
              const res = await fetch(src);
              blob = await res.blob();
              filename = `image.${extForMime(blob.type)}`;
            }
            if (!blob || !/^(image\/(png|jpe?g|gif|webp))$/i.test(blob.type)) {
              throw new Error("仅支持 PNG/JPEG/GIF/WebP 图片上传");
            }
            const uploaded = await uploadMarkdownAsset(
              projectIDRef.current,
              pathRef.current,
              blob,
              filename,
            );
            return uploaded.relativePath;
          },
          getPathForFile: () => "",
        }) as unknown as MuyaInstance;

        if (cancelled) {
          muya.destroy();
          return;
        }

        muya.init();
        stripPlantUMLFromQuickInsert(muya);

        changeHandler = () => onChangeRef.current?.();
        muya.on("json-change", changeHandler);

        muyaRef.current = muya;
        onReady?.();
      } catch (err) {
        if (!cancelled) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    })();

    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        // Keep layout stable in narrow panels; Muya floats use Floating UI.
      });
      ro.observe(outer);
    }

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (muya && changeHandler) {
        try {
          muya.off("json-change", changeHandler);
        } catch {
          // ignore
        }
      }
      try {
        muya?.hideAllFloatTools();
        muya?.destroy();
      } catch {
        // ignore
      }
      muyaRef.current = null;
      // Remove any leftover portals for this session.
      document.querySelectorAll(".mu-portal").forEach((el) => {
        if (!document.body.contains(el)) return;
        // Destroyed Muya should remove its portals; clean orphans cautiously.
      });
      if (mount.parentNode) mount.parentNode.removeChild(mount);
      mountRef.current = null;
    };
    // Mount once per path/project; content updates go through setContent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectID, markdownPath]);

  // Sync external draft reloads (discard / remote poll) into Muya.
  useEffect(() => {
    const muya = muyaRef.current;
    if (!muya) return;
    const current = muya.getMarkdown();
    if (current === markdown) return;
    muya.setContent(markdown);
  }, [markdown]);

  useEffect(() => {
    if (hidden) {
      muyaRef.current?.hideAllFloatTools();
    }
  }, [hidden]);

  const style: CSSProperties | undefined = hidden ? { display: "none" } : undefined;

  return (
    <div
      ref={outerRef}
      className="forkly-markdown forkly-markdown-editor"
      style={style}
      aria-hidden={hidden || undefined}
    />
  );
});

export default MarkdownEditorView;
