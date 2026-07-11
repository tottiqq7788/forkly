import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileContent } from "../../../api";
import { APIError } from "../../../api";
import { useMarkdownDocument } from "./useMarkdownDocument";

const putMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../../api", async () => {
  const actual = await vi.importActual<typeof import("../../../api")>("../../../api");
  return {
    ...actual,
    putFileContent: (...args: unknown[]) => putMock(...args),
    fetchFileContent: (...args: unknown[]) => fetchMock(...args),
  };
});

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

describe("useMarkdownDocument", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    putMock.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks dirty and autosaves after debounce; concurrent edits keep dirty", async () => {
    let resolveSave: (v: unknown) => void = () => undefined;
    putMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useMarkdownDocument({
        projectID: "p1",
        source: "worktree",
        path: "docs/a.md",
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
    expect(putMock).toHaveBeenCalledTimes(1);

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
    putMock.mockRejectedValue(
      new APIError("content_conflict", 409, "content_conflict", {
        currentRevision: "rev-disk",
      }),
    );
    fetchMock.mockResolvedValue({
      path: "docs/a.md",
      source: "worktree",
      kind: "text",
      content: "# disk",
      revision: "rev-disk",
    });

    const { result } = renderHook(() =>
      useMarkdownDocument({
        projectID: "p1",
        source: "worktree",
        path: "docs/a.md",
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
});
