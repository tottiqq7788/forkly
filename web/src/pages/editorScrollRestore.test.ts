import { describe, expect, it, vi, afterEach } from "vitest";
import {
  applyEditorScrollSnapshot,
  blurFocusedEditorIn,
  clearEditorScrollSnapshot,
  editorScrollStorageKey,
  readEditorScrollSnapshot,
  resolveRestoredScrollTop,
  shouldPersistScrollSnapshot,
  snapshotFromScrollElement,
  writeEditorScrollSnapshot,
} from "./editorScrollRestore";

function makeStorage(store: Map<string, string>): Storage {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("editorScrollRestore", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("builds a stable storage key from scope and path", () => {
    expect(editorScrollStorageKey("project:p1", "docs/a.md")).toBe(
      "forkly:md-editor-scroll:project:p1:docs/a.md",
    );
  });

  it("round-trips snapshots through Storage", () => {
    const store = new Map<string, string>();
    const storage = makeStorage(store);

    writeEditorScrollSnapshot(storage, "local:file-1", "a.md", {
      top: 420,
      scrollHeight: 2000,
      slug: "heading",
    });
    expect(readEditorScrollSnapshot(storage, "local:file-1", "a.md")).toEqual({
      top: 420,
      scrollHeight: 2000,
      slug: "heading",
    });
    clearEditorScrollSnapshot(storage, "local:file-1", "a.md");
    expect(readEditorScrollSnapshot(storage, "local:file-1", "a.md")).toBeNull();
  });

  it("rejects invalid stored payloads", () => {
    const store = new Map<string, string>([[editorScrollStorageKey("project:p1", "a.md"), "{bad"]]);
    const storage = makeStorage(store);
    expect(readEditorScrollSnapshot(storage, "project:p1", "a.md")).toBeNull();
  });

  it("keeps absolute top when height is stable", () => {
    expect(
      resolveRestoredScrollTop({ scrollHeight: 2000, clientHeight: 800 }, { top: 900, scrollHeight: 2000 }),
    ).toBe(900);
  });

  it("clamps to the current max scroll", () => {
    expect(
      resolveRestoredScrollTop({ scrollHeight: 1900, clientHeight: 800 }, { top: 1400, scrollHeight: 2000 }),
    ).toBe(1100);
  });

  it("falls back to ratio when document height changes a lot", () => {
    const top = resolveRestoredScrollTop(
      { scrollHeight: 4000, clientHeight: 800 },
      { top: 600, scrollHeight: 2000 },
    );
    expect(top).toBeCloseTo(1600, 0);
  });

  it("does not persist a near-zero overwrite over a real reading position", () => {
    expect(
      shouldPersistScrollSnapshot({ top: 0, scrollHeight: 2000 }, { top: 480, scrollHeight: 2000 }),
    ).toBe(false);
    expect(
      shouldPersistScrollSnapshot({ top: 500, scrollHeight: 2100 }, { top: 480, scrollHeight: 2000 }),
    ).toBe(true);
  });

  it("blurs focused editor content inside the scroll root", () => {
    const root = document.createElement("div");
    const child = document.createElement("div");
    child.tabIndex = 0;
    root.appendChild(child);
    document.body.appendChild(root);
    child.focus();
    expect(document.activeElement).toBe(child);
    blurFocusedEditorIn(root);
    expect(document.activeElement).not.toBe(child);
  });

  it("reads a live element snapshot and applies it", () => {
    const el = {
      scrollTop: 123,
      scrollHeight: 1800,
      clientHeight: 700,
      contains: () => false,
    } as unknown as HTMLElement;
    expect(snapshotFromScrollElement(el, "s1")).toEqual({
      top: 123,
      scrollHeight: 1800,
      slug: "s1",
    });
    const applied = applyEditorScrollSnapshot(el, { top: 500, scrollHeight: 1800 });
    expect(applied).toBe(500);
    expect(el.scrollTop).toBe(500);
  });
});
