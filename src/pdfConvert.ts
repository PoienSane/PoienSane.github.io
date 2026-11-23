/**
 * PDF 文字层 -> Markdown 的纯转换逻辑（不依赖 PDF.js，可单测）。
 * 负责：按坐标把文字片段聚成行、去重复页眉页脚、按字号/编号识别标题、
 * 识别项目符号、把被版面折断的段落合并回整段。
 */

export interface PdfTextLine {
  text: string;
  fontSize: number;
  x: number;
  /** PDF 文字坐标：通常 y 越大越靠页面上方 */
  y: number;
  pageWidth: number;
  pageHeight: number;
  /** 行宽（pt），用于判断独立公式是否居中 */
  width?: number;
  /** 整行主要是等宽字体（代码/终端输出） */
  mono?: boolean;
}

export interface PdfMarkdownResult {
  markdown: string;
  pages: number;
  chars: number;
  title: string;
  warnings: string[];
  /** 成功转成 LaTeX 的公式数量 */
  formulaConverted?: number;
  /** 有墨迹但识别失败、用占位符标出的公式数量 */
  formulaFailed?: number;
  /** 检测到的公式空位总数 */
  formulaSlots?: number;
}

/** 只修复 PDF 常见的康熙部首/兼容字（如 ⼊->入），不碰中文全角标点 */
function normalizePdfText(s: string): string {
  return s.replace(/[\u2e80-\u2fdf\uf900-\ufaff\ufb00-\ufb04]/g, (ch) => ch.normalize("NFKC"));
}

const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;

function shouldSpaceBetween(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (/\s$/.test(left) || /^\s/.test(right)) return false;
  const a = left[left.length - 1];
  const b = right[0];
  if (CJK.test(a) || CJK.test(b)) return false;
  if (/[，。；：、“”‘’（）《》【】「」『』·—…]$/.test(a)) return false;
  if (/^[，。；：、,.!?%)\]]/.test(b)) return false;
  return /[A-Za-z0-9]/.test(a) && /[A-Za-z0-9(\[]/.test(b);
}

export interface PdfRawItem {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  /** 字体样式（由 PDF.js 的字体名推断），导入时保留成 Markdown 样式 */
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}

export interface PdfFormulaSlot {
  token: string;
  x0: number;
  x1: number;
  /** 基线 y（PDF 坐标，y 越大越靠上） */
  y: number;
  fontSize: number;
}

export function formulaToken(index: number): string {
  return `@@MXF${String(index).padStart(4, "0")}@@`;
}

/**
 * 检测“公式空位”：同一行两个文字片段之间出现不合常理的大间隙，
 * 通常是公式被排成了矢量轮廓（Typora/MathJax 经系统打印常见），不在文字层里。
 * 这些位置稍后会从渲染好的页面上裁出区域做字形模板匹配，尽量转成 LaTeX；识别失败会明确占位计数。
 */
export function detectFormulaSlots(items: PdfRawItem[], pageWidth: number, startIndex = 0): PdfFormulaSlot[] {
  const anchors = items.filter((it) => it.str.trim().length > 0);
  const sorted = [...anchors].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfRawItem[][] = [];
  for (const item of sorted) {
    let best: PdfRawItem[] | undefined;
    let bestDiff = Infinity;
    for (const line of lines) {
      const diff = Math.abs(line[0].y - item.y);
      const tol = Math.max(2.4, Math.min(line[0].fontSize, item.fontSize) * 0.32);
      if (diff <= tol && diff < bestDiff) {
        best = line;
        bestDiff = diff;
      }
    }
    if (best) best.push(item);
    else lines.push([item]);
  }
  const slots: PdfFormulaSlot[] = [];
  let seq = startIndex;
  const bodyLeft = anchors.length ? Math.min(...anchors.map((i) => i.x)) : 0;
  const bodyRight = anchors.length ? Math.max(...anchors.map((i) => i.x + i.width)) : pageWidth;
  for (const line of lines) {
    const parts = [...line].sort((a, b) => a.x - b.x);
    // 行首/行尾公式：换行处的公式不在任何行内间隙里，按行首缩进量与行尾留白补检
    const first = parts[0];
    const last = parts[parts.length - 1];
    const startGap = first.x - bodyLeft;
    if (startGap > Math.max(7, first.fontSize * 0.55) && startGap < Math.min(320, pageWidth * 0.52)) {
      slots.push({ token: formulaToken(seq++), x0: bodyLeft, x1: first.x - 0.5, y: first.y, fontSize: first.fontSize });
    }
    const endGap = bodyRight - (last.x + last.width);
    if (endGap > Math.max(7, last.fontSize * 0.55) && endGap < Math.min(320, pageWidth * 0.52)) {
      slots.push({ token: formulaToken(seq++), x0: last.x + last.width + 0.5, x1: bodyRight, y: last.y, fontSize: last.fontSize });
    }
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      const prevEnd = a.x + a.width;
      const gap = b.x - prevEnd;
      const threshold = Math.max(6, Math.min(a.fontSize, b.fontSize) * 0.48);
      if (gap < threshold) continue;
      if (gap > Math.min(320, pageWidth * 0.52)) continue;
      slots.push({
        token: formulaToken(seq++),
        x0: prevEnd + 0.5,
        x1: b.x - 0.5,
        y: (a.y + b.y) / 2,
        fontSize: Math.max(a.fontSize, b.fontSize),
      });
    }
  }
  return slots;
}

export function groupPdfItems(items: PdfRawItem[], pageWidth: number, pageHeight: number): PdfTextLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfRawItem[][] = [];
  for (const item of sorted) {
    let best: PdfRawItem[] | undefined;
    let bestDiff = Infinity;
    for (const g of groups) {
      const gy = g[0].y;
      const diff = Math.abs(gy - item.y);
      const tol = Math.max(2.4, Math.min(item.fontSize, g[0].fontSize) * 0.32);
      if (diff <= tol && diff < bestDiff) {
        best = g;
        bestDiff = diff;
      }
    }
    if (best) best.push(item);
    else groups.push([item]);
  }

  const lines: PdfTextLine[] = [];
  interface Seg {
    text: string;
    bold: boolean;
    italic: boolean;
    mono: boolean;
    token: boolean;
  }
  const renderSeg = (seg: Seg, lineMono: boolean): string => {
    if (seg.token || (!seg.bold && !seg.italic && !seg.mono)) return seg.text;
    const lead = /^\s*/.exec(seg.text)?.[0] ?? "";
    const trail = /\s*$/.exec(seg.text)?.[0] ?? "";
    const core = seg.text.slice(lead.length, seg.text.length - trail.length || undefined).trim();
    if (!core) return seg.text;
    const body = core.replace(/\*/g, "\\*");
    if (seg.mono) return lineMono ? seg.text : `${lead}\`${body.replace(/`/g, "\\`")}\`${trail}`;
    if (!seg.bold && !seg.italic) return seg.text;
    const mark = seg.bold && seg.italic ? "***" : seg.bold ? "**" : "*";
    return `${lead}${mark}${body}${mark}${trail}`;
  };
  for (const group of groups) {
    const parts = [...group].sort((a, b) => a.x - b.x);
    const segs: Seg[] = [];
    let plain = "";
    let prevEnd = 0;
    let prevFont = 10;
    const push = (text: string, st: Omit<Seg, "text">) => {
      if (!text) return;
      const last = segs[segs.length - 1];
      if (last && last.bold === st.bold && last.italic === st.italic && last.mono === st.mono && last.token === st.token) last.text += text;
      else segs.push({ text, ...st });
    };
    for (const item of parts) {
      const str = normalizePdfText(item.str).replace(/\s+/g, " ");
      if (!str.trim() && !plain) continue;
      let prefix = "";
      if (plain) {
        const gap = item.x - prevEnd;
        if (gap > Math.max(1.4, prevFont * 0.18) && shouldSpaceBetween(plain, str)) prefix = " ";
        else if (gap > prevFont * 2.4) prefix = " ";
      }
      const token = /^@@MXF\d+@@$/.test(str.trim());
      if (prefix) push(prefix, { bold: false, italic: false, mono: false, token: false });
      push(str, token ? { bold: false, italic: false, mono: false, token: true } : { bold: !!item.bold, italic: !!item.italic, mono: !!item.mono, token: false });
      plain += prefix + str;
      prevEnd = item.x + Math.max(item.width, str.length * item.fontSize * 0.5);
      prevFont = Math.max(prevFont, item.fontSize);
    }
    const plainText = normalizePdfText(plain).replace(/[ \t]+/g, " ").trim();
    if (!plainText) continue;
    const monoChars = segs.filter((x) => x.mono && !x.token).reduce((a, x) => a + x.text.trim().length, 0);
    const lineMono = monoChars >= 3 && monoChars >= plainText.length * 0.6;
    const text = segs.map((seg) => renderSeg(seg, lineMono)).join("").replace(/[ \t]+/g, " ").trim();
    if (!text) continue;
    const x = Math.min(...parts.map((p) => p.x));
    lines.push({
      text,
      fontSize: Math.max(...parts.map((p) => p.fontSize)),
      x,
      y: parts[0].y,
      pageWidth,
      pageHeight,
      width: Math.max(...parts.map((p) => p.x + p.width)) - x,
      mono: lineMono || undefined,
    });
  }
  return lines.sort((a, b) => b.y - a.y || a.x - b.x);
}

function weightedMedianFont(lines: PdfTextLine[]): number {
  const pairs = lines
    .map((l) => ({ f: l.fontSize, w: Math.max(1, [...l.text].length) }))
    .sort((a, b) => a.f - b.f);
  const total = pairs.reduce((a, p) => a + p.w, 0);
  let acc = 0;
  for (const p of pairs) {
    acc += p.w;
    if (acc >= total / 2) return p.f;
  }
  return 11;
}

function removeRepeatedHeaderFooter(pages: PdfTextLine[][]): PdfTextLine[][] {
  if (pages.length < 3) return pages;
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page) {
      const nearEdge = line.y > line.pageHeight * 0.9 || line.y < line.pageHeight * 0.08;
      if (!nearEdge || line.text.length > 90) continue;
      const key = line.text.replace(/\d+/g, "#");
      if (!seen.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      seen.add(key);
    }
  }
  const threshold = Math.ceil(pages.length * 0.55);
  const repeated = new Set([...counts].filter(([, c]) => c >= threshold).map(([k]) => k));
  if (!repeated.size) return pages;
  return pages.map((page) =>
    page.filter((line) => {
      const nearEdge = line.y > line.pageHeight * 0.9 || line.y < line.pageHeight * 0.08;
      const key = line.text.replace(/\d+/g, "#");
      if (nearEdge && repeated.has(key)) return false;
      // 多页文档边缘的纯页码删掉
      if (nearEdge && /^\d{1,4}$/.test(line.text)) return false;
      return true;
    }),
  );
}

const endsPunct = (s: string) => /[。！？；：.!?;:]$/.test(s.trim());

function headingLevel(line: PdfTextLine, bodyFont: number, isDocumentStart: boolean): number {
  const t = line.text.trim();
  const len = [...t].length;
  if (len > 90 || endsPunct(t)) return 0;
  if (isDocumentStart && line.fontSize >= bodyFont * 1.45 && len <= 80) return 1;
  if (/^第[一二三四五六七八九十百千\d]+[章节篇部分]/.test(t)) return 2;
  if (/^\d+\.\d+\.\d+\s*\S/.test(t)) return 4;
  if (/^\d+\.\d+\s*\S/.test(t)) return 3;
  if (/^\d{1,2}[、.．)]\s*\S/.test(t) && line.fontSize >= bodyFont * 1.02) return 2;
  if (line.fontSize >= bodyFont * 1.42 && len <= 80) return 2;
  if (line.fontSize >= bodyFont * 1.2 && len <= 90) return 3;
  return 0;
}

function normalizeList(text: string): string | null {
  const t = text.trim();
  if (/^[•·●▪◦]\s*/.test(t)) return "- " + t.replace(/^[•·●▪◦]\s*/, "");
  if (/^[-*]\s+/.test(t)) return "- " + t.replace(/^[-*]\s+/, "");
  const num = /^(\d{1,3})[.、)]\s+(.+)$/.exec(t);
  if (num) return `${Number(num[1])}. ${num[2]}`;
  return null;
}

function escapeBodyStart(text: string): string {
  return text.replace(/^(\s*)([#>\-|])/, "$1\\$2");
}

/** 把已经提取好的分页文字行转成 Markdown。单独导出是为了可测试。 */
export function pdfLinesToMarkdown(pagesIn: PdfTextLine[][], fallbackTitle: string): PdfMarkdownResult {
  const pages = removeRepeatedHeaderFooter(pagesIn.map((p) => [...p]));
  const leftCounts = new Map<number, number>();
  for (const line of pages.flat()) {
    if (line.fontSize <= 0) continue;
    const key = Math.round(line.x / 4) * 4;
    leftCounts.set(key, (leftCounts.get(key) ?? 0) + 1);
  }
  const bodyLeft = [...leftCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const all = pages.flat();
  const bodyRight = all.length ? Math.max(...all.map((l) => l.x + (l.width ?? 0))) : 0;
  const bodyFont = all.length ? weightedMedianFont(all) : 11;
  const indentedCount = all.filter((l) => l.x >= bodyLeft + 16 && [...l.text].length <= 90 && l.fontSize <= bodyFont * 1.15).length;
  const warnings: string[] = [];
  const blocks: string[] = [];
  let title = normalizePdfText(fallbackTitle).trim() || "PDF 导入";
  let titleUsed = false;
  let firstMeaningful = true;
  let chars = 0;

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    let para = "";
    let codeBuf: string[] = [];
    let prev: PdfTextLine | null = null;
    const flush = () => {
      if (para.trim()) blocks.push(escapeBodyStart(para.trim()));
      para = "";
    };
    // 等宽代码块按内容嗅探语言：认出 C++/Python 后，预览里能高亮、能直接运行/对拍
    const sniffLang = (code: string): string => {
      if (/#include\s*<|using\s+namespace\s+std|int\s+main\s*\(|std::/.test(code)) return "cpp";
      if (/^\s*(from\s+\w+\s+import\s|import\s+\w+|def\s+\w+\s*\(|print\s*\()/m.test(code)) return "python";
      return "";
    };
    const flushCode = () => {
      if (codeBuf.length) {
        const joined = codeBuf.join("\n");
        blocks.push("```" + sniffLang(joined) + "\n" + joined + "\n```");
      }
      codeBuf = [];
    };

    for (const line of page) {
      const raw = normalizePdfText(line.text).replace(/\s+/g, " ").trim();
      if (!raw) continue;
      chars += raw.length;
      const level = headingLevel(line, bodyFont, firstMeaningful && pi === 0);
      firstMeaningful = false;

      if (level === 1) {
        flush();
        flushCode();
        title = raw.replace(/[*`]/g, "");
        titleUsed = true;
        prev = line;
        continue;
      }
      if (level > 1) {
        flush();
        flushCode();
        blocks.push(`${"#".repeat(level)} ${raw.replace(/^#+\s*/, "")}`);
        prev = line;
        continue;
      }

      // 等宽字体行（代码/终端）连续出现时还原成代码块，而不是挤进正文段落
      if (line.mono && level === 0) {
        flush();
        codeBuf.push(raw);
        prev = line;
        continue;
      }
      // 居中独占一行的公式是行间公式，还原成 $$...$$，与原 PDF 的居中大公式一致
      if (/^@@MXF\d{4}@@$/.test(raw) && line.width !== undefined) {
        const leftGap = line.x - bodyLeft;
        const rightGap = bodyRight - (line.x + line.width);
        const centered =
          leftGap > Math.max(18, line.pageWidth * 0.04) &&
          rightGap > Math.max(18, line.pageWidth * 0.04) &&
          Math.abs(leftGap - rightGap) < line.pageWidth * 0.06;
        if (centered) {
          flush();
          flushCode();
          blocks.push(`$$${raw}$$`);
          prev = line;
          continue;
        }
      }

      const list = normalizeList(raw);
      if (list) {
        flush();
        flushCode();
        blocks.push(list);
        prev = line;
        continue;
      }
      // 文字层常丢掉列表符号（如浏览器打印的 • 画成路径），用“同级缩进 + 多行重复”兜底识别
      if (
        indentedCount >= 2 &&
        line.x >= bodyLeft + 16 &&
        [...raw].length <= 90 &&
        line.fontSize <= bodyFont * 1.15 &&
        !/^[。．，、；：！？）】」]/.test(raw) &&
        !raw.startsWith("@@MXF")
      ) {
        flush();
        flushCode();
        blocks.push("- " + raw);
        prev = line;
        continue;
      }

      flushCode();
      if (!para) {
        para = raw;
      } else {
        const gap = prev ? prev.y - line.y : 999;
        const mergedLine = gap <= Math.max(16, bodyFont * 1.75);
        if (!mergedLine || endsPunct(para) && gap > bodyFont * 1.35) {
          flush();
          para = raw;
        } else if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(raw)) {
          para = para.slice(0, -1) + raw;
        } else {
          para += (shouldSpaceBetween(para, raw) ? " " : "") + raw;
        }
      }
      prev = line;
    }
    flush();
    flushCode();
  }

  if (!titleUsed) blocks.unshift(`# ${title}`);
  else blocks.unshift(`# ${title}`);
  blocks.splice(1, 0, "<!-- 由墨序从 PDF 文字层导入：标题层级按字号和编号推断；公式、表格、图片与代码格式需要人工核对。 -->");

  if (pages.length > 1) warnings.push(`共 ${pages.length} 页，页眉页脚和纯页码已尽量去除`);
  warnings.push("标题按字号/编号启发式识别，复杂版面可能需要手工调整");
  warnings.push("PDF 中的图片和表格无法从文字层精确还原；矢量公式会尽量转成 LaTeX，复杂公式仍需人工核对");

  return {
    markdown: blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n",
    pages: pages.length,
    chars,
    title,
    warnings,
  };
}

