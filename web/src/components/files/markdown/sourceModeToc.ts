/** Minimal CodeMirror surface `scrollSourceEditorToLine` needs. */
export type SourceEditorLike = {
  setCursor: (
    pos: { line: number; ch: number },
    ch?: number | null,
    options?: { scroll?: boolean },
  ) => void;
  heightAtLine: (line: number, mode: "local" | "page" | "div") => number;
};

/**
 * Scroll so `line` sits near the top of the outer scroll container.
 * CodeMirror with `viewportMargin: Infinity` does not scroll its own pane.
 */
export function scrollSourceEditorToLine(
  editor: SourceEditorLike,
  line: number,
  scrollContainer: HTMLElement | null | undefined,
): void {
  editor.setCursor({ line, ch: 0 }, null, { scroll: false });
  if (!scrollContainer) return;
  const top = editor.heightAtLine(line, "local");
  scrollContainer.scrollTo({ top, behavior: "smooth" });
}

/** Collect 0-based ATX/setext heading lines, skipping fenced code. */
export function findMarkdownHeadingLines(markdown: string): number[] {
  const lines = markdown.split("\n");
  const headingLines: number[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) {
      headingLines.push(i);
      continue;
    }

    const next = lines[i + 1];
    if (line.trim() !== "" && next !== undefined && /^ {0,3}(?:=+|-+)\s*$/.test(next)) {
      headingLines.push(i);
      i++;
    }
  }

  return headingLines;
}

/**
 * Find the 0-based line of the `headingIndex`-th markdown heading.
 * Returns -1 when not found.
 */
export function findMarkdownHeadingLine(markdown: string, headingIndex: number): number {
  if (headingIndex < 0) return -1;
  return findMarkdownHeadingLines(markdown)[headingIndex] ?? -1;
}
