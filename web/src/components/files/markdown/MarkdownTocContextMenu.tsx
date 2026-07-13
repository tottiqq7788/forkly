import {
  CaretDown,
  CaretRight,
  Copy,
  LinkSimple,
  ListBullets,
  TextT,
  TreeStructure,
} from "@phosphor-icons/react";
import { ContextMenuItem, ContextMenuPortal, ContextMenuSeparator } from "../../ui/ContextMenu";

export type MarkdownTocContextTarget =
  | { kind: "root" }
  | {
      kind: "heading";
      slug: string;
      content: string;
      canCollapse: boolean;
      isExpanded: boolean;
      canCopyAnchor: boolean;
    };

export type MarkdownTocContextMenuState = {
  x: number;
  y: number;
  target: MarkdownTocContextTarget;
};

type Props = {
  state: MarkdownTocContextMenuState;
  anyCollapsed: boolean;
  onClose: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCopyOutline: () => void;
  onSelectHeading: (slug: string) => void;
  onToggleHeading: (slug: string) => void;
  onCopyTitle: (content: string) => void;
  onCopyAnchor: (slug: string) => void;
  onCopyMarkdownLink: (slug: string) => void;
};

export function MarkdownTocContextMenu({
  state,
  anyCollapsed,
  onClose,
  onExpandAll,
  onCollapseAll,
  onCopyOutline,
  onSelectHeading,
  onToggleHeading,
  onCopyTitle,
  onCopyAnchor,
  onCopyMarkdownLink,
}: Props) {
  return (
    <ContextMenuPortal x={state.x} y={state.y} onClose={onClose}>
      {renderMenuItems(state.target, {
        anyCollapsed,
        onExpandAll,
        onCollapseAll,
        onCopyOutline,
        onSelectHeading,
        onToggleHeading,
        onCopyTitle,
        onCopyAnchor,
        onCopyMarkdownLink,
      })}
    </ContextMenuPortal>
  );
}

type MenuHandlers = Omit<Props, "state" | "onClose">;

function renderMenuItems(target: MarkdownTocContextTarget, handlers: MenuHandlers) {
  if (target.kind === "root") {
    return (
      <>
        <ContextMenuItem
          icon={handlers.anyCollapsed ? <CaretDown /> : <CaretRight />}
          onSelect={handlers.anyCollapsed ? handlers.onExpandAll : handlers.onCollapseAll}
        >
          {handlers.anyCollapsed ? "全部展开" : "全部折叠"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<TreeStructure />} onSelect={handlers.onCopyOutline}>
          复制目录大纲
        </ContextMenuItem>
      </>
    );
  }

  return (
    <>
      <ContextMenuItem icon={<TextT />} onSelect={() => handlers.onSelectHeading(target.slug)}>
        定位到标题
      </ContextMenuItem>
      {target.canCollapse ? (
        <ContextMenuItem
          icon={target.isExpanded ? <CaretRight /> : <CaretDown />}
          onSelect={() => handlers.onToggleHeading(target.slug)}
        >
          {target.isExpanded ? "折叠子标题" : "展开子标题"}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Copy />} onSelect={() => handlers.onCopyTitle(target.content)}>
        复制标题文本
      </ContextMenuItem>
      {target.canCopyAnchor ? (
        <>
          <ContextMenuItem icon={<LinkSimple />} onSelect={() => handlers.onCopyAnchor(target.slug)}>
            复制锚点
          </ContextMenuItem>
          <ContextMenuItem
            icon={<ListBullets />}
            onSelect={() => handlers.onCopyMarkdownLink(target.slug)}
          >
            复制 Markdown 链接
          </ContextMenuItem>
        </>
      ) : null}
    </>
  );
}
