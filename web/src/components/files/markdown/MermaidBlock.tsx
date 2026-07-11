import { useEffect, useId, useRef, useState } from "react";
import DOMPurify from "dompurify";

type Props = {
  code: string;
};

function forklyTheme(): "default" | "dark" {
  if (typeof document === "undefined") return "default";
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === "dark") return "dark";
  if (root.getAttribute("data-theme") === "light") return "default";
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "default";
  } catch {
    return "default";
  }
}

/**
 * Mermaid flowcharts put node labels in SVG `<foreignObject>` + XHTML.
 * DOMPurify ≥3.1.7 no longer treats foreignObject as an HTML integration
 * point by default, so without HTML_INTEGRATION_POINTS the tag stays but
 * inner labels are wiped — shapes render, text disappears.
 * @see https://github.com/cure53/DOMPurify/issues/1002
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ["foreignObject", "div", "span", "p", "br", "b", "i", "em", "strong", "ul", "ol", "li"],
    ADD_ATTR: ["dominant-baseline", "class", "style", "xmlns"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "a"],
    FORBID_ATTR: ["onclick", "onload", "onerror", "onmouseover", "href", "xlink:href"],
  });
}

export function MermaidBlock({ code }: Props) {
  const reactId = useId().replace(/:/g, "");
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string>("");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setHtml("");
    setError("");
    let timer = 0;

    async function run() {
      // Mermaid v11 appends a temporary measure node to body when no host is
      // given; that briefly grows document scroll height and flashes a
      // scrollbar. A fixed off-screen host keeps measurement without layout
      // impact. Gantt (and some other diagrams) read parent.offsetWidth, so
      // the host must have a real width — zero-size hosts yield empty SVGs.
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      const measureWidth = Math.max(
        640,
        Math.min(1200, Math.floor(window.innerWidth || 800) - 48),
      );
      host.style.cssText = [
        "position:fixed",
        "left:-9999px",
        "top:0",
        "visibility:hidden",
        "pointer-events:none",
        `width:${measureWidth}px`,
        "height:auto",
        "overflow:hidden",
      ].join(";");
      document.body.appendChild(host);
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: forklyTheme(),
        });
        const id = `forkly-mermaid-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, code, host);
        if (cancelled.current) return;
        setHtml(sanitizeMermaidSvg(svg));
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : "图表渲染失败");
      } finally {
        host.remove();
      }
    }

    timer = window.setTimeout(() => {
      void run();
    }, 0);

    return () => {
      cancelled.current = true;
      window.clearTimeout(timer);
    };
  }, [code, reactId]);

  if (error) {
    return (
      <div className="forkly-mermaid-error">
        <p className="forkly-mermaid-error-title">Mermaid 渲染失败</p>
        <p className="forkly-mermaid-error-msg">{error}</p>
        <pre className="forkly-mermaid-source">{code}</pre>
      </div>
    );
  }

  if (!html) {
    return <p className="forkly-mermaid-loading">加载图表…</p>;
  }

  return (
    <div
      className="forkly-mermaid"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
