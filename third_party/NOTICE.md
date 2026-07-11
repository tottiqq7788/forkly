# Third-party notices

## Git (bundled via desktop/dugite-native)

- License: GPL-2.0
- Upstream: https://github.com/git/git
- Packaging: https://github.com/desktop/dugite-native
- Exact version and SHA-256: see `tools/git-runtime/manifest.json`

When distributing Forkly with a bundled Git runtime, the GPLv2 source offer
for the corresponding Git version must remain available to recipients.

## fyne.io/systray

- License: Apache-2.0
- https://github.com/fyne-io/systray

## fsnotify

- License: BSD-3-Clause
- https://github.com/fsnotify/fsnotify

## Markdown preview (web UI)

Runtime packages used by the project file Markdown preview:

- `react-markdown` — MIT — https://github.com/remarkjs/react-markdown
- `remark-gfm` — MIT — https://github.com/remarkjs/remark-gfm
- `remark-math` — MIT — https://github.com/remarkjs/remark-math
- `remark-emoji` — MIT — https://github.com/rhysd/remark-emoji
- `remark-cjk-friendly` — MIT — https://github.com/tats-u/markdown-cjk-friendly
- `rehype-raw` / `rehype-sanitize` / `rehype-slug` / `rehype-katex` / `rehype-highlight` — MIT
- `katex` — MIT — https://github.com/KaTeX/KaTeX
- `mermaid` — MIT — https://github.com/mermaid-js/mermaid
- `dompurify` — MPL-2.0 OR Apache-2.0 — https://github.com/cure53/DOMPurify
- `highlight.js` (via `rehype-highlight` / `lowlight`) — BSD-3-Clause

Design inspiration for export-style security, Mermaid strict mode, and relative
asset rewriting was taken from MarkText / `@muyajs/core` (MIT); Forkly does not
bundle the MarkText editor runtime.
