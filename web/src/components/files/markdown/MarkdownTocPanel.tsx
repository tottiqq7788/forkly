import { CaretRight } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { TocItem } from "./MarkdownEditorView";
import {
  MarkdownTocContextMenu,
  type MarkdownTocContextMenuState,
} from "./MarkdownTocContextMenu";
import {
  headingAnchorForClipboard,
  headingMarkdownLinkForClipboard,
} from "./copyHeadingAnchor";
import {
  collectCollapsibleTocSlugs,
  formatTocOutlineMarkdown,
  hasTocChildren,
  pruneCollapsedTocSlugs,
  visibleTocIndexes,
} from "./tocTree";
import { SegmentedButton, SegmentedButtonGroup } from "../../ui/SegmentedButton";

export type MarkdownEditorMode = "wysiwyg" | "source";

type Props = {
  items: TocItem[];
  activeSlug?: string;
  onSelect: (slug: string) => void;
  editorMode?: MarkdownEditorMode;
  onEditorModeChange?: (mode: MarkdownEditorMode) => void;
};

export function MarkdownTocPanel({
  items,
  activeSlug = "",
  onSelect,
  editorMode = "wysiwyg",
  onEditorModeChange,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MarkdownTocContextMenuState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setCollapsed((prev) => pruneCollapsedTocSlugs(items, prev));
  }, [items]);

  const visibleIndexes = useMemo(() => visibleTocIndexes(items, collapsed), [items, collapsed]);
  const collapsibleSlugs = useMemo(() => new Set(collectCollapsibleTocSlugs(items)), [items]);
  const anyCollapsed = collapsed.size > 0;
  const showModeToggle = typeof onEditorModeChange === "function";

  function showError(message: string) {
    setError(message);
  }

  async function copyText(text: string) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("当前浏览器不支持剪贴板写入");
    }
    await navigator.clipboard.writeText(text);
  }

  async function runSilent(action: () => Promise<void>) {
    try {
      await action();
      setError("");
    } catch (err) {
      showError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setMenu(null);
    }
  }

  function toggleHeading(slug: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function expandAll() {
    setCollapsed(new Set());
  }

  function collapseAll() {
    setCollapsed(new Set(collectCollapsibleTocSlugs(items)));
  }

  function openRootMenu(event: MouseEvent) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, target: { kind: "root" } });
  }

  function openHeadingMenu(event: MouseEvent, item: TocItem, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const canCollapse = hasTocChildren(items, index);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      target: {
        kind: "heading",
        slug: item.slug,
        content: item.content || "(无标题)",
        canCollapse,
        isExpanded: canCollapse && !collapsed.has(item.slug),
        canCopyAnchor: headingAnchorForClipboard(items, item.slug) != null,
      },
    });
  }

  return (
    <aside className="forkly-md-toc" aria-label="标题目录" onContextMenu={openRootMenu}>
      <div className="forkly-md-toc-scroll">
        {error ? (
          <div
            role="status"
            className="forkly-md-toc-error mx-2 mt-2 rounded-[var(--radius-sm)] border px-2 py-1 text-xs border-[var(--color-error-fg)]/30 bg-[var(--color-error-bg)] text-[var(--color-error-fg)]"
          >
            {error}
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className="forkly-md-toc-empty">暂无标题</div>
        ) : (
          <nav className="forkly-md-toc-nav">
            {visibleIndexes.map((index) => {
              const item = items[index];
              const active = item.slug === activeSlug;
              const canCollapse = collapsibleSlugs.has(item.slug);
              const isExpanded = canCollapse && !collapsed.has(item.slug);
              const pad = 8 + Math.max(0, item.lvl - 1) * 12;

              return (
                <div
                  key={item.slug}
                  className={`forkly-md-toc-row ${active ? "is-active" : ""}`}
                  style={{ paddingLeft: pad }}
                  onContextMenu={(event) => openHeadingMenu(event, item, index)}
                >
                  {canCollapse ? (
                    <button
                      type="button"
                      className="forkly-md-toc-caret"
                      aria-label={isExpanded ? "折叠子标题" : "展开子标题"}
                      aria-expanded={isExpanded}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleHeading(item.slug);
                      }}
                    >
                      <CaretRight
                        size={12}
                        className={`forkly-md-toc-caret-icon ${isExpanded ? "is-expanded" : ""}`}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    <span className="forkly-md-toc-caret-spacer" aria-hidden />
                  )}
                  <button
                    type="button"
                    className="forkly-md-toc-item"
                    title={item.content}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(item.slug)}
                  >
                    {item.content || "(无标题)"}
                  </button>
                </div>
              );
            })}
          </nav>
        )}
      </div>

      {showModeToggle ? (
        <SegmentedButtonGroup label="Markdown 显示模式" className="forkly-md-toc-footer">
          <SegmentedButton
            active={editorMode === "wysiwyg"}
            onClick={() => onEditorModeChange?.("wysiwyg")}
          >
            预览
          </SegmentedButton>
          <SegmentedButton
            active={editorMode === "source"}
            onClick={() => onEditorModeChange?.("source")}
          >
            源码
          </SegmentedButton>
        </SegmentedButtonGroup>
      ) : null}

      {menu ? (
        <MarkdownTocContextMenu
          state={menu}
          anyCollapsed={anyCollapsed}
          onClose={() => setMenu(null)}
          onExpandAll={() => {
            expandAll();
            setMenu(null);
          }}
          onCollapseAll={() => {
            collapseAll();
            setMenu(null);
          }}
          onCopyOutline={() =>
            void runSilent(async () => {
              await copyText(formatTocOutlineMarkdown(items));
            })
          }
          onSelectHeading={(slug) => {
            onSelect(slug);
            setMenu(null);
          }}
          onToggleHeading={(slug) => {
            toggleHeading(slug);
            setMenu(null);
          }}
          onCopyTitle={(content) =>
            void runSilent(async () => {
              await copyText(content);
            })
          }
          onCopyAnchor={(slug) =>
            void runSilent(async () => {
              const text = headingAnchorForClipboard(items, slug);
              if (!text) throw new Error("无法复制锚点");
              await copyText(text);
            })
          }
          onCopyMarkdownLink={(slug) =>
            void runSilent(async () => {
              const text = headingMarkdownLinkForClipboard(items, slug);
              if (!text) throw new Error("无法复制 Markdown 链接");
              await copyText(text);
            })
          }
        />
      ) : null}
    </aside>
  );
}

export default MarkdownTocPanel;
