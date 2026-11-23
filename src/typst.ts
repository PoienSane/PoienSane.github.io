/**
 * Markdown -> Typst 导出（子集）。
 * 目标是「能编译、排版像样」，不是 100% 等价：标题、段落、强调、代码、公式、
 * 列表、引用、表格、链接、图片、分隔线会被转换，其余行原样保留并在文件头注明。
 */

function inline(s: string): string {
  let r = s;
  r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '#image("$2")');
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '#link("$2")[$1]');
  // 先把加粗占位，避免被斜体规则误伤（Typst 里加粗是 *x*、斜体是 _x_）
  r = r.replace(/\*\*([^*]+)\*\*/g, "\u0001$1\u0002");
  r = r.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1_$2_");
  r = r.replace(/\u0001/g, "*").replace(/\u0002/g, "*");
  r = r.replace(/~~([^~]+)~~/g, "#strike[$1]");
  return r;
}

export function mdToTypst(md: string, title = "题解"): string {
  const out: string[] = [
    "// 由墨序导出：Markdown -> Typst 子集转换，复杂公式可能需要手工微调。",
    '#set page(paper: "a4", margin: (x: 2cm, y: 2.2cm), numbering: "1")',
    '#set text(font: ("Fira Code", "PingFang SC", "Microsoft YaHei"), size: 10.5pt, lang: "zh")',
    "#set par(leading: 0.9em, justify: true)",
    "#set heading(numbering: none)",
    "#show raw.where(block: true): it => block(fill: rgb(\"f5f6f3\"), inset: 8pt, radius: 4pt, width: 100%, it)",
    "",
    `= ${title}`,
    "",
  ];
  const lines = md.split("\n");
  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      if (!inFence) {
        out.push("```" + (fence[1] || ""));
        inFence = true;
      } else {
        out.push("```");
        inFence = false;
      }
      i++;
      continue;
    }
    if (inFence) {
      out.push(line);
      i++;
      continue;
    }
    // 行间公式 $$...$$（可跨行）
    if (/^\s*\$\$\s*$/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // 结束 $$
      out.push("$ " + body.join("\n").trim() + " $", "");
      continue;
    }
    const oneLineDisplay = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
    if (oneLineDisplay) {
      out.push("$ " + oneLineDisplay[1].trim() + " $", "");
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push("=".repeat(h[1].length) + " " + inline(h[2]), "");
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("#line(length: 100%)", "");
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // 表格：收集连续表格行，跳过分隔行
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) {
        const cols = Math.max(...rows.map((r) => r.length));
        const body = rows.map((r) => r.map((c) => `[${inline(c)}]`).join(", ")).join(",\n  ");
        out.push(`#table(columns: ${cols},\n  ${body},\n)`, "");
      }
      continue;
    }
    const li = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(line.trimStart()[0] ?? "");
      out.push(li[1] + (ordered ? "+ " : "- ") + inline(li[2]));
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      out.push("#quote[" + inline(line.replace(/^\s*>\s?/, "")) + "]");
      i++;
      continue;
    }
    out.push(inline(line));
    i++;
  }
  return out.join("\n");
}
