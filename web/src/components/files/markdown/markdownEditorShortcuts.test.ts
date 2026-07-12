import { describe, expect, it } from "vitest";
import { buildMarkdownEditorShortcutGroups, modifierLabel, optionLabel } from "./markdownEditorShortcuts";

describe("markdownEditorShortcuts", () => {
  it("uses Cmd on mac platforms and Ctrl elsewhere", () => {
    expect(modifierLabel("MacIntel")).toBe("⌘");
    expect(modifierLabel("Win32")).toBe("Ctrl");
    expect(modifierLabel("Linux x86_64")).toBe("Ctrl");
    expect(optionLabel("MacIntel")).toBe("⌥");
    expect(optionLabel("Win32")).toBe("Alt");
  });

  it("lists the host-wired save / find / undo shortcuts", () => {
    const groups = buildMarkdownEditorShortcutGroups("MacIntel");
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.some((r) => r.keys === "⌘ + S" && r.action.includes("保存"))).toBe(true);
    expect(rows.some((r) => r.keys === "⌘ + F")).toBe(true);
    expect(rows.some((r) => r.keys === "⌥ + ⌘ + F" && r.action === "打开替换输入")).toBe(true);
    expect(rows.some((r) => r.keys === "⌘ + G")).toBe(true);
    expect(rows.some((r) => r.keys === "⌘ + Z")).toBe(true);
    expect(rows.some((r) => r.keys === "⌘ + B" && r.action === "加粗")).toBe(true);
    expect(rows.some((r) => r.keys === "⌘ + K / ⌘ + L" && r.action === "链接")).toBe(true);
    expect(rows.some((r) => r.keys === "/")).toBe(true);
  });

  it("lists common block and list shortcuts", () => {
    const groups = buildMarkdownEditorShortcutGroups("MacIntel");
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.some((r) => r.action === "标题 1" && r.keys === "⌘ + 1")).toBe(true);
    expect(rows.some((r) => r.action === "引用" && r.keys === "⌥ + ⌘ + Q")).toBe(true);
    expect(rows.some((r) => r.action === "有序列表" && r.keys.includes("⌘ + Shift + 7"))).toBe(true);
    expect(rows.some((r) => r.action === "代码块" && r.keys === "⌥ + ⌘ + C")).toBe(true);
  });
});
