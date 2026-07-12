export type TocSlugItem = {
  slug: string;
  githubSlug: string;
};

/** Resolve Muya `heading-copy-link` key → `#github-slug` for clipboard. */
export function headingAnchorForClipboard(toc: TocSlugItem[], key: string): string | null {
  const item = toc.find((i) => i.slug === key);
  if (!item?.githubSlug) return null;
  return `#${item.githubSlug}`;
}

export async function copyHeadingAnchor(toc: TocSlugItem[], key: string): Promise<boolean> {
  const text = headingAnchorForClipboard(toc, key);
  if (!text) return false;
  await navigator.clipboard.writeText(text);
  return true;
}
