/** 行级代码对比：LCS 最长公共子序列，输出 same / del / add 三种行 */

export interface DiffOp {
  t: "same" | "add" | "del";
  text: string;
  a: number | null; // A 中行号（1 起），add 时为 null
  b: number | null; // B 中行号（1 起），del 时为 null
}

function toLines(s: string): string[] {
  const lines = s.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(aText: string, bText: string): DiffOp[] {
  const A = toLines(aText);
  const B = toLines(bText);
  const n = A.length;
  const m = B.length;
  // dp[i][j] = A[i:] 与 B[j:] 的 LCS 长度
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ t: "same", text: A[i], a: i + 1, b: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "del", text: A[i], a: i + 1, b: null });
      i++;
    } else {
      ops.push({ t: "add", text: B[j], a: null, b: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ t: "del", text: A[i], a: i + 1, b: null }), i++;
  while (j < m) ops.push({ t: "add", text: B[j], a: null, b: j + 1 }), j++;
  return ops;
}

export function diffStats(ops: DiffOp[]): { add: number; del: number; same: number } {
  let add = 0;
  let del = 0;
  let same = 0;
  for (const o of ops) {
    if (o.t === "add") add++;
    else if (o.t === "del") del++;
    else same++;
  }
  return { add, del, same };
}

/** 把对比结果变成 ```diff 代码块可用的文本 */
export function diffToText(ops: DiffOp[]): string {
  return ops.map((o) => (o.t === "add" ? "+ " : o.t === "del" ? "- " : "  ") + o.text).join("\n");
}

/** 词级片段：一行内部哪些词变了 */
export interface WordSeg {
  t: "same" | "del" | "add";
  text: string;
}

/** 把一行代码切成词元：标识符、数字、空白各成一块，其余单字一块（中文注释逐字） */
export function tokenizeCode(line: string): string[] {
  return line.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|\s+|./gu) ?? [];
}

function tokenLcs(a: string[], b: string[]): WordSeg[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const segs: WordSeg[] = [];
  const push = (t: WordSeg["t"], text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.t === t) last.text += text;
    else segs.push({ t, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i]), i++;
  while (j < m) push("add", b[j]), j++;
  return segs;
}

/** 一对改动行的词级对比：aSegs 只含 same/del，bSegs 只含 same/add，可直接渲染高亮 */
export function diffWords(a: string, b: string): { aSegs: WordSeg[]; bSegs: WordSeg[] } {
  const ta = tokenizeCode(a);
  const tb = tokenizeCode(b);
  if (ta.length > 600 || tb.length > 600) {
    return {
      aSegs: a ? [{ t: "del", text: a }] : [],
      bSegs: b ? [{ t: "add", text: b }] : [],
    };
  }
  const segs = tokenLcs(ta, tb);
  return {
    aSegs: segs.filter((s) => s.t !== "add"),
    bSegs: segs.filter((s) => s.t !== "del"),
  };
}

/** 展示用行：把相邻的删/加配成「修改」行，词级高亮才有的放矢 */
export type DiffRow =
  | { kind: "same"; aNo: number; bNo: number; text: string }
  | { kind: "del"; aNo: number; text: string }
  | { kind: "add"; bNo: number; text: string }
  | { kind: "change"; aNo: number; bNo: number; aText: string; bText: string; aSegs: WordSeg[]; bSegs: WordSeg[] };

export function pairDiffRows(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === "same") {
      const o = ops[i];
      rows.push({ kind: "same", aNo: o.a!, bNo: o.b!, text: o.text });
      i++;
      continue;
    }
    const dels: DiffOp[] = [];
    const adds: DiffOp[] = [];
    while (i < ops.length && ops[i].t !== "same") {
      (ops[i].t === "del" ? dels : adds).push(ops[i]);
      i++;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const { aSegs, bSegs } = diffWords(dels[k].text, adds[k].text);
      rows.push({ kind: "change", aNo: dels[k].a!, bNo: adds[k].b!, aText: dels[k].text, bText: adds[k].text, aSegs, bSegs });
    }
    for (let k = pairs; k < dels.length; k++) rows.push({ kind: "del", aNo: dels[k].a!, text: dels[k].text });
    for (let k = pairs; k < adds.length; k++) rows.push({ kind: "add", bNo: adds[k].b!, text: adds[k].text });
  }
  return rows;
}

export function diffRowStats(rows: DiffRow[]): { add: number; del: number; change: number; same: number } {
  let add = 0;
  let del = 0;
  let change = 0;
  let same = 0;
  for (const r of rows) {
    if (r.kind === "add") add++;
    else if (r.kind === "del") del++;
    else if (r.kind === "change") change++;
    else same++;
  }
  return { add, del, change, same };
}

export type DiffDisplayRow = DiffRow | { kind: "gap"; count: number };

/** 折叠未改动的大段相同行：每处改动保留 context 行上下文，其余收成一行「未改动 N 行」 */
export function foldDiffRows(rows: DiffRow[], context = 2): DiffDisplayRow[] {
  if (!rows.some((r) => r.kind !== "same")) return rows;
  const keep = rows.map((r, idx) => {
    if (r.kind !== "same") return true;
    for (let d = 1; d <= context; d++) {
      if (rows[idx - d]?.kind !== "same" && rows[idx - d] !== undefined) return true;
      if (rows[idx + d]?.kind !== "same" && rows[idx + d] !== undefined) return true;
    }
    return false;
  });
  const out: DiffDisplayRow[] = [];
  let gap = 0;
  rows.forEach((r, idx) => {
    if (keep[idx]) {
      if (gap > 0) out.push({ kind: "gap", count: gap });
      gap = 0;
      out.push(r);
    } else {
      gap++;
    }
  });
  if (gap > 0) out.push({ kind: "gap", count: gap });
  return out;
}
