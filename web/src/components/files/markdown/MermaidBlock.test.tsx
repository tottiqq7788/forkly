import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MermaidBlock } from "./MermaidBlock";

const renderMock = vi.fn(async (_id: string, code: string, _host?: Element) => {
  if (code.includes("bad")) throw new Error("parse fail");
  return { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>' };
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) =>
      renderMock(...(args as [string, string, Element | undefined])),
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

  it("renders sanitized svg from mermaid into a temporary host", async () => {
    render(<MermaidBlock code={"graph TD; A-->B"} />);
    await waitFor(() => {
      expect(document.querySelector(".forkly-mermaid svg")).toBeTruthy();
    });
    expect(renderMock).toHaveBeenCalled();
    const host = renderMock.mock.calls[0]?.[2] as HTMLElement | undefined;
    expect(host).toBeInstanceOf(HTMLElement);
    // Host must be removed after render so it cannot grow document scroll height.
    expect(document.body.contains(host!)).toBe(false);
  });

  it("shows error fallback for invalid diagrams", async () => {
    render(<MermaidBlock code={"bad diagram"} />);
    expect(await screen.findByText("Mermaid 渲染失败")).toBeInTheDocument();
    expect(screen.getByText("parse fail")).toBeInTheDocument();
    expect(screen.getByText("bad diagram")).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBe(0);
  });
});
