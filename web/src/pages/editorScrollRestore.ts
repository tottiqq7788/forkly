/** Persist / restore Markdown editor scroll for refresh within the same tab. */

export type EditorScrollSnapshot = {
  top: number;
  scrollHeight: number;
  slug?: string;
};

export function editorScrollStorageKey(scopeKey: string, path: string): string {
  return `forkly:md-editor-scroll:${scopeKey}:${path}`;
}

export function readEditorScrollSnapshot(
  storage: Storage,
  scopeKey: string,
  path: string,
): EditorScrollSnapshot | null {
  try {
    const raw = storage.getItem(editorScrollStorageKey(scopeKey, path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorScrollSnapshot>;
    if (typeof parsed.top !== "number" || !Number.isFinite(parsed.top) || parsed.top < 0) {
      return null;
    }
    const scrollHeight =
      typeof parsed.scrollHeight === "number" && Number.isFinite(parsed.scrollHeight)
        ? Math.max(0, parsed.scrollHeight)
        : 0;
    const slug = typeof parsed.slug === "string" && parsed.slug ? parsed.slug : undefined;
    return { top: parsed.top, scrollHeight, slug };
  } catch {
    return null;
  }
}

export function writeEditorScrollSnapshot(
  storage: Storage,
  scopeKey: string,
  path: string,
  snapshot: EditorScrollSnapshot,
): void {
  try {
    storage.setItem(editorScrollStorageKey(scopeKey, path), JSON.stringify(snapshot));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function clearEditorScrollSnapshot(storage: Storage, scopeKey: string, path: string): void {
  try {
    storage.removeItem(editorScrollStorageKey(scopeKey, path));
  } catch {
    // ignore
  }
}

export function snapshotFromScrollElement(
  el: HTMLElement,
  slug?: string,
): EditorScrollSnapshot {
  return {
    top: Math.max(0, el.scrollTop),
    scrollHeight: Math.max(0, el.scrollHeight),
    ...(slug ? { slug } : {}),
  };
}

/**
 * Map a saved absolute scrollTop onto the current element.
 * If the document height changed a lot (diagrams finished rendering), fall back
 * to the saved relative progress so we stay near the same reading position.
 */
export function resolveRestoredScrollTop(
  el: Pick<HTMLElement, "scrollHeight" | "clientHeight">,
  saved: EditorScrollSnapshot,
): number {
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  if (maxScroll <= 0) return 0;

  const heightDelta = Math.abs(el.scrollHeight - saved.scrollHeight);
  const heightChangedAlot =
    saved.scrollHeight > 0 && heightDelta > Math.max(80, saved.scrollHeight * 0.08);

  if (heightChangedAlot) {
    const prevMax = Math.max(1, saved.scrollHeight - el.clientHeight);
    const ratio = Math.min(1, Math.max(0, saved.top / prevMax));
    return Math.min(maxScroll, ratio * maxScroll);
  }

  return Math.min(maxScroll, saved.top);
}

/** Avoid clobbering a real reading position with a transient top-of-page value. */
export function shouldPersistScrollSnapshot(
  next: EditorScrollSnapshot,
  previous: EditorScrollSnapshot | null,
): boolean {
  if (!previous || previous.top < 40) return true;
  // During restore, Muya focus can yank scroll to 0 before layout settles.
  if (next.top < 40 && previous.top >= 40) return false;
  return true;
}

/**
 * Blur focused editor content so caret "keep in view" does not yank scrollTop
 * back to the first block after we restore a mid-document position.
 */
export function blurFocusedEditorIn(root: HTMLElement): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!root.contains(active)) return;
  active.blur();
}

export function applyEditorScrollSnapshot(
  el: HTMLElement,
  saved: EditorScrollSnapshot,
  opts?: { blurFocused?: boolean },
): number {
  if (opts?.blurFocused !== false) blurFocusedEditorIn(el);
  const next = resolveRestoredScrollTop(el, saved);
  el.scrollTop = next;
  return next;
}
