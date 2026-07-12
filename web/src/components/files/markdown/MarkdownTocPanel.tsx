import type { TocItem } from "./MarkdownEditorView";

type Props = {
  items: TocItem[];
  activeSlug?: string;
  onSelect: (slug: string) => void;
};

export function MarkdownTocPanel({ items, activeSlug = "", onSelect }: Props) {
  if (items.length === 0) {
    return (
      <aside className="forkly-md-toc" aria-label="标题目录">
        <div className="forkly-md-toc-empty">暂无标题</div>
      </aside>
    );
  }

  return (
    <aside className="forkly-md-toc" aria-label="标题目录">
      <nav className="forkly-md-toc-nav">
        {items.map((item) => {
          const active = item.slug === activeSlug;
          return (
            <button
              key={item.slug}
              type="button"
              className={`forkly-md-toc-item ${active ? "is-active" : ""}`}
              style={{ paddingLeft: 8 + Math.max(0, item.lvl - 1) * 12 }}
              title={item.content}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(item.slug)}
            >
              {item.content || "(无标题)"}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default MarkdownTocPanel;
