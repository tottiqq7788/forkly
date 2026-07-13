import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MarkdownTocContextMenu,
  type MarkdownTocContextMenuState,
} from "./MarkdownTocContextMenu";

function renderMenu(
  state: MarkdownTocContextMenuState,
  overrides: Partial<Parameters<typeof MarkdownTocContextMenu>[0]> = {},
) {
  const handlers = {
    anyCollapsed: false,
    onClose: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    onCopyOutline: vi.fn(),
    onSelectHeading: vi.fn(),
    onToggleHeading: vi.fn(),
    onCopyTitle: vi.fn(),
    onCopyAnchor: vi.fn(),
    onCopyMarkdownLink: vi.fn(),
    ...overrides,
  };
  render(<MarkdownTocContextMenu state={state} {...handlers} />);
  return handlers;
}

describe("MarkdownTocContextMenu", () => {
  it("shows root expand/collapse and outline actions", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({ x: 12, y: 12, target: { kind: "root" } }, { anyCollapsed: true });

    expect(screen.getByRole("menuitem", { name: "全部展开" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制目录大纲" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "全部展开" }));
    expect(handlers.onExpandAll).toHaveBeenCalled();
  });

  it("shows heading actions and hides anchors when unavailable", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({
      x: 12,
      y: 12,
      target: {
        kind: "heading",
        slug: "uid-1",
        content: "简介",
        canCollapse: true,
        isExpanded: true,
        canCopyAnchor: false,
      },
    });

    expect(screen.getByRole("menuitem", { name: "定位到标题" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "折叠子标题" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制标题文本" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "复制锚点" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "复制 Markdown 链接" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "定位到标题" }));
    expect(handlers.onSelectHeading).toHaveBeenCalledWith("uid-1");
  });

  it("copies anchor and markdown link when available", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({
      x: 12,
      y: 12,
      target: {
        kind: "heading",
        slug: "uid-2",
        content: "API",
        canCollapse: false,
        isExpanded: false,
        canCopyAnchor: true,
      },
    });

    expect(screen.queryByRole("menuitem", { name: "折叠子标题" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "复制锚点" }));
    expect(handlers.onCopyAnchor).toHaveBeenCalledWith("uid-2");
    await user.click(screen.getByRole("menuitem", { name: "复制 Markdown 链接" }));
    expect(handlers.onCopyMarkdownLink).toHaveBeenCalledWith("uid-2");
  });

  it("closes on Escape", () => {
    const handlers = renderMenu({ x: 12, y: 12, target: { kind: "root" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
