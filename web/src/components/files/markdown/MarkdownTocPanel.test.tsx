import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TocItem } from "./MarkdownEditorView";
import { MarkdownTocPanel } from "./MarkdownTocPanel";

const clipboardWriteMock = vi.hoisted(() => vi.fn());

const sampleItems: TocItem[] = [
  { slug: "h1", content: "介绍", lvl: 1, githubSlug: "intro" },
  { slug: "h2", content: "安装", lvl: 2, githubSlug: "install" },
  { slug: "h3", content: "细节", lvl: 3, githubSlug: "details" },
  { slug: "h4", content: "进阶", lvl: 2, githubSlug: "advanced" },
  { slug: "h5", content: "附录", lvl: 1, githubSlug: "appendix" },
];

function installClipboardMock() {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: clipboardWriteMock },
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: clipboardWriteMock },
  });
}

describe("MarkdownTocPanel", () => {
  beforeEach(() => {
    clipboardWriteMock.mockReset();
    clipboardWriteMock.mockResolvedValue(undefined);
    installClipboardMock();
  });

  it("opens heading and blank-area context menus", async () => {
    installClipboardMock();
    render(<MarkdownTocPanel items={sampleItems} onSelect={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "安装" }), {
      clientX: 20,
      clientY: 30,
    });
    expect(await screen.findByRole("menuitem", { name: "定位到标题" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制锚点" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "定位到标题" })).toBeNull();
    });

    fireEvent.contextMenu(screen.getByLabelText("标题目录"), { clientX: 10, clientY: 12 });
    expect(await screen.findByRole("menuitem", { name: "全部折叠" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "复制目录大纲" }));
    await waitFor(() => {
      expect(clipboardWriteMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("collapses a heading via caret without selecting it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MarkdownTocPanel items={sampleItems} onSelect={onSelect} />);

    expect(screen.getByRole("button", { name: "细节" })).toBeInTheDocument();
    const carets = screen.getAllByRole("button", { name: "折叠子标题" });
    // 介绍, 安装 — collapse 安装 so only its child 细节 hides.
    await user.click(carets[1]);
    expect(screen.queryByRole("button", { name: "细节" })).toBeNull();
    expect(screen.getByRole("button", { name: "安装" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "安装" }));
    expect(onSelect).toHaveBeenCalledWith("h2");
  });

  it("collapses all and restores siblings under different parents", async () => {
    const user = userEvent.setup();
    render(<MarkdownTocPanel items={sampleItems} onSelect={vi.fn()} />);

    fireEvent.contextMenu(screen.getByLabelText("标题目录"), { clientX: 8, clientY: 8 });
    await user.click(await screen.findByRole("menuitem", { name: "全部折叠" }));

    expect(screen.getByRole("button", { name: "介绍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "附录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "安装" })).toBeNull();
    expect(screen.queryByRole("button", { name: "进阶" })).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "展开子标题" })[0]);
    expect(screen.getByRole("button", { name: "安装" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进阶" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "细节" })).toBeNull();
  });

  it("hides unsafe anchors for empty or duplicate githubSlug", async () => {
    const items: TocItem[] = [
      { slug: "a", content: "中文", lvl: 1, githubSlug: "" },
      { slug: "b", content: "Same", lvl: 1, githubSlug: "same" },
      { slug: "c", content: "Same again", lvl: 1, githubSlug: "same" },
    ];
    render(<MarkdownTocPanel items={items} onSelect={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "中文" }), {
      clientX: 12,
      clientY: 12,
    });
    expect(await screen.findByRole("menuitem", { name: "复制标题文本" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "复制锚点" })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Same" }), {
      clientX: 14,
      clientY: 14,
    });
    expect(await screen.findByRole("menuitem", { name: "复制标题文本" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "复制 Markdown 链接" })).toBeNull();
  });

  it("keeps sibling branch children visible when only one branch is collapsed", async () => {
    const user = userEvent.setup();
    const items: TocItem[] = [
      { slug: "a", content: "A", lvl: 1, githubSlug: "a" },
      { slug: "b", content: "B", lvl: 2, githubSlug: "b" },
      { slug: "c", content: "C", lvl: 3, githubSlug: "c" },
      { slug: "d", content: "D", lvl: 2, githubSlug: "d" },
      { slug: "e", content: "E", lvl: 3, githubSlug: "e" },
    ];
    render(<MarkdownTocPanel items={items} onSelect={vi.fn()} />);

    const carets = screen.getAllByRole("button", { name: "折叠子标题" });
    // A, B, D — collapse B only.
    await user.click(carets[1]);
    expect(screen.queryByRole("button", { name: "C" })).toBeNull();
    expect(screen.getByRole("button", { name: "D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "E" })).toBeInTheDocument();
  });

  it("shows an error when clipboard write fails", async () => {
    clipboardWriteMock.mockRejectedValue(new Error("denied"));
    installClipboardMock();
    render(<MarkdownTocPanel items={sampleItems} onSelect={vi.fn()} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "介绍" }), {
      clientX: 16,
      clientY: 16,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制标题文本" }));
    expect(await screen.findByRole("status")).toHaveTextContent("denied");
  });
});
