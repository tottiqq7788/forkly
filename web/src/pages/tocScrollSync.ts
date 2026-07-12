/** Pure helper for TOC active-slug updates during programmatic smooth scroll. */
export function shouldApplyScrollDerivedTocActive(
  lockSlug: string | null | undefined,
  currentSlug: string,
): { apply: boolean; clearLock: boolean } {
  if (!lockSlug) return { apply: true, clearLock: false };
  if (currentSlug === lockSlug) return { apply: true, clearLock: true };
  return { apply: false, clearLock: false };
}

/** Map visible heading tops to a TOC slug by shared index order. */
export function resolveActiveTocSlug(
  headingTops: number[],
  tocSlugs: string[],
  viewportTop: number,
): string {
  if (tocSlugs.length === 0) return "";
  let current = tocSlugs[0] ?? "";
  const n = Math.min(headingTops.length, tocSlugs.length);
  for (let i = 0; i < n; i++) {
    if (headingTops[i]! <= viewportTop) current = tocSlugs[i] ?? current;
    else break;
  }
  return current;
}
