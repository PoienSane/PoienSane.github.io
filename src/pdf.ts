import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";
import {
  detectFormulaSlots,
  groupPdfItems,
  pdfLinesToMarkdown,
  type PdfFormulaSlot,
  type PdfMarkdownResult,
  type PdfRawItem,
  type PdfTextLine,
} from "./pdfConvert";
import { recognizeFormula, type FormulaResult } from "./formulaOcr";

export type { PdfMarkdownResult, PdfTextLine } from "./pdfConvert";

/**
 * PDF -> Markdown（纯本地，基于 PDF.js 的文字层）。
 * 能做：提取文字、按坐标聚行、按字号/编号识别标题、识别项目符号、合并被版面折断的段落；
 * 公式若被排成矢量轮廓（不在文字层），会检测空位并用字形模板匹配转成 LaTeX。
 * 不能做：扫描版 OCR，也不保证复杂公式无误还原。没有文字层时会明确报错，不伪造结果；
 * 认不准的公式用 $\\square$ 占位并计数，绝不硬猜，也不贴图冒充 Markdown。
 */

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  GlobalWorkerOptions.workerPort = new PdfWorker();
  workerReady = true;
}

/** 渲染一页，把每个公式空位裁下来做字形识别（token -> 识别结果） */
async function convertFormulaCrops(page: PDFPageProxy, slots: PdfFormulaSlot[]): Promise<Map<string, FormulaResult>> {
  const map = new Map<string, FormulaResult>();
  if (!slots.length) return map;
  const scale = 2.2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return map;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  for (const slot of slots) {
    const rect = viewport.convertToViewportRectangle([
      slot.x0,
      slot.y - slot.fontSize * 0.95,
      slot.x1,
      slot.y + slot.fontSize * 1.55,
    ]);
    const left = Math.max(0, Math.floor(Math.min(rect[0], rect[2])) - 2);
    const top = Math.max(0, Math.floor(Math.min(rect[1], rect[3])) - 2);
    const right = Math.min(canvas.width, Math.ceil(Math.max(rect[0], rect[2])) + 2);
    const bottom = Math.min(canvas.height, Math.ceil(Math.max(rect[1], rect[3])) + 2);
    const w = right - left;
    const hgt = bottom - top;
    if (w < 3 || hgt < 3) {
      map.set(slot.token, { kind: "empty" });
      continue;
    }
    const crop = document.createElement("canvas");
    crop.width = w;
    crop.height = hgt;
    const cctx = crop.getContext("2d");
    if (!cctx) {
      map.set(slot.token, { kind: "fail" });
      continue;
    }
    cctx.fillStyle = "#ffffff";
    cctx.fillRect(0, 0, w, hgt);
    cctx.drawImage(canvas, left, top, w, hgt, 0, 0, w, hgt);
    const baselineY = viewport.convertToViewportPoint(slot.x0, slot.y)[1] - top;
    map.set(slot.token, await recognizeFormula(crop, baselineY, slot.fontSize * scale));
  }
  return map;
}

function friendlyError(e: unknown): Error {
  const msg = String((e as Error)?.message || e || "");
  const name = String((e as Error)?.name || "");
  if (name.includes("Password") || /password/i.test(msg)) return new Error("这个 PDF 有密码保护，静态页无法解密导入。");
  if (name.includes("InvalidPDF") || /Invalid PDF/i.test(msg)) return new Error("文件不是有效的 PDF，或已经损坏。");
  if (/worker/i.test(msg)) return new Error("PDF 解析组件启动失败，请刷新页面后重试。");
  return new Error("PDF 解析失败：" + (msg || "未知错误"));
}

export async function pdfToMarkdown(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<PdfMarkdownResult> {
  ensureWorker();
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf: PDFDocumentProxy;
  try {
    pdf = await getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    throw friendlyError(e);
  }

  try {
    if (pdf.numPages > 300) throw new Error("PDF 超过 300 页，先拆分后再导入，避免浏览器内存不足。");
    const pages: PdfTextLine[][] = [];
    const formulaResults = new Map<string, FormulaResult>();
    let slotSeq = 0;
    let slotTotal = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      // 先解析一次算子列表，字体对象才会被 PDF.js 解析出来，才能拿到字体真名。
      // 注意不能用 getTextContent().styles 里的 fontFamily 判断样式：那是 PDF.js 的
      // 通用回退名（如把苹方正文标成 monospace），会把整篇正文误判成代码/斜体。
      await page.getOperatorList().catch(() => undefined);
      interface FontInfo { name?: string; bold?: boolean; italic?: boolean }
      const fontCache = new Map<string, FontInfo | undefined>();
      const fontInfo = (fontName?: string): FontInfo | undefined => {
        const key = fontName ?? "";
        if (!fontCache.has(key)) {
          let info: FontInfo | undefined;
          try {
            info = page.commonObjs.get(key) as FontInfo | undefined;
          } catch {
            info = undefined;
          }
          fontCache.set(key, info);
        }
        return fontCache.get(key);
      };
      const items: PdfRawItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || typeof (item as PdfTextItem).str !== "string") continue;
        const ti = item as unknown as PdfTextItem;
        const tr = ti.transform;
        const fontSize = Math.hypot(tr[2] || 0, tr[3] || 0) || Math.abs(tr[3]) || ti.height || 11;
        // 保留原 PDF 的字体样式（粗/斜/等宽），导入后用 Markdown 样式还原，而不是全压成正文
        const fo = fontInfo(ti.fontName);
        const label = fo?.name ?? "";
        items.push({
          str: ti.str,
          x: tr[4],
          y: tr[5],
          width: ti.width,
          fontSize,
          bold: fo?.bold || /bold|semibold|demibold|heavy|black/i.test(label) || undefined,
          italic: fo?.italic || /italic|oblique/i.test(label) || undefined,
          mono: /courier|mono|typewriter|consolas?|menlo|console|code/i.test(label) || undefined,
        });
      }
      const slots = detectFormulaSlots(items, viewport.width, slotSeq);
      slotSeq += slots.length;
      slotTotal += slots.length;
      const withSlots = slots.length
        ? [...items, ...slots.map((s) => ({ str: s.token, x: s.x0, y: s.y, width: s.x1 - s.x0, fontSize: s.fontSize }))]
        : items;
      pages.push(groupPdfItems(withSlots, viewport.width, viewport.height));
      if (slots.length) {
        const crops = await convertFormulaCrops(page, slots);
        crops.forEach((v, k) => formulaResults.set(k, v));
      }
      page.cleanup();
      onProgress?.(i, pdf.numPages);
    }

    const meta = await pdf.getMetadata().catch(() => null);
    const metaTitle = String((meta?.info as { Title?: string } | undefined)?.Title ?? "").trim();
    const fallback = metaTitle || file.name.replace(/\.pdf$/i, "") || "PDF 导入";
    const result = pdfLinesToMarkdown(pages, fallback);
    if (slotTotal > 0) {
      let converted = 0;
      let failed = 0;
      const applyToken = (token: string, display: boolean): string => {
        const r = formulaResults.get(token);
        if (r?.kind === "ok") {
          converted++;
          return display ? `$$\n${r.tex}\n$$` : `$${r.tex}$`;
        }
        if (r?.kind === "empty") return "";
        failed++;
        return display ? "$$\n\\square\n$$" : "$\\square$";
      };
      result.markdown = result.markdown
        .replace(/\$\$(@@MXF\d{4}@@)\$\$/g, (_m, token: string) => applyToken(token, true))
        .replace(/@@MXF\d{4}@@/g, (token) => applyToken(token, false));
      result.formulaSlots = slotTotal;
      result.formulaConverted = converted;
      result.formulaFailed = failed;
      if (converted > 0) {
        result.warnings.push(`有 ${converted} 处矢量公式已用字形匹配转成 LaTeX`);
        result.markdown = result.markdown.replace(
          "公式、表格、图片与代码格式需要人工核对。",
          `公式、表格、图片与代码格式需要人工核对；其中 ${converted} 处矢量公式已转成 LaTeX${failed ? `，${failed} 处识别失败已用方框占位待人工补` : ""}。`,
        );
      } else if (failed > 0) {
        result.warnings.push(`有 ${failed} 处矢量公式识别失败，已用 $\\square$ 占位`);
      }
    }
    if (result.chars < 20) {
      throw new Error("没有提取到足够的文字层。这个 PDF 可能是扫描图片版，需要 OCR；墨序是静态页，不能在本地冒充 OCR 结果。");
    }
    return result;
  } catch (e) {
    if (e instanceof Error && /没有提取到|超过 300 页/.test(e.message)) throw e;
    throw friendlyError(e);
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}
