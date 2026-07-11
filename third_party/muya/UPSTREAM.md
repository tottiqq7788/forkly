# Muya upstream snapshot

Forkly vendors a snapshot of MarkText's `@muyajs/core` (Muya) package for
in-browser Markdown editing.

## Pin

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/marktext/marktext |
| Local source | `marktext/packages/muya` |
| MarkText commit | `43bd8b77795fb27b1a9512737c000f7362031ea0` |
| Muya tree hash | `5b7f57fcd43d69fef9c4688518dae6aa0751d42f` |
| Package name | `@muyajs/core` |
| Package version | `0.2.0-dev` (package.json reports `0.2.0`) |
| License | MIT (see `LICENSE`) |

## Sync steps

1. Check out MarkText at the pin commit above.
2. Confirm the Muya tree hash:
   `git -C <marktext> rev-parse 43bd8b77795fb27b1a9512737c000f7362031ea0:packages/muya`
3. Replace this directory (excluding Forkly metadata) with a clean copy of
   `packages/muya` (no `node_modules` / `lib`).
4. Re-apply the patches documented in `FORKLY_PATCHES.md`.
5. Update this file and `../NOTICE.md` if the pin changes.
6. Run `npm install` in `web/` so the `file:../third_party/muya` dependency
   refreshes, then `npm run test` / `npm run build`.

## What Forkly consumes

The Vite app depends on `@muyajs/core` via `file:../third_party/muya` and
imports TypeScript sources through the package `exports` map (`.` →
`./src/index.ts`). Forkly does not ship Muya's built `lib/` artifacts.
