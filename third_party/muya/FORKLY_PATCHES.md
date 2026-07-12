# Forkly patches to vendored Muya

These changes adapt MarkText's Electron-oriented Muya core for Forkly's React
browser host. Keep them minimal and documented.

## 1. Instance-level plugins

**Files:** `src/muya.ts`, `src/types.ts`

- `Muya.use` deduplicates by `pluginName` (safe under React StrictMode / HMR).
- `IMuyaOptions.plugins` registers plugins for a single instance; `init()`
  prefers instance plugins when present, otherwise falls back to the static
  list.

## 2. `imageSrcResolver` host hook

**Files:** `src/types.ts`, `src/utils/image.ts`, image render call sites

- New optional `imageSrcResolver(src)` on `IMuyaOptions`.
- `getImageSrc(src, resolver?)` consults the resolver before Electron
  `file://` / `window.DIRNAME` anchoring so relative repo images can map to
  Forkly's `/asset` API.

## 3. Browser File drop → Data URL

**File:** `src/editor/dragDropImage.ts`

When `getPathForFile` is missing or returns empty (normal browsers), dropped
image `File`s are read as Data URLs and still routed through `imageAction`.

## 4. Portal marker class

**Files:** `src/ui/baseFloat/index.ts`, `src/ui/paragraphFrontButton/index.ts`,
`src/ui/imageResizeBar/index.ts`, `src/ui/tooltip/index.ts`

Body-mounted float / toolbar / tooltip nodes also receive `mu-portal` so
Forkly can scope styles and z-index without targeting bare `body` children.

## 4b. Paragraph front-button portal host + clip hide

**File:** `src/ui/paragraphFrontButton/index.ts`

- Mount `.mu-front-button-wrapper` into the nearest scroll/overflow ancestor of
  the editor root (fallback: `document.body`) so `overflow: auto/hidden` clips
  the drag handle to the editor viewport instead of letting it escape into page
  chrome / overlays.
- Use Floating UI `hide()` middleware to clear visibility when the reference
  block is clipped or the floating node has escaped its boundary.

## 5. CSS isolation

**File:** `src/assets/styles/index.css`

- Theme variables move from `:root` to `.mu-editor, .mu-portal`.
- Global `html, body` typography rules are limited to `.mu-editor, .mu-portal`.
- Global `::selection` rules are limited to descendants of
  `.mu-editor` / `.mu-portal`.

## 6. Undo restores caret on the first history entry

**File:** `src/history/index.ts`

Upstream History uses a Quill-style two-slot selection lag (`_selectionStack`).
The first recorded undo entry therefore stores `selection: null`, so
`updateContents` skips caret restore and the browser caret collapses to offset
0 after the DOM rewrite.

- Listen to `selection-change` (when not ignoring) and keep `_beforeEditSelection`.
- When `_getLastSelection` has no lagged snapshot yet, fall back to that seed
  (then to the live selection) instead of returning `null`.

## 7. Diagram hover toolbar (source/preview toggle + PNG export)

**Files:**
- `src/block/extra/diagram/diagramPreview.ts`
- `src/assets/styles/blockSyntax.css`
- `src/ui/previewToolBar/{index.ts,config.ts,index.css}`
- `src/utils/exportSvgPng.ts`
- `src/locales/{en,zh-CN,zh-TW}.ts`

Upstream MarkText enters diagram source mode on preview click, then floats the
still-visible preview under the source with `position:absolute; z-index:10000`,
covering subsequent content.

Forkly changes:
- Preview click does not enter source mode (source editing is toolbar-only).
- Active diagram blocks hide the preview (`display:none`) instead of floating it;
  source and preview are mutually exclusive in document flow.
- `PreviewToolBar` also targets `diagram` blocks: hover shows a top-placed
  toolbar with source/preview toggle + Export PNG. Delayed hide + float
  `mouseenter` keeps the bar stable while moving onto the portal; `destroy`
  clears the hide timer. Toolbar `mousedown` is cancelled so toggling does not
  blur-then-reenter source mode. Entering source activates the block (expands the
  0×0 source container) before focusing, so the 2nd/3rd toggle keeps working.
- `downloadDiagramPreviewAsPng` rasterizes the preview SVG onto a canvas with
  `--editor-bg-color`, rejects zero-size / cross-origin `<img>` exports, and
  caps canvas dimensions to avoid OOMs.
