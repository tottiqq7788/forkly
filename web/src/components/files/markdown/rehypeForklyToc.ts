import type { Root, Element, ElementContent, Text } from "hast";
import { visit } from "unist-util-visit";
import { toString as hastToString } from "hast-util-to-string";

function isText(node: ElementContent): node is Text {
  return node.type === "text";
}

function isTocParagraph(node: Element): boolean {
  if (node.tagName !== "p") return false;
  if (node.children.length !== 1) return false;
  const only = node.children[0];
  return isText(only) && only.value.trim() === "[TOC]";
}

/** Replace standalone `[TOC]` paragraphs with a generated heading list. */
export function rehypeForklyToc() {
  return (tree: Root) => {
    const headings: { id: string; text: string; depth: number }[] = [];
    visit(tree, "element", (node) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      const depth = Number(node.tagName.slice(1));
      const id = typeof node.properties?.id === "string" ? node.properties.id : "";
      if (!id) return;
      headings.push({ id, text: hastToString(node).trim(), depth });
    });

    visit(tree, "element", (node, index, parent) => {
      if (!parent || typeof index !== "number" || !isTocParagraph(node)) return;
      const items: Element[] = headings.map((h) => ({
        type: "element",
        tagName: "li",
        properties: { className: [`toc-depth-${h.depth}`] },
        children: [
          {
            type: "element",
            tagName: "a",
            properties: { href: `#${h.id}` },
            children: [{ type: "text", value: h.text }],
          },
        ],
      }));
      const toc: Element = {
        type: "element",
        tagName: "nav",
        properties: { className: ["forkly-toc"], "aria-label": "目录" },
        children: [
          {
            type: "element",
            tagName: "p",
            properties: { className: ["forkly-toc-title"] },
            children: [{ type: "text", value: "目录" }],
          },
          {
            type: "element",
            tagName: "ul",
            properties: {},
            children: items,
          },
        ],
      };
      parent.children[index] = toc;
    });
  };
}

export function extractFrontMatter(source: string): { matter: string | null; body: string } {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { matter: null, body: source };
  }
  const rest = source.slice(3).replace(/^\r?\n/, "");
  const end = rest.search(/\r?\n---(?:\r?\n|$)/);
  if (end < 0) return { matter: null, body: source };
  const matter = rest.slice(0, end).trim();
  const after = rest.slice(end).replace(/^\r?\n---\r?\n?/, "");
  return { matter: matter || null, body: after };
}
