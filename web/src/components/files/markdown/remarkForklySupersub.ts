import type { Root, Text, Parent } from "mdast";
import { visit } from "unist-util-visit";

function transformValue(value: string, delim: string, tag: "sup" | "sub"): Array<Text | Record<string, unknown>> | null {
  if (!value.includes(delim)) return null;
  const parts = value.split(delim);
  if (parts.length < 3 || parts.length % 2 === 0) return null;
  return parts.map((str, i) =>
    i % 2 === 0
      ? ({ type: "text", value: str } as Text)
      : {
          type: tag === "sup" ? "superscript" : "subscript",
          data: { hName: tag, hChildren: [{ type: "text", value: str }] },
          children: [{ type: "text", value: str }],
        },
  );
}

function applyDelim(tree: Root, delim: string, tag: "sup" | "sub") {
  const replacements: { parent: Parent; index: number; nodes: unknown[] }[] = [];
  visit(tree, "text", (node, index, parent) => {
    if (index == null || !parent) return;
    const next = transformValue(node.value, delim, tag);
    if (!next) return;
    replacements.push({ parent: parent as Parent, index, nodes: next });
  });
  // Apply from the end so earlier indexes stay valid.
  for (const item of replacements.sort((a, b) => b.index - a.index)) {
    item.parent.children.splice(item.index, 1, ...(item.nodes as Parent["children"]));
  }
}

/** MarkText-style `^sup^` / `~sub~` (requires remark-gfm singleTilde:false). */
export function remarkForklySupersub() {
  return (tree: Root) => {
    applyDelim(tree, "^", "sup");
    applyDelim(tree, "~", "sub");
  };
}
