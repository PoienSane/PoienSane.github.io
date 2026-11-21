/**
 * 公式定界符 / 环境的统一来源。
 * 渲染器（markdown.ts）、源码高亮（Editor.tsx）、规范检查（lint.ts）都从这里取，
 * 保证「看到什么 = 检查什么 = 渲染什么」。
 */

/** 支持的行间公式环境（KaTeX 原生支持的那些） */
export const MATH_ENVS = [
  "align",
  "align*",
  "aligned",
  "alignat",
  "alignat*",
  "alignedat",
  "gather",
  "gather*",
  "gathered",
  "equation",
  "equation*",
  "multline",
  "multline*",
  "split",
  "cases",
  "dcases",
  "rcases",
  "array",
  "subarray",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "CD",
] as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const ENV_ALT = MATH_ENVS.map(esc).join("|");

/**
 * 行内公式正则源码（无 ? 前缀，带 4 个捕获组）：
 *   1 → `$$…$$`（行内的行间公式）
 *   2 → `$…$`
 *   3 → `\(…\)`
 *   4 → `\[…\]`（行内的行间公式）
 */
export const INLINE_MATH_SRC =
  String.raw`\$\$(?!\$)([^\n]+?)\$\$` +
  String.raw`|\$(?![\s$])((?:\\.|[^$\\\n])+?)\$` +
  String.raw`|\\\(((?:\\.|[^\\])+?)\\\)` +
  String.raw`|\\\[((?:\\.|[^\\])+?)\\\]`;

/** 从 INLINE_MATH_SRC 的匹配结果里取出公式体与是否行间 */
export function mathGroup(m: RegExpMatchArray): { body: string; display: boolean } | null {
  for (let i = 1; i <= 4; i++) {
    if (m[i] !== undefined) return { body: m[i], display: i === 1 || i === 4 };
  }
  return null;
}

export const inlineMathRe = () => new RegExp("(?<!\\\\)(?:" + INLINE_MATH_SRC + ")", "g");

/** 行首的行间公式起手：$$、\[、\begin{env} */
export const DISPLAY_OPEN_RE = new RegExp(String.raw`^ {0,3}(?:\$\$|\\\[|\\begin\{(${ENV_ALT})\})`);

export interface BlockMath {
  raw: string;
  body: string;
  env: string | null;
}

const RE_HEAD = new RegExp(String.raw`^ {0,3}(?:\$\$|\\\[|\\begin\{(${ENV_ALT})\})`);

/** 从块首解析一段行间公式（含环境），失败返回 null */
export function matchBlockMath(src: string): BlockMath | null {
  const head = RE_HEAD.exec(src);
  if (!head) return null;
  const env = head[1] ?? null;

  let bodyStart: number;
  let bodyEnd: number;
  let bodyClose = 0; // 结尾定界符长度（环境为 0，公式体含 \end）

  if (env) {
    const openTok = "\\begin{" + env + "}";
    const endTok = "\\end{" + env + "}";
    bodyStart = src.indexOf(openTok, head[0].length - openTok.length);
    if (bodyStart < 0) return null;
    let depth = 1;
    let i = bodyStart + openTok.length;
    let close = -1;
    for (;;) {
      const nb = src.indexOf(openTok, i);
      const ne = src.indexOf(endTok, i);
      if (ne < 0) return null;
      if (nb >= 0 && nb < ne) {
        depth++;
        i = nb + openTok.length;
        continue;
      }
      depth--;
      i = ne + endTok.length;
      if (depth === 0) {
        close = ne;
        break;
      }
    }
    bodyEnd = close + endTok.length;
    bodyClose = 0;
  } else {
    const openTok = head[0].trimStart();
    const closeTok = openTok === "$$" ? "$$" : "\\]";
    bodyStart = head[0].length;
    const close = src.indexOf(closeTok, bodyStart);
    if (close < 0) return null;
    bodyEnd = close + closeTok.length;
    bodyClose = closeTok.length;
  }

  // 吃掉结尾的空格与换行，避免产生空块
  const tail = /^[ \t]*(?:\n+|$)/.exec(src.slice(bodyEnd))?.[0] ?? "";
  return {
    raw: src.slice(0, bodyEnd) + tail,
    body: src.slice(bodyStart, bodyEnd - bodyClose),
    env,
  };
}

/** marked 的 start() 钩子：找出下一个可能的行间公式起点 */
export function blockMathStart(src: string): number | undefined {
  const re = new RegExp(String.raw`(?:^|\n)( {0,3}(?:\$\$|\\\[|\\begin\{(?:${ENV_ALT})\}))`);
  const m = re.exec(src);
  return m ? m.index + m[0].length - m[1].length : undefined;
}

/** 常用宏：渲染与检查共用，避免“能渲染但报错”的不一致 */
export const MATH_MACROS: Record<string, string> = {
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\eps": "\\varepsilon",
  "\\dd": "\\mathrm{d}",
  "\\abs": "\\left|#1\\right|",
  "\\norm": "\\left\\|#1\\right\\|",
  "\\set": "\\left\\{#1\\right\\}",
  "\\ceil": "\\left\\lceil #1\\right\\rceil",
  "\\floor": "\\left\\lfloor #1\\right\\rfloor",
  "\\and": "\\land",
  "\\or": "\\lor",
};
