import { describe, expect, it } from "vitest";
import { resolveActiveTocSlug, shouldApplyScrollDerivedTocActive } from "./tocScrollSync";

describe("shouldApplyScrollDerivedTocActive", () => {
  it("applies scroll updates when unlocked", () => {
    expect(shouldApplyScrollDerivedTocActive(null, "a")).toEqual({
      apply: true,
      clearLock: false,
    });
  });

  it("ignores intermediate headings while locked", () => {
    expect(shouldApplyScrollDerivedTocActive("target", "mid")).toEqual({
      apply: false,
      clearLock: false,
    });
  });

  it("applies and clears the lock when the target heading is reached", () => {
    expect(shouldApplyScrollDerivedTocActive("target", "target")).toEqual({
      apply: true,
      clearLock: true,
    });
  });
});

describe("resolveActiveTocSlug", () => {
  it("picks the last heading that has crossed the viewport top", () => {
    expect(resolveActiveTocSlug([10, 40, 80], ["a", "b", "c"], 50)).toBe("b");
  });

  it("falls back to the first slug when none have crossed", () => {
    expect(resolveActiveTocSlug([60, 90], ["a", "b"], 50)).toBe("a");
  });
});
