import katex from "katex";
import { DISPLAY_OPEN_RE, INLINE_MATH_SRC, MATH_MACROS, mathGroup } from "./mathre";

/**
 * 题解规范检查（仅检查以下三条）：
 *  1. 全角中文标点，句末要有句号；
 *  2. 数学公式使用 LaTeX，非数学内容（英文单词、算法名、人名等）不使用 LaTeX；
 *  3. 中文与英文、数字、公式之间以半角空格隔开；中文标点与它们之间不留空格。
 * 另外附带 KaTeX 公式语法检查。
 */

export type Rule = "punct" | "end" | "space" | "latex" | "katex";

export interface Fix {
  from: number;
  to: number;
  text: string;
}

export interface Diag {
  from: number;
  to: number;
  line: number; // 0-based
  col: number; // 0-based
  rule: Rule;
  message: string;
  fix?: Fix;
}

export const RULE_LABEL: Record<Rule, string> = {
  punct: "全角标点",
  end: "句末句号",
  space: "中英空格",
  latex: "公式规范",
  katex: "公式语法",
};

const HAN_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
const CPUNCT = "，。；：！？、（）“”‘’《》〈〉【】「」『』…—·～";
const CLOSERS = "）”’」』》〉】";
const ENDERS = "。！？…；：";
const FULL: Record<string, string> = {
  ",": "，",
  ".": "。",
  ";": "；",
  ":": "：",
  "!": "！",
  "?": "？",
  "(": "（",
  ")": "）",
};

// 掩码占位符
const M = "\u0001"; // 公式
const C = "\u0002"; // 行内代码
const U = "\u0003"; // 链接 / URL / HTML
const T = "\u0004"; // 强调标记（透明）

// 允许出现在公式里的“运算符名称”
const OP_WORDS = new Set([
  "log", "lg", "ln", "gcd", "lcm", "max", "min", "mod", "sin", "cos", "tan", "cot", "sec", "csc",
  "exp", "arg", "det", "dim", "lim", "sup", "inf", "deg", "ker", "sum", "prod", "pmod", "bmod",
  "popcount", "sgn", "ord", "rank", "tr",
]);
const KNOWN_ABBR = new Set([
  "DFS", "BFS", "SPFA", "LCA", "LCT", "KMP", "FFT", "NTT", "SAM", "TLE", "MLE", "AC", "DP", "BIT",
  "RMQ", "DSU", "SCC", "MST", "AC", "STL", "IOI", "NOI", "NOIP", "CSP", "ICPC",
]);

function cls(ch: string): string {
  if (ch === M) return "M";
  if (ch === C || ch === U) return "O";
  if (ch === T) return "T";
  if (/\s/.test(ch)) return "S";
  if (HAN_RE.test(ch)) return "H";
  if (CPUNCT.includes(ch)) return "P";
  if (/[A-Za-z0-9]/.test(ch)) return "A";
  if (',.;:!?()"'.includes(ch)) return "Q";
  return "O";
}

function maskRange(a: string[], s: number, e: number, ch: string) {
  for (let k = s; k < e; k++) a[k] = ch;
}

// ---------- KaTeX 语法检查（带缓存） ----------
const katexCache = new Map<string, string | null>();
function katexError(tex: string, display: boolean): string | null {
  const key = (display ? "D" : "I") + tex;
  const hit = katexCache.get(key);
  if (hit !== undefined) return hit;
  let res: string | null = null;
  try {
    katex.renderToString(tex, {
      throwOnError: true,
      displayMode: display,
      output: "html",
      strict: "ignore",
      macros: MATH_MACROS,
    });
  } catch (e) {
    res = String((e as Error).message || e).replace(/^KaTeX parse error:\s*/, "");
  }
  if (katexCache.size > 3000) katexCache.clear();
  katexCache.set(key, res);
  return res;
}

// ---------- 数学化 ----------
const TEXIFY: [RegExp, string][] = [
  [/<=/g, "\\le"],
  [/>=/g, "\\ge"],
  [/!=/g, "\\ne"],
  [/==/g, "="],
  [/->/g, "\\to"],
  [/≤/g, "\\le"],
  [/≥/g, "\\ge"],
  [/≠/g, "\\ne"],
  [/×/g, "\\times"],
  [/÷/g, "\\div"],
  [/±/g, "\\pm"],
  [/∈/g, "\\in"],
  [/∞/g, "\\infty"],
  [/π/g, "\\pi"],
  [/∑/g, "\\sum"],
  [/∏/g, "\\prod"],
  [/√/g, "\\sqrt"],
  [/≈/g, "\\approx"],
  [/∪/g, "\\cup"],
  [/∩/g, "\\cap"],
  [/\*/g, "\\times"],
];
function texify(s: string): string {
  let r = s;
  for (const [re, to] of TEXIFY) r = r.replace(re, to + " ");
  return r.replace(/(\\[A-Za-z]+) +(?=[\s^_)}]|$)/g, "$1").replace(/ {2,}/g, " ");
}

// ---------- 裸露的数学表达式识别 ----------
const TOK =
  /(\s+)|(<=|>=|!=|==|->)|([A-Za-z]\w*\([^()\n\u3400-\u9fff]*\))|([A-Za-z0-9]+(?:\.\d+)?)|([+\-*/=<>^_≤≥≠×÷±∈∪∩≈])|([∑∏∞√π])|(\{[^{}\n]*\})|(\([^()\n\u3400-\u9fff]*\))|([\s\S])/g;

interface Run {
  s: number;
  e: number;
  lone: boolean;
}

function findMathRuns(ms: string, raw: string): Run[] {
  type Tk = { k: string; s: number; e: number; t: string };
  const toks: Tk[] = [];
  for (const m of ms.matchAll(TOK)) {
    const s = m.index!;
    const t = m[0];
    const e = s + t.length;
    if (m[1]) toks.push({ k: "sp", s, e, t });
    else if (m[2]) toks.push({ k: "op", s, e, t });
    else if (m[3]) toks.push({ k: "call", s, e, t });
    else if (m[4]) {
      let k = "word";
      if (/^\d+(\.\d+)?$/.test(t)) k = "num";
      else if (/^[A-Za-z]$/.test(t)) k = "letter";
      else if (/^\d+[a-z]$/.test(t) && !"sdhgb".includes(t[t.length - 1])) k = "coef";
      toks.push({ k, s, e, t });
    } else if (m[5]) toks.push({ k: "op", s, e, t });
    else if (m[6]) toks.push({ k: "uni", s, e, t });
    else if (m[7]) toks.push({ k: "brace", s, e, t });
    else if (m[8]) toks.push({ k: "paren", s, e, t });
    else toks.push({ k: "other", s, e, t });
  }

  const runs: Run[] = [];
  type Cur = { s: number; endOpd: number; signal: boolean; lone: boolean; count: number };
  const st: { cur: Cur | null } = { cur: null };
  let last: "opd" | "op" | "" = "";
  let lastOp = "";

  const close = () => {
    const c = st.cur;
    if (c && c.signal) runs.push({ s: c.s, e: c.endOpd, lone: c.lone && c.count === 1 });
    st.cur = null;
    last = "";
    lastOp = "";
  };
  const startRun = (t: Tk, signal: boolean, lone: boolean) => {
    st.cur = { s: t.s, endOpd: t.e, signal, lone, count: 1 };
    last = "opd";
  };

  for (const t of toks) {
    if (t.k === "sp") continue;
    const isOpd = ["letter", "num", "coef", "call", "paren", "uni"].includes(t.k) || (t.k === "brace" && (lastOp === "^" || lastOp === "_"));
    if (isOpd) {
      const signal =
        t.k === "letter" ||
        t.k === "coef" ||
        t.k === "call" ||
        t.k === "uni" ||
        (t.k === "paren" && /[=<>+*/^_]|(^|[^A-Za-z0-9])[A-Za-z]($|[^A-Za-z0-9])/.test(t.t));
      const lone = t.k === "letter";
      if (st.cur && last === "opd") {
        close();
        startRun(t, signal, lone);
      } else if (st.cur && last === "op") {
        const c = st.cur!;
        c.endOpd = t.e;
        c.signal = c.signal || signal;
        c.lone = false;
        c.count++;
        last = "opd";
        lastOp = "";
      } else startRun(t, signal, lone);
    } else if (t.k === "op") {
      const ascii = t.t;
      const strong = ascii !== "-"; // 数字 - 数字 视为范围，不构成信号
      if (st.cur && last === "opd") {
        last = "op";
        lastOp = ascii;
        if (strong) st.cur!.signal = true;
      } else if (st.cur && last === "op" && ascii === "-") {
        lastOp = ascii;
      } else {
        close();
      }
    } else {
      close();
    }
  }
  close();

  // 过滤误报
  return runs.filter((r) => {
    const txt = raw.slice(r.s, r.e);
    if (txt === "I/O") return false;
    const before = raw[r.s - 1];
    const after = raw[r.e];
    if (before && /[#@\\&]/.test(before)) return false;
    if (r.lone) {
      if (after && /[+#'’]/.test(after)) return false; // C++ C# I'm
      if (after === "." && /[A-Za-z]/.test(raw[r.e + 1] || "")) return false;
      if (before === "." && /[A-Za-z]/.test(raw[r.s - 2] || "")) return false;
    }
    if (/^C\+\+\d*$/.test(txt)) return false;
    return true;
  });
}

// ---------- 主函数 ----------
export function lintMarkdown(text: string): Diag[] {
  const diags: Diag[] = [];
  const lines = text.split("\n");
  const starts: number[] = [];
  {
    let acc = 0;
    for (const l of lines) {
      starts.push(acc);
      acc += l.length + 1;
    }
  }

  const addDiag = (rule: Rule, line: number, from: number, to: number, message: string, fix?: Fix) => {
    diags.push({ from, to, line, col: from - starts[line], rule, message, fix });
  };

  const lineOf = (abs: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= abs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // 公式内容检查：语法 + 非数学内容
  const checkMath = (inner: string, display: boolean, rFrom: number, rTo: number) => {
    const ln = lineOf(rFrom);
    const err = katexError(inner, display);
    if (err) addDiag("katex", ln, rFrom, rTo, `公式语法错误：${err}`);
    if (HAN_RE.test(inner)) {
      addDiag("latex", ln, rFrom, rTo, "公式中不应包含中文，请把中文移到公式之外。");
      return;
    }
    const trimmed = inner.trim();
    if (/^[A-Za-z]{3,}$/.test(trimmed) && !OP_WORDS.has(trimmed.toLowerCase()) && (/[a-z]/.test(trimmed) || KNOWN_ABBR.has(trimmed))) {
      addDiag(
        "latex",
        ln,
        rFrom,
        rTo,
        `“${trimmed}” 是英文单词或名称，不应使用 LaTeX。`,
        display ? undefined : { from: rFrom, to: rTo, text: trimmed },
      );
      return;
    }
    for (const m of inner.matchAll(/\\(?:text|mathrm|textbf|textit|mbox|mathit|operatorname)\s*\{([^{}]*)\}/g)) {
      const bad = [...m[1].matchAll(/[A-Za-z]{2,}/g)].map((x) => x[0]).find((w) => !OP_WORDS.has(w.toLowerCase()));
      if (bad) {
        addDiag("latex", ln, rFrom, rTo, `公式中的英文单词 “${bad}” 不属于数学公式，不应写入 LaTeX（含 \\text）。`);
        return;
      }
    }
  };

  const isListStart = (s: string) => /^\s*(?:[-*+]|\d{1,9}[.)])\s+/.test(s);
  const isHeading = (s: string) => /^ {0,3}#{1,6}\s/.test(s);
  const isFenceStart = (s: string) => /^ {0,3}(`{3,}|~{3,})/.test(s);
  const isDisplayStart = (s: string) => DISPLAY_OPEN_RE.test(s);
  const isTable = (s: string) => /^\s*\|/.test(s);
  const isHr = (s: string) => /^ {0,3}([-*_])( *\1){2,} *$/.test(s);
  const isBlockStart = (s: string) => isHeading(s) || isFenceStart(s) || isDisplayStart(s) || isTable(s) || isListStart(s) || isHr(s);

  // ------ 单行内联分析 ------
  const analyze = (raw: string, base: number, lineNo: number, col: number, checkEnd: boolean, endsPara: boolean, paraHan: { v: boolean }) => {
    const m = raw.split("");
    maskRange(m, 0, col, " ");

    // 1. 行内代码
    const codeRe = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
    for (const x of raw.matchAll(codeRe)) {
      const s = x.index!;
      if (s < col) continue;
      maskRange(m, s, s + x[0].length, C);
    }
    // 2. 行内公式
    const mathRanges: { s: number; e: number; inner: string; display: boolean }[] = [];
    {
      const str = m.join("");
      const re = new RegExp("(?<!\\\\)(?:" + INLINE_MATH_SRC + ")", "g");
      for (const x of str.matchAll(re)) {
        const s = x.index!;
        if (s < col) continue;
        const g = mathGroup(x);
        if (!g) continue;
        mathRanges.push({ s, e: s + x[0].length, inner: g.body, display: g.display });
        maskRange(m, s, s + x[0].length, M);
      }
    }
    // 3. 图片 / 链接目标 / URL / 行内 HTML
    {
      let str = m.join("");
      for (const x of str.matchAll(/!\[[^\]\n]*\]\([^)\n]*\)/g)) maskRange(m, x.index!, x.index! + x[0].length, U);
      str = m.join("");
      for (const x of str.matchAll(/\]\(([^)\n]*)\)/g)) maskRange(m, x.index! + 1, x.index! + x[0].length, U);
      str = m.join("");
      for (const x of str.matchAll(/https?:\/\/[^\s)）]+|<[A-Za-z/!][^>\n]*>/g)) maskRange(m, x.index!, x.index! + x[0].length, U);
    }
    // 4. 强调标记
    {
      let str = m.join("");
      for (const x of str.matchAll(/\*\*|__|~~/g)) maskRange(m, x.index!, x.index! + 2, T);
      str = m.join("");
      for (let k = col; k < str.length; k++) {
        if (str[k] !== "*" || (k > 0 && raw[k - 1] === "\\")) continue;
        const p = str[k - 1];
        const n = str[k + 1];
        const opChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9\s\u0001]/.test(c);
        if (!(opChar(p) && opChar(n))) m[k] = T;
      }
    }

    const ms = m.join("");
    const lineHan = HAN_RE.test(ms);
    if (lineHan) paraHan.v = true;

    // 公式内容检查
    for (const r of mathRanges) checkMath(r.inner, r.display, base + r.s, base + r.e);

    if (lineHan) {
      const c = ms.split("").map(cls);
      const bare = new Array<boolean>(ms.length).fill(false);

      // ---- 规则 2：裸露数学表达式 ----
      for (const r of findMathRuns(ms, raw)) {
        const txt = raw.slice(r.s, r.e);
        for (let k = r.s; k < r.e; k++) bare[k] = true;
        addDiag(
          "latex",
          lineNo,
          base + r.s,
          base + r.e,
          r.lone ? `变量 “${txt}” 应使用 LaTeX：$${txt}$` : `运算式 “${txt}” 应使用 LaTeX：$${texify(txt)}$`,
          { from: base + r.s, to: base + r.e, text: `$${texify(txt)}$` },
        );
      }

      const idx: number[] = [];
      for (let k = 0; k < c.length; k++) if (c[k] !== "T") idx.push(k);

      // T 连续段编号（用于判断强调标记是起始还是结束）
      const runStartsBefore = (pos: number) => {
        let n = 0;
        for (let k = 0; k <= pos && k < c.length; k++) if (c[k] === "T" && (k === 0 || c[k - 1] !== "T")) n++;
        return n;
      };

      // ---- 规则 3a：中文与英文/数字/公式之间缺少空格 ----
      for (let p = 0; p + 1 < idx.length; p++) {
        const i = idx[p];
        const j = idx[p + 1];
        const a = c[i];
        const b = c[j];
        const need =
          (a === "H" && (b === "A" || b === "M")) ||
          (b === "H" && (a === "A" || a === "M")) ||
          (a === "A" && b === "M") ||
          (a === "M" && b === "A");
        if (!need) continue;
        if (bare[i] || bare[j]) continue;
        const kinds = a === "M" || b === "M" ? "公式" : "英文或数字";
        let pos = j;
        if (j > i + 1) pos = runStartsBefore(i) % 2 === 0 ? i + 1 : j;
        const cn = a === "H" || b === "H";
        addDiag(
          "space",
          lineNo,
          base + i,
          base + j + 1,
          cn ? `中文与${kinds}之间应加一个半角空格。` : "公式与英文、数字之间应加一个半角空格。",
          { from: base + pos, to: base + pos, text: " " },
        );
      }

      // ---- 规则 3b：中文标点与英文/数字/公式之间不应有空格 ----
      for (let p = 0; p < idx.length; p++) {
        if (c[idx[p]] !== "S") continue;
        if (p > 0 && c[idx[p - 1]] === "S") continue;
        let q = p;
        while (q + 1 < idx.length && c[idx[q + 1]] === "S") q++;
        const l = p > 0 ? c[idx[p - 1]] : "";
        const r = q + 1 < idx.length ? c[idx[q + 1]] : "";
        if (!l || !r) continue;
        const bad = (l === "P" && (r === "A" || r === "M")) || ((l === "A" || l === "M") && r === "P");
        if (!bad) continue;
        if (bare[idx[p - 1]] || bare[idx[q + 1]]) continue;
        const s = idx[p];
        const e = idx[q] + 1;
        addDiag("space", lineNo, base + s, base + e, "中文标点与英文、数字、公式之间不应有空格。", { from: base + s, to: base + e, text: "" });
      }

      // ---- 规则 1：全角标点 ----
      const quotes: number[] = [];
      for (let k = col; k < c.length; k++) {
        if (c[k] !== "Q" || bare[k]) continue;
        const ch = ms[k];
        const prevI = (() => {
          for (let t = k - 1; t >= 0; t--) if (c[t] !== "T") return t;
          return -1;
        })();
        const nextI = (() => {
          for (let t = k + 1; t < c.length; t++) if (c[t] !== "T") return t;
          return -1;
        })();
        const prevNS = (() => {
          for (let t = k - 1; t >= 0; t--) if (c[t] !== "T" && c[t] !== "S") return c[t];
          return "";
        })();
        const nextNS = (() => {
          for (let t = k + 1; t < c.length; t++) if (c[t] !== "T" && c[t] !== "S") return c[t];
          return "";
        })();
        const pI = prevI >= 0 ? c[prevI] : "";
        const nI = nextI >= 0 ? c[nextI] : "";

        if (ch === '"') {
          quotes.push(k);
          continue;
        }
        if (ch === "." && ms.startsWith("...", k)) {
          addDiag("punct", lineNo, base + k, base + k + 3, "省略号应使用全角“……”。", { from: base + k, to: base + k + 3, text: "……" });
          k += 2;
          continue;
        }
        let flag = false;
        if (ch === "(") flag = pI === "H" || pI === "P" || nI === "H" || nI === "M" || nI === "P";
        else if (ch === ")") flag = pI === "H" || pI === "M" || pI === "P" || nI === "H" || nI === "P";
        else if (ch === ".") {
          if (pI === "A" && nI === "A") flag = false;
          else flag = prevNS === "H" || prevNS === "P" || prevNS === "M" || nextNS === "H" || nextNS === "P" || (nI === "" && prevNS === "A");
        } else if (ch === ",") {
          flag = prevNS === "H" || prevNS === "P" || prevNS === "M" || nextNS === "H" || nextNS === "P";
        } else {
          // ; : ! ?
          flag = prevNS === "H" || prevNS === "P" || prevNS === "M" || nextNS === "H" || nextNS === "P" || (nI === "" && prevNS === "A");
          if (ch === ":" && nI === "Q" && ms[nextI] === ":") flag = false;
        }
        if (flag) {
          const full = FULL[ch];
          addDiag("punct", lineNo, base + k, base + k + 1, `中文语境应使用全角标点“${full}”，而不是半角“${ch}”。`, {
            from: base + k,
            to: base + k + 1,
            text: full,
          });
        }
      }
      // 半角引号：成对处理
      for (let t = 0; t + 1 < quotes.length; t += 2) {
        const a = quotes[t];
        const b = quotes[t + 1];
        const near = (k: number) => {
          const pv = k > 0 ? c[k - 1] : "";
          const nx = k + 1 < c.length ? c[k + 1] : "";
          return ["H", "P", "M"].includes(pv) || ["H", "P", "M"].includes(nx);
        };
        if (near(a) || near(b)) {
          addDiag("punct", lineNo, base + a, base + a + 1, "中文语境应使用全角引号“ ”。", { from: base + a, to: base + a + 1, text: "“" });
          addDiag("punct", lineNo, base + b, base + b + 1, "中文语境应使用全角引号“ ”。", { from: base + b, to: base + b + 1, text: "”" });
        }
      }
    }

    // ---- 规则 1：句末句号 ----
    // 列表项是短语时（短、且没有句中标点）不强求句号，避免每一条都报错
    const isListItem = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/.test(raw);
    const itemBody = raw.slice(col).trim();
    const shortItem = isListItem && itemBody.length <= 14 && !/[，、；：,;:]/.test(itemBody);
    if (checkEnd && endsPara && paraHan.v && !shortItem) {
      const trimmedRaw = raw.replace(/\s+$/, "");
      const hardBreak = /\\$/.test(trimmedRaw) || / {2,}$/.test(raw);
      const onlyLink = /^(\s*!?\[[^\]]*\]\([^)]*\)\s*)+$/.test(raw.slice(col));
      if (!hardBreak && !onlyLink && raw.slice(col).trim() !== "") {
        const c2 = ms.split("").map(cls);
        let k = -1;
        for (let t = c2.length - 1; t >= 0; t--) {
          if (c2[t] !== "T" && c2[t] !== "S") {
            k = t;
            break;
          }
        }
        const lastVisible = k;
        while (k >= 0 && c2[k] === "P" && CLOSERS.includes(ms[k])) {
          let t = k - 1;
          while (t >= 0 && (c2[t] === "T" || c2[t] === "S")) t--;
          k = t;
        }
        if (k >= 0 && c2[k] !== "Q" && !ENDERS.includes(ms[k]) && lastVisible >= 0) {
          const endPos = trimmedRaw.length;
          addDiag("end", lineNo, base + endPos - 1, base + endPos, "句末缺少句号，请以“。”结尾。", {
            from: base + endPos,
            to: base + endPos,
            text: "。",
          });
        }
      }
    }
  };

  // ------ 逐行扫描 ------
  let fence: { ch: string; len: number } | null = null;
  let display: { bodyAbs: number; from: number; close: string } | null = null;
  const paraHan = { v: false };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const base = starts[i];

    if (fence) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
      paraHan.v = false;
      continue;
    }
    if (display) {
      const k = line.indexOf(display.close);
      if (k >= 0) {
        const from = display.bodyAbs;
        const to = base + k;
        checkMath(text.slice(from, to), true, display.from, base + k + display.close.length);
        display = null;
      }
      paraHan.v = false;
      continue;
    }
    const fm = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fm) {
      fence = { ch: fm[1][0], len: fm[1].length };
      paraHan.v = false;
      continue;
    }
    const dm = DISPLAY_OPEN_RE.exec(line);
    if (dm) {
      const openCol = dm[0].length;
      const env = dm[1];
      const closeTok = env ? "\\end{" + env + "}" : dm[0].trimStart() === "$$" ? "$$" : "\\]";
      const closeIdx = line.indexOf(closeTok, openCol);
      if (closeIdx >= 0) {
        checkMath(
          line.slice(openCol, closeIdx + (env ? closeTok.length : 0)),
          true,
          base + openCol - (env ? 0 : 0),
          base + closeIdx + closeTok.length,
        );
      } else {
        display = { bodyAbs: base + openCol, from: base, close: closeTok };
      }
      paraHan.v = false;
      continue;
    }
    if (line.trim() === "") {
      paraHan.v = false;
      continue;
    }
    if (/^\s*<[A-Za-z/!]/.test(line) || isHr(line)) {
      paraHan.v = false;
      continue;
    }
    const hm = line.match(/^ {0,3}#{1,6}\s+/);
    if (hm) {
      paraHan.v = false;
      analyze(line, base, i, hm[0].length, false, false, paraHan);
      paraHan.v = false;
      continue;
    }
    if (isTable(line)) {
      paraHan.v = false;
      analyze(line, base, i, 0, false, false, paraHan);
      paraHan.v = false;
      continue;
    }

    let col = 0;
    let inQuote = false;
    const bq = line.match(/^(\s*>\s?)+/);
    if (bq) {
      col = bq[0].length;
      inQuote = true;
    }
    const lm = line.slice(col).match(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/);
    if (lm) {
      col += lm[0].length;
      paraHan.v = false;
    }

    // 是否段落最后一行
    const nx = lines[i + 1];
    let endsPara: boolean;
    if (nx === undefined) endsPara = true;
    else if (nx.trim() === "") {
      // 越过空行：若后面紧跟公式块或代码块，则认为句子延续到该块
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      endsPara = !(j < lines.length && (isDisplayStart(lines[j]) || isFenceStart(lines[j])));
    } else if (isDisplayStart(nx) || isFenceStart(nx)) endsPara = false; // 句子延续到后面的块
    else if (inQuote) {
      const nb = nx.match(/^(\s*>\s?)+/);
      endsPara = !nb || nx.slice(nb[0].length).trim() === "" || isBlockStart(nx.slice(nb[0].length));
    } else endsPara = isBlockStart(nx) || /^\s*>/.test(nx);

    analyze(line, base, i, col, true, endsPara, paraHan);
  }

  if (display) {
    const ln = lineOf(display.from);
    diags.push({
      from: display.from,
      to: display.from + 2,
      line: ln,
      col: display.from - starts[ln],
      rule: "katex",
      message: `公式没有闭合，缺少 “${display.close}”。`,
    });
  }

  diags.sort((a, b) => a.from - b.from || a.to - b.to);
  return diags;
}

/** 应用所有可自动修复的项（重叠的留到下一轮），迭代到稳定 */
export function applyAllFixes(text: string): { text: string; fixed: number } {
  let cur = text;
  let total = 0;
  for (let round = 0; round < 6; round++) {
    const ds = lintMarkdown(cur).filter((d) => d.fix);
    if (!ds.length) break;
    const fixes = ds
      .map((d) => d.fix!)
      .sort((a, b) => a.from - b.from || a.to - b.to);
    const picked: Fix[] = [];
    let lastEnd = -1;
    for (const f of fixes) {
      const prev = picked[picked.length - 1];
      if (prev && prev.from === f.from && prev.to === f.to && prev.text === f.text) continue;
      if (f.from < lastEnd || (f.from === lastEnd && prev && prev.from === prev.to && f.from === f.to)) continue;
      picked.push(f);
      lastEnd = f.to;
    }
    if (!picked.length) break;
    let out = "";
    let pos = 0;
    for (const f of picked) {
      out += cur.slice(pos, f.from) + f.text;
      pos = f.to;
    }
    out += cur.slice(pos);
    if (out === cur) break;
    total += picked.length;
    cur = out;
  }
  return { text: cur, fixed: total };
}
