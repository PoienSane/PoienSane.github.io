/**
 * 公式字形识别（本地模板匹配，不是 AI/OCR 服务）：
 * Typora/MathJax 打印的 PDF 把公式排成矢量轮廓，不在文字层里。
 * 这里把裁下的公式区域做连通域分割，逐字与 KaTeX 数学字体模板比对，
 * 再按基线位置判断上下标，拼成 LaTeX。认不准就明确返回 fail，绝不硬猜。
 */

export type FormulaResult =
  | { kind: "ok"; tex: string; confidence: number }
  | { kind: "empty" }
  | { kind: "fail" };

interface Template {
  tex: string;
  bits: Uint8Array; // SIZE×SIZE 灰度墨量（0..255）
  bin: Uint8Array; // 二值化墨迹
  dil: Uint8Array; // bin 的 3×3 膨胀，容忍 1px 位移与笔画粗细差
  aspect: number;
  density: number;
}

function binarize(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) out[i] = data[i] >= 60 ? 1 : 0;
  return out;
}

function dilate(bin: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (!bin[y * SIZE + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) out[ny * SIZE + nx] = 1;
        }
    }
  return out;
}

const SIZE = 24;

interface CharSpec {
  ch: string;
  tex: string;
  font: "math" | "main" | "size1" | "size2";
}

function buildSpecs(): CharSpec[] {
  const specs: CharSpec[] = [];
  for (const c of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") specs.push({ ch: c, tex: c, font: "math" });
  for (const c of "0123456789") specs.push({ ch: c, tex: c, font: "main" });
  // 直立字母：\log、\operatorname{lca} 等在原稿里是正体，只有斜体模板会把 l 认成 1、a 认成 α
  for (const c of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") specs.push({ ch: c, tex: c, font: "main" });
  const syms: [string, string][] = [
    ["+", "+"],
    ["-", "-"],
    ["=", "="],
    ["<", "<"],
    [">", ">"],
    ["(", "("],
    [")", ")"],
    ["[", "["],
    ["]", "]"],
    ["|", "|"],
    [",", ","],
    [".", "."],
    ["/", "/"],
    ["*", "*"],
    [":", ":"],
    [";", ";"],
    ["!", "!"],
    ["×", "\\times"],
    ["≤", "\\le"],
    ["≥", "\\ge"],
    ["≠", "\\ne"],
    ["→", "\\to"],
    ["←", "\\leftarrow"],
    ["↔", "\\leftrightarrow"],
    ["∞", "\\infty"],
    ["∈", "\\in"],
    ["∉", "\\notin"],
    ["⊆", "\\subseteq"],
    ["⊂", "\\subset"],
    ["∪", "\\cup"],
    ["∩", "\\cap"],
    ["∅", "\\varnothing"],
    ["∑", "\\sum"],
    ["∏", "\\prod"],
    ["√", "\\sqrt"],
    ["·", "\\cdot"],
    ["±", "\\pm"],
    ["α", "\\alpha"],
    ["β", "\\beta"],
    ["γ", "\\gamma"],
    ["δ", "\\delta"],
    ["ε", "\\varepsilon"],
    ["θ", "\\theta"],
    ["λ", "\\lambda"],
    ["μ", "\\mu"],
    ["π", "\\pi"],
    ["σ", "\\sigma"],
    ["φ", "\\varphi"],
    ["ω", "\\omega"],
    ["Δ", "\\Delta"],
    ["ℓ", "\\ell"],
    ["⊕", "\\oplus"],
    ["⊗", "\\otimes"],
    ["⌊", "\\lfloor"],
    ["⌋", "\\rfloor"],
  ];
  for (const [ch, tex] of syms) specs.push({ ch, tex, font: "main" });
  // 大算子在原稿里常按 display 尺寸排版，多备两档字号模板，避免 ∑ 被 ε 之类小字形抢走
  specs.push(
    { ch: "∑", tex: "\\sum", font: "size1" },
    { ch: "∑", tex: "\\sum", font: "size2" },
    { ch: "∏", tex: "\\prod", font: "size1" },
    { ch: "∏", tex: "\\prod", font: "size2" },
  );
  return specs;
}

function inkBits(img: ImageData): { bits: Uint8Array; w: number; h: number } {
  const { width: w, height: h, data } = img;
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    const lum = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.5 + data[i * 4 + 2] * 0.2;
    bits[i] = a > 12 && lum < 205 ? 1 : 0;
  }
  return { bits, w, h };
}

/** 灰度墨量：抗锯齿边缘也算一部分墨，比纯二值更耐缩放误差 */
function inkGray(img: ImageData): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    const lum = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.5 + data[i * 4 + 2] * 0.2;
    out[i] = Math.max(0, Math.min(255, Math.round(a * (255 - lum))));
  }
  return out;
}

function bboxOf(bits: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (bits[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** 把任意墨迹包围盒规范化成 SIZE×SIZE 灰度图（面积平均缩放，保持宽高比） */
function normalize(gray: Uint8Array, w: number, box: { x0: number; y0: number; x1: number; y1: number }): { data: Uint8Array; aspect: number; density: number } {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const scale = Math.min(SIZE / bw, SIZE / bh);
  const dw = Math.max(1, Math.round(bw * scale));
  const dh = Math.max(1, Math.round(bh * scale));
  const ox = Math.floor((SIZE - dw) / 2);
  const oy = Math.floor((SIZE - dh) / 2);
  const data = new Uint8Array(SIZE * SIZE);
  let sum = 0;
  for (let y = 0; y < dh; y++) {
    const sy0 = box.y0 + Math.floor((y / dh) * bh);
    const sy1 = Math.max(sy0 + 1, box.y0 + Math.floor(((y + 1) / dh) * bh));
    for (let x = 0; x < dw; x++) {
      const sx0 = box.x0 + Math.floor((x / dw) * bw);
      const sx1 = Math.max(sx0 + 1, box.x0 + Math.floor(((x + 1) / dw) * bw));
      let acc = 0, cnt = 0;
      for (let sy = sy0; sy < Math.min(sy1, box.y1 + 1); sy++)
        for (let sx = sx0; sx < Math.min(sx1, box.x1 + 1); sx++) {
          acc += gray[sy * w + sx];
          cnt++;
        }
      const v = cnt ? Math.round(acc / cnt) : 0;
      data[(oy + y) * SIZE + (ox + x)] = v;
      sum += v;
    }
  }
  return { data, aspect: bw / Math.max(1, bh), density: sum / (255 * SIZE * SIZE) };
}

function renderTemplate(spec: CharSpec): Template | null {
  const c = document.createElement("canvas");
  c.width = 72;
  c.height = 72;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 72, 72);
  ctx.fillStyle = "#000";
  ctx.font =
    spec.font === "math"
      ? "italic 46px KaTeX_Math, 'Times New Roman', serif"
      : spec.font === "size1"
        ? "38px KaTeX_Size1, KaTeX_Main, 'Times New Roman', serif"
        : spec.font === "size2"
          ? "34px KaTeX_Size2, KaTeX_Main, 'Times New Roman', serif"
          : "46px KaTeX_Main, 'Times New Roman', serif";
  ctx.textBaseline = "alphabetic";
  try {
    ctx.fillText(spec.ch, 10, 54);
  } catch {
    return null;
  }
  const img = ctx.getImageData(0, 0, 72, 72);
  const { bits, w, h } = inkBits(img);
  const box = bboxOf(bits, w, h);
  if (!box) return null;
  const norm = normalize(inkGray(img), w, box);
  const bin = binarize(norm.data);
  return { tex: spec.tex, bits: norm.data, bin, dil: dilate(bin), aspect: norm.aspect, density: norm.density };
}

let templatesPromise: Promise<Template[]> | null = null;

async function loadTemplates(): Promise<Template[]> {
  if (!templatesPromise) {
    templatesPromise = (async () => {
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load("italic 46px KaTeX_Math", "abcdefghijklmnopqrstuvwxyz"),
            document.fonts.load("46px KaTeX_Main", "0123456789∑∏ℓ⊕⊗α≤→"),
            document.fonts.load("38px KaTeX_Size1", "∑∏"),
            document.fonts.load("34px KaTeX_Size2", "∑∏"),
          ]),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      } catch {
        /* 字体没就绪时退回系统衬线模板，仍可一试 */
      }
      const out: Template[] = [];
      for (const spec of buildSpecs()) {
        const t = renderTemplate(spec);
        if (t) out.push(t);
      }
      return out;
    })();
  }
  return templatesPromise;
}

function matchGlyph(norm: { data: Uint8Array; aspect: number; density: number }, templates: Template[]): { tex: string; score: number } {
  const binA = binarize(norm.data);
  const dilA = dilate(binA);
  let cntA = 0;
  for (let i = 0; i < SIZE * SIZE; i++) cntA += binA[i];
  if (!cntA) return { tex: "", score: 0 };
  let best = { tex: "", score: -1 };
  for (const t of templates) {
    // 宽高比用对数比：减号这类极扁字形 aspect 9 与 11 只差 1.2 倍，不应被绝对差误杀
    // 极扁/极窄字形（减号、竖线）的宽高比随渲染字号非线性变化，跳过此过滤，靠形状与密度区分
    if (Math.max(t.aspect, norm.aspect) <= 3 && Math.abs(Math.log(t.aspect / norm.aspect)) > Math.log(1.9)) continue;
    if (Math.abs(t.density - norm.density) > 0.32) continue;
    let cntT = 0, hitA = 0, hitT = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (t.bin[i]) cntT++;
      if (binA[i] && t.dil[i]) hitA++;
      if (t.bin[i] && dilA[i]) hitT++;
    }
    if (!cntT) continue;
    // 双向覆盖率取小：形状对得上但笔画粗细/位置差 1px 不重罚，形状不同则必然有一侧漏覆盖
    const score = Math.min(hitA / cntA, hitT / cntT);
    if (score > best.score) best = { tex: t.tex, score };
  }
  return best;
}

interface Comp { x0: number; y0: number; x1: number; y1: number; area: number }
interface Glyph extends Comp { norm: { data: Uint8Array; aspect: number; density: number } }

function components(bits: Uint8Array, w: number, h: number): Comp[] {
  const seen = new Uint8Array(w * h);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!bits[i] || seen[i]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      area++;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
      const nb = [cur - 1, cur + 1, cur - w, cur + w, cur - w - 1, cur - w + 1, cur + w - 1, cur + w + 1];
      for (const n of nb) {
        if (n < 0 || n >= w * h || seen[n] || !bits[n]) continue;
        if (Math.abs((n % w) - cx) > 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (area >= 4) comps.push({ x0, y0, x1, y1, area });
  }
  return comps;
}

/** 把同一字形的多个连通域合并（= 的两横、i 的点、: 的两点） */
function groupGlyphs(comps: Comp[], gray: Uint8Array, w: number, fontPx: number): Glyph[] {
  const sorted = [...comps].sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const glyphs: Comp[] = [];
  for (const c of sorted) {
    let merged = false;
    for (const g of glyphs) {
      const overlap = Math.min(c.x1, g.x1) - Math.max(c.x0, g.x0) + 1;
      const minW = Math.min(c.x1 - c.x0, g.x1 - g.x0) + 1;
      const vGap = Math.max(c.y0, g.y0) - Math.min(c.y1, g.y1) - 1;
      const mergedH = Math.max(c.y1, g.y1) - Math.min(c.y0, g.y0) + 1;
      const centerDist = Math.abs(c.y0 + c.y1 - (g.y0 + g.y1)) / 2;
      // 两块都有实质高度、且上下中心拉开时，多半是“大算子 + 下置界限”这类两个独立字形，
      // 不能按 = 的两横、i 的点那种同一字形部件合并，否则会粘成无法辨认的一团。
      const separateRows =
        vGap >= 0 &&
        centerDist > fontPx * 0.52 &&
        Math.min(c.y1 - c.y0 + 1, g.y1 - g.y0 + 1) > fontPx * 0.2;
      if (overlap > minW * 0.5 && vGap <= Math.max(3, fontPx * 0.4) && mergedH <= fontPx * 1.6 && !separateRows) {
        g.x0 = Math.min(g.x0, c.x0);
        g.x1 = Math.max(g.x1, c.x1);
        g.y0 = Math.min(g.y0, c.y0);
        g.y1 = Math.max(g.y1, c.y1);
        g.area += c.area;
        merged = true;
        break;
      }
    }
    if (!merged) glyphs.push({ ...c });
  }
  return glyphs
    .sort((a, b) => a.x0 - b.x0)
    .map((g) => ({ ...g, norm: normalize(gray, w, g) }));
}

/** 命令后紧跟字母必须留空格，否则 \\to+v 拼成非法命令 \\tov。
 * 用已知命令词典做最长前缀切分：\\tov → \\to v，\\cdot\\cdot 不会被回溯拆成 \\cdo t */
const KNOWN_COMMANDS = [
  "leftrightarrow", "leftarrow", "rightarrow", "operatorname", "varnothing", "varepsilon",
  "subseteq", "infty", "alpha", "gamma", "delta", "theta", "lambda", "sigma", "varphi",
  "omega", "Delta", "times", "notin", "subset", "sqrt", "cdot", "beta", "oplus", "otimes",
  "lfloor", "rfloor", "prod", "sum", "cap", "cup", "ell", "pm", "mu", "pi", "le", "ge", "ne", "to", "in",
].sort((a, b) => b.length - a.length);

function spaceCommands(t: string): string {
  return t.replace(/\\[a-zA-Z]+/g, (m: string) => {
    const name = m.slice(1);
    const known = KNOWN_COMMANDS.find((k) => name.startsWith(k) && name.length > k.length);
    return known ? `\\${known} ${name.slice(known.length)}` : m;
  });
}

const OPERATOR_WORDS = ["lca", "log", "sin", "cos", "tan", "max", "min", "gcd", "lcm", "exp", "ln", "mod"];

/** 原稿里 \log、\operatorname{lca} 是直立算子名，逐字识别后在字母串内分词还原（nlogn → n\log n、lcax → \lca x） */
function restoreOperators(t: string): string {
  return t.replace(/(\\[a-zA-Z]+)|([a-zA-Z]+)/g, (m: string, cmd?: string, run?: string) => {
    if (cmd || !run || run.length < 3) return m;
    const lower = run.toLowerCase();
    for (const op of OPERATOR_WORDS) {
      const idx = lower.indexOf(op);
      if (idx < 0) continue;
      const left = run.slice(0, idx);
      const right = run.slice(idx + op.length);
      if (left.length <= 1 && right.length <= 2) return `${left}\\operatorname{${op}}${right}`;
    }
    return m;
  });
}

/** 分数内部没有整行基线可借用：用同组最高一档字形的底边推断局部分子/分母基线 */
function inferGroupBaseline(glyphs: Glyph[], fallback: number): number {
  if (!glyphs.length) return fallback;
  const maxH = Math.max(...glyphs.map((g) => g.y1 - g.y0 + 1));
  const mains = glyphs.filter((g) => g.y1 - g.y0 + 1 >= maxH * 0.75);
  if (!mains.length) return fallback;
  // 主字形的底边对齐在局域基线上；上标底边更高、下标底边更低，都不应拿来当基线
  return Math.min(...mains.map((g) => g.y1));
}

function glyphsToTex(
  glyphs: Glyph[],
  templates: Template[],
  baselineY: number,
  fontPx: number,
): { tex: string; confidence: number } | null {
  let tex = "";
  let mode: "n" | "sup" | "sub" = "n";
  let total = 0;
  const setMode = (m: "n" | "sup" | "sub") => {
    if (m === mode) return;
    if (mode !== "n") tex += "}";
    if (m === "sup") tex += "^{";
    if (m === "sub") tex += "_{";
    mode = m;
  };
  const matches = glyphs.map((g) => {
    const gh = g.y1 - g.y0 + 1;
    const gw = g.x1 - g.x0 + 1;
    // 又扁又宽的单连通域只可能是减号/横线：模板匹配会把它认成箭头杆，这类直接定字（仍按位置判上下标）
    const flatBar = gh <= Math.max(3, fontPx * 0.13) && gw >= fontPx * 0.5;
    const m = flatBar ? { tex: "-", score: 0.92 } : matchGlyph(g.norm, templates);
    // ε 只是 x 高小字形；若墨迹接近整行高且够宽，实际是 display 尺寸的 ∑，模板分数接近时用几何特征纠偏
    if (m.tex === "\\varepsilon" && gh > fontPx * 0.85 && gw > fontPx * 0.45) m.tex = "\\sum";
    if (m.tex === "\\pi" && gh > fontPx * 0.95 && gw > fontPx * 0.55) m.tex = "\\prod";
    return { g, tex: m.tex, score: m.score };
  });
  if (matches.some((m) => m.score < 0.45)) return null;

  const atomDone = new Set<"sup" | "sub">();
  for (const { g, tex: matchedTex, score } of matches) {
    const gh = g.y1 - g.y0 + 1;
    const m = { tex: matchedTex, score };
    total += m.score;
    let cls: "n" | "sup" | "sub" = "n";
    if (m.tex === "," || m.tex === ".") cls = "n"; // 逗号/句点永远落在基线上，不能当下标
    // 减号挂在数学轴上（底 ≈ 基线-0.2 倍字高），真上标底要再高一截，阈值取 0.38 防把减号判成上标
    else if (gh < fontPx * 0.68 && g.y1 < baselineY - fontPx * 0.38) cls = "sup";
    // 下标的可靠特征是底边明显低于基线（约 0.15~0.35 倍字高）；只看顶会把 k、j 这类高个下标误判
    else if (gh < fontPx * 0.78 && g.y1 > baselineY + fontPx * 0.1) cls = "sub";
    // 同一原子最多一组下标 + 一组上标：同组续写没问题，回头再起一组同类型脚本必然是
    // 二维结构被拍平了，继续拼会生成 KaTeX 直接报错的双重脚本，宁可整条失败
    const prevMode = mode as "n" | "sup" | "sub"; // setMode 经闭包改 mode，TS 窄化会误判，这里显式取当前值
    if (cls !== "n" && cls !== prevMode && atomDone.has(cls)) return null;
    if (prevMode !== "n" && prevMode !== cls) atomDone.add(prevMode);
    setMode(cls);
    if (cls === "n") atomDone.clear();
    // 抬到数学轴高度的圆点是 \cdot 而不是句点（\cdots 的点都在轴高）
    tex += m.tex === "." && (g.y0 + g.y1) / 2 < baselineY - fontPx * 0.15 ? "\\cdot" : m.tex;
  }
  if (mode !== "n") tex += "}";
  if (tex.startsWith("_{") || tex.startsWith("^{")) return null; // 开头就是上下标必是拼装错位，宁可失败
  const confidence = total / glyphs.length;
  if (confidence < 0.55 || !tex) return null;
  return { tex: restoreOperators(spaceCommands(tex)), confidence };
}

export async function recognizeFormula(
  crop: HTMLCanvasElement,
  baselineY: number,
  fontPx: number,
): Promise<FormulaResult> {
  const ctx = crop.getContext("2d");
  if (!ctx) return { kind: "fail" };
  const templates = await loadTemplates();
  const img = ctx.getImageData(0, 0, crop.width, crop.height);
  const { bits, w, h } = inkBits(img);
  const gray = inkGray(img);
  const rawComps = components(bits, w, h);
  if (!rawComps.length) return { kind: "empty" };
  // 裁剪框上下会带进相邻行的字头/下延碎片：完全悬在本行基线带之外的连通域丢弃，
  // 否则它们会与公式字形按 x 重叠合并成巨型字形，导致整条公式识别失败。
  const comps = rawComps.filter(
    (c) =>
      c.y1 >= baselineY - fontPx * 1.05 &&
      c.y0 <= baselineY + fontPx * 0.55 &&
      // 紧贴裁图左右边缘的 ≤3px 细长条是相邻汉字被裁进来的碎片（会被认成 l），不是公式字形
      !((c.x0 <= 1 || c.x1 >= w - 2) && c.x1 - c.x0 + 1 <= 3 && c.y1 - c.y0 + 1 > fontPx * 0.6),
  );
  if (!comps.length) return { kind: "empty" };

  // 分数线：一条明显比字形宽的横线，且上下都有字形
  const bar = comps.find(
    (c) => c.x1 - c.x0 + 1 > fontPx * 0.9 && (c.y1 - c.y0 + 1) <= Math.max(3, fontPx * 0.14) && (c.x1 - c.x0 + 1) / Math.max(1, c.y1 - c.y0 + 1) >= 4,
  );
  if (bar) {
    const above = comps.filter((c) => c !== bar && c.y1 < bar.y0 + 2);
    const below = comps.filter((c) => c !== bar && c.y0 > bar.y1 - 2);
    if (above.length && below.length) {
      // 分子/分母各有自己的局部基线，内部上下标按局部基线判
      const aboveGlyphs = groupGlyphs(above, gray, w, fontPx);
      const belowGlyphs = groupGlyphs(below, gray, w, fontPx);
      const ga = glyphsToTex(aboveGlyphs, templates, inferGroupBaseline(aboveGlyphs, bar.y0 - fontPx * 0.1), fontPx * 0.8);
      const gb = glyphsToTex(belowGlyphs, templates, inferGroupBaseline(belowGlyphs, bar.y1 + fontPx * 0.55), fontPx * 0.8);
      if (ga && gb) {
        const score = (ga.confidence + gb.confidence) / 2;
        return { kind: "ok", tex: `\\frac{${ga.tex}}{${gb.tex}}`, confidence: score };
      }
    }
  }

  const glyphs = groupGlyphs(comps, gray, w, fontPx);
  if (!glyphs.length) return { kind: "empty" };
  const built = glyphsToTex(glyphs, templates, baselineY, fontPx);
  if (!built) return { kind: "fail" };
  const { tex, confidence } = built;
  return { kind: "ok", tex, confidence };
}
