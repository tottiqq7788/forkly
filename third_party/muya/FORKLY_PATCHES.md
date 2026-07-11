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

## 5. CSS isolation

**File:** `src/assets/styles/index.css`

- Theme variables move from `:root` to `.mu-editor, .mu-portal`.
- Global `html, body` typography rules are limited to `.mu-editor, .mu-portal`.
- Global `::selection` rules are limited to descendants of
  `.mu-editor` / `.mu-portal`.
