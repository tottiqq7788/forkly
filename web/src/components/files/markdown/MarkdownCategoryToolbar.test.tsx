import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownCategoryToolbar } from "./MarkdownCategoryToolbar";

describe("MarkdownCategoryToolbar", () => {
  it("shows category labels and expands heading items on hover", async () => {
    const onCommand = vi.fn();
    const user = userEvent.setup();
    render(<MarkdownCategoryToolbar onCommand={onCommand} />);

    expect(screen.getByRole("button", { name: "标题样式" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "历史操作" })).toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: "标题样式" }));
    expect(await screen.findByRole("menuitem", { name: "标题 1" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "标题 2" }));
    expect(onCommand).toHaveBeenCalledWith("para:heading 2");
  });

  it("opens findbar directly from the find category without a flyout", async () => {
    const onCommand = vi.fn();
    const user = userEvent.setup();
    render(<MarkdownCategoryToolbar onCommand={onCommand} findOpen={false} />);

    const findBtn = screen.getByRole("button", { name: "查找替换" });
    await user.hover(findBtn);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(findBtn);
    expect(onCommand).toHaveBeenCalledWith("find:open");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
