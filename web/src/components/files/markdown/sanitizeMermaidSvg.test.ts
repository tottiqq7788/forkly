import { describe, expect, it } from "vitest";
import { sanitizeMermaidSvg } from "./MermaidBlock";

describe("sanitizeMermaidSvg", () => {
  it("keeps flowchart labels inside foreignObject", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <rect width="120" height="40" fill="#eee"/>
  <foreignObject x="0" y="0" width="120" height="40">
    <div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">开始</span></div>
  </foreignObject>
</svg>`;
    const out = sanitizeMermaidSvg(svg);
    expect(out.toLowerCase()).toContain("foreignobject");
    expect(out).toContain("开始");
    expect(out).toContain("nodeLabel");
  });

  it("still strips script and event handlers", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
  <foreignObject width="100" height="40">
    <div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(1)">
      <script>alert(1)</script>
      <span>安全文字</span>
    </div>
  </foreignObject>
</svg>`;
    const out = sanitizeMermaidSvg(svg);
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out).toContain("安全文字");
  });

  it("strips anchor tags used as navigation vectors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
  <a href="javascript:alert(1)"><text>x</text></a>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><a href="https://evil.example">y</a></div></foreignObject>
</svg>`;
    const out = sanitizeMermaidSvg(svg);
    expect(out.toLowerCase()).not.toMatch(/<a[\s>]/);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });
});
