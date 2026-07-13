import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/markdown/markdown";
import "codemirror/addon/search/searchcursor";
import "codemirror/addon/selection/active-line";
import "./markdown-source.css";
import type { SearchOpts, SearchResult } from "./MarkdownEditorView";

export type IndexCursor = {
  anchor: { line: number; ch: number };
  focus: { line: number; ch: number };
};

export type MarkdownSourceEditorHandle = {
  getValue: () => string;
  setValue: (markdown: string) => void;
  getIndexCursor: () => IndexCursor | null;
  setIndexCursor: (cursor: IndexCursor | null) => void;
  focus: () => void;
  undo: () => void;
  redo: () => void;
  search: (value: string, opts?: SearchOpts) => SearchResult;
  find: (action: "previous" | "next") => SearchResult;
  replace: (value: string, opt?: { isSingle?: boolean; isRegexp?: boolean }) => SearchResult;
  scrollToLine: (line: number) => void;
  heightAtLine: (line: number) => number;
};

type Props = {
  markdown: string;
  cursor?: IndexCursor | null;
  onChange?: () => void;
  onReady?: () => void;
};

type SearchMatch = { from: CodeMirror.Position; to: CodeMirror.Position };

type SearchState = {
  query: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
  matches: SearchMatch[];
  index: number;
};

type SearchCursor = {
  findNext: () => boolean;
  from: () => CodeMirror.Position;
  to: () => CodeMirror.Position;
};

type EditorWithSearch = CodeMirror.Editor & {
  getSearchCursor: (
    query: string | RegExp,
    pos?: CodeMirror.Position,
    caseFold?: boolean,
  ) => SearchCursor;
};

const EMPTY_SEARCH: SearchResult = { matches: [], index: -1 };

export const MarkdownSourceEditorView = forwardRef<MarkdownSourceEditorHandle, Props>(
  function MarkdownSourceEditorView({ markdown, cursor = null, onChange, onReady }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const cmRef = useRef<CodeMirror.Editor | null>(null);
    const searchRef = useRef<SearchState>({
      query: "",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
      matches: [],
      index: -1,
    });
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const suppressChangeRef = useRef(false);

    useImperativeHandle(ref, () => ({
      getValue: () => cmRef.current?.getValue() ?? "",
      setValue: (value) => {
        const cm = cmRef.current;
        if (!cm || cm.getValue() === value) return;
        suppressChangeRef.current = true;
        const scrollInfo = cm.getScrollInfo();
        cm.setValue(value);
        cm.scrollTo(scrollInfo.left, scrollInfo.top);
        suppressChangeRef.current = false;
      },
      getIndexCursor: () => {
        const cm = cmRef.current;
        if (!cm) return null;
        return {
          anchor: cm.getCursor("anchor"),
          focus: cm.getCursor("head"),
        };
      },
      setIndexCursor: (next) => {
        const cm = cmRef.current;
        if (!cm) return;
        if (next?.anchor && next.focus) {
          cm.setSelection(next.anchor, next.focus, { scroll: true });
        } else {
          cm.setCursor({ line: 0, ch: 0 });
        }
      },
      focus: () => cmRef.current?.focus(),
      undo: () => cmRef.current?.execCommand("undo"),
      redo: () => cmRef.current?.execCommand("redo"),
      search: (value, opts) => runSearch(cmRef.current, searchRef.current, value, opts),
      find: (action) => stepSearch(cmRef.current, searchRef.current, action),
      replace: (value, opt) =>
        replaceSearch(cmRef.current, searchRef.current, value, opt?.isSingle !== false),
      scrollToLine: (line) => {
        cmRef.current?.setCursor({ line, ch: 0 }, undefined, { scroll: false });
      },
      heightAtLine: (line) => cmRef.current?.heightAtLine(line, "local") ?? 0,
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const cm = CodeMirror(host, {
        value: markdown,
        mode: "markdown",
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true,
        viewportMargin: Infinity,
        autofocus: true,
      });
      cmRef.current = cm;

      if (cursor?.anchor && cursor.focus) {
        cm.setSelection(cursor.anchor, cursor.focus, { scroll: true });
      } else {
        cm.setCursor({ line: 0, ch: 0 });
      }

      cm.on("changes", () => {
        if (suppressChangeRef.current) return;
        onChangeRef.current?.();
      });

      onReady?.();

      return () => {
        host.replaceChildren();
        cmRef.current = null;
      };
      // Mount once; content sync goes through imperative setValue / cursor props.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const cm = cmRef.current;
      if (!cm || cm.getValue() === markdown) return;
      suppressChangeRef.current = true;
      const scrollInfo = cm.getScrollInfo();
      const cursorPos = cm.getCursor();
      cm.setValue(markdown);
      try {
        cm.setCursor(cursorPos);
      } catch {
        cm.setCursor({ line: 0, ch: 0 });
      }
      cm.scrollTo(scrollInfo.left, scrollInfo.top);
      suppressChangeRef.current = false;
    }, [markdown]);

    return (
      <div
        ref={hostRef}
        className="forkly-md-source-editor"
        data-testid="markdown-source-editor"
      />
    );
  },
);

function collectMatches(
  cm: CodeMirror.Editor,
  query: string | RegExp,
  caseFold?: boolean,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const cursor = (cm as EditorWithSearch).getSearchCursor(query, { line: 0, ch: 0 }, caseFold);
  while (cursor.findNext()) {
    matches.push({ from: cursor.from(), to: cursor.to() });
  }
  return matches;
}

function runSearch(
  cm: CodeMirror.Editor | null,
  state: SearchState,
  value: string,
  opts?: SearchOpts,
): SearchResult {
  if (!cm) return EMPTY_SEARCH;
  if (!value) {
    state.query = "";
    state.matches = [];
    state.index = -1;
    return EMPTY_SEARCH;
  }

  const caseSensitive = !!opts?.isCaseSensitive;
  const regexp = !!opts?.isRegexp;
  const wholeWord = !!opts?.isWholeWord;
  let matches: SearchMatch[] = [];

  try {
    if (regexp || wholeWord) {
      const source = regexp ? value : `\\b${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;
      const re = new RegExp(source, caseSensitive ? "g" : "gi");
      matches = collectMatches(cm, re);
    } else {
      matches = collectMatches(cm, value, !caseSensitive);
    }
  } catch {
    return { matches: [], index: -1 };
  }

  state.query = value;
  state.caseSensitive = caseSensitive;
  state.regexp = regexp;
  state.wholeWord = wholeWord;
  state.matches = matches;
  state.index = matches.length > 0 ? 0 : -1;
  if (state.index >= 0) {
    const m = matches[state.index];
    cm.setSelection(m.from, m.to, { scroll: true });
  }
  return { matches, index: state.index };
}

function stepSearch(
  cm: CodeMirror.Editor | null,
  state: SearchState,
  action: "previous" | "next",
): SearchResult {
  if (!cm || state.matches.length === 0) return { matches: state.matches, index: -1 };
  if (action === "next") {
    state.index = (state.index + 1) % state.matches.length;
  } else {
    state.index = (state.index - 1 + state.matches.length) % state.matches.length;
  }
  const m = state.matches[state.index];
  cm.setSelection(m.from, m.to, { scroll: true });
  return { matches: state.matches, index: state.index };
}

function replaceSearch(
  cm: CodeMirror.Editor | null,
  state: SearchState,
  replacement: string,
  single: boolean,
): SearchResult {
  if (!cm || state.matches.length === 0 || state.index < 0) {
    return { matches: state.matches, index: state.index };
  }
  if (single) {
    const m = state.matches[state.index];
    cm.replaceRange(replacement, m.from, m.to);
  } else {
    for (let i = state.matches.length - 1; i >= 0; i--) {
      const m = state.matches[i];
      cm.replaceRange(replacement, m.from, m.to);
    }
  }
  return runSearch(cm, state, state.query, {
    isCaseSensitive: state.caseSensitive,
    isRegexp: state.regexp,
    isWholeWord: state.wholeWord,
  });
}

export default MarkdownSourceEditorView;
