import * as C from "../src/commands";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    console.log("FAIL", name, "\n  got ", g, "\n  want", w);
  }
}
const pick = (d: { text: string; sel: [number, number] }) => ({ t: d.text, sel: d.sel });
const at = (text: string, pos: number): C.Doc => ({ text, sel: [pos, pos] });

// ---------------------------------------------------------------- 行内包裹
eq("wrap sel", pick(C.wrapInline({ text: "abcdef", sel: [1, 3] }, "**", "**", "x")), { t: "a**bc**def", sel: [3, 5] });
eq("unwrap inner", pick(C.wrapInline({ text: "a**bc**def", sel: [3, 5] }, "**", "**", "x")), { t: "abcdef", sel: [1, 3] });
eq("unwrap outer", pick(C.wrapInline({ text: "a**bc**def", sel: [3, 5] }, "**", "**", "x")), { t: "abcdef", sel: [1, 3] });
eq("wrap empty", pick(C.wrapInline({ text: "ab", sel: [1, 1] }, "**", "**", "加粗")), { t: "a**加粗**b", sel: [3, 5] });
eq("wrap empty nomarker", pick(C.wrapInline({ text: "ab", sel: [1, 1] }, "$", "$", "x")), { t: "a$x$b", sel: [2, 3] });

// ---------------------------------------------------------------- 标题
eq("h up from H2", C.setHeading(at("## hello\nworld", 0), "up").text, "# hello\nworld");
eq("h up from plain", C.setHeading(at("hello", 0), "up").text, "# hello");
eq("h down from H1", C.setHeading(at("# hello", 0), "down").text, "## hello");
eq("h down from plain", C.setHeading(at("hello", 0), "down").text, "## hello");
eq("h level 3", C.setHeading({ text: "# a\nb", sel: [0, 5] }, 3).text, "### a\n### b");
eq("h cancel", C.setHeading(at("### a", 0), 0).text, "a");
eq("h keep quote", C.setHeading(at("> ## a", 0), "up").text, "> # a");
eq("h keep list indent", C.setHeading(at("1. a", 0), 2).text, "1. ## a");

// ---------------------------------------------------------------- 列表：基本切换
eq("toggle bullet", C.toggleLineKind({ text: "a\nb", sel: [0, 3] }, "bullet").text, "- a\n- b");
eq("toggle bullet off", C.toggleLineKind({ text: "- a\n- b", sel: [0, 7] }, "bullet").text, "a\nb");
eq("toggle ordered", C.toggleLineKind({ text: "a\nb", sel: [0, 3] }, "ordered").text, "1. a\n2. b");
eq("quote on", C.toggleLineKind({ text: "a\nb", sel: [0, 3] }, "quote").text, "> a\n> b");
eq("quote off", C.toggleLineKind({ text: "> a\n> b", sel: [0, 7] }, "quote").text, "a\nb");
eq("task on", C.toggleLineKind(at("a", 0), "task").text, "- [ ] a");
eq("task off", C.toggleLineKind(at("- [ ] a", 0), "task").text, "a");
eq("star bullet", C.applyList(at("a", 0), { kind: "bullet", bullet: "*" }).text, "* a");
eq("paren ordered", C.applyList(at("a", 0), { kind: "ordered", delim: ")" }).text, "1) a");
eq("convert bullet->ordered", C.applyList(at("- a", 0), { kind: "ordered" }).text, "1. a");
eq("none strips marker", C.applyList(at("  1. a", 0), { kind: "none" }).text, "  a");

// 嵌套：编号分层
const nested = "- a\n  1. x\n  2. y\n- b\n  1. z";
eq("renumber nested", C.renumberList(at(nested, 0)).text, "- a\n  1. x\n  2. y\n- b\n  1. z");
const nested2 = "1. a\n  1. x\n  5. y\n  9. z\n2. b\n  7. q";
eq("renumber nested fix", C.renumberList(at(nested2, 0)).text, "1. a\n  1. x\n  2. y\n  3. z\n2. b\n  1. q");
eq("renumber whole doc", C.renumberList({ text: "3. a\n4. b\n\n7. c", sel: [0, 16] }).text, "1. a\n2. b\n\n1. c");
eq("renumber expands block", C.renumberList(at("3. a\n4. b\n\n7. c", 0)).text, "1. a\n2. b\n\n7. c");
eq("renumber keeps task", C.renumberList(at("1. [ ] a\n9. [x] b", 0)).text, "1. [ ] a\n2. [x] b");

// 缩进：列表内按层
eq("indent list", C.indentList(at("- a", 0), 1).text, "  - a");
eq("outdent list", C.indentList(at("  - a", 0), -1).text, "- a");
eq("indent keeps ordered num", C.indentList(at("3. a", 0), 1).text, "  3. a");
eq("indent block both levels", C.indentList({ text: "- a\n  - b", sel: [0, 9] }, 1).text, "  - a\n    - b");
eq("indent non-list falls back", C.indentList(at("abc", 0), 1).text, "  abc");

// 回车：续写 / 退出
eq("nl bullet", pick(C.newline(at("- a", 3))!), { t: "- a\n- ", sel: [6, 6] });
eq("nl ordered", C.newline(at("1. a", 4))!.text, "1. a\n2. ");
eq("nl nested ordered", C.newline(at("  - a", 5))!.text, "  - a\n  - ");
eq("nl task resets box", C.newline(at("- [x] a", 7))!.text, "- [x] a\n- [ ] ");
eq("nl quote", C.newline(at("> a", 3))!.text, "> a\n> ");
eq("nl empty item exits", C.newline(at("- a\n- ", 6))!.text, "- a\n");
eq("nl empty nested outdents", C.newline(at("    - ", 6))!.text, "  - ");
eq("nl empty quote exits", C.newline(at("> a\n> ", 6))!.text, "> a\n");
eq("nl plain", C.newline(at("abc", 3)), null);

// 行首退格
eq("backspace unlist", pick(C.backspaceAtStart(at("- abc", 0))!), { t: "abc", sel: [0, 0] });
eq("backspace unlist nested", C.backspaceAtStart(at("  - abc", 0))!.text, "  abc");
eq("backspace dedent", C.backspaceAtStart(at("  abc", 0))!.text, "abc");
eq("backspace noop", C.backspaceAtStart(at("abc", 0)), null);

// 整项移动（含子项）
const tree = "- a\n  - a1\n  - a2\n- b";
eq("move item up carries children", C.moveLines(at(tree, 18), -1).text, "- b\n- a\n  - a1\n  - a2");
eq("move item down carries children", C.moveLines(at(tree, 2), 1).text, "- b\n- a\n  - a1\n  - a2");
eq("move item up sel", C.moveLines(at(tree, 18), -1).sel, [0, 0]);
eq("duplicate item with children", C.duplicateLines(at(tree, 2)).text, "- a\n  - a1\n  - a2\n- a\n  - a1\n  - a2\n- b");

// ---------------------------------------------------------------- 其他行操作
eq("move up sel2", C.moveLines({ text: "aaaa\nbb", sel: [5, 7] }, -1).sel, [0, 2]);
eq("delete line", C.deleteLines({ text: "aa\nbb\ncc", sel: [3, 5] }).text, "aa\ncc");
eq("delete last", C.deleteLines({ text: "aa\nbb", sel: [3, 5] }).text, "aa");
eq("indent", C.indentLines({ text: "a\nb", sel: [0, 3] }, 1).text, "  a\n  b");
eq("outdent", C.indentLines({ text: "  a\n  b", sel: [0, 7] }, -1).text, "a\nb");
eq("tab sel", C.tab({ text: "a\nb", sel: [0, 3] }, false).text, "  a\n  b");
eq("tab no sel", pick(C.tab({ text: "ab", sel: [1, 1] }, false)), { t: "a  b", sel: [3, 3] });
eq("tab list no sel", C.tab(at("- a", 3), false).text, "  - a");

// ---------------------------------------------------------------- 模板 / 公式
const t1 = C.insertTemplate(at("abc", 3), C.MATH_TEMPLATES.display());
eq("tpl display", t1.text, "abc\n\n$$\n\n$$\n");
eq("tpl display caret", t1.sel[0], t1.text.indexOf("$$\n") + 3);
eq("tpl bracket", C.insertTemplate(at("", 0), C.MATH_TEMPLATES.bracket()).text, "\\[\n\n\\]\n");
eq("tpl aligned", C.insertTemplate(at("", 0), C.MATH_TEMPLATES.aligned()).text, "$$\n\\begin{aligned}\n\\end{aligned}\n$$\n");
eq("tpl hr on empty", C.insertTemplate(at("", 0), C.TEMPLATES.hr()).text, "---\n");

const l = C.linkCmd({ text: "hi", sel: [0, 2] });
eq("link", l.text, "[hi](https://)");
eq("link sel", l.text.slice(l.sel[0], l.sel[1]), "https://");
eq("image", C.imageCmd(at("", 0)).text, "![图片说明](https://)");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
