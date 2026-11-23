/**
 * Markdown 编辑命令：全部是纯函数 `(doc) => doc`。
 * 不依赖 DOM，便于测试，也让工具栏与快捷键共用同一套逻辑。
 */

export interface Doc {
  text: string;
  /** [selectionStart, selectionEnd] */
  sel: [number, number];
}

export const CARET = "\u0000"; // 模板中表示“光标应停在这里”
export const INDENT_UNIT = "  ";

const lineStart = (t: string, p: number) => t.lastIndexOf("\n", Math.max(0, p - 1)) + 1;
const lineEnd = (t: string, p: number) => {
  const i = t.indexOf("\n", p);
  return i < 0 ? t.length : i;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** 缩进宽度（Tab 记作 2 个空格） */
export function indentWidth(indent: string) {
  let w = 0;
  for (const ch of indent) w += ch === "\t" ? INDENT_UNIT.length : 1;
  return w;
}

function outdent(indent: string) {
  if (indent.endsWith("\t")) return indent.slice(0, -1);
  if (indent.endsWith(INDENT_UNIT)) return indent.slice(0, -INDENT_UNIT.length);
  if (/^[ \t]+$/.test(indent)) return indent.slice(0, -1);
  return "";
}

/** 选区覆盖到的整行（end 不含换行符） */
export function selectionBlock(text: string, s: number, e: number) {
  const start = lineStart(text, s);
  let end = lineEnd(text, e);
  if (e > s && text[e - 1] === "\n") end = e - 1; // 光标停在行首时不多算一行
  if (end < start) end = start;
  return { start, end };
}

interface LineSpan {
  ls: number;
  le: number;
  text: string;
}

export function blockLines(text: string, s: number, e: number): { start: number; end: number; lines: LineSpan[] } {
  const { start, end } = selectionBlock(text, s, e);
  const raw = text.slice(start, end).split("\n");
  const lines: LineSpan[] = [];
  let acc = start;
  for (const l of raw) {
    lines.push({ ls: acc, le: acc + l.length, text: l });
    acc += l.length + 1;
  }
  return { start, end, lines };
}

// ---------------------------------------------------------------- 列表模型

export type ListKind = "none" | "bullet" | "ordered" | "task";

export interface ListInfo {
  indent: string;
  quote: string;
  kind: ListKind;
  ordered: boolean; // 是否用数字编号（可与任务框共存）
  bullet: string; // "-" | "*" | "+"
  num: number;
  delim: string; // "." | ")"
  task: string; // "" | "[ ]" | "[x]"
  body: string;
  markLen: number;
}

const RE_INDENT = /^[ \t]*/;
const RE_QUOTE = /^(?:>[ \t]?)+/;
const RE_LIST = /^(?:([-*+])|(\d{1,9})([.)]))[ \t]+(?:(\[[ xX]\])[ \t]+)?/;

export function listInfo(line: string): ListInfo {
  const indent = RE_INDENT.exec(line)?.[0] ?? "";
  const rest0 = line.slice(indent.length);
  const quote = RE_QUOTE.exec(rest0)?.[0] ?? "";
  const rest = rest0.slice(quote.length);
  const m = RE_LIST.exec(rest);
  if (!m) {
    return { indent, quote, kind: "none", ordered: false, bullet: "-", num: 1, delim: ".", task: "", body: rest, markLen: 0 };
  }
  const bullet = m[1] ?? "-";
  const num = m[2] ? parseInt(m[2], 10) : 1;
  const delim = m[3] ?? ".";
  const task = m[4] ? (m[4] === "[ ]" ? "[ ]" : "[x]") : "";
  const kind: ListKind = task ? "task" : m[1] ? "bullet" : "ordered";
  return {
    indent,
    quote,
    kind,
    ordered: !m[1],
    bullet,
    num,
    delim,
    task,
    body: rest.slice(m[0].length),
    markLen: m[0].length,
  };
}

export const listKindOf = (line: string) => listInfo(line).kind;

/** 列表标记部分（不含正文） */
export function listPrefix(i: ListInfo): string {
  if (i.kind === "none") return i.indent + i.quote;
  const mark = i.ordered ? `${i.num}${i.delim} ` : `${i.bullet} `;
  return i.indent + i.quote + mark + (i.task ? `${i.task} ` : "");
}

export function formatList(i: ListInfo, body = i.body): string {
  return listPrefix(i) + body;
}

function prefixLen(line: string) {
  const i = listInfo(line);
  return i.kind === "none" ? i.indent.length + i.quote.length : listPrefix(i).length;
}

/** 相邻缩进相同的行算同一个列表块 */
function sameBlock(a: ListInfo, b: ListInfo) {
  return a.kind !== "none" && b.kind !== "none" && indentWidth(a.indent) === indentWidth(b.indent);
}

// ---------------------------------------------------------------- 行前缀（标题等）

interface Parts {
  indent: string;
  quote: string;
  mark: string; // 列表标记，含任务框
  body: string; // 剩下的正文（可能含标题 #）
}

export function parseLine(line: string): Parts {
  const li = listInfo(line);
  const mark = li.markLen ? line.slice(li.indent.length + li.quote.length, li.indent.length + li.quote.length + li.markLen) : "";
  return { indent: li.indent, quote: li.quote, mark, body: li.body };
}

const build = (p: Parts) => p.indent + p.quote + p.mark + p.body;

export function headingLevel(line: string): number {
  const m = /^(#{1,6})[ \t]+/.exec(parseLine(line).body);
  return m ? m[1].length : 0;
}

function withHeading(line: string, level: number): string {
  const p = parseLine(line);
  const body = p.body.replace(/^#{1,6}[ \t]+/, "");
  if (level <= 0) return build({ ...p, body });
  return build({ ...p, body: "#".repeat(level) + " " + body });
}

// ---------------------------------------------------------------- 块内映射

/**
 * 对块内每一行做变换，并把选区按「正文相对位置」映射回新文本，
 * 这样给列表加标记、改缩进时光标不会乱跳。
 */
function mapBlock(doc: Doc, fn: (lines: string[]) => string[]): Doc {
  const { text, sel } = doc;
  const { start, end, lines } = blockLines(text, sel[0], sel[1]);
  const out = fn(lines.map((l) => l.text));
  const body = out.join("\n");

  const startsOld: number[] = [];
  let acc = start;
  for (const l of lines) {
    startsOld.push(acc);
    acc += l.text.length + 1;
  }
  const startsNew: number[] = [];
  acc = start;
  for (const l of out) {
    startsNew.push(acc);
    acc += l.length + 1;
  }

  const posMap = (p: number): number => {
    let i = 0;
    while (i + 1 < lines.length && p > startsOld[i] + lines[i].text.length) i++;
    const off = p - startsOld[i];
    const content = Math.max(0, off - prefixLen(lines[i].text));
    const maxOff = out[i].length;
    return startsNew[i] + Math.min(prefixLen(out[i]) + content, maxOff);
  };

  return { text: text.slice(0, start) + body + text.slice(end), sel: [posMap(sel[0]), posMap(sel[1])] };
}

/** 给块内每一行加 / 去前缀（不重排选区，整块选中） */
function mapBlockLines(doc: Doc, fn: (line: string, index: number) => string, selectBlock = true): Doc {
  const { text, sel } = doc;
  const { start, end, lines } = blockLines(text, sel[0], sel[1]);
  const out = lines.map((l, i) => fn(l.text, i));
  const body = out.join("\n");
  const next = text.slice(0, start) + body + text.slice(end);
  if (selectBlock) return { text: next, sel: [start, start + body.length] };
  const shift = body.length - (end - start);
  return { text: next, sel: [sel[0], Math.max(sel[0], sel[1] + shift)] };
}

// ---------------------------------------------------------------- 行内命令

/** 包裹 / 取消包裹行内标记 */
export function wrapInline(doc: Doc, open: string, close = open, placeholder = ""): Doc {
  const { text, sel } = doc;
  const [s, e] = sel;
  const inner = text.slice(s, e);

  // 选区内已经带着标记 -> 去掉
  if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
    const stripped = inner.slice(open.length, inner.length - close.length);
    return { text: text.slice(0, s) + stripped + text.slice(e), sel: [s, s + stripped.length] };
  }
  // 紧邻两侧已经有标记 -> 去掉
  const before = text.slice(Math.max(0, s - open.length), s);
  const after = text.slice(e, e + close.length);
  if (before === open && after === close) {
    const next = text.slice(0, s - open.length) + inner + text.slice(e + close.length);
    return { text: next, sel: [s - open.length, e - open.length] };
  }
  // 空选区：插入占位符并选中它
  const body = inner || placeholder;
  const next = text.slice(0, s) + open + body + close + text.slice(e);
  return { text: next, sel: [s + open.length, s + open.length + body.length] };
}

// ---------------------------------------------------------------- 标题

/** 标题层级：up 提升一级、down 降低一级、数字直接设定、0 取消标题 */
export function setHeading(doc: Doc, target: number | "up" | "down"): Doc {
  const { text, sel } = doc;
  const { lines } = blockLines(text, sel[0], sel[1]);
  const levels = lines.map((l) => headingLevel(l.text));
  const lv = Math.max(...levels, 0);
  let level: number;
  if (typeof target === "number") level = target;
  else if (target === "up") level = lv <= 1 ? 1 : lv - 1;
  else level = lv === 0 ? 2 : Math.min(6, lv + 1);
  return mapBlock(doc, (ls) => ls.map((line) => withHeading(line, level)));
}

// ---------------------------------------------------------------- 列表

export type ListStyle =
  | { kind: "none" }
  | { kind: "bullet"; bullet?: "-" | "*" | "+" }
  | { kind: "ordered"; delim?: "." | ")"; start?: number }
  | { kind: "task"; bullet?: "-" | "*" | "+" };

/** 整块重排有序列表编号（按缩进分层，遇到更深/更浅的层自动重新计数） */
export function renumberLines(lines: string[]): string[] {
  const levels: number[] = [];
  const counters: number[] = [];
  const out = lines.map((line) => {
    const li = listInfo(line);
    if (li.kind === "none") {
      if (line.trim() === "") {
        levels.length = 0;
        counters.length = 0;
      }
      return line;
    }
    const w = indentWidth(li.indent);
    let idx = levels.lastIndexOf(w);
    if (idx < 0) {
      while (levels.length && levels[levels.length - 1] > w) {
        levels.pop();
        counters.pop();
      }
      levels.push(w);
      counters.push(0);
      idx = levels.length - 1;
    } else {
      while (levels.length - 1 > idx) {
        levels.pop();
        counters.pop();
      }
    }
    if (li.ordered) {
      counters[idx] += 1;
      li.num = counters[idx];
    } else {
      counters[idx] = 0;
    }
    return formatList(li);
  });
  return out;
}

/** 套用列表样式（工具菜单用）；已经是同样式则原样保留缩进与嵌套 */
export function applyList(doc: Doc, style: ListStyle): Doc {
  const out = mapBlock(doc, (lines) =>
    renumberLines(
      lines.map((line) => {
        const li = listInfo(line);
        if (style.kind === "none") {
          li.kind = "none";
          li.task = "";
          return formatList(li);
        }
        if (style.kind === "bullet") {
          li.kind = "bullet";
          li.ordered = false;
          li.bullet = style.bullet ?? (li.bullet || "-");
          li.task = "";
        } else if (style.kind === "ordered") {
          li.kind = "ordered";
          li.ordered = true;
          li.delim = style.delim ?? li.delim ?? ".";
          li.task = "";
          li.num = style.start ?? 1;
        } else {
          li.kind = "task";
          if (!li.ordered) li.bullet = style.bullet ?? (li.bullet || "-");
          if (!li.task) li.task = "[ ]";
        }
        return formatList(li);
      }),
    ),
  );
  return out;
}

export type LineKind = "quote" | "bullet" | "ordered" | "task" | "plain";

/** 兼容入口：工具栏的「无序 / 有序 / 任务 / 引用」按钮 */
export function toggleLineKind(doc: Doc, kind: LineKind): Doc {
  const { text, sel } = doc;
  if (kind === "quote") {
    const { lines } = blockLines(text, sel[0], sel[1]);
    const allOn = lines.every((l) => listInfo(l.text).quote.length > 0);
    return mapBlock(doc, (ls) =>
      ls.map((line) => {
        const li = listInfo(line);
        li.quote = allOn ? "" : li.quote || "> ";
        return formatList(li);
      }),
    );
  }
  if (kind === "plain") return applyList(doc, { kind: "none" });

  const { lines } = blockLines(text, sel[0], sel[1]);
  const allOn = lines.every((l) => {
    const k = listInfo(l.text).kind;
    if (kind === "task") return k === "task";
    if (kind === "bullet") return k === "bullet";
    return k === "ordered";
  });
  if (allOn) return applyList(doc, { kind: "none" });
  return applyList(doc, { kind });
}

/** 把选区扩展到光标所在的整个列表块（含上下相邻的列表行与续行） */
export function expandListBlock(doc: Doc): Doc {
  const { text, sel } = doc;
  let start = selectionBlock(text, sel[0], sel[1]).start;
  let end = selectionBlock(text, sel[0], sel[1]).end;
  const isListish = (s: string) => listInfo(s).kind !== "none" || /^\s*\>/.test(s);

  // 向下
  for (;;) {
    if (end >= text.length) break;
    const ns = end + 1;
    const ne = lineEnd(text, ns);
    const line = text.slice(ns, ne);
    if (line.trim() === "" || !isListish(line)) break;
    end = ne;
  }
  // 向上
  for (;;) {
    if (start === 0) break;
    const ps = lineStart(text, start - 1);
    const pe = start - 1;
    const line = text.slice(ps, pe);
    if (line.trim() === "" || !isListish(line)) break;
    start = ps;
  }
  return { text, sel: [start, end] };
}

/** 重新编号当前列表块（含嵌套层级） */
export function renumberList(doc: Doc): Doc {
  return mapBlock(expandListBlock(doc), renumberLines);
}

/** 缩进：列表块整体升降一层，非列表按普通缩进处理 */
export function indentList(doc: Doc, dir: -1 | 1): Doc {
  const { text, sel } = doc;
  const { lines } = blockLines(text, sel[0], sel[1]);
  const isList = lines.some((l) => listInfo(l.text).kind !== "none");
  if (!isList) return indentLines(doc, dir);
  return mapBlock(doc, (ls) =>
    ls.map((line) => {
      const li = listInfo(line);
      if (line.trim() === "") return line;
      li.indent = dir === 1 ? li.indent + INDENT_UNIT : outdent(li.indent);
      return formatList(li);
    }),
  );
}

/** 勾选 / 取消勾选任务项 */
export function toggleTask(doc: Doc): Doc {
  return mapBlock(doc, (ls) =>
    ls.map((line) => {
      const li = listInfo(line);
      if (li.kind !== "task") return line;
      li.task = li.task === "[x]" ? "[ ]" : "[x]";
      return formatList(li);
    }),
  );
}

// ---------------------------------------------------------------- 块级插入

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** 在光标处插入一段模板（CARET 标记光标落点），自动补齐空行 */
export function insertTemplate(doc: Doc, tpl: string): Doc {
  const { text, sel } = doc;
  const [s, e] = sel;
  const before = text.slice(0, s);
  const after = text.slice(e);

  const needLead = s === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const needTail = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const payload = tpl.replace(/^\n+|\n+$/g, "");
  const caretInTpl = payload.indexOf(CARET);
  const clean = payload.replace(CARET, "");
  const snippet = needLead + clean + needTail;
  const next = before + snippet + after;
  const caret = s + needLead.length + (caretInTpl < 0 ? clean.length : caretInTpl);
  return { text: next, sel: [caret, caret] };
}

/** 用选区内容填充模板中的 %s */
export function insertTemplateWithSel(doc: Doc, tpl: string): Doc {
  const { text, sel } = doc;
  const inner = text.slice(sel[0], sel[1]);
  const filled = inner ? tpl.replace("%s", inner) : tpl.replace("%s", "文字");
  return insertTemplate({ text: text.slice(0, sel[0]) + text.slice(sel[1]), sel: [sel[0], sel[0]] }, filled);
}

// ---------------------------------------------------------------- 行操作

/** 列表项（含子项）一直延伸到最后一个缩进更深的行 */
function blockEndAt(text: string, start: number): number {
  const firstEnd = lineEnd(text, start);
  const base = indentWidth(listInfo(text.slice(start, firstEnd)).indent);
  let cur = firstEnd;
  while (cur < text.length) {
    const ns = cur + 1;
    const ne = lineEnd(text, ns);
    const line = text.slice(ns, ne);
    if (line.trim() === "") break;
    if (indentWidth(listInfo(line).indent) <= base) break;
    cur = ne;
  }
  return cur;
}

export function duplicateLines(doc: Doc): Doc {
  const { text, sel } = doc;
  const { start } = selectionBlock(text, sel[0], sel[1]);
  const end = blockEndAt(text, start);
  const chunk = text.slice(start, end);
  const next = text.slice(0, end) + "\n" + chunk + text.slice(end);
  return { text: next, sel: [sel[0] + chunk.length + 1, sel[1] + chunk.length + 1] };
}

export function moveLines(doc: Doc, dir: -1 | 1): Doc {
  const { text, sel } = doc;
  const { start } = selectionBlock(text, sel[0], sel[1]);
  const end = blockEndAt(text, start);
  const chunk = text.slice(start, end);

  if (dir === -1) {
    if (start === 0) return doc;
    const baseIndent = indentWidth(listInfo(text.slice(start, lineEnd(text, start))).indent);
    // 向上找到同级/更浅一级的上一项行首
    let prevStart = lineStart(text, start - 1);
    while (prevStart > 0) {
      const up = lineStart(text, prevStart - 1);
      const prevLine = text.slice(up, prevStart - 1);
      if (prevLine.trim() !== "" && indentWidth(listInfo(prevLine).indent) <= baseIndent) {
        prevStart = up;
        break;
      }
      prevStart = up;
    }
    const prevEnd = Math.min(blockEndAt(text, prevStart), start - 1);
    if (prevEnd < prevStart) return doc;
    const prev = text.slice(prevStart, prevEnd);
    const next = text.slice(0, prevStart) + chunk + "\n" + prev + text.slice(end);
    const d = prevStart - start; // 整块前移到上一块的行首
    return { text: next, sel: [sel[0] + d, sel[1] + d] };
  }

  if (end >= text.length) return doc;
  const nextStart = end + 1;
  const nextEnd = blockEndAt(text, nextStart);
  const nex = text.slice(nextStart, nextEnd);
  const next = text.slice(0, start) + nex + "\n" + chunk + text.slice(nextEnd);
  const d = nex.length + 1;
  return { text: next, sel: [sel[0] + d, sel[1] + d] };
}

export function deleteLines(doc: Doc): Doc {
  const { text, sel } = doc;
  const { start, end } = selectionBlock(text, sel[0], sel[1]);
  // 连同行尾换行一起删掉
  const to = end < text.length ? end + 1 : text.length;
  const from = end === text.length && start > 0 ? start - 1 : start;
  const next = text.slice(0, from) + text.slice(to);
  const caret = clamp(from, 0, next.length);
  return { text: next, sel: [caret, caret] };
}

/** 普通缩进（非列表） */
export function indentLines(doc: Doc, dir: -1 | 1): Doc {
  return mapBlockLines(
    doc,
    (line) => {
      if (line.trim() === "") return line;
      if (dir === 1) return INDENT_UNIT + line;
      if (line.startsWith(INDENT_UNIT)) return line.slice(INDENT_UNIT.length);
      if (line.startsWith("\t")) return line.slice(1);
      if (line.startsWith(" ")) return line.slice(1);
      return line;
    },
    false,
  );
}

/** Tab：无选区时插入两个空格，有选区时整块缩进；列表内按层缩进 */
export function tab(doc: Doc, shift: boolean): Doc {
  const { text, sel } = doc;
  const inList = listInfo(text.slice(lineStart(text, sel[0]), lineEnd(text, sel[0]))).kind !== "none";
  if (sel[0] !== sel[1] || inList) return indentList(doc, shift ? -1 : 1);
  const next = text.slice(0, sel[0]) + INDENT_UNIT + text.slice(sel[0]);
  return { text: next, sel: [sel[0] + INDENT_UNIT.length, sel[0] + INDENT_UNIT.length] };
}

/** Enter：延续列表 / 引用；空条目逐级退出 */
export function newline(doc: Doc): Doc | null {
  const { text, sel } = doc;
  const [s, e] = sel;
  if (s !== e) return null;
  const ls = lineStart(text, s);
  const line = text.slice(ls, s);
  const li = listInfo(line);
  const emptyBody = li.body.trim() === "";

  if (li.kind !== "none" && emptyBody) {
    // 空列表项：先降一级；已经在顶层则退出列表
    if (indentWidth(li.indent) > 0) {
      const next = { ...li, indent: outdent(li.indent), num: 1, body: "" };
      const prefix = listPrefix(next);
      return { text: text.slice(0, ls) + prefix + text.slice(s), sel: [ls + prefix.length, ls + prefix.length] };
    }
    return { text: text.slice(0, ls) + li.quote + text.slice(s), sel: [ls + li.quote.length, ls + li.quote.length] };
  }
  if (li.kind === "none" && li.quote !== "" && emptyBody) {
    return { text: text.slice(0, ls) + text.slice(s), sel: [ls, ls] };
  }
  if (li.kind === "none" && li.quote === "") return null;

  const next: ListInfo = { ...li };
  if (next.kind === "ordered") next.num += 1;
  if (next.task) next.task = "[ ]";
  next.body = "";
  const prefix = listPrefix(next);
  const insert = "\n" + prefix;
  return { text: text.slice(0, s) + insert + text.slice(e), sel: [s + insert.length, s + insert.length] };
}

/** 行首 Backspace：先去掉列表标记，再去掉一级缩进，都不适用则交回默认行为 */
export function backspaceAtStart(doc: Doc): Doc | null {
  const { text, sel } = doc;
  const [s, e] = sel;
  if (s !== e) return null;
  const ls = lineStart(text, s);
  if (s !== ls) return null;
  const line = text.slice(ls, lineEnd(text, ls));
  const li = listInfo(line);
  if (li.kind !== "none") {
    const next = { ...li, kind: "none" as ListKind, task: "" };
    const newLine = formatList(next);
    return {
      text: text.slice(0, ls) + newLine + text.slice(ls + line.length),
      sel: [ls + (next.indent.length + next.quote.length), ls + (next.indent.length + next.quote.length)],
    };
  }
  if (indentWidth(li.indent) > 0) {
    const indent = outdent(li.indent);
    const newLine = indent + li.quote + li.body;
    const caret = ls + indent.length + li.quote.length;
    return { text: text.slice(0, ls) + newLine + text.slice(ls + line.length), sel: [caret, caret] };
  }
  return null;
}

// ---------------------------------------------------------------- 代码块

const fence = (lang: string) => "```" + lang + "\n" + CARET + "\n```";

export function toggleFence(doc: Doc, lang = "cpp"): Doc {
  const { text, sel } = doc;
  const inner = text.slice(sel[0], sel[1]);
  // 已在代码块内 -> 去掉围栏
  const ls = lineStart(text, sel[0]);
  const openLine = text.slice(ls, lineEnd(text, ls));
  if (RE_FENCE.test(openLine)) {
    const closeIdx = text.indexOf("\n```", sel[0]);
    if (closeIdx >= 0) {
      const closeEnd = lineEnd(text, closeIdx + 1);
      const body = text.slice(lineEnd(text, ls) + 1, closeIdx);
      const next = text.slice(0, ls) + body + text.slice(closeEnd);
      return { text: next, sel: [ls, ls + body.length] };
    }
  }
  if (!inner) return insertTemplate(doc, fence(lang));
  const snippet = "```" + lang + "\n" + inner + "\n```";
  const next = text.slice(0, sel[0]) + snippet + text.slice(sel[1]);
  return { text: next, sel: [sel[0] + lang.length + 4, sel[0] + lang.length + 4 + inner.length] };
}

// ---------------------------------------------------------------- 模板

export const TEMPLATES = {
  codeBlock: (lang = "cpp") => fence(lang),
  table: () => "| 列 1 | 列 2 |\n| --- | --- |\n| " + CARET + " |  |",
  hr: () => "---",
  frontMatter: () => "---\ntitle: 题解\ndate: \n---\n" + CARET,
};

/** 在光标处插入行内片段（公式符号 / 函数名等）：%s 用选区填充，CARET 标记落点 */
export function insertText(doc: Doc, snippet: string): Doc {
  const { text, sel } = doc;
  const [s, e] = sel;
  const picked = text.slice(s, e);
  let body = snippet;
  let placeholderRange: [number, number] | null = null;
  if (body.includes("%s")) {
    const fill = picked || "x";
    const at = body.indexOf("%s");
    body = body.replace("%s", fill);
    if (!picked) placeholderRange = [s + at, s + at + fill.length];
  }
  const caretAt = body.indexOf(CARET);
  const clean = body.replace(CARET, "");
  const next = text.slice(0, s) + clean + text.slice(e);
  if (placeholderRange) return { text: next, sel: placeholderRange };
  const caret = s + (caretAt < 0 ? clean.length : caretAt);
  return { text: next, sel: [caret, caret] };
}

/** 公式模板：$$ / \[ \] / 环境 */
export const MATH_TEMPLATES = {
  display: () => "$$\n" + CARET + "\n$$",
  bracket: () => "\\[\n" + CARET + "\n\\]",
  inline: () => "$" + CARET + "$",
  inlineParen: () => "\\(" + CARET + "\\)",
  aligned: () => "$$\n\\begin{aligned}\n" + CARET + "\\end{aligned}\n$$",
  cases: () => "$$\nf(x)=\\begin{cases}\n" + CARET + "\\end{cases}\n$$",
  matrix: () => "$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}\n$$",
  equation: () => "\\begin{equation}\n" + CARET + "\n\\end{equation}",
  sum: () => "$\\sum_{i=1}^{n} " + CARET + "$",
  prod: () => "$\\prod_{i=1}^{n} " + CARET + "$",
  integral: () => "$\\int_{a}^{b} " + CARET + " \\,\\mathrm{d}x$",
  limit: () => "$\\lim_{n \\to \\infty} " + CARET + "$",
  frac: () => "$\\frac{" + CARET + "}{}$",
  sqrt: () => "$\\sqrt{" + CARET + "}$",
  binom: () => "$\\binom{n}{" + CARET + "}$",
  operator: () => "$\\operatorname{" + CARET + "}$",
};

// ---------------------------------------------------------------- 链接 / 图片

const URL = "https://";

export function linkCmd(doc: Doc): Doc {
  const { text, sel } = doc;
  const inner = text.slice(sel[0], sel[1]);
  const label = inner || "链接文字";
  const snippet = `[${label}](${URL})`;
  const next = text.slice(0, sel[0]) + snippet + text.slice(sel[1]);
  const urlStart = sel[0] + label.length + 3;
  return { text: next, sel: [urlStart, urlStart + URL.length] };
}

export function imageCmd(doc: Doc): Doc {
  const { text, sel } = doc;
  const inner = text.slice(sel[0], sel[1]);
  const label = inner || "图片说明";
  const snippet = `![${label}](${URL})`;
  const next = text.slice(0, sel[0]) + snippet + text.slice(sel[1]);
  const urlStart = sel[0] + label.length + 4;
  return { text: next, sel: [urlStart, urlStart + URL.length] };
}

export { sameBlock };
