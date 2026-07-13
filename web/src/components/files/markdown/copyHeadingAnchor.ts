export type TocSlugItem = {
  slug: string;
  githubSlug: string;
  content?: string;
};

export function isUniqueGithubSlug(toc: TocSlugItem[], githubSlug: string): boolean {
  if (!githubSlug) return false;
  let count = 0;
  for (const item of toc) {
    if (item.githubSlug === githubSlug) {
      count += 1;
      if (count > 1) return false;
    }
  }
  return count === 1;
}

/** Resolve stable slug → `#github-slug` only when the anchor is unique and non-empty. */
export function headingAnchorForClipboard(toc: TocSlugItem[], key: string): string | null {
  const item = toc.find((i) => i.slug === key);
  if (!item?.githubSlug) return null;
  if (!isUniqueGithubSlug(toc, item.githubSlug)) return null;
  return `#${item.githubSlug}`;
}

export function escapeMarkdownLinkLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/** Resolve stable slug → `[title](#github-slug)` when the anchor is unique and non-empty. */
export function headingMarkdownLinkForClipboard(toc: TocSlugItem[], key: string): string | null {
  const item = toc.find((i) => i.slug === key);
  if (!item?.githubSlug) return null;
  if (!isUniqueGithubSlug(toc, item.githubSlug)) return null;
  const label = escapeMarkdownLinkLabel(item.content?.trim() || "(无标题)");
  return `[${label}](#${item.githubSlug})`;
}

export async function copyHeadingAnchor(toc: TocSlugItem[], key: string): Promise<boolean> {
  const text = headingAnchorForClipboard(toc, key);
  if (!text) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

export async function copyHeadingMarkdownLink(toc: TocSlugItem[], key: string): Promise<boolean> {
  const text = headingMarkdownLinkForClipboard(toc, key);
  if (!text) return false;
  await navigator.clipboard.writeText(text);
  return true;
}
