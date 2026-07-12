import { describe, expect, it, vi } from "vitest";
import { copyHeadingAnchor, headingAnchorForClipboard } from "./copyHeadingAnchor";

describe("headingAnchorForClipboard", () => {
  const toc = [
    { slug: "uid-1", githubSlug: "getting-started" },
    { slug: "uid-2", githubSlug: "api" },
  ];

  it("returns #githubSlug for a matching stable slug", () => {
    expect(headingAnchorForClipboard(toc, "uid-1")).toBe("#getting-started");
  });

  it("returns null when the key is missing", () => {
    expect(headingAnchorForClipboard(toc, "missing")).toBeNull();
  });

  it("returns null when githubSlug is empty", () => {
    expect(headingAnchorForClipboard([{ slug: "a", githubSlug: "" }], "a")).toBeNull();
  });
});

describe("copyHeadingAnchor", () => {
  it("writes the anchor to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(
      copyHeadingAnchor([{ slug: "uid-1", githubSlug: "hello" }], "uid-1"),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("#hello");
  });

  it("skips clipboard when TOC lookup fails", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(copyHeadingAnchor([], "uid-1")).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
