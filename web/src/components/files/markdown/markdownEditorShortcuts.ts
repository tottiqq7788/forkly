export type MarkdownShortcutRow = {
  id: string;
  action: string;
  keys: string;
  note?: string;
};

export type MarkdownShortcutGroup = {
  id: string;
  title: string;
  rows: MarkdownShortcutRow[];
};

/** macOS uses ⌘; Windows/Linux use Ctrl. */
export function modifierLabel(platform = navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl";
}

export function optionLabel(platform = navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌥" : "Alt";
}

export function buildMarkdownEditorShortcutGroups(
  platform = typeof navigator !== "undefined" ? navigator.platform : "Mac",
): MarkdownShortcutGroup[] {
  const mod = modifierLabel(platform);
  const alt = optionLabel(platform);
  const replaceKeys = alt === "⌥" ? `${alt} + ${mod} + F` : `${mod} + H / ${alt} + ${mod} + F`;
  return [
    {
      id: "file",
      title: "文件与查找",
      rows: [
        { id: "save", action: "保存当前文件", keys: `${mod} + S` },
        { id: "find", action: "打开查找替换", keys: `${mod} + F` },
        { id: "replace-focus", action: "打开替换输入", keys: replaceKeys },
        { id: "find-next", action: "查找下一个", keys: `${mod} + G` },
        { id: "find-previous", action: "查找上一个", keys: `${mod} + Shift + G` },
        { id: "find-enter", action: "查找下一个 / 上一个", keys: "Enter / Shift + Enter", note: "查找栏内" },
        { id: "escape-find", action: "关闭查找栏", keys: "Esc", note: "查找栏打开时" },
      ],
    },
    {
      id: "history",
      title: "撤销与重做",
      rows: [
        { id: "undo", action: "撤销", keys: `${mod} + Z` },
        { id: "redo-shift", action: "重做", keys: `${mod} + Shift + Z` },
        { id: "redo-y", action: "重做", keys: `${mod} + Y` },
      ],
    },
    {
      id: "format",
      title: "文字格式",
      rows: [
        { id: "strong", action: "加粗", keys: `${mod} + B` },
        { id: "em", action: "斜体", keys: `${mod} + I` },
        { id: "underline", action: "下划线", keys: `${mod} + U` },
        { id: "del", action: "删除线", keys: `${mod} + D` },
        { id: "inline-code", action: "行内代码", keys: `${mod} + \`` },
        { id: "link", action: "链接", keys: `${mod} + K / ${mod} + L` },
        { id: "mark", action: "高亮", keys: `${mod} + Shift + H` },
        { id: "inline-math", action: "行内公式", keys: `${mod} + Shift + M` },
        { id: "image", action: "插入图片", keys: `${mod} + Shift + I` },
        { id: "clear", action: "清除格式", keys: `${mod} + Shift + R` },
      ],
    },
    {
      id: "blocks",
      title: "标题与段落",
      rows: [
        { id: "paragraph", action: "正文段落", keys: `${mod} + 0` },
        { id: "heading-1", action: "标题 1", keys: `${mod} + 1` },
        { id: "heading-2", action: "标题 2", keys: `${mod} + 2` },
        { id: "heading-3", action: "标题 3", keys: `${mod} + 3` },
        { id: "heading-4", action: "标题 4", keys: `${mod} + 4` },
        { id: "heading-5", action: "标题 5", keys: `${mod} + 5` },
        { id: "heading-6", action: "标题 6", keys: `${mod} + 6` },
        { id: "quote", action: "引用", keys: `${alt} + ${mod} + Q` },
      ],
    },
    {
      id: "lists-insert",
      title: "列表与插入",
      rows: [
        { id: "ordered-list", action: "有序列表", keys: `${mod} + Shift + 7 / ${alt} + ${mod} + O` },
        { id: "bullet-list", action: "无序列表", keys: `${mod} + Shift + 8 / ${alt} + ${mod} + U` },
        { id: "task-list", action: "任务列表", keys: `${mod} + Shift + 9 / ${alt} + ${mod} + X` },
        { id: "table", action: "表格", keys: `${mod} + Shift + T` },
        { id: "math-block", action: "块公式", keys: `${alt} + ${mod} + M` },
        { id: "code-block", action: "代码块", keys: `${alt} + ${mod} + C` },
        { id: "hr", action: "分隔线", keys: `${alt} + ${mod} + -` },
      ],
    },
    {
      id: "edit",
      title: "编辑与导航",
      rows: [
        { id: "slash", action: "打开快速插入菜单", keys: "/" },
        { id: "tab", action: "缩进列表 / 插入空格 / 跳出格式标记", keys: "Tab" },
        { id: "shift-tab", action: "减少列表缩进", keys: "Shift + Tab" },
        { id: "enter", action: "换行或转换块", keys: "Enter", note: "如 ```、$$、表格行" },
        { id: "backspace", action: "删除 / 合并块", keys: "Backspace" },
        { id: "delete", action: "向前删除 / 合并下一块", keys: "Delete" },
        { id: "arrows", action: "在块间移动光标", keys: "↑ ↓ ← →" },
      ],
    },
    {
      id: "table",
      title: "表格",
      rows: [
        {
          id: "table-cmd-enter",
          action: "在表格中插入新行（命令键）",
          keys: `${mod} + Enter`,
          note: "光标在表格单元格内",
        },
        {
          id: "table-shift-enter",
          action: "在单元格内换行",
          keys: "Shift + Enter",
          note: "光标在表格单元格内",
        },
      ],
    },
    {
      id: "inline",
      title: "行内成对输入",
      rows: [
        {
          id: "wrap-pair",
          action: "用成对符号包裹选中文字",
          keys: "* _ ` ~ ( [ { \" '",
          note: "先选中文字再输入开启符号",
        },
      ],
    },
    {
      id: "mouse",
      title: "鼠标",
      rows: [
        {
          id: "open-link",
          action: "打开链接",
          keys: `${mod} + 单击`,
          note: "链接或链接图片",
        },
      ],
    },
  ];
}
