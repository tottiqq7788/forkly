import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MermaidBlock } from "./MermaidBlock";

const renderMock = vi.fn(async (_id: string, code: string) => {
  if (code.includes("bad")) throw new Error("parse fail");
  return { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>' };
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => renderMock(...(args as [string, string])),
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ""),
  },
}));

describe("MermaidBlock", () => {
  beforeEach(() => {
    renderMock.mockClear();
  });

  it("renders sanitized svg from mermaid", async () => {
    render(<MermaidBlock code={"graph TD; A-->B"} />);
    await waitFor(() => {
      expect(document.querySelector(".forkly-mermaid svg")).toBeTruthy();
    });
    expect(renderMock).toHaveBeenCalled();
  });

  it("shows error fallback for invalid diagrams", async () => {
    render(<MermaidBlock code={"bad diagram"} />);
    expect(await screen.findByText("Mermaid 渲染失败")).toBeInTheDocument();
    expect(screen.getByText("parse fail")).toBeInTheDocument();
    expect(screen.getByText("bad diagram")).toBeInTheDocument();
  });
});
