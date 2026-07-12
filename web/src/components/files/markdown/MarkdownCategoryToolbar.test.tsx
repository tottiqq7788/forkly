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

  it("disables find next until a query exists", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MarkdownCategoryToolbar onCommand={vi.fn()} findQuery="" />,
    );
    await user.hover(screen.getByRole("button", { name: "查找替换" }));
    expect(await screen.findByRole("menuitem", { name: "下一个匹配" })).toBeDisabled();

    rerender(<MarkdownCategoryToolbar onCommand={vi.fn()} findQuery="hello" />);
    await user.hover(screen.getByRole("button", { name: "查找替换" }));
    expect(await screen.findByRole("menuitem", { name: "下一个匹配" })).not.toBeDisabled();
  });
});
