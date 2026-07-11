const MARKDOWN_EXTENSIONS = [
  ".md",
  ".markdown",
  ".mdown",
  ".mkdn",
  ".mkd",
  ".mdwn",
  ".mdtxt",
  ".mdtext",
] as const;

export function isMarkdownPath(path: string): boolean {
  const lower = path.trim().toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
