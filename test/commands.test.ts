import * as C from "../src/commands";
import { lintMarkdown } from "../src/lint";
import { buildDiagram, parseGraphInput, parseTreeInput, treeLayout, circleLayout, forceLayout, physicsStep, simulatePhysics, createVelocities, countCrossings, traverseOrder, parseDotInput, renderGraphSvg } from "../src/diagram.ts";
import { mdToTypst } from "../src/typst.ts";
import { checkQuality, formatDocument } from "../src/quality.ts";
import { pdfLinesToMarkdown, detectFormulaSlots, groupPdfItems, type PdfTextLine } from "../src/pdfConvert.ts";
import { diffLines, diffStats, diffToText, diffWords, pairDiffRows, diffRowStats, foldDiffRows } from "../src/diff.ts";
import { extractCodeBlocks, isCppLang, isPlainLang, compareOutputs, parseJudge0, parseWandbox, judge0Body, pickStressCodes } from "../src/runner.ts";
import { sseDelta, createSseAccumulator, buildChatBody, normalizeBaseUrl, AI_PRESETS, stripCodeFence, effectiveAiConfig, FREE_AI_CONFIG } from "../src/ai.ts";

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


// ---------------------------------------------------------------- 行内插入 / 公式助手
eq("insertText plain", pick(C.insertText({ text: "ab", sel: [1, 1] }, "X")), { t: "aXb", sel: [2, 2] });
eq("insertText fill sel", C.insertText({ text: "aXYb", sel: [1, 3] }, "$" + "\\frac{%s}{}").text, "a$\\frac{XY}{}b");
eq("insertText placeholder selected", pick(C.insertText({ text: "ab", sel: [1, 1] }, "\\sqrt{%s}")), { t: "a\\sqrt{x}b", sel: [7, 8] });
eq("tpl sum", C.MATH_TEMPLATES.sum(), "$\\sum_{i=1}^{n} " + C.CARET + "$");
eq("tpl operator", C.MATH_TEMPLATES.operator(), "$\\operatorname{" + C.CARET + "}$");

// ---------------------------------------------------------------- 公式规范（\mathrm / \operatorname 合法）
const mathDiags = (src: string) => lintMarkdown(src).filter((d) => d.rule === "latex" || d.rule === "katex");
eq("lint mathrm lca ok", mathDiags("求 $\\mathrm{lca}(u,v)$ 的值。"), []);
eq("lint operatorname lca ok", mathDiags("求 $\\operatorname{lca}(u,v)$ 的值。"), []);
eq("lint text ans ok", mathDiags("设 $\\text{ans}$ 为答案。"), []);
eq("lint bare lca flagged", mathDiags("求 $lca$ 的值。").length, 1);
eq("lint bare lca fix", mathDiags("求 $lca$ 的值。")[0]?.fix?.text, "$\\operatorname{lca}$");
eq("lint bare fn flagged", mathDiags("求 $lca(u,v)$ 的值。").length, 1);
eq("lint log ok", mathDiags("复杂度为 $O(\\log n)$。"), []);


// ---------------------------------------------------------------- 图示 / 代码对比
const treeSvg = buildDiagram("tree", "1 2\n1 3\n2 4");
eq("diagram tree ok", treeSvg.error === "" && treeSvg.svg.includes("<circle") && treeSvg.svg.includes(">4<"), true);
const seg = buildDiagram("segtree", "5 2 8 1");
eq("diagram segtree root", seg.svg.includes("[0, 3]") && seg.svg.includes(">16<"), true);
const graph = buildDiagram("graph", "A B 4\nB C 2", true);
eq("diagram graph arrow", graph.svg.includes('marker-end="url(#arr)"') && graph.svg.includes(">4<"), true);
const flow = buildDiagram("flow", "开始\n是否结束？\n输出");
eq("diagram flow diamond", flow.svg.includes("<polygon"), true);
const dp = buildDiagram("dp", "0 1\n0 3");
eq("diagram dp cells", dp.svg.includes("<rect") && dp.svg.includes(">3<"), true);
eq("diagram empty error", buildDiagram("tree", "").error.length > 0, true);
const dops = diffLines("a\nb\nc", "a\nx\nc");
eq("diff ops", dops.map((o) => o.t), ["same", "del", "add", "same"]);
eq("diff stats", diffStats(dops), { add: 1, del: 1, same: 2 });
eq("diff text", diffToText(dops), "  a\n- b\n+ x\n  c");
eq("segtree node index badge", seg.svg.includes('font-size="9"') && seg.svg.includes(">1<") && seg.svg.includes(">2<") && seg.svg.includes(">3<"), true);
{
  const w = diffWords("int a = 1; // 注释", "int a = 2; // 注释");
  eq("diff words del", w.aSegs.filter((x) => x.t === "del").map((x) => x.text), ["1"]);
  eq("diff words add", w.bSegs.filter((x) => x.t === "add").map((x) => x.text), ["2"]);
  const rows = pairDiffRows(dops);
  eq("diff pair kinds", rows.map((r) => r.kind), ["same", "change", "same"]);
  eq("diff row stats", diffRowStats(rows), { add: 0, del: 0, change: 1, same: 2 });
  const many = pairDiffRows(diffLines(
    Array.from({ length: 30 }, (_, i) => "line" + i).join("\n"),
    Array.from({ length: 30 }, (_, i) => (i === 15 ? "changed" : "line" + i)).join("\n"),
  ));
  const folded = foldDiffRows(many, 2);
  eq("diff fold gaps", folded.filter((r) => r.kind === "gap").length, 2);
  eq("diff fold keeps change", folded.some((r) => r.kind === "change"), true);
}

// ---------------------------------------------------------------- 编译运行（纯逻辑）
{
  const doc = "# t\n\n```cpp\nint main() {}\n```\n\n```text\n1 2\n```\n\n```\n3\n```\n\n```python\nprint(1)\n```\n";
  const blocks = extractCodeBlocks(doc);
  eq("runner blocks", blocks.map((b) => b.lang), ["cpp", "text", "", "python"]);
  eq("runner block code", blocks[0].code, "int main() {}");
  eq("runner iscpp", [isCppLang("cpp"), isCppLang("C++"), isCppLang("python"), isPlainLang("text"), isPlainLang("")], [true, true, false, true, true]);
  eq("runner compare ok", compareOutputs("1  \n2\n\n", "1\n2"), { match: true, firstDiff: null });
  eq("runner compare diff", compareOutputs("1\n9\n", "1\n2\n"), { match: false, firstDiff: 1 });
  const enc = judge0Body("int main(){cout<<1;}", "x");
  eq("runner judge0 body", typeof enc.source_code === "string" && enc.language_id === 105, true);
  eq(
    "runner judge0 parse ok",
    parseJudge0({ status: { id: 3 }, stdout: btoa("7\n"), time: "0.01" }).stage,
    "ok",
  );
  eq("runner judge0 parse compile", parseJudge0({ status: { id: 6 }, compile_output: btoa("error: x") }).stage, "compile");
  eq("runner judge0 parse tle", parseJudge0({ status: { id: 5 } }).stage, "timeout");
  eq("runner wandbox ok", parseWandbox({ status: "0", program_output: "7\n" }).stage, "ok");
  eq("runner wandbox compile", parseWandbox({ status: "1", compiler_error: "prog.cc:2:1: error: bad" }).stage, "compile");
  eq("runner wandbox warn runs", parseWandbox({ status: "0", compiler_error: "warning: unused", program_output: "1" }).stage, "ok");
  const three = pickStressCodes("```cpp\ngen\n```\n\n```cpp\nbrute\n```\n\n```cpp\nsol\n```");
  eq("stress pick 3", [three.gen, three.a, three.b], ["gen", "brute", "sol"]);
  const two = pickStressCodes("```cpp\nbrute\n```\n\n```cpp\nsol\n```");
  eq("stress pick 2", [two.a, two.b, two.gen.includes("mt19937")], ["brute", "sol", true]);
  const one = pickStressCodes("```cpp\nsol\n```");
  eq("stress pick 1", [one.a, one.b], ["", "sol"]);
}

// ---------------------------------------------------------------- PDF 代码语言嗅探
{
  const monoCpp = pdfLinesToMarkdown([[
    { text: "#include <bits/stdc++.h>", fontSize: 11, x: 40, y: 700, pageWidth: 595, pageHeight: 842, mono: true },
    { text: "int main() { return 0; }", fontSize: 11, x: 40, y: 680, pageWidth: 595, pageHeight: 842, mono: true },
  ]], "代码");
  eq("pdf code block sniffed cpp", monoCpp.markdown.includes("```cpp\n#include <bits/stdc++.h>"), true);
  const monoPy = pdfLinesToMarkdown([[
    { text: "def solve():", fontSize: 11, x: 40, y: 700, pageWidth: 595, pageHeight: 842, mono: true },
    { text: "print(42)", fontSize: 11, x: 40, y: 680, pageWidth: 595, pageHeight: 842, mono: true },
  ]], "代码");
  eq("pdf code block sniffed python", monoPy.markdown.includes("```python\ndef solve():"), true);
}

// ---------------------------------------------------------------- AI 层（纯逻辑）
{
  eq("ai presets", AI_PRESETS.length >= 6 && AI_PRESETS[0].id === "deepseek", true);
  eq("ai base url norm", normalizeBaseUrl("https://api.deepseek.com/v1///"), "https://api.deepseek.com/v1");
  const body = buildChatBody({ baseUrl: "x", apiKey: "k", model: "m" }, [{ role: "user", content: "hi" }]) as { model: string; stream: boolean };
  eq("ai body", [body.model, body.stream], ["m", true]);
  eq("ai sse delta", sseDelta('data: {"choices":[{"delta":{"content":"你好"}}]}'), "你好");
  eq("ai sse done", sseDelta("data: [DONE]"), null);
  eq("ai sse junk", sseDelta(": ping"), null);
  const acc = createSseAccumulator();
  acc.feed('data: {"choices":[{"delta":{"content":"AB');
  acc.feed('"}}]}\ndata: {"choices":[{"delta":{"content":"CD"}}]}\ndata: [DONE]\n');
  eq("ai sse accumulate", acc.text(), "ABCD");
  eq("ai strip fence", stripCodeFence("好的：\n```cpp\nint main(){}\n```\n完毕"), "int main(){}");
  eq("ai strip no fence", stripCodeFence("3 4\n"), "3 4");
  eq("ai free default", effectiveAiConfig(), FREE_AI_CONFIG);
  eq("ai free is keyless cloud", FREE_AI_CONFIG.apiKey === "" && FREE_AI_CONFIG.baseUrl.startsWith("https://"), true);
}

// ---------------------------------------------------------------- 交互画布 / Mermaid / DOT
{
  const g = parseGraphInput("1 2 4\n2 3\n3 1 7");
  eq("pg nodes", g.nodes, ["1", "2", "3"]);
  eq("pg edges", g.edges.length, 3);
  eq("pg weight", g.edges[0].w, "4");
}
{
  const t = parseTreeInput("1 2\n1 3\n2 4");
  eq("ptree root", t.root, "1");
  eq("ptree kids1", t.children.get("1"), ["2", "3"]);
  eq("ptree kids2", t.children.get("2"), ["4"]);
}
{
  const t = parseTreeInput("1 2\n1 3\n2 4\n2 5\n3 6");
  const lay = treeLayout(t.children, t.root);
  const r = lay.pos.get("1")!;
  const a = lay.pos.get("2")!;
  const b = lay.pos.get("3")!;
  eq("tree root above", r.y < a.y, true);
  eq("tree root centered", Math.abs(r.x - (a.x + b.x) / 2) < 0.01, true);
}
{
  const g = parseGraphInput("1 4\n2 5\n3 6\n1 2\n2 3\n4 5\n5 6\n1 6\n3 4");
  const before = countCrossings(circleLayout(g.nodes, 660, 470), g.edges);
  const after = countCrossings(forceLayout(circleLayout(g.nodes, 660, 470), g.edges, 660, 470, 320), g.edges);
  eq("force reduces crossings", after <= before, true);
}

{
  const nodes = ["1", "2"];
  const start = new Map([["1", { x: 320, y: 235 }], ["2", { x: 340, y: 235 }]]);
  const out = simulatePhysics(start, [], 660, 470, 180);
  const d = Math.hypot(out.pos.get("1")!.x - out.pos.get("2")!.x, out.pos.get("1")!.y - out.pos.get("2")!.y);
  eq("physics repulsion separates close nodes", d > 38, true);
  eq("physics nodes stay in canvas", [...out.pos.values()].every((p) => p.x >= 22 && p.x <= 638 && p.y >= 22 && p.y <= 448), true);
}
{
  const start = new Map([["1", { x: 120, y: 235 }], ["2", { x: 540, y: 235 }]]);
  const out = simulatePhysics(start, [{ u: "1", v: "2", w: "" }], 660, 470, 220, { restLength: 120 });
  const d = Math.hypot(out.pos.get("1")!.x - out.pos.get("2")!.x, out.pos.get("1")!.y - out.pos.get("2")!.y);
  eq("physics spring pulls long edge toward rest", d > 80 && d < 170, true);
}
{
  const start = new Map([["1", { x: 100, y: 100 }], ["2", { x: 130, y: 100 }]]);
  const out = physicsStep(start, createVelocities(["1", "2"]), [], 660, 470, {}, "1", { x: 100, y: 100 });
  eq("physics pinned node stays", out.pos.get("1"), { x: 100, y: 100 });
  eq("physics free node moves", out.pos.get("2")!.x > 130, true);
}

{
  const pos = new Map([["1", { x: 0, y: 0 }], ["2", { x: 10, y: 10 }], ["3", { x: 0, y: 10 }], ["4", { x: 10, y: 0 }]]);
  eq("cross 1", countCrossings(pos, [{ u: "1", v: "2", w: "" }, { u: "3", v: "4", w: "" }]), 1);
  eq("cross shared 0", countCrossings(pos, [{ u: "1", v: "2", w: "" }, { u: "1", v: "4", w: "" }]), 0);
}
{
  const g = parseGraphInput("1 2\n1 3\n2 4\n3 5");
  eq("bfs order", traverseOrder(g.nodes, g.edges, "bfs"), ["1", "2", "3", "4", "5"]);
  eq("dfs order", traverseOrder(g.nodes, g.edges, "dfs"), ["1", "2", "4", "3", "5"]);
}
{
  const r = buildDiagram("mermaid", "graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[结束]");
  eq("mermaid err", r.error, "");
  eq("mermaid diamond", r.svg.includes("<polygon") && r.svg.includes("判断") && r.svg.includes("结束"), true);
}
{
  const r = buildDiagram("dot", "digraph G { A -> B; A -> C; B -> D; }");
  eq("dot err", r.error, "");
  eq("dot svg", r.svg.includes("<circle"), true);
  const d = parseDotInput("digraph G { A -> B [label=\"9\"]; }");
  eq("dot directed", d.directed, true);
  eq("dot w", d.edges[0].w, "9");
}
{
  const pos = new Map([["1", { x: 50, y: 50 }], ["2", { x: 150, y: 50 }]]);
  const svg = renderGraphSvg(["1", "2"], [{ u: "1", v: "2", w: "" }], pos, { w: 200, h: 120, highlight: new Map([["1", "cur"]]) });
  eq("render highlight", svg.includes("#d97706"), true);
}

// ---------------------------------------------------------------- Typst / 质量 / PDF
{
  const out = mdToTypst("# 标题\n\n**粗体**与普通文本\n\n- 甲\n- 乙\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$x^2$$", "题解");
  eq("typ heading", out.includes("= 标题"), true);
  eq("typ bold", out.includes("*粗体*"), true);
  eq("typ list", out.includes("- 甲"), true);
  eq("typ table", out.includes("#table") && out.includes("[1]"), true);
  eq("typ math", out.includes("$ x^2 $"), true);
}
{
}
{
  const q = checkQuality("# T\n\n### 跳级\n\n```cpp\nint main(){}");
  eq("q jump", q.some((x) => x.id.startsWith("h-jump")), true);
  eq("q fence", q.some((x) => x.id === "fence-open"), true);
  eq("q short doc clean", checkQuality("一段很短的文字。").length, 0);
  eq("q missing sections", checkQuality("这里是一篇足够长的题解正文，只写了背景和结论，没有给出推导过程，也没有复杂度说明，更没有代码实现部分，读者很难复现这套做法是否正确。".repeat(2)).some((x) => x.id === "sec-idea"), true);
}

{
  const L = (text: string, fontSize: number, y: number): PdfTextLine => ({ text, fontSize, x: 40, y, pageWidth: 595, pageHeight: 842 });
  const r = pdfLinesToMarkdown([
    [
      L("算法学习笔记", 24, 780),
      L("第一章 基础", 16, 730),
      L("这是第一段的第一行，", 11, 690),
      L("这是第一段的第二行。", 11, 675),
      L("• 第一项", 11, 640),
      L("1. 第一名", 11, 620),
    ],
    [L("第二页正文继续说明。", 11, 760)],
  ], "备用标题");
  eq("pdf title", r.title, "算法学习笔记");
  eq("pdf h1", r.markdown.includes("# 算法学习笔记"), true);
  eq("pdf heading", r.markdown.includes("## 第一章 基础"), true);
  eq("pdf paragraph merge", r.markdown.includes("这是第一段的第一行，这是第一段的第二行。"), true);
  eq("pdf bullet", r.markdown.includes("- 第一项"), true);
  eq("pdf ordered", r.markdown.includes("1. 第一名"), true);
  eq("pdf pages", r.pages, 2);
}


{
  const items = [
    { str: "把每条道路", x: 40, y: 600, width: 60, fontSize: 12 },
    { str: "的边权记为", x: 145, y: 600, width: 60, fontSize: 12 },
    { str: "紧挨着", x: 208, y: 600, width: 36, fontSize: 12 },
  ];
  const slots = detectFormulaSlots(items, 595);
  eq("slot detected", slots.length, 1);
  eq("slot box", [Math.round(slots[0].x0), Math.round(slots[0].x1)], [101, 145]);
  const line = groupPdfItems([...items, { str: slots[0].token, x: slots[0].x0, y: 600, width: slots[0].x1 - slots[0].x0, fontSize: 12 }], 595, 842)[0];
  eq("slot token kept in line", line.text.includes(slots[0].token), true);
  eq("no slot for small gap", detectFormulaSlots([
    { str: "数组", x: 40, y: 600, width: 24, fontSize: 12 },
    { str: "MST", x: 67, y: 600, width: 24, fontSize: 12 },
  ], 595).length, 0);

  const startSlots = detectFormulaSlots([
    { str: "正文左边", x: 40, y: 600, width: 200, fontSize: 12 },
    { str: "公式后的文字", x: 120, y: 560, width: 120, fontSize: 12 },
    { str: "正文结尾", x: 40, y: 520, width: 200, fontSize: 12 },
  ], 595);
  eq("line-start formula slot", startSlots.some((x) => Math.round(x.x0) === 40 && Math.round(x.x1) === 120), true);

  const endSlots = detectFormulaSlots([
    { str: "正文左边", x: 40, y: 600, width: 260, fontSize: 12 },
    { str: "短行", x: 40, y: 560, width: 80, fontSize: 12 },
  ], 595);
  eq("line-end formula slot", endSlots.some((x) => Math.round(x.x0) === 121 && Math.round(x.x1) === 300), true);

  const styled = groupPdfItems([
    { str: "正文", x: 40, y: 600, width: 24, fontSize: 12 },
    { str: "重点", x: 66, y: 600, width: 24, fontSize: 12, bold: true },
    { str: "代码", x: 92, y: 600, width: 24, fontSize: 12, mono: true },
  ], 595, 842)[0];
  eq("pdf bold kept", styled.text.includes("**重点**"), true);
  eq("pdf inline code kept", styled.text.includes("`代码`"), true);

  const monoDoc = pdfLinesToMarkdown([[
    { text: "int main() {}", fontSize: 11, x: 40, y: 700, pageWidth: 595, pageHeight: 842, mono: true },
    { text: "return 0;", fontSize: 11, x: 40, y: 680, pageWidth: 595, pageHeight: 842, mono: true },
    { text: "正文说明。", fontSize: 11, x: 40, y: 640, pageWidth: 595, pageHeight: 842 },
  ]], "代码测试");
  eq("pdf mono lines become code block", monoDoc.markdown.includes("```cpp\nint main() {}\nreturn 0;\n```"), true);

  const dispDoc = pdfLinesToMarkdown([[
    { text: "正文左边正文左边", fontSize: 11, x: 40, y: 700, pageWidth: 595, pageHeight: 842, width: 500 },
    { text: "@@MXF0000@@", fontSize: 11, x: 250, y: 660, pageWidth: 595, pageHeight: 842, width: 80 },
    { text: "正文结尾正文结尾", fontSize: 11, x: 40, y: 620, pageWidth: 595, pageHeight: 842, width: 500 },
  ]], "公式测试");
  eq("centered formula becomes display math", dispDoc.markdown.includes("$$@@MXF0000@@$$"), true);
}

{
  const L = (text: string, x: number, y: number): PdfTextLine => ({ text, fontSize: 11, x, y, pageWidth: 595, pageHeight: 842 });
  const r = pdfLinesToMarkdown([[
    L("正文段落从左边开始。", 40, 700),
    L("第一条缩进", 72, 660),
    L("第二条缩进", 72, 640),
    L("正文继续。", 40, 600),
  ]], "缩进测试");
  eq("pdf indented bullets", r.markdown.includes("- 第一条缩进") && r.markdown.includes("- 第二条缩进"), true);
  const punct = pdfLinesToMarkdown([[
    L("正文段落从左边开始。", 40, 700),
    L("。公式后的标点行", 120, 660),
    L("另一个缩进行", 120, 640),
    L("正文继续。", 40, 600),
  ]], "标点测试");
  eq("punctuation line is not a fake bullet", punct.markdown.includes("- 。公式后的标点行"), false);
  eq("pdf radical title", pdfLinesToMarkdown([[{ text: "⼊门", fontSize: 24, x: 40, y: 700, pageWidth: 595, pageHeight: 842 }, { text: "正文内容足够长用来衬托标题字号。", fontSize: 11, x: 40, y: 650, pageWidth: 595, pageHeight: 842 }]], "x").title, "入门");
}

{
  const L = (text: string, fontSize: number, y: number): PdfTextLine => ({ text, fontSize, x: 40, y, pageWidth: 595, pageHeight: 842 });
  const page = (body: string) => [L("统一页眉", 9, 800), L(body, 11, 400), L("3", 9, 20)];
  const r = pdfLinesToMarkdown([page("第一页正文。"), page("第二页正文。"), page("第三页正文。")], "标题");
  eq("pdf repeated header removed", r.markdown.includes("统一页眉"), false);
  eq("pdf body kept", r.markdown.includes("第二页正文。"), true);
}

{
  const r = formatDocument("# A\n\n\n\n\n### B   \n正文无尾换行");
  eq("fmt blanks", r.text.includes("\n\n\n\n"), false);
  eq("fmt heading fix", r.text.includes("\n## B\n"), true);
  eq("fmt nl", r.text.endsWith("\n"), true);
  eq("fmt changed", r.changed > 0, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
