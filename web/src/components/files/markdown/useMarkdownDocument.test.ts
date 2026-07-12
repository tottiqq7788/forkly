import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContent } from "../../../api";
import { APIError } from "../../../api";
import { useMarkdownDocument } from "./useMarkdownDocument";
import type { DocumentTransport } from "./documentTransport";

const saveMock = vi.fn();
const loadMock = vi.fn();

function initialFile(over: Partial<FileContent> = {}): FileContent {
  return {
    path: "docs/a.md",
    source: "worktree",
    kind: "text",
    content: "# hello",
    revision: "rev-1",
    editable: true,
    ...over,
  };
}

function transport(overrides: Partial<DocumentTransport> = {}): DocumentTransport {
  return {
    scopeKey: "project:p1",
    remountKey: "project:p1:docs/a.md",
    displayLabel: "demo",
    displayPath: "docs/a.md",
    titleName: "a.md",
    markdownPath: "docs/a.md",
    load: (...args) => loadMock(...args),
    save: (...args) => saveMock(...args),
    assetURL: (path) => `/asset/${path}`,
    uploadAsset: async () => ({ path: "images/a.png", relativePath: "images/a.png", mime: "image/png", size: 1 }),
    ...overrides,
  };
}

describe("useMarkdownDocument", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    saveMock.mockReset();
    loadMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks dirty and autosaves after debounce; concurrent edits keep dirty", async () => {
    let resolveSave: (v: unknown) => void = () => undefined;
    saveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useMarkdownDocument({
        transport: transport(),
        initial: initialFile(),
        enabled: true,
      }),
    );

    result.current.registerSerializer({
      flush: () => undefined,
      getMarkdown: () => "# edited",
    });

    act(() => {
      result.current.setDraftFromEditor();
    });
    expect(result.current.saveStatus).toBe("dirty");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.saveStatus).toBe("saving");
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith("# edited", "rev-1");

    // Type while saving
    act(() => {
      result.current.setDraftFromEditor();
    });
    expect(result.current.saveStatus).toBe("dirty");

    await act(async () => {
      resolveSave({ path: "docs/a.md", revision: "rev-2", size: 10 });
      await Promise.resolve();
    });

    // Newer edits remain dirty after the in-flight save resolves.
    expect(result.current.saveStatus).toBe("dirty");
  });

  it("enters conflict on 409 and keeps draft", async () => {
    saveMock.mockRejectedValue(
      new APIError("content_conflict", 409, "content_conflict", {
        currentRevision: "rev-disk",
      }),
    );
    loadMock.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# disk",
      revision: "rev-disk",
    });

    const { result } = renderHook(() =>
      useMarkdownDocument({
        transport: transport(),
        initial: initialFile(),
        enabled: true,
      }),
    );

    result.current.registerSerializer({
      flush: () => undefined,
      getMarkdown: () => "# draft",
    });

    act(() => {
      result.current.setDraftFromEditor();
    });

    await act(async () => {
      await result.current.flush();
    });

    expect(result.current.saveStatus).toBe("conflict");
    expect(result.current.conflictDiskContent).toBe("# disk");
    expect(result.current.draftMarkdown).toBe("# draft");
  });

  it("keeps dirty draft and enters conflict when initial revision refreshes", async () => {
    const { result, rerender } = renderHook(
      ({ initial }) =>
        useMarkdownDocument({
          transport: transport(),
          initial,
          enabled: true,
        }),
      { initialProps: { initial: initialFile() } },
    );

    result.current.registerSerializer({
      flush: () => undefined,
      getMarkdown: () => "# local-draft",
    });

    act(() => {
      result.current.setDraftFromEditor();
    });
    expect(result.current.saveStatus).toBe("dirty");

    rerender({
      initial: initialFile({ content: "# from-disk", revision: "rev-2" }),
    });

    expect(result.current.saveStatus).toBe("conflict");
    expect(result.current.conflictDiskContent).toBe("# from-disk");
    expect(result.current.draftMarkdown).toBe("# local-draft");
  });
});
