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

function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed", "a"],
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
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: forklyTheme(),
        });
        const id = `forkly-mermaid-${reactId}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled.current) return;
        setHtml(sanitizeMermaidSvg(svg));
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : "图表渲染失败");
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
