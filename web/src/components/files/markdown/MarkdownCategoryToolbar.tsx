import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Code,
  Function as FunctionIcon,
  Image as ImageIcon,
  Link as LinkIcon,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  Minus,
  Paragraph,
  Quotes,
  Table,
  TextB,
  TextH,
  TextItalic,
  TextStrikethrough,
  TextT,
  CheckSquare,
  Plus,
  ArrowsClockwise,
} from "@phosphor-icons/react";

export type FormatCommand =
  | "undo"
  | "redo"
  | "para:paragraph"
  | "para:heading 1"
  | "para:heading 2"
  | "para:heading 3"
  | "para:heading 4"
  | "para:heading 5"
  | "para:heading 6"
  | "para:blockquote"
  | "para:ul-bullet"
  | "para:ol-order"
  | "para:ul-task"
  | "strong"
  | "em"
  | "del"
  | "inline_code"
  | "link"
  | "image"
  | "inline_math"
  | "para:mathblock"
  | "para:pre"
  | "para:table"
  | "para:hr"
  | "find:open"
  | "find:previous"
  | "find:next"
  | "find:replace";

type ToolItem = {
  id: string;
  label: string;
  title: string;
  icon: ReactNode;
  command: FormatCommand;
  disabled?: boolean;
};

type ToolCategory = {
  id: string;
  label: string;
  title: string;
  icon: ReactNode;
  items: ToolItem[];
};

type Props = {
  onCommand: (cmd: FormatCommand) => void;
  findOpen?: boolean;
  findQuery?: string;
};

const CLOSE_DELAY_MS = 160;

function buildCategories(findQuery: string): ToolCategory[] {
  const hasQuery = findQuery.trim().length > 0;
  return [
    {
      id: "history",
      label: "历史",
      title: "历史操作",
      icon: <ArrowsClockwise size={18} />,
      items: [
        {
          id: "undo",
          label: "撤销",
          title: "撤销",
          icon: <ArrowCounterClockwise size={18} />,
          command: "undo",
        },
        {
          id: "redo",
          label: "重做",
          title: "重做",
          icon: <ArrowClockwise size={18} />,
          command: "redo",
        },
      ],
    },
    {
      id: "heading",
      label: "标题",
      title: "标题样式",
      icon: <TextH size={18} />,
      items: [1, 2, 3, 4, 5, 6].map((level) => ({
        id: `h${level}`,
        label: `标题${level}`,
        title: `标题 ${level}`,
        icon: <TextH size={18} />,
        command: `para:heading ${level}` as FormatCommand,
      })),
    },
    {
      id: "paragraph",
      label: "段落",
      title: "段落样式",
      icon: <Paragraph size={18} />,
      items: [
        {
          id: "paragraph",
          label: "正文",
          title: "段落",
          icon: <Paragraph size={18} />,
          command: "para:paragraph",
        },
        {
          id: "quote",
          label: "引用",
          title: "引用",
          icon: <Quotes size={18} />,
          command: "para:blockquote",
        },
        {
          id: "ul",
          label: "无序",
          title: "无序列表",
          icon: <ListBullets size={18} />,
          command: "para:ul-bullet",
        },
        {
          id: "ol",
          label: "有序",
          title: "有序列表",
          icon: <ListNumbers size={18} />,
          command: "para:ol-order",
        },
        {
          id: "task",
          label: "任务",
          title: "任务列表",
          icon: <CheckSquare size={18} />,
          command: "para:ul-task",
        },
      ],
    },
    {
      id: "text",
      label: "文字",
      title: "文字样式",
      icon: <TextB size={18} />,
      items: [
        {
          id: "strong",
          label: "粗体",
          title: "粗体",
          icon: <TextB size={18} />,
          command: "strong",
        },
        {
          id: "em",
          label: "斜体",
          title: "斜体",
          icon: <TextItalic size={18} />,
          command: "em",
        },
        {
          id: "del",
          label: "删除",
          title: "删除线",
          icon: <TextStrikethrough size={18} />,
          command: "del",
        },
        {
          id: "code",
          label: "代码",
          title: "行内代码",
          icon: <Code size={18} />,
          command: "inline_code",
        },
      ],
    },
    {
      id: "insert",
      label: "插入",
      title: "插入内容",
      icon: <Plus size={18} />,
      items: [
        {
          id: "link",
          label: "链接",
          title: "链接",
          icon: <LinkIcon size={18} />,
          command: "link",
        },
        {
          id: "image",
          label: "图片",
          title: "图片",
          icon: <ImageIcon size={18} />,
          command: "image",
        },
        {
          id: "inline-math",
          label: "行内式",
          title: "行内公式",
          icon: <FunctionIcon size={18} />,
          command: "inline_math",
        },
        {
          id: "math-block",
          label: "块公式",
          title: "块公式",
          icon: <FunctionIcon size={18} />,
          command: "para:mathblock",
        },
        {
          id: "code-block",
          label: "代码块",
          title: "代码块",
          icon: <Code size={18} />,
          command: "para:pre",
        },
        {
          id: "table",
          label: "表格",
          title: "表格",
          icon: <Table size={18} />,
          command: "para:table",
        },
        {
          id: "hr",
          label: "分隔",
          title: "分隔线",
          icon: <Minus size={18} />,
          command: "para:hr",
        },
      ],
    },
    {
      id: "find",
      label: "查找",
      title: "查找替换",
      icon: <MagnifyingGlass size={18} />,
      items: [
        {
          id: "find-open",
          label: "打开",
          title: "打开查找",
          icon: <MagnifyingGlass size={18} />,
          command: "find:open",
        },
        {
          id: "find-prev",
          label: "上一个",
          title: "上一个匹配",
          icon: <TextT size={18} />,
          command: "find:previous",
          disabled: !hasQuery,
        },
        {
          id: "find-next",
          label: "下一个",
          title: "下一个匹配",
          icon: <TextT size={18} />,
          command: "find:next",
          disabled: !hasQuery,
        },
        {
          id: "find-replace",
          label: "替换",
          title: "替换当前",
          icon: <ArrowsClockwise size={18} />,
          command: "find:replace",
          disabled: !hasQuery,
        },
      ],
    },
  ];
}

export function MarkdownCategoryToolbar({
  onCommand,
  findOpen = false,
  findQuery = "",
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const categories = buildCategories(findQuery);

  function clearCloseTimer() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }

  function openCategory(id: string) {
    clearCloseTimer();
    setOpenId(id);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenId(null);
    }
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpenId(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
      clearCloseTimer();
    };
  }, []);

  useEffect(() => {
    if (!findOpen && openId === "find") {
      // keep flyout available while findbar is open only if user wants; no-op
    }
  }, [findOpen, openId]);

  return (
    <div ref={rootRef} className="forkly-md-category-rail" role="toolbar" aria-label="Markdown 格式">
      {categories.map((category) => {
        const open = openId === category.id;
        return (
          <div
            key={category.id}
            className="forkly-md-category-wrap"
            onMouseEnter={() => openCategory(category.id)}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              className={`forkly-md-category-btn ${open ? "is-open" : ""}`}
              title={category.title}
              aria-label={category.title}
              aria-expanded={open}
              aria-haspopup="true"
              onFocus={() => openCategory(category.id)}
              onClick={() => setOpenId(open ? null : category.id)}
            >
              <span className="forkly-md-tool-icon">{category.icon}</span>
              <span className="forkly-md-tool-label">{category.label}</span>
            </button>
            {open ? (
              <div
                className="forkly-md-category-flyout"
                role="menu"
                aria-label={category.title}
                onMouseEnter={() => openCategory(category.id)}
                onMouseLeave={scheduleClose}
              >
                {category.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="forkly-md-category-btn"
                    title={item.title}
                    aria-label={item.title}
                    disabled={item.disabled}
                    onClick={() => {
                      onCommand(item.command);
                      if (!item.command.startsWith("find:")) setOpenId(null);
                    }}
                  >
                    <span className="forkly-md-tool-icon">{item.icon}</span>
                    <span className="forkly-md-tool-label">{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default MarkdownCategoryToolbar;
