import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  HistoryTreeContextMenu,
  type HistoryTreeContextMenuState,
} from "./HistoryTreeContextMenu";

const sampleCommit = {
  sha: "abcdef1234567890",
  short: "abcdef1",
  subject: "你好",
  author: "本机身份",
  email: "me@example.com",
  date: "2026-07-11T00:10:16+08:00",
};

function renderMenu(
  state: HistoryTreeContextMenuState,
  overrides: Partial<Parameters<typeof HistoryTreeContextMenu>[0]> = {},
) {
  const handlers = {
    anyCollapsed: false,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    onOpenLocation: vi.fn(),
    onCopyProjectPath: vi.fn(),
    onSelectCommit: vi.fn(),
    onToggleGroup: vi.fn(),
    onCopyText: vi.fn(),
    ...overrides,
  };
  render(<HistoryTreeContextMenu state={state} {...handlers} />);
  return handlers;
}

describe("HistoryTreeContextMenu", () => {
  it("shows root actions for blank area", () => {
    renderMenu({ x: 12, y: 12, target: { kind: "root" } }, { anyCollapsed: true });
    expect(screen.getByRole("menuitem", { name: "刷新历史" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "全部展开" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开项目文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制项目绝对路径" })).toBeInTheDocument();
  });

  it("shows group actions and copies semantic values", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({
      x: 12,
      y: 12,
      target: {
        kind: "group",
        key: "d:2026-07-11",
        label: "11",
        copyValue: "2026-07-11",
        isExpanded: false,
        latestSha: sampleCommit.sha,
      },
    });

    expect(screen.getByRole("menuitem", { name: "展开" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "查看组内最新提交" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "复制分组名称" }));
    expect(handlers.onCopyText).toHaveBeenCalledWith("2026-07-11");
  });

  it("copies commit sha and details silently via handlers", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({
      x: 12,
      y: 12,
      target: { kind: "commit", commit: sampleCommit },
    });

    await user.click(screen.getByRole("menuitem", { name: "复制完整 SHA" }));
    expect(handlers.onCopyText).toHaveBeenCalledWith(sampleCommit.sha);

    await user.click(screen.getByRole("menuitem", { name: "复制提交说明" }));
    expect(handlers.onCopyText).toHaveBeenCalledWith("你好");

    await user.click(screen.getByRole("menuitem", { name: "复制完整提交信息" }));
    expect(handlers.onCopyText).toHaveBeenCalledWith(
      expect.stringContaining(`SHA: ${sampleCommit.sha}`),
    );
  });

  it("closes on Escape", () => {
    const handlers = renderMenu({ x: 12, y: 12, target: { kind: "root" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
