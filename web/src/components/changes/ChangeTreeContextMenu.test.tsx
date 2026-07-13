import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ChangeTreeContextMenu,
  type ChangeTreeContextMenuState,
} from "./ChangeTreeContextMenu";

function renderMenu(
  state: ChangeTreeContextMenuState,
  overrides: Partial<Parameters<typeof ChangeTreeContextMenu>[0]> = {},
) {
  const handlers = {
    allSelected: false,
    anyCollapsed: false,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onToggleSelectAll: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    onOpenLocation: vi.fn(),
    onCopyAbsolutePath: vi.fn(),
    onCopyRelativePath: vi.fn(),
    onOpenDiff: vi.fn(),
    onToggleSelect: vi.fn(),
    onToggleDirectory: vi.fn(),
    collectDirectoryPaths: vi.fn(() => ["docs/a.txt"]),
    ...overrides,
  };
  render(<ChangeTreeContextMenu state={state} {...handlers} />);
  return handlers;
}

describe("ChangeTreeContextMenu", () => {
  it("shows root actions for blank/root targets", () => {
    renderMenu({ x: 20, y: 20, target: { kind: "root" } });
    expect(screen.getByRole("menuitem", { name: "刷新变更" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "全选" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "全部折叠" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开项目文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制项目绝对路径" })).toBeInTheDocument();
  });

  it("toggles selection labels for files and hides reveal for deleted files", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({
      x: 20,
      y: 20,
      target: {
        kind: "file",
        path: "gone.txt",
        name: "gone.txt",
        file: {
          path: "gone.txt",
          kind: "deleted",
          staged: false,
          unstaged: true,
        },
        selected: true,
      },
    });

    expect(screen.getByRole("menuitem", { name: "查看差异" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "移出本次保存" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "在文件管理器中显示" })).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "移出本次保存" }));
    expect(handlers.onToggleSelect).toHaveBeenCalledWith(["gone.txt"]);
  });

  it("shows directory expand and path actions", async () => {
    const user = userEvent.setup();
    const handlers = renderMenu({
      x: 20,
      y: 20,
      target: {
        kind: "directory",
        path: "docs",
        name: "docs",
        isExpanded: true,
        selected: false,
      },
    });

    expect(screen.getByRole("menuitem", { name: "折叠" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "选择目录内全部变更" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "复制相对路径" }));
    expect(handlers.onCopyRelativePath).toHaveBeenCalledWith("docs");
  });

  it("closes on Escape", () => {
    const handlers = renderMenu({ x: 20, y: 20, target: { kind: "root" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
