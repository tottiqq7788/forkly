import { useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkEmoji from "remark-emoji";
import remarkCjkFriendly from "remark-cjk-friendly";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import { BrowseSource } from "../../../api";
import { markdownSanitizeSchema } from "./sanitizeSchema";
import { extractFrontMatter, rehypeForklyToc } from "./rehypeForklyToc";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownLink, scrollToId } from "./MarkdownLink";
import { MermaidBlock } from "./MermaidBlock";
import { remarkForklySupersub } from "./remarkForklySupersub";
import "katex/dist/katex.min.css";
import "./markdown-preview.css";

export type MarkdownPreviewViewProps = {
  content: string;
  projectID: string;
  source: BrowseSource;
  ownerPath: string;
  onOpenPath: (path: string, fragment?: string) => void;
  pendingFragment?: string;
  onFragmentConsumed?: () => void;
};

export function MarkdownPreviewView({
  content,
  projectID,
  source,
  ownerPath,
  onOpenPath,
  pendingFragment = "",
  onFragmentConsumed,
}: MarkdownPreviewViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { matter, body } = useMemo(() => extractFrontMatter(content), [content]);

  useEffect(() => {
    if (!pendingFragment) return;
    const t = window.setTimeout(() => {
      scrollToId(pendingFragment, rootRef.current);
      onFragmentConsumed?.();
    }, 50);
    return () => window.clearTimeout(t);
  }, [pendingFragment, content, onFragmentConsumed]);

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <MarkdownLink
          href={href}
          ownerPath={ownerPath}
          onOpenPath={onOpenPath}
          scrollRoot={rootRef.current}
        >
          {children}
        </MarkdownLink>
      ),
      img: ({ src, alt, title }) => (
        <MarkdownImage
          src={typeof src === "string" ? src : undefined}
          alt={alt ?? ""}
          title={typeof title === "string" ? title : undefined}
          projectID={projectID}
          source={source}
          ownerPath={ownerPath}
        />
      ),
      input: (props) => {
        if (props.type === "checkbox") {
          return <input type="checkbox" checked={!!props.checked} disabled readOnly />;
        }
        return null;
      },
      code: ({ className, children, ...rest }) => {
        const match = /language-(\w+)/.exec(className || "");
        const lang = match?.[1]?.toLowerCase();
        const text = String(children).replace(/\n$/, "");
        const isBlock = Boolean(className) || text.includes("\n");
        if (isBlock && lang === "mermaid") {
          return <MermaidBlock code={text} />;
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      },
    }),
    [onOpenPath, ownerPath, projectID, source],
  );

  const remarkPlugins = useMemo<PluggableList>(
    () => [
      // singleTilde:false keeps `~sub~` for MarkText-style subscript; use `~~del~~` for strike.
      // Skip remark-cjk-friendly-gfm-strikethrough: it re-enables single-tilde strike at parse time.
      [remarkGfm, { singleTilde: false }],
      remarkForklySupersub,
      remarkCjkFriendly,
      remarkMath,
      remarkEmoji,
    ],
    [],
  );

  const rehypePlugins = useMemo<PluggableList>(
    () => [
      rehypeRaw,
      [rehypeSanitize, markdownSanitizeSchema],
      rehypeSlug,
      rehypeForklyToc,
      [rehypeKatex, { throwOnError: false, strict: "ignore" }],
      [rehypeHighlight, { detect: false, ignoreMissing: true }],
    ],
    [],
  );

  return (
    <div className="forkly-markdown" ref={rootRef}>
      {matter ? (
        <details className="forkly-md-frontmatter">
          <summary>文档信息</summary>
          <pre>{matter}</pre>
        </details>
      ) : null}
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {body}
      </Markdown>
    </div>
  );
}

export default MarkdownPreviewView;
