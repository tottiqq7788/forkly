import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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

describe("markdown security", () => {
  it("strips script tags", () => {
    const { container } = renderMd(`before

<script>alert(1)</script>

after`);
    expect(container.innerHTML).not.toMatch(/<script/i);
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("strips event handlers from raw html", () => {
    const { container } = renderMd(`<a href="https://example.com" onclick="alert(1)">x</a>`);
    expect(container.innerHTML).not.toContain("onclick");
    expect(container.innerHTML).not.toContain("alert(1)");
  });

  it("blocks javascript and vbscript links", () => {
    const { container } = renderMd(`[x](javascript:alert(1))

[y](vbscript:msgbox(1))`);
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector('a[href^="vbscript"]')).toBeNull();
  });

  it("blocks dangerous data and iframe/object/embed", () => {
    const { container } = renderMd(`![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

<iframe src="https://evil"></iframe>
<object data="https://evil"></object>
<embed src="https://evil"></embed>
<style>body{display:none}</style>`);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain("data:text/html");
  });

  it("does not keep raw svg script vectors", () => {
    const { container } = renderMd(`<svg><script>alert(1)</script></svg>`);
    expect(container.innerHTML).not.toMatch(/<script/i);
  });

  it("keeps safe data image urls through sanitize for MarkdownImage", () => {
    const data = "data:image/png;base64,iVBORw0KGgo=";
    const { container } = renderMd(`![x](${data})`);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(data);
  });

  it("still strips dangerous data urls", () => {
    const { container } = renderMd(`![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)`);
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain("data:text/html");
  });
});
