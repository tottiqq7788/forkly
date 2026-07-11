import type { MouseEvent, ReactNode } from "react";
import { resolveMarkdownLink } from "./markdownPath";

type Props = {
  href?: string;
  children?: ReactNode;
  ownerPath: string;
  onOpenPath: (path: string, fragment?: string) => void;
  scrollRoot?: HTMLElement | null;
};

export function MarkdownLink({ href = "", children, ownerPath, onOpenPath, scrollRoot }: Props) {
  const resolved = resolveMarkdownLink(ownerPath, href);

  if (resolved.kind === "blocked") {
    return <span className="forkly-md-link-blocked">{children}</span>;
  }

  if (resolved.kind === "fragment") {
    return (
      <a
        href={`#${resolved.fragment}`}
        className="forkly-md-link"
        onClick={(e) => {
          e.preventDefault();
          scrollToId(resolved.fragment, scrollRoot);
        }}
      >
        {children}
      </a>
    );
  }

  if (resolved.kind === "external") {
    return (
      <a
        href={resolved.href}
        className="forkly-md-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={`#/${resolved.path}${resolved.fragment ? `#${resolved.fragment}` : ""}`}
      className="forkly-md-link"
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        onOpenPath(resolved.path, resolved.fragment || undefined);
      }}
    >
      {children}
    </a>
  );
}

export function scrollToId(id: string, root?: HTMLElement | null) {
  if (!id) return;
  const decoded = (() => {
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  })();
  const escaped = CSS.escape(decoded);
  // Prefer the preview root so same-id headings outside the markdown pane are ignored.
  const el = root
    ? root.querySelector(`#${escaped}`) ?? root.querySelector(`[id="${escaped}"]`)
    : document.getElementById(decoded);
  if (el && "scrollIntoView" in el) {
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
