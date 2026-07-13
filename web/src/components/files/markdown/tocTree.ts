export type TocTreeItem = {
  slug: string;
  content: string;
  lvl: number;
};

export function hasTocChildren(items: TocTreeItem[], index: number): boolean {
  if (index < 0 || index >= items.length - 1) return false;
  return items[index + 1].lvl > items[index].lvl;
}

export function collectCollapsibleTocSlugs(items: TocTreeItem[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (hasTocChildren(items, i)) out.push(items[i].slug);
  }
  return out;
}

export function isTocItemVisible(items: TocTreeItem[], index: number, collapsed: Set<string>): boolean {
  if (index < 0 || index >= items.length) return false;
  // Only walk the ancestor chain: after finding a parent, require a strictly
  // shallower level next so collapsed siblings do not hide other branches.
  let depth = items[index].lvl;
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].lvl >= depth) continue;
    if (collapsed.has(items[i].slug)) return false;
    depth = items[i].lvl;
  }
  return true;
}

export function visibleTocIndexes(items: TocTreeItem[], collapsed: Set<string>): number[] {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isTocItemVisible(items, i, collapsed)) out.push(i);
  }
  return out;
}

export function pruneCollapsedTocSlugs(items: TocTreeItem[], collapsed: Set<string>): Set<string> {
  const collapsible = new Set(collectCollapsibleTocSlugs(items));
  const next = new Set<string>();
  for (const slug of collapsed) {
    if (collapsible.has(slug)) next.add(slug);
  }
  return next.size === collapsed.size ? collapsed : next;
}

export function formatTocOutlineMarkdown(items: TocTreeItem[]): string {
  return items
    .map((item) => {
      const indent = "  ".repeat(Math.max(0, item.lvl - 1));
      const text = (item.content || "(无标题)").replace(/\s*\n\s*/g, " ").trim() || "(无标题)";
      return `${indent}- ${text}`;
    })
    .join("\n");
}
