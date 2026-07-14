export type SourcePos = { line: number; ch: number };

export type SourceSelection = {
  anchor: SourcePos;
  head: SourcePos;
};

export type SourceFormatResult = {
  text: string;
  selection: SourceSelection;
};

export type SourceInlineFormat =
  | "strong"
  | "em"
  | "del"
  | "inline_code"
  | "inline_math"
  | "link"
  | "image";

export type SourceBlockFormat =
  | "paragraph"
  | "heading 1"
  | "heading 2"
  | "heading 3"
  | "heading 4"
  | "heading 5"
  | "heading 6"
  | "blockquote"
  | "ul-bullet"
  | "ol-order"
  | "ul-task"
  | "pre"
  | "mathblock"
  | "table"
  | "hr";

type InlineMarker = {
  open: string;
  close: string;
};

const INLINE_MARKERS: Record<Exclude<SourceInlineFormat, "link" | "image">, InlineMarker> = {
  strong: { open: "**", close: "**" },
  em: { open: "*", close: "*" },
  del: { open: "~~", close: "~~" },
  inline_code: { open: "`", close: "`" },
  inline_math: { open: "$", close: "$" },
};

const HEADING_RE = /^(#{1,6})\s+/;
const BLOCKQUOTE_RE = /^>\s?/;
const UL_BULLET_RE = /^([-*+])\s+(?:\[[ xX]\]\s+)?/;
const OL_ORDER_RE = /^(\d+)\.\s+(?:\[[ xX]\]\s+)?/;
const UL_TASK_RE = /^([-*+])\s+\[[ xX]\]\s+/;

function comparePos(a: SourcePos, b: SourcePos): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.ch - b.ch;
}

function orderedSelection(sel: SourceSelection): { from: SourcePos; to: SourcePos } {
  if (comparePos(sel.anchor, sel.head) <= 0) {
    return { from: sel.anchor, to: sel.head };
  }
  return { from: sel.head, to: sel.anchor };
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function getLineRange(
  text: string,
  from: SourcePos,
  to: SourcePos,
): { lines: string[]; startLine: number; endLine: number } {
  const lines = splitLines(text);
  const startLine = Math.max(0, Math.min(from.line, lines.length - 1));
  const endLine = Math.max(startLine, Math.min(to.line, Math.max(lines.length - 1, 0)));
  return { lines, startLine, endLine };
}

function replaceRange(
  text: string,
  from: SourcePos,
  to: SourcePos,
  replacement: string,
): string {
  const lines = splitLines(text);
  const startLine = Math.max(0, from.line);
  const endLine = Math.max(0, to.line);
  while (lines.length <= endLine) lines.push("");

  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine + 1);
  const startLineText = lines[startLine] ?? "";
  const endLineText = lines[endLine] ?? "";
  const startCh = Math.max(0, Math.min(from.ch, startLineText.length));
  const endCh = Math.max(0, Math.min(to.ch, endLineText.length));

  const prefix = startLineText.slice(0, startCh);
  const suffix = endLineText.slice(endCh);
  const mid = splitLines(replacement);
  if (mid.length === 1) {
    return joinLines([...before, prefix + mid[0] + suffix, ...after]);
  }
  const first = prefix + mid[0];
  const last = mid[mid.length - 1] + suffix;
  return joinLines([...before, first, ...mid.slice(1, -1), last, ...after]);
}

function getSelectedText(text: string, from: SourcePos, to: SourcePos): string {
  if (from.line === to.line && from.ch === to.ch) return "";
  const lines = splitLines(text);
  if (from.line === to.line) {
    return (lines[from.line] ?? "").slice(from.ch, to.ch);
  }
  const parts: string[] = [];
  parts.push((lines[from.line] ?? "").slice(from.ch));
  for (let i = from.line + 1; i < to.line; i++) {
    parts.push(lines[i] ?? "");
  }
  parts.push((lines[to.line] ?? "").slice(0, to.ch));
  return parts.join("\n");
}

function offsetToPos(text: string, offset: number): SourcePos {
  const lines = splitLines(text);
  let remaining = Math.max(0, offset);
  for (let line = 0; line < lines.length; line++) {
    const len = lines[line].length;
    if (remaining <= len) return { line, ch: remaining };
    remaining -= len + 1;
  }
  const last = Math.max(lines.length - 1, 0);
  return { line: last, ch: (lines[last] ?? "").length };
}

function posToOffset(text: string, pos: SourcePos): number {
  const lines = splitLines(text);
  let offset = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  const lineText = lines[Math.min(pos.line, Math.max(lines.length - 1, 0))] ?? "";
  return offset + Math.max(0, Math.min(pos.ch, lineText.length));
}

function selectionAt(pos: SourcePos): SourceSelection {
  return { anchor: pos, head: pos };
}

function selectionRange(from: SourcePos, to: SourcePos): SourceSelection {
  return { anchor: from, head: to };
}

/** Keep labels single-line and free of tokens that break `[]()` / `![]()` syntax. */
export function sanitizeMarkdownLabel(raw: string): string {
  return raw.replace(/[\r\n\[\]]+/g, " ").replace(/\s+/g, " ").trim();
}

function unwrapInline(selected: string, marker: InlineMarker): string | null {
  if (
    selected.length >= marker.open.length + marker.close.length &&
    selected.startsWith(marker.open) &&
    selected.endsWith(marker.close)
  ) {
    return selected.slice(marker.open.length, selected.length - marker.close.length);
  }
  return null;
}

function applyInlineWrap(
  text: string,
  selection: SourceSelection,
  marker: InlineMarker,
): SourceFormatResult {
  const { from, to } = orderedSelection(selection);
  const selected = getSelectedText(text, from, to);
  if (!selected) {
    const insert = marker.open + marker.close;
    const next = replaceRange(text, from, to, insert);
    const cursor = { line: from.line, ch: from.ch + marker.open.length };
    return { text: next, selection: selectionAt(cursor) };
  }

  const unwrapped = unwrapInline(selected, marker);
  if (unwrapped != null) {
    const next = replaceRange(text, from, to, unwrapped);
    return {
      text: next,
      selection: selectionRange(from, {
        line: from.line + (unwrapped.includes("\n") ? unwrapped.split("\n").length - 1 : 0),
        ch:
          unwrapped.includes("\n")
            ? unwrapped.split("\n").pop()!.length
            : from.ch + unwrapped.length,
      }),
    };
  }

  const wrapped = marker.open + selected + marker.close;
  const next = replaceRange(text, from, to, wrapped);
  const endOffset = posToOffset(text, from) + wrapped.length;
  const end = offsetToPos(next, endOffset);
  return { text: next, selection: selectionRange(from, end) };
}

function applyLinkOrImage(
  text: string,
  selection: SourceSelection,
  kind: "link" | "image",
): SourceFormatResult {
  const { from, to } = orderedSelection(selection);
  const selected = getSelectedText(text, from, to);
  const fallback = kind === "image" ? "描述" : "链接文本";
  const label = sanitizeMarkdownLabel(selected) || fallback;
  const prefix = kind === "image" ? "![" : "[";
  const insert = `${prefix}${label}]()`;
  const next = replaceRange(text, from, to, insert);
  // Place cursor inside the empty parentheses for the URL.
  const openParen = prefix.length + label.length + 2; // ](
  const cursor = { line: from.line, ch: from.ch + openParen };
  return { text: next, selection: selectionAt(cursor) };
}

export function applyInlineFormat(
  text: string,
  selection: SourceSelection,
  format: SourceInlineFormat,
): SourceFormatResult {
  if (format === "link" || format === "image") {
    return applyLinkOrImage(text, selection, format);
  }
  return applyInlineWrap(text, selection, INLINE_MARKERS[format]);
}

function stripBlockPrefix(line: string): string {
  return line
    .replace(HEADING_RE, "")
    .replace(UL_TASK_RE, "")
    .replace(OL_ORDER_RE, "")
    .replace(UL_BULLET_RE, "")
    .replace(BLOCKQUOTE_RE, "");
}

function detectBlockKind(line: string): SourceBlockFormat | "plain" {
  const heading = line.match(HEADING_RE);
  if (heading) return `heading ${heading[1].length}` as SourceBlockFormat;
  if (UL_TASK_RE.test(line)) return "ul-task";
  if (OL_ORDER_RE.test(line)) return "ol-order";
  if (UL_BULLET_RE.test(line)) return "ul-bullet";
  if (BLOCKQUOTE_RE.test(line)) return "blockquote";
  return "plain";
}

function applyBlockPrefix(line: string, format: SourceBlockFormat): string {
  const content = stripBlockPrefix(line);
  switch (format) {
    case "paragraph":
      return content;
    case "heading 1":
      return `# ${content}`;
    case "heading 2":
      return `## ${content}`;
    case "heading 3":
      return `### ${content}`;
    case "heading 4":
      return `#### ${content}`;
    case "heading 5":
      return `##### ${content}`;
    case "heading 6":
      return `###### ${content}`;
    case "blockquote":
      return content ? `> ${content}` : "> ";
    case "ul-bullet":
      return content ? `- ${content}` : "- ";
    case "ol-order":
      return content ? `1. ${content}` : "1. ";
    case "ul-task":
      return content ? `- [ ] ${content}` : "- [ ] ";
    default:
      return line;
  }
}

function linePrefixLength(line: string, format: SourceBlockFormat): number {
  const next = applyBlockPrefix(line, format);
  const content = stripBlockPrefix(line);
  if (!content) return next.length;
  return next.length - content.length;
}

export function applyBlockFormat(
  text: string,
  selection: SourceSelection,
  format: SourceBlockFormat,
): SourceFormatResult {
  const { from, to } = orderedSelection(selection);

  if (format === "pre" || format === "mathblock" || format === "table" || format === "hr") {
    return insertBlockTemplate(text, from, format);
  }

  const { lines, startLine, endLine } = getLineRange(text, from, to);
  if (lines.length === 0) {
    const nextLine = applyBlockPrefix("", format);
    return {
      text: nextLine,
      selection: selectionAt({ line: 0, ch: nextLine.length }),
    };
  }

  const allSame = lines
    .slice(startLine, endLine + 1)
    .every((line) => detectBlockKind(line) === format);

  const nextLines = lines.map((line, index) => {
    if (index < startLine || index > endLine) return line;
    if (allSame) return stripBlockPrefix(line);
    return applyBlockPrefix(line, format);
  });

  const next = joinLines(nextLines);
  const first = lines[startLine] ?? "";
  const firstNext = nextLines[startLine] ?? "";
  const oldPrefixLen = first.length - stripBlockPrefix(first).length;
  const newPrefixLen = allSame ? 0 : linePrefixLength(first, format);
  const caretCh = Math.max(
    0,
    Math.min(firstNext.length, from.ch - oldPrefixLen + newPrefixLen),
  );

  return {
    text: next,
    selection: selectionAt({ line: startLine, ch: caretCh }),
  };
}

function insertBlockTemplate(
  text: string,
  at: SourcePos,
  format: Exclude<SourceBlockFormat, "paragraph" | `heading ${number}` | "blockquote" | "ul-bullet" | "ol-order" | "ul-task">,
): SourceFormatResult {
  let template: string;
  let cursorOffsetInTemplate: number;

  switch (format) {
    case "pre":
      template = "```\n\n```";
      cursorOffsetInTemplate = 4; // after ```\n
      break;
    case "mathblock":
      template = "$$\n\n$$";
      cursorOffsetInTemplate = 3; // after $$\n
      break;
    case "table":
      template = "| 列1 | 列2 |\n| --- | --- |\n|  |  |";
      cursorOffsetInTemplate = 2; // after "| "
      break;
    case "hr":
      template = "---\n\n";
      cursorOffsetInTemplate = 5; // after ---\n\n
      break;
  }

  const lines = splitLines(text);
  const lineText = lines[at.line] ?? "";
  const atLineStart = at.ch === 0;
  const atLineEnd = at.ch >= lineText.length;
  const needsLeadingNewline = !(atLineStart || (atLineEnd && lineText.length === 0));
  const insert = (needsLeadingNewline ? "\n" : "") + template;
  const next = replaceRange(text, at, at, insert);
  const startOffset = posToOffset(text, at) + (needsLeadingNewline ? 1 : 0) + cursorOffsetInTemplate;
  const cursor = offsetToPos(next, startOffset);
  return { text: next, selection: selectionAt(cursor) };
}

/** Insert a literal snippet and optionally select a relative range inside it. */
export function insertSnippet(
  text: string,
  selection: SourceSelection,
  snippet: string,
  select?: { start: number; end: number },
): SourceFormatResult {
  const { from, to } = orderedSelection(selection);
  const next = replaceRange(text, from, to, snippet);
  if (!select) {
    const end = offsetToPos(next, posToOffset(text, from) + snippet.length);
    return { text: next, selection: selectionAt(end) };
  }
  const start = offsetToPos(next, posToOffset(text, from) + select.start);
  const end = offsetToPos(next, posToOffset(text, from) + select.end);
  return { text: next, selection: selectionRange(start, end) };
}

export function applySourceFormatCommand(
  text: string,
  selection: SourceSelection,
  command: string,
): SourceFormatResult | null {
  if (
    command === "strong" ||
    command === "em" ||
    command === "del" ||
    command === "inline_code" ||
    command === "inline_math" ||
    command === "link" ||
    command === "image"
  ) {
    return applyInlineFormat(text, selection, command);
  }
  if (command.startsWith("para:")) {
    const type = command.slice(5) as SourceBlockFormat;
    return applyBlockFormat(text, selection, type);
  }
  return null;
}
