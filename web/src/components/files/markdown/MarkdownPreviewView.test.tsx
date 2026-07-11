import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarkdownPreviewView } from "./MarkdownPreviewView";

function renderMd(content: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarkdownPreviewView
        content={content}
        projectID="p1"
        source="worktree"
        ownerPath="docs/guide.md"
        onOpenPath={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("MarkdownPreviewView", () => {
  it("renders headings, lists, and tables", () => {
    renderMd(`# Hello

- one
- two

| a | b |
| - | - |
| 1 | 2 |
`);
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders task lists and strikethrough", () => {
    const { container } = renderMd(`- [x] done
- [ ] todo

~~gone~~
`);
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[0] as HTMLInputElement).disabled).toBe(true);
    expect(container.querySelector("del")).toBeTruthy();
  });

  it("renders footnotes", () => {
    renderMd(`See note[^1].

[^1]: Footnote body
`);
    expect(screen.getByText("Footnote body")).toBeInTheDocument();
  });

  it("renders CJK emphasis", () => {
    const { container } = renderMd(`中文**加粗**中文`);
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
  });

  it("renders math", () => {
    const { container } = renderMd(`$$x^2$$`);
    expect(container.querySelector(".katex, .katex-display, .math")).toBeTruthy();
  });

  it("renders emoji shortcodes", () => {
    const { container } = renderMd(`Hello :smile:`);
    expect(container.textContent).toMatch(/Hello/);
    expect(container.textContent).not.toContain(":smile:");
  });

  it("renders supersub", () => {
    const { container } = renderMd(`H~2~O and 2^n^`);
    expect(container.querySelector("sub")?.textContent).toBe("2");
    expect(container.querySelector("sup")?.textContent).toBe("n");
  });

  it("shows front matter as details", () => {
    renderMd(`---
title: Demo
---

# Body
`);
    expect(screen.getByText("文档信息")).toBeInTheDocument();
    expect(screen.getByText(/title: Demo/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Body" })).toBeInTheDocument();
  });

  it("converts [TOC] into a nav", () => {
    const { container } = renderMd(`[TOC]

# One

## Two
`);
    expect(container.querySelector("nav.forkly-toc")).toBeTruthy();
    expect(screen.getByText("目录")).toBeInTheDocument();
  });
});
