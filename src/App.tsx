import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpToLine,
  Bot,
  ClipboardCopy,
  Command,
  Check,
  ChevronDown,
  CircleAlert,
  Columns2,
  Crosshair,
  Download,
  FileText,
  FileUp,
  FolderOpen,
  History,
  FileCode,
  FlaskConical,
  Keyboard,
  LayoutList,
  GitCompare,
  LayoutTemplate,
  ListChecks,
  Network,
  ListTree,
  Maximize,
  Minimize,
  Minus,
  PenLine,
  Play,
  Plus,
  Printer,
  Save,
  Settings2,
  Sigma,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import Editor, { type EditorHandle } from "./Editor";
import Preview, { type Block } from "./Preview";
import DiagramDialog from "./Diagram";
import MathEditor from "./MathEditor";
import VersionsDialog, { type Version } from "./Versions";
import { checkQuality, formatDocument } from "./quality";
import { mdToTypst } from "./typst";
import { pdfToMarkdown } from "./pdf";
import DiffDialog from "./Diff";
import RunDialog from "./Run";
import { extractCodeBlocks, isCppLang, isPlainLang, pickStressCodes, DEFAULT_GEN, type CodeBlockInfo, type RunResult } from "./runner";
import BatchDialog, { type BatchItem } from "./Batch";
import { stripCodeFence } from "./ai";
import StressDialog from "./Stress";
import AiDialog, { type AiTask } from "./Ai";
import { renderMarkdown } from "./markdown";
import { applyAllFixes, lintMarkdown, RULE_LABEL, type Diag, type Rule } from "./lint";
import { DEFAULT_DOC, SOLUTION_TEMPLATES } from "./templates";

type View = "edit" | "split" | "preview";

const THEMES: { id: string; name: string; sw: string }[] = [
  { id: "paper", name: "素白", sw: "linear-gradient(135deg,#ffffff 50%,#5b5bd6 50%)" },
  { id: "ink", name: "墨夜", sw: "linear-gradient(135deg,#15171b 50%,#8fa2ff 50%)" },
  { id: "sepia", name: "纸黄", sw: "linear-gradient(135deg,#f8f1e0 50%,#b4530a 50%)" },
  { id: "nord", name: "靛青", sw: "linear-gradient(135deg,#1b2230 50%,#88c0d0 50%)" },
  { id: "mint", name: "薄荷", sw: "linear-gradient(135deg,#f3f9f7 50%,#0e9b78 50%)" },
];

const RULES: Rule[] = ["punct", "end", "space", "latex", "katex"];

/** 导出 HTML / 打印 PDF 用的主题变量，与预览的五套主题一一对应，保证两处长得一模一样 */
const EXPORT_THEMES: Record<string, Record<string, string>> = {
  paper: { bg: "#eeefec", page: "#ffffff", fg: "#1b1f24", fg2: "#5f6672", fg3: "#98a0ad", line: "#e4e6e1", accent: "#5b5bd6", "accent-softer": "rgba(91,91,214,0.055)", ok: "#12855c", err: "#e11d48", code: "#f5f6f3", kw: "#cf222e", str: "#0a3069", num: "#0550ae", com: "#9aa1ab", fn: "#8250df", ty: "#953800" },
  ink: { bg: "#0c0d10", page: "#16181d", fg: "#d8dce3", fg2: "#8d95a3", fg3: "#5d6472", line: "#262b34", accent: "#8fa2ff", "accent-softer": "rgba(143,162,255,0.07)", ok: "#4ade80", err: "#ff7089", code: "#1b1e25", kw: "#ff7b72", str: "#a5d6ff", num: "#79c0ff", com: "#6a7280", fn: "#d2a8ff", ty: "#ffa657" },
  sepia: { bg: "#e8dfca", page: "#fcf8ee", fg: "#40331f", fg2: "#857257", fg3: "#a8977c", line: "#e0d4bb", accent: "#b4530a", "accent-softer": "rgba(180,83,10,0.06)", ok: "#15803d", err: "#be123c", code: "#f2e9d5", kw: "#9d174d", str: "#166534", num: "#1d4ed8", com: "#b3a184", fn: "#7c3aed", ty: "#b45309" },
  nord: { bg: "#121821", page: "#1d2634", fg: "#d6dee9", fg2: "#8b97ab", fg3: "#5b6678", line: "#2c374a", accent: "#88c0d0", "accent-softer": "rgba(136,192,208,0.07)", ok: "#a3be8c", err: "#ff8095", code: "#212b3a", kw: "#81a1c1", str: "#a3be8c", num: "#b48ead", com: "#667089", fn: "#88c0d0", ty: "#ebcb8b" },
  mint: { bg: "#dfeee9", page: "#ffffff", fg: "#16241f", fg2: "#56746c", fg3: "#8aa8a0", line: "#d2e4de", accent: "#0e9b78", "accent-softer": "rgba(14,155,120,0.06)", ok: "#0f766e", err: "#dc2626", code: "#eef6f3", kw: "#be185d", str: "#0e7490", num: "#7c3aed", com: "#86a29a", fn: "#0f766e", ty: "#b45309" },
};

/**
 * 把应用已加载的字体与 KaTeX 样式（单文件里是 data URI）抽出来内嵌进导出文件：
 * 这样导出的 HTML 离线打开、换台机器打开，公式字体和正文字体都与预览完全一致，
 * 不再依赖 CDN（版本不一致会让公式字形和间距都变样）。
 */
function collectExportCss(): string {
  const chunks: string[] = [];
  const seen = new Set<string>();
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        const text = rule.cssText;
        if (!text || seen.has(text)) continue;
        if (rule.type === CSSRule.FONT_FACE_RULE || /KaTeX|\.katex/.test(text)) {
          seen.add(text);
          chunks.push(text);
        }
      }
    }
  } catch {
    /* 抽不到就退回 CDN 链接，见 buildExportHtml */
  }
  return chunks.join("\n");
}

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "文字样式",
    items: [
      ["Ctrl + B", "加粗 **文字**"],
      ["Ctrl + I", "斜体 *文字*"],
      ["Ctrl + `", "行内代码 `code`"],
      ["Ctrl + M", "行内公式 $x$"],
      ["Ctrl + Shift + X", "删除线 ~~文字~~"],
      ["Ctrl + K", "插入链接 [文字](地址)"],
    ],
  },
  {
    group: "标题与块",
    items: [
      ["Ctrl + 1 ~ 6", "设为 H1 ~ H6"],
      ["Ctrl + 0", "取消标题，回到正文"],
      ["Ctrl + ↑ / ↓", "提升 / 降低标题一级"],
      ["Ctrl + Shift + .", "引用块"],
      ["Ctrl + Shift + C / M", "代码块 / 行间公式"],
      ["Ctrl + Alt + T", "插入表格"],
    ],
  },
  {
    group: "列表",
    items: [
      ["Ctrl + Shift + U", "无序列表 - / * / +"],
      ["Ctrl + Shift + L", "有序列表 1. / 1)"],
      ["Ctrl + Shift + T", "任务列表 - [ ]"],
      ["Enter", "续写下一项，有序自动 +1"],
      ["Enter（空条目）", "逐级退出列表"],
      ["Tab / Shift + Tab", "列表降一层 / 升一层"],
      ["Ctrl + Shift + N", "重新编号（按嵌套层级）"],
      ["行首 Backspace", "去掉列表标记，保留正文"],
    ],
  },
  {
    group: "公式（KaTeX）",
    items: [
      ["$x$ 或 \\(x\\)", "行内公式"],
      ["$$ … $$ 或 \\[ … \\]", "行间公式"],
      ["Ctrl + M / Ctrl + Shift + M", "快速插入行内 / 行间公式"],
      ["\\begin{aligned} …", "多行对齐（也可 gather、split）"],
      ["\\begin{cases} …", "分段函数"],
      ["\\begin{pmatrix} …", "矩阵（bmatrix / vmatrix 同理）"],
      ["\\R \\N \\Z \\abs{x} \\ceil{x}", "内置宏，渲染与检查一致"],
      ["$\\operatorname{lca}(u, v)$", "函数 / 算法名直立排版，不按变量连乘理解"],
      ["行内公式 Σ 菜单", "分式 / 根号 / 求和 / 连乘 / 积分 / 极限 / 组合数一键插入"],
      ["行间公式", "预览自动编号 (1) (2) (3)…"],
    ],
  },
  {
    group: "行操作",
    items: [
      ["Tab / Shift + Tab", "整块缩进 / 反缩进"],
      ["Alt + ↑ / ↓", "整行上移 / 下移"],
      ["Ctrl + Shift + D", "复制当前行"],
      ["Ctrl + Shift + K", "删除当前行"],
      ["Ctrl + Z / Ctrl + Shift + Z", "撤销 / 重做"],
    ],
  },
  {
    group: "文件与其他",
    items: [
      ["Ctrl + S", "导出 Markdown 文件"],
      ["命令面板搜「待补」", "依次定位 $\\square$ 待补公式"],
      ["Ctrl + Shift + P", "命令面板（搜索全部功能）"],
      ["导出菜单", "Markdown / HTML 网页 / 打印为 PDF"],
      ["Ctrl + Shift + F", "专注模式（隐藏顶栏与状态栏）"],
      ["Ctrl + /", "打开这份速查表"],
      ["Esc", "关闭浮层"],
      ["双击预览", "定位到源码对应行"],
    ],
  },
];

const ls = {
  get(k: string, d: string) {
    try {
      return localStorage.getItem("moxu:" + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem("moxu:" + k, v);
    } catch {
      /* ignore */
    }
  },
};

function lineStart(text: string, line: number) {
  let pos = 0;
  for (let i = 0; i < line; i++) {
    const n = text.indexOf("\n", pos);
    if (n < 0) return text.length;
    pos = n + 1;
  }
  return pos;
}

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const h = () => setWide(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return wide;
}

export default function App() {
  const [text, setText] = useState(() => ls.get("text", DEFAULT_DOC));
  const [name, setName] = useState(() => ls.get("name", "题解.md"));
  const [theme, setTheme] = useState(() => ls.get("theme", "paper"));
  const [fontSize, setFontSize] = useState(() => {
    const v = Number(ls.get("fs", "14"));
    return Number.isFinite(v) ? Math.min(22, Math.max(11, v)) : 14;
  });
  const [view, setView] = useState<View>(() => {
    const v = ls.get("view", "split");
    return v === "edit" || v === "preview" || v === "split" ? v : "split";
  });
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState<Rule | "all">("all");
  const [outline, setOutline] = useState(false);
  const [help, setHelp] = useState(false);
  const [caret, setCaret] = useState({ pos: 0, line: 0, col: 0 });
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState(true);
  const [splitRatio, setSplitRatio] = useState(() => {
    const v = Number(ls.get("split", "0.5"));
    return Number.isFinite(v) ? Math.min(0.75, Math.max(0.25, v)) : 0.5;
  });
  const [tplOpen, setTplOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [diffInit, setDiffInit] = useState<{ a: string; b: string } | null>(null);
  const [versions, setVersions] = useState<Version[]>(() => {
    try {
      const v = JSON.parse(ls.get("versions", "[]"));
      return Array.isArray(v) ? v.filter((x) => x && typeof x.text === "string").slice(0, 30) : [];
    } catch {
      return [];
    }
  });
  const loadedTextRef = useRef<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [runInit, setRunInit] = useState<{ code: string; stdin: string; expected: string; versus?: string; insertAfter?: number } | null>(null);
  const [stressInit, setStressInit] = useState<{ gen: string; a: string; b: string } | null>(null);
  const [aiState, setAiState] = useState<{ task: AiTask | null; sel?: { from: number; to: number }; settings?: boolean; apply?: { label: string; run(text: string): void } } | null>(null);
  const [batchItems, setBatchItems] = useState<BatchItem[] | null>(null);
  const wide = useWide();
  const eff: View = wide ? view : view === "preview" ? "preview" : "edit";

  const edRef = useRef<EditorHandle>(null);
  const pvRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<Block[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfFileRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  // ---------- 派生 ----------
  const diags = useMemo(() => lintMarkdown(text), [text]);
  const deferred = useDeferredValue(text);
  const rendered = useMemo(() => renderMarkdown(deferred), [deferred]);
  const words = useMemo(() => {
    const han = (deferred.match(/[\u3400-\u9fff]/g) || []).length;
    const en = (deferred.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
    return han + en;
  }, [deferred]);
  const readMin = Math.max(1, Math.ceil(words / 450));
  const firstCode = useMemo(() => {
    const m = /```[^\n]*\n([\s\S]*?)```/.exec(text);
    return m ? m[1].replace(/\n$/, "") : "";
  }, [text]);
  const counts = useMemo(() => {
    const c: Record<Rule, number> = { punct: 0, end: 0, space: 0, latex: 0, katex: 0 };
    for (const d of diags) c[d.rule]++;
    return c;
  }, [diags]);
  const fixable = useMemo(() => diags.filter((d) => d.fix).length, [diags]);
  const quality = useMemo(() => checkQuality(text), [text]);
  const shown = useMemo(() => (filter === "all" ? diags : diags.filter((d) => d.rule === filter)), [diags, filter]);
  const atCaret = useMemo(() => diags.filter((d) => caret.pos >= d.from && caret.pos <= d.to).slice(0, 2), [diags, caret.pos]);
  // PDF 公式识别失败会留下 $\square$；把它们收成可依次定位的清单，方便人工补写
  const pendingFormulas = useMemo(() => {
    const needle = "$\\square$";
    const out: { from: number; to: number }[] = [];
    let i = 0;
    while ((i = text.indexOf(needle, i)) >= 0) {
      out.push({ from: i, to: i + needle.length });
      i += needle.length;
    }
    return out;
  }, [text]);

  // ---------- 持久化 ----------
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      ls.set("text", text);
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => ls.set("name", name), [name]);
  useEffect(() => {
    document.title = `${name.replace(/\.md$/, "")} · 墨序`;
  }, [name]);
  useEffect(() => ls.set("fs", String(fontSize)), [fontSize]);
  useEffect(() => ls.set("view", view), [view]);
  useEffect(() => ls.set("split", String(splitRatio)), [splitRatio]);
  useEffect(() => {
    try {
      localStorage.setItem("moxu:versions", JSON.stringify(versions));
    } catch {
      /* ignore */
    }
  }, [versions]);
  // 自动快照：改动后停顿 5 秒、且距上次快照超过 45 秒才存，避免版本列表刷屏
  useEffect(() => {
    if (loadedTextRef.current === null) {
      loadedTextRef.current = text;
      return;
    }
    if (loadedTextRef.current === text) return;
    const t = setTimeout(() => {
      setVersions((vs) => {
        const last = vs[0];
        if (last?.text === text) return vs;
        if (last && Date.now() - last.ts < 45000) return vs;
        return [{ id: Date.now(), ts: Date.now(), name: "自动快照", text }, ...vs].slice(0, 30);
      });
    }, 5000);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    ls.set("theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- 滚动联动 ----------
  const owner = useRef({ who: "", until: 0 });
  const caretRef = useRef(caret);
  caretRef.current = caret;
  const caretTs = useRef(0);
  const caretScrollTs = useRef(0);
  const suppressCaret = useRef(0);

  const previewY = useCallback((line: number) => {
    const bl = blocksRef.current;
    if (!bl.length) return 0;
    let prevBottom = 0;
    let prevE = 0;
    for (const b of bl) {
      const top = b.el.offsetTop;
      const h = b.el.offsetHeight;
      if (line < b.e) {
        if (line >= b.s) return top + ((line - b.s) / Math.max(1, b.e - b.s)) * h;
        const span = Math.max(1, b.s - prevE);
        return prevBottom + ((line - prevE) / span) * (top - prevBottom);
      }
      prevBottom = top + h;
      prevE = b.e;
    }
    return prevBottom;
  }, []);

  const lineForPreviewY = useCallback((y: number) => {
    const bl = blocksRef.current;
    if (!bl.length) return 0;
    let prevBottom = 0;
    let prevE = 0;
    for (const b of bl) {
      const top = b.el.offsetTop;
      const h = b.el.offsetHeight;
      if (y < top) {
        const span = Math.max(1, top - prevBottom);
        return prevE + ((y - prevBottom) / span) * (b.s - prevE);
      }
      if (y < top + h) return b.s + ((y - top) / Math.max(1, h)) * (b.e - b.s);
      prevBottom = top + h;
      prevE = b.e;
    }
    return prevE;
  }, []);

  const setActiveBlock = useCallback((line: number) => {
    for (const b of blocksRef.current) b.el.classList.toggle("active", line >= b.s && line < b.e);
  }, []);

  const syncCaret = useCallback(() => {
    const pv = pvRef.current;
    if (!pv || !pv.clientHeight || !blocksRef.current.length) return;
    const line = caretRef.current.line;
    setActiveBlock(line);
    if (Date.now() < suppressCaret.current) return;
    const y = previewY(line + 0.5);
    const top = pv.scrollTop;
    const h = pv.clientHeight;
    if (y < top + h * 0.12 || y > top + h * 0.72) {
      owner.current = { who: "e", until: Date.now() + 160 };
      caretScrollTs.current = Date.now();
      pv.scrollTop = Math.max(0, y - h * 0.35);
    }
  }, [previewY, setActiveBlock]);

  const syncFromEditor = useCallback(() => {
    const ed = edRef.current;
    const ta = ed?.ta;
    const pv = pvRef.current;
    if (!ed || !ta || !pv || !pv.clientHeight) return;
    const now = Date.now();
    if (owner.current.who === "p" && now < owner.current.until) return;
    if (now - caretScrollTs.current < 160) return; // 光标触发的滚动优先
    owner.current = { who: "e", until: now + 160 };
    if (ta.scrollTop <= 0) pv.scrollTop = 0;
    else if (ta.scrollTop + ta.clientHeight >= ta.scrollHeight - 2) pv.scrollTop = pv.scrollHeight;
    else pv.scrollTop = Math.max(0, previewY(ed.lineAtY(ta.scrollTop + 4)) - 4);
  }, [previewY]);

  const syncFromPreview = useCallback(() => {
    const ed = edRef.current;
    const ta = ed?.ta;
    const pv = pvRef.current;
    if (!ed || !ta || !pv) return;
    const now = Date.now();
    if (owner.current.who === "e" && now < owner.current.until) return;
    owner.current = { who: "p", until: now + 160 };
    if (pv.scrollTop <= 0) ta.scrollTop = 0;
    else if (pv.scrollTop + pv.clientHeight >= pv.scrollHeight - 2) ta.scrollTop = ta.scrollHeight;
    else ta.scrollTop = Math.max(0, ed.yAtLine(lineForPreviewY(pv.scrollTop + 4)) - 4);
  }, [lineForPreviewY]);

  const handleCaret = useCallback(() => {
    const ta = edRef.current?.ta;
    if (!ta) return;
    const pos = ta.selectionStart;
    let line = 0;
    for (let i = -1; (i = ta.value.indexOf("\n", i + 1)) >= 0 && i < pos; ) line++;
    const col = pos - (ta.value.lastIndexOf("\n", pos - 1) + 1);
    caretTs.current = Date.now();
    setCaret((c) => (c.pos === pos && c.line === line && c.col === col ? c : { pos, line, col }));
  }, []);

  // caret 变化后再做联动，避免 setState 与滚动同一帧内互相打断
  useEffect(() => {
    syncCaret();
  }, [caret, syncCaret]);

  const onRendered = useCallback(() => {
    owner.current = { who: "e", until: Date.now() + 160 };
    if (Date.now() - caretTs.current < 2000) syncCaret();
    else setActiveBlock(caretRef.current.line);
  }, [syncCaret, setActiveBlock]);

  const onBlockDoubleClick = useCallback((b: Block, ratio: number) => {
    const ta = edRef.current?.ta;
    if (!ta) return;
    const line = Math.min(b.e - 1, b.s + Math.floor(ratio * (b.e - b.s)));
    const from = lineStart(ta.value, line);
    const to = lineStart(ta.value, line + 1) - 1;
    suppressCaret.current = Date.now() + 400;
    edRef.current?.jumpTo(from, Math.max(from, to));
  }, []);

  // ---------- 动作 ----------
  const onChange = useCallback((v: string) => {
    caretTs.current = Date.now();
    setText(v);
  }, []);

  const applyFix = (d: Diag) => {
    if (!d.fix) return;
    edRef.current?.replace(d.fix.from, d.fix.to, d.fix.text);
  };

  const fixAll = () => {
    const { text: t, fixed } = applyAllFixes(text);
    if (!fixed) {
      setToast("没有可自动修复的问题");
      return;
    }
    edRef.current?.replaceAll(t);
    setToast(`已修复 ${fixed} 处`);
  };

  const insertSolution = (body: string, label: string) => {
    const ed = edRef.current;
    const ta = ed?.ta;
    if (!ed || !ta) return;
    if (text.trim() === "") {
      ed.replaceAll(`# 题号 题解\n\n${body}`);
    } else {
      const pos = ta.selectionStart;
      const before = text.slice(0, pos);
      const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      ed.replace(pos, ta.selectionEnd, `${lead}${body}\n`);
    }
    setToast("已插入" + label);
  };

  /** 插入整块内容（图示 / diff）：若光标正在代码块内部，改放文末，避免把内容塞进代码 */
  const insertBlock = (snippet: string) => {
    const ed = edRef.current;
    const ta = ed?.ta;
    if (!ed || !ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const fences = (before.match(/^```/gm) || []).length;
    if (fences % 2 === 1) ed.replace(ta.value.length, ta.value.length, snippet);
    else ed.replace(ta.selectionStart, ta.selectionEnd, snippet);
  };

  /** 组装运行对话框的初始值：代码块紧随的纯文本块自动当作样例输入 / 期望输出 */
  const buildRunInit = (block: CodeBlockInfo | undefined, all: CodeBlockInfo[], withPos: boolean) => {
    if (!block) return null;
    const i = all.indexOf(block);
    const next = all[i + 1];
    const next2 = all[i + 2];
    const hasIn = next !== undefined && isPlainLang(next.lang);
    return {
      code: block.code,
      stdin: hasIn ? next.code : "",
      expected: hasIn && next2 !== undefined && isPlainLang(next2.lang) ? next2.code : "",
      insertAfter: withPos ? block.end : undefined,
    };
  };
  const openRunner = (block: CodeBlockInfo | undefined, all: CodeBlockInfo[], withPos: boolean) => {
    const init = buildRunInit(block, all, withPos);
    if (!init) {
      setToast("文档里还没有 C++ 代码块");
      return;
    }
    setRunInit(init);
  };
  /** 当前选区（AI 润色/讲解用） */
  const currentSelection = () => {
    const ta = edRef.current?.ta;
    if (!ta || ta.selectionStart === ta.selectionEnd) return null;
    return { text: ta.value.slice(ta.selectionStart, ta.selectionEnd), from: ta.selectionStart, to: ta.selectionEnd };
  };
  const openAiWithSelection = (kind: "polish" | "explain") => {
    const s = currentSelection();
    if (!s) {
      setToast("先在编辑器里选中一段内容");
      return;
    }
    if (kind === "polish") {
      setAiState({
        sel: { from: s.from, to: s.to },
        task: {
          title: "AI 润色",
          replaceSelection: true,
          kickoff: `请润色下面这段题解文字：保持原意、公式与代码不变，只让表达更通顺准确。只输出润色后的正文，不要任何解释。\n\n${s.text}`,
        },
      });
    } else {
      setAiState({
        task: {
          title: "AI 讲解代码",
          kickoff: `请讲解下面这段代码：先一句话说清它在做什么，再分段讲思路与关键变量，最后给时间/空间复杂度。用题解的口吻。\n\n\`\`\`cpp\n${s.text}\n\`\`\``,
        },
      });
    }
  };

  /** AI 任务模板：讲解一段代码 */
  const aiExplainTask = (code: string): AiTask => ({
    title: "AI 讲解代码",
    kickoff: `请讲解下面这段代码：先一句话说清它在做什么，再分段讲思路与关键变量，最后给时间/空间复杂度。用题解的口吻。\n\n\`\`\`cpp\n${code.slice(0, 6000)}\n\`\`\``,
  });
  /** AI 任务模板：分析一次编译/运行失败 */
  const aiAnalyzeTask = (code: string, stdin: string, result: RunResult, expected = "", actual = result.stdout, codeB?: string, resultB?: RunResult): AiTask => ({
    title: result.stage === "ok" ? "AI 运行结果分析" : "AI 分析报错",
    kickoff: `请严格分析这次 C++ 编译运行。先区分已知事实与推测；如果有期望输出，逐行定位差异。检查算法正确性、不变量、边界、溢出、未定义行为与复杂度。若信息不足，明确指出缺少的题意或约束，不要编造。若能确定存在 bug，请在最后附上完整修复版 C++ 程序代码块；若不能确定，不要为了给代码而臆造修改。\n\n代码：\n\`\`\`cpp\n${code.slice(0, 7000)}\n\`\`\`\n${codeB ? `\n对照代码：\n\`\`\`cpp\n${codeB.slice(0, 6000)}\n\`\`\`\n` : ""}标准输入：\n\`\`\`text\n${stdin.slice(0, 2500)}\n\`\`\`\n\n阶段：${result.stage}\n编译日志：\n\`\`\`text\n${result.compileLog.slice(0, 3000)}\n\`\`\`\n标准输出：\n\`\`\`text\n${result.stdout.slice(0, 3000)}\n\`\`\`\n标准错误：\n\`\`\`text\n${result.stderr.slice(0, 2000)}\n\`\`\`\n${expected ? `期望/对照输出：\n\`\`\`text\n${expected.slice(0, 3000)}\n\`\`\`\n实际输出：\n\`\`\`text\n${actual.slice(0, 3000)}\n\`\`\`\n` : ""}${resultB ? `对照阶段：${resultB.stage}\n对照输出：\n\`\`\`text\n${resultB.stdout.slice(0, 2500)}\n\`\`\`\n` : ""}提示：${result.message ?? "无"}`,
  });
  /** 全文 C++ 代码块清单（带各自样例），供逐段验证 */
  const buildBatchItems = (): BatchItem[] => {
    const all = extractCodeBlocks(text);
    return all
      .filter((b) => isCppLang(b.lang))
      .map((b, i) => {
        const init = buildRunInit(b, all, false);
        return { no: i + 1, code: b.code, stdin: init?.stdin ?? "", expected: init?.expected ?? "" };
      });
  };
  const docBlocks = useMemo(() => extractCodeBlocks(text), [text]);
  /** 光标正落在某段 C++ 代码里时，状态栏给出这段代码的快捷动作 */
  const caretBlock = useMemo(
    () => docBlocks.find((x) => caret.pos >= x.start && caret.pos <= x.end && isCppLang(x.lang)) ?? null,
    [docBlocks, caret.pos],
  );

  /** 运行光标所在（或第一段）C++ 代码块 */
  const openRunnerAtCaret = () => {
    const all = extractCodeBlocks(text);
    const cpp = all.filter((b) => isCppLang(b.lang));
    const pos = edRef.current?.ta?.selectionStart ?? 0;
    openRunner(cpp.find((b) => pos >= b.start && pos <= b.end) ?? cpp[0], all, true);
  };

  const formatDoc = () => {
    const r = formatDocument(text);
    if (!r.changed) {
      setToast("格式已经很整齐");
      return;
    }
    edRef.current?.replaceAll(r.text);
    setToast(`已整理 ${r.changed} 处格式`);
  };

  const insertAtCaret = (snippet: string) => {
    const ed = edRef.current;
    const ta = ed?.ta;
    if (!ed || !ta) return;
    ed.replace(ta.selectionStart, ta.selectionEnd, snippet);
  };

  const pushVersion = (verName: string, txt: string) => {
    setVersions((vs) => (vs[0]?.text === txt ? vs : [{ id: Date.now(), ts: Date.now(), name: verName, text: txt }, ...vs].slice(0, 30)));
  };

  const loadFile = async (f: File) => {
    const t = (await f.text()).replace(/\r\n?/g, "\n");
    edRef.current?.replaceAll(t);
    setName(f.name);
    setToast(`已打开 ${f.name}`);
  };

  const loadPdf = async (f: File) => {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setToast("请选择 PDF 文件");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setToast("PDF 超过 50 MB，请先压缩或拆分后再导入");
      return;
    }
    setPdfBusy(true);
    try {
      const r = await pdfToMarkdown(f, (page, total) => {
        if (page === 1 || page === total || page % 5 === 0) setToast(`正在解析 PDF：第 ${page}/${total} 页`);
      });
      pushVersion("导入 PDF 前自动保存", text);
      edRef.current?.replaceAll(r.markdown);
      setName(f.name.replace(/\.pdf$/i, "") + ".md");
      const cppCount = extractCodeBlocks(r.markdown).filter((blk) => isCppLang(blk.lang)).length;
      setToast(
        `已导入 PDF：${r.pages} 页 · ${r.chars} 字${r.formulaConverted ? ` · ${r.formulaConverted} 处公式已转 LaTeX` : ""}${r.formulaFailed ? ` · ${r.formulaFailed} 处待人工补` : ""}${cppCount ? ` · 识别到 ${cppCount} 段代码，点预览代码块右上角 ▶ 即可运行${cppCount >= 2 ? "，也可在「对比」里对拍" : ""}` : ""}`,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "PDF 导入失败");
    } finally {
      setPdfBusy(false);
    }
  };

  const loadAnyFile = (f: File) => {
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") void loadPdf(f);
    else if (/\.(cpp|cc|cxx|c)$/i.test(f.name)) {
      // 直接把 .cpp 文件送进运行框，省去先贴进文档的步骤
      void f.text().then((t) => {
        setRunInit({ code: t, stdin: "", expected: "" });
        setToast(`已载入 ${f.name}，点「编译并运行」即可`);
      });
    } else void loadFile(f);
  };

  const download = () => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.endsWith(".md") ? name : name + ".md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setToast("已导出 " + a.download);
  };

  const buildExportHtml = (a4 = false) => {
    const title = (name.replace(/\.md$/i, "") || "题解").replace(/</g, "&lt;");
    let htmlBody = rendered.html;
    let tocHtml = "";
    if (a4) {
      let n = 0;
      htmlBody = rendered.html.replace(/<h([1-6])>/g, (_m, d) => `<h${d} id="hx${n++}">`);
      tocHtml =
        `<nav class="toc"><div style="font-weight:600;margin-bottom:8px">目录</div>` +
        rendered.headings.map((hd, i) => `<a class="lv${hd.depth}" href="#hx${i}">${hd.text.replace(/</g, "&lt;")}</a>`).join("") +
        `</nav>`;
    }
    const et = EXPORT_THEMES[theme] ?? EXPORT_THEMES.paper;
    const vars = Object.entries(et).map(([k, v]) => `--${k}:${v}`).join(";");
    const embeddedCss = collectExportCss();
    const css = [
      `:root{${vars}}`,
      "*,*::before,*::after{box-sizing:border-box}",
      "body{font-family:'Fira Code',ui-monospace,Menlo,'PingFang SC','Microsoft YaHei',sans-serif;margin:0;background:var(--bg);color:var(--fg)}",
      `article{max-width:800px;margin:0 auto;padding:30px 46px 64px 44px;background:var(--page);counter-reset:eq;line-height:1.9;font-size:${fontSize + 1.5}px;min-height:100vh;font-feature-settings:"calt" 0}`,
      ".blk>:first-child{margin-top:0}.blk>:last-child{margin-bottom:0}",
      "h1,h2,h3,h4,h5,h6{font-weight:600;line-height:1.4;margin:1.6em 0 .6em;color:var(--fg)}",
      "h1{font-size:1.7em;padding-bottom:.34em;border-bottom:1px solid var(--line)}",
      "h2{font-size:1.36em;padding-bottom:.28em;border-bottom:1px solid var(--line)}",
      "h3{font-size:1.16em}h4{font-size:1.04em}",
      "p{margin:.72em 0}",
      "a{color:var(--accent);text-decoration:none;border-bottom:1px solid}",
      "strong{font-weight:600}",
      "ul,ol{padding-left:1.6em;margin:.6em 0}ul{list-style:disc}ul ul{list-style:circle}ul ul ul{list-style:square}ol{list-style:decimal}ol ol{list-style:lower-alpha}ol ol ol{list-style:lower-roman}",
      "li{margin:.24em 0;padding-left:.1em}li::marker{color:var(--fg3)}",
      "blockquote{margin:1em 0;padding:.4em 1em;color:var(--fg2);border-left:3px solid color-mix(in srgb,var(--accent) 45%,var(--line));border-radius:0 10px 10px 0;background:var(--accent-softer)}",
      "blockquote>:first-child{margin-top:0}blockquote>:last-child{margin-bottom:0}",
      "hr{border:0;border-top:1px solid var(--line);margin:1.8em 0}",
      "table{border-collapse:collapse;margin:1em 0;font-size:.94em;width:100%}th,td{border:1px solid var(--line);padding:7px 12px;text-align:left}th{background:var(--code);font-weight:600}tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--code) 45%,transparent)}",
      "img{max-width:100%;border-radius:10px}",
      ":not(pre)>code{font-family:inherit;font-size:.9em;padding:.14em .4em;border-radius:5px;background:var(--code);color:var(--ty)}",
      "figure.code{--lang:var(--fg3);margin:1em 0;border-radius:12px;border:1px solid var(--line);background:var(--code);overflow:hidden}figure.code-cpp{--lang:#3b82f6}figure.code-python{--lang:#d9a400}",
      "figure.code figcaption{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 12px;font-size:11.5px;color:var(--fg2);border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--lang) 7%,transparent)}",
      "figure.code .dot{width:8px;height:8px;border-radius:50%;background:var(--lang);box-shadow:0 0 0 3px color-mix(in srgb,var(--lang) 18%,transparent)}",
      "figure.code .name{font-weight:600;color:var(--lang);letter-spacing:.03em}",
      "figure.code button{margin-left:auto;border:1px solid transparent;background:transparent;color:var(--fg2);font-size:11.5px;cursor:pointer;padding:2px 8px;border-radius:6px}",
      "figure.code.collapsed pre{display:none}",
      "figure.code pre{display:flex;margin:0;padding:12px 16px 12px 12px;font-family:inherit;font-size:.86em;line-height:1.7;overflow-x:auto}",
      ".code-ln{flex:none;white-space:pre;text-align:right;padding-right:12px;margin-right:14px;border-right:1px solid var(--line);color:var(--fg3);user-select:none}",
      "figure.code code{flex:1 1 auto;min-width:0;font-family:inherit;background:none;padding:0;color:var(--fg)}",
      ".diff-code{white-space:normal}",
      ".diff-code .dl{display:block;margin:0 -16px 0 -12px;padding:0 16px 0 12px;white-space:pre}",
      ".diff-code .dl:empty::before{content:' '}",
      ".diff-code .dl-add{background:color-mix(in srgb,var(--ok) 15%,transparent)}",
      ".diff-code .dl-del{background:color-mix(in srgb,var(--err) 13%,transparent)}",
      ".diff-code .dl-meta{background:var(--code);color:var(--fg2)}",
      ".diff-code .ds{font-weight:700}.diff-code .dl-add .ds{color:var(--ok)}.diff-code .dl-del .ds{color:var(--err)}",
      ".hljs-keyword,.hljs-literal,.hljs-built_in{color:var(--kw)}.hljs-string{color:var(--str)}.hljs-number{color:var(--num)}.hljs-comment,.hljs-quote{color:var(--com);font-style:italic}.hljs-title,.hljs-title.function_{color:var(--fn)}.hljs-type,.hljs-title.class_,.hljs-meta{color:var(--ty)}.hljs-params,.hljs-variable{color:var(--fg)}",
      ".katex{font-size:1.21em}.katex-display{margin:.6em 0}",
      ".math-block{position:relative;text-align:center;margin:1em 0;overflow-x:auto;padding:2px 2.6em 2px 0;counter-increment:eq}",
      ".math-block::after{content:'(' counter(eq) ')';position:absolute;right:6px;top:50%;transform:translateY(-50%);color:var(--fg3);font-size:.85em}",
      ".math-inline-display{display:inline-flex;max-width:100%;vertical-align:middle}",
      "@media print{body{background:var(--bg)}article{box-shadow:none;min-height:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}}",
    ].join("\n") +
      (a4
        ? "\n@page{size:A4;margin:18mm 16mm;@bottom-center{content:counter(page);color:var(--fg3);font-size:10px}}.toc{border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-bottom:26px}.toc a{display:block;color:var(--fg);text-decoration:none;padding:2px 0;font-size:13px}.toc a.lv3{padding-left:16px}.toc a.lv4,.toc a.lv5,.toc a.lv6{padding-left:32px}h1,h2{page-break-after:avoid}figure.code{page-break-inside:avoid}"
        : "\n@page{margin:16mm 14mm}");
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${title} · 墨序</title>
${embeddedCss ? `<style>${embeddedCss}</style>` : '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">'}
<style>${css}</style>
</head>
<body>
<article class="md">${tocHtml}${htmlBody}</article>
<script>
document.addEventListener('click',function(e){
var f=e.target.closest('[data-fold]');
if(f){var fig=f.closest('figure');fig.classList.toggle('collapsed');var l=f.querySelector('.fold-label');if(l)l.textContent=fig.classList.contains('collapsed')?'\u5c55\u5f00':'\u6298\u53e0';return;}
var c=e.target.closest('[data-copy]');
if(c){var code=c.closest('figure').querySelector('code');if(navigator.clipboard)navigator.clipboard.writeText(code.textContent);var l2=c.querySelector('.copy-label');if(l2){l2.textContent='\u5df2\u590d\u5236';setTimeout(function(){l2.textContent='\u590d\u5236';},1400);}}
});
</script>
</body>
</html>`;
  };

  const exportHtml = () => {
    const blob = new Blob([buildExportHtml()], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (name.replace(/\.md$/i, "") || "题解") + ".html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setToast("已导出 " + a.download);
  };

  const exportTypst = () => {
    const title = name.replace(/\.md$/i, "") || "题解";
    const blob = new Blob([mdToTypst(text, title)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = title + ".typ";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setToast("已导出 " + a.download + "（可用 Typst 编译为 PDF）");
  };

  const printPdf = (a4 = false) => {
    const w = window.open("", "_blank");
    if (!w) {
      exportHtml();
      setToast("弹窗被拦截，已改为导出 HTML");
      return;
    }
    w.document.open();
    w.document.write(buildExportHtml(a4));
    w.document.close();
    w.focus();
    window.setTimeout(() => w.print(), 400);
  };

  const onSplitterDown = (e: { preventDefault(): void }) => {
    const main = mainRef.current;
    if (!main) return;
    e.preventDefault();
    const rect = main.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = (ev.clientX - rect.left) / Math.max(1, rect.width);
      setSplitRatio(Math.min(0.75, Math.max(0.25, r)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const jumpDiag = (d: Diag) => edRef.current?.jumpTo(d.from, d.to);

  const jumpLine = (line: number) => {
    const ta = edRef.current?.ta;
    if (!ta) return;
    const from = lineStart(ta.value, line);
    edRef.current?.jumpTo(from, from);
    setOutline(false);
    suppressCaret.current = 0;
    caretTs.current = Date.now();
  };

  const jumpPendingFormula = () => {
    if (!pendingFormulas.length) {
      setToast("没有待补公式");
      return;
    }
    const ed = edRef.current;
    const ta = ed?.ta;
    if (!ed || !ta) {
      setView("split");
      setToast("已切换到分栏，请再执行一次定位待补公式");
      return;
    }
    const idx = pendingFormulas.findIndex((x) => x.from >= ta.selectionEnd);
    const n = idx >= 0 ? idx : 0;
    const target = pendingFormulas[n];
    ed.jumpTo(target.from, target.to);
    setToast(`待补公式 ${n + 1}/${pendingFormulas.length}，补写后可继续定位下一处`);
  };

  const gotoCaretInPreview = () => {
    const pv = pvRef.current;
    if (!pv) return;
    setActiveBlock(caret.line);
    pv.scrollTo({ top: Math.max(0, previewY(caret.line + 0.5) - pv.clientHeight * 0.3), behavior: "smooth" });
  };

  // ---------- 全局快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        download();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFocus((f) => !f);
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (e.key === "Escape") {
        setHelp(false);
        setOutline(false);
        setDrawer(false);
        setTplOpen(false);
        setExpOpen(false);
        setFocus(false);
        setDiagramOpen(false);
        setDiffOpen(false);
        setMathOpen(false);
        setVersionsOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const paletteCommands: PaletteCmd[] = [
    { id: "diagram", title: "打开算法图示编辑器", desc: "树 / 图 / 线段树 / DP / Mermaid / DOT，节点可拖、物理布局", category: "插入", keywords: "graph tree dot mermaid 图 树 流程图 csacademy", icon: Network, run: () => setDiagramOpen(true) },
    { id: "math", title: "打开公式可视化编辑器", desc: "符号面板、模板、KaTeX 实时预览与报错定位", category: "插入", keywords: "latex katex formula 公式 符号 矩阵 分段", icon: Sigma, run: () => setMathOpen(true) },
    { id: "diff", title: "打开代码对比", desc: "逐行标出两段代码的增加、删除与相同行", category: "插入", keywords: "diff compare 代码 对比 版本", icon: GitCompare, run: () => { setDiffInit(null); setDiffOpen(true); } },
    { id: "run-cpp", title: "编译运行 C++ 代码块", desc: "在线 g++ 编译运行光标处代码，自动带入后面的样例输入/输出对答案", category: "插入", keywords: "run compile g++ 运行 编译 样例 对拍 cpp", icon: Play, run: openRunnerAtCaret },
    { id: "stress", title: "多轮对拍（生成器 + 双程序）", desc: "随机生成数据让两段程序自动跑很多轮，找反例", category: "插入", keywords: "stress 对拍 生成器 暴力 标程 反例", icon: FlaskConical, run: () => setStressInit(pickStressCodes(text)) },
    { id: "batch-check", title: "逐段验证全文 C++ 代码", desc: "文档里每段代码带自带样例逐个编译运行，一次看清哪段挂了", category: "代码", keywords: "batch verify 验证 全文 样例 运行 cpp 检查", icon: ListChecks, run: () => { const items = buildBatchItems(); if (items.length) setBatchItems(items); else setToast("文档里还没有 C++ 代码块"); } },
    { id: "ai-chat", title: "AI 助手对话", desc: "免费免 Key 直接问：答疑、讲解、出思路", category: "AI", keywords: "ai chat 智能 对话 大模型", icon: Bot, run: () => setAiState({ task: null }) },
    { id: "ai-doc", title: "AI 带着全文提问", desc: "把当前文档作为上下文，和 AI 讨论这篇题解", category: "AI", keywords: "ai doc 全文 上下文 写作 题解", icon: Bot, run: () => setAiState({ task: { title: "AI 写作助手", kickoff: "", docContext: text.slice(0, 9000) } }) },
    { id: "ai-polish", title: "AI 润色选中文字", desc: "把选中的题解文字润色得更通顺，结果可一键替换选区", category: "AI", keywords: "ai polish 润色 改写 文字", icon: Sparkles, run: () => openAiWithSelection("polish") },
    { id: "ai-explain", title: "AI 讲解选中代码", desc: "讲清选中代码的思路、关键变量与复杂度", category: "AI", keywords: "ai explain 讲解 代码 理解", icon: Bot, run: () => openAiWithSelection("explain") },
    { id: "ai-review-all-code", title: "AI 审查全文 C++ 代码", desc: "逐段检查正确性、边界、溢出、复杂度与实现细节", category: "AI", keywords: "ai review audit code 全文 cpp 代码审查 bug 正确性", icon: Bot, run: () => {
      const blocks = extractCodeBlocks(text).filter((b) => isCppLang(b.lang));
      if (!blocks.length) { setToast("文档里还没有 C++ 代码块"); return; }
      const context = blocks.slice(0, 8).map((b, i) => `代码段 ${i + 1}（第 ${b.startLine + 1} 行）\n\`\`\`cpp\n${b.code.slice(0, 5000)}\n\`\`\``).join("\n\n");
      setAiState({ task: { title: "AI 审查全文 C++", kickoff: `请按代码段逐一进行严格 OI/ICPC 代码审查。检查算法正确性与不变量、边界、整数溢出、未定义行为、复杂度和常数。每个问题标明代码段与严重程度；没有题目约束时不要臆测，明确说明无法判断的部分。最后给出优先修复清单。\n\n${context}` } });
    } },
    { id: "ai-review-solution", title: "AI 审查整篇题解", desc: "检查思路是否闭环、证明是否严谨、复杂度是否匹配代码", category: "AI", keywords: "ai review solution 题解 证明 严谨 复杂度 完整性", icon: Sparkles, run: () => setAiState({ task: { title: "AI 题解完整性审查", kickoff: `请严格审查这篇 OI/ICPC 题解。重点检查：思路是否完整、关键结论是否证明、算法正确性论证是否有漏洞、复杂度是否与实现一致、变量/下标定义是否清楚、边界是否遗漏、公式是否规范。按“确定的问题 / 需要题面才能判断 / 可改进表达”分组，不要擅自补充题目未给出的条件。\n\n${text.slice(0, 14000)}` } }),
    { id: "ai-settings", title: "AI 设置", desc: "配置服务商、API Key 与模型（Key 只存本机）", category: "AI", keywords: "ai settings key 模型 配置 deepseek", icon: Settings2, run: () => setAiState({ task: null, settings: true }) },
    { id: "open", title: "打开 Markdown 文件", desc: "打开 .md / .markdown / .txt，也可以把文件拖进窗口", category: "文档", keywords: "open file 打开 文件 导入 md", icon: FolderOpen, run: () => fileRef.current?.click() },
    { id: "import-pdf", title: "导入 PDF 并转成 Markdown", desc: "本地提取 PDF 文字层；扫描版没有文字层时无法 OCR", category: "文档", keywords: "pdf import convert 导入 转换 文档 ocr", icon: FileUp, run: () => pdfFileRef.current?.click() },
    { id: "versions", title: "打开版本管理", desc: "自动快照、手动保存、恢复与版本对比", category: "文档", keywords: "version history snapshot 版本 历史 恢复", icon: History, run: () => setVersionsOpen(true) },
    { id: "save-version", title: "保存当前为新版本", desc: "立即留一份可恢复、可对比的快照", category: "文档", keywords: "save snapshot 保存 版本 快照", icon: Save, run: () => { pushVersion("手动保存", text); setToast("已保存新版本"); } },
    { id: "outline", title: "打开文档大纲", desc: "按标题层级快速跳转到对应行", category: "文档", keywords: "outline heading 大纲 标题 目录 跳转", icon: ListTree, run: () => setOutline(true) },
    { id: "fixall", title: "一键修复全部规范问题", desc: `${fixable} 处可自动修复，其余问题会在检查面板里说明`, category: "检查", keywords: "fix lint repair 修复 规范 标点 公式", icon: Wrench, run: fixAll },
    { id: "pending-formula", title: "定位下一处待补公式", desc: pendingFormulas.length ? `${pendingFormulas.length} 处 $\\square$ 等待人工补写` : "当前没有 $\\square$ 占位", category: "检查", keywords: "square placeholder pending pdf 待补 公式 定位 占位", icon: Crosshair, run: jumpPendingFormula },
    { id: "format", title: "一键整理格式", desc: "合并多余空行、去行尾空格、修正标题跳级", category: "检查", keywords: "format tidy 整理 空行 标题", icon: Sparkles, run: formatDoc },
    { id: "drawer", title: "切换规范检查面板", desc: "行内规范 + 题解完整性建议，可点击定位问题行", category: "检查", keywords: "lint check 检查 规范 质量", icon: TriangleAlert, run: () => setDrawer((d) => !d) },
    { id: "focus", title: "切换专注模式", desc: "隐藏顶栏与状态栏，只留下写作区域", category: "视图", keywords: "focus zen 专注 写作", shortcut: "Ctrl+Shift+F", icon: Maximize, run: () => setFocus((f) => !f) },
    { id: "v-edit", title: "视图：仅编辑", desc: "隐藏预览，把宽度留给源码", category: "视图", keywords: "view edit 视图 编辑", icon: PenLine, run: () => setView("edit") },
    { id: "v-split", title: "视图：编辑与预览分栏", desc: "左右对照，滚动与光标位置联动", category: "视图", keywords: "view split 视图 分栏 预览", icon: Columns2, run: () => setView("split") },
    { id: "v-pv", title: "视图：仅预览", desc: "只看排版效果，适合通读检查", category: "视图", keywords: "view preview 视图 预览 阅读", icon: LayoutList, run: () => setView("preview") },
    { id: "font-up", title: "增大编辑字号", desc: `当前 ${fontSize}px，最大 22px`, category: "视图", keywords: "font size 字号 增大", icon: Plus, run: () => setFontSize((v) => Math.min(22, v + 1)) },
    { id: "font-down", title: "减小编辑字号", desc: `当前 ${fontSize}px，最小 11px`, category: "视图", keywords: "font size 字号 减小", icon: Minus, run: () => setFontSize((v) => Math.max(11, v - 1)) },
    { id: "goto-preview", title: "在预览中定位光标段落", desc: "把预览滚动到当前光标所在的块", category: "视图", keywords: "locate preview 光标 预览 定位", icon: Crosshair, run: gotoCaretInPreview },
    { id: "copy-md", title: "复制 Markdown 源码", desc: "把当前全文复制到剪贴板", category: "导出", keywords: "copy markdown 复制 源码", icon: ClipboardCopy, run: () => { void navigator.clipboard?.writeText(text); setToast("Markdown 源码已复制"); } },
    { id: "copy-html", title: "复制预览 HTML", desc: "复制渲染后的 HTML 片段，不含页面外壳", category: "导出", keywords: "copy html 复制 网页", icon: FileCode, run: () => { void navigator.clipboard?.writeText(rendered.html); setToast("预览 HTML 已复制"); } },
    { id: "exp-md", title: "导出 Markdown 文件", desc: "下载当前 .md 源文件", category: "导出", keywords: "export markdown download 导出 下载", shortcut: "Ctrl+S", icon: FileText, run: download },
    { id: "exp-html", title: "导出 HTML 网页", desc: "生成可直接分享的单页 HTML", category: "导出", keywords: "export html web 导出 网页 分享", icon: FileCode, run: exportHtml },
    { id: "exp-pdf", title: "打印 / 保存为 PDF", desc: "调用浏览器打印，可另存为 PDF", category: "导出", keywords: "export pdf print 打印 导出", icon: Printer, run: () => printPdf() },
    { id: "exp-a4", title: "A4 专业排版打印", desc: "带目录锚点与页码的 A4 打印版", category: "导出", keywords: "a4 pdf print toc A4 排版 目录 页码", icon: Printer, run: () => printPdf(true) },
    { id: "exp-typ", title: "导出 Typst 文件", desc: "转换成 .typ，可用 Typst 编译为 PDF", category: "导出", keywords: "typst export 导出 排版", icon: FileCode, run: exportTypst },
    { id: "help", title: "快捷键与语法速查", desc: "查看全部快捷键、公式与列表规则", category: "帮助", keywords: "help shortcut keyboard 帮助 快捷键 速查", shortcut: "Ctrl+/", icon: Keyboard, run: () => setHelp(true) },
    ...THEMES.map((t) => ({ id: "theme-" + t.id, title: "主题：" + t.name, desc: "立即切换编辑器配色", category: "主题", keywords: "theme color 主题 配色 " + t.name, icon: Sparkles, run: () => setTheme(t.id) })),
    ...SOLUTION_TEMPLATES.map((t) => ({
      id: "tpl-" + t.id,
      title: "插入模板：" + t.name,
      desc: t.desc,
      category: "模板",
      keywords: "template insert 模板 插入 题解 " + t.name + " " + t.desc,
      icon: LayoutTemplate,
      run: () => insertSolution(t.body, "「" + t.name + "」"),
    })),
  ];

  const ok = diags.length === 0;

  return (
    <div
      className={"app" + (focus ? " focus" : "")}
      style={{ ["--fs" as string]: `${fontSize}px`, ["--pfs" as string]: `${fontSize + 1.5}px` }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) loadAnyFile(f);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">墨</span>
          <span className="brand-name">墨序</span>
        </div>
        <label className="file-name" title="文件名">
          <FileText size={13} />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            aria-label="文件名"
            size={Math.max(8, name.length)}
          />
        </label>

        <div className="topbar-group file-actions">
          <button className="bar-btn" onClick={() => fileRef.current?.click()} title="打开 .md 文件（也可以直接拖进窗口）">
            <FolderOpen size={14} />
            <span className="lbl">打开</span>
          </button>
          <button className="bar-btn" onClick={() => pdfFileRef.current?.click()} disabled={pdfBusy} title="把带文字层的 PDF 转成 Markdown；扫描版没有文字层时会明确提示">
            <FileUp size={14} />
            <span className="lbl">{pdfBusy ? "解析中" : "导入 PDF"}</span>
          </button>
          <div className="topbar-group pop-anchor">
            <button className={"bar-btn" + (expOpen ? " on" : "")} onClick={() => setExpOpen((o) => !o)} title="导出 Markdown / HTML / PDF">
              <Download size={14} />
              <span className="lbl">导出</span>
              <ChevronDown size={11} />
            </button>
            {expOpen && (
              <>
                <div className="pop-mask" onClick={() => setExpOpen(false)} />
                <div className="pop outline-pop thin">
                  <div className="pop-title">导出为</div>
                  <button className="outline-item" onClick={() => { download(); setExpOpen(false); }}>
                    <FileText size={13} /><span className="truncate">Markdown 源文件（Ctrl+S）</span>
                  </button>
                  <button className="outline-item" onClick={() => { exportHtml(); setExpOpen(false); }}>
                    <FileCode size={13} /><span className="truncate">HTML 网页（可分享）</span>
                  </button>
                  <button className="outline-item" onClick={() => { printPdf(); setExpOpen(false); }}>
                    <Printer size={13} /><span className="truncate">打印 / 保存为 PDF</span>
                  </button>
                  <button className="outline-item" onClick={() => { printPdf(true); setExpOpen(false); }}>
                    <Printer size={13} /><span className="truncate">A4 专业排版（目录 + 页码）</span>
                  </button>
                  <button className="outline-item" onClick={() => { exportTypst(); setExpOpen(false); }}>
                    <FileCode size={13} /><span className="truncate">Typst 文件（.typ）</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="topbar-group pop-anchor">
            <button className={"bar-btn" + (tplOpen ? " on" : "")} onClick={() => setTplOpen((o) => !o)} title="OI / ACM 题解模板库">
              <LayoutTemplate size={14} />
              <span className="lbl">模板</span>
              <ChevronDown size={11} />
            </button>
            {tplOpen && (
              <>
                <div className="pop-mask" onClick={() => setTplOpen(false)} />
                <div className="pop outline-pop thin">
                  <div className="pop-title">题解模板 · {SOLUTION_TEMPLATES.length}</div>
                  {SOLUTION_TEMPLATES.map((t) => (
                    <button key={t.id} className="outline-item" title={t.desc} onClick={() => { insertSolution(t.body, "「" + t.name + "」"); setTplOpen(false); }}>
                      <span className="outline-dot" /><span className="truncate">{t.name} · {t.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="topbar-sep" aria-hidden="true" />
        <div className="topbar-group tool-cluster">
          <button className="bar-btn" onClick={() => setDiagramOpen(true)} title="算法图示编辑器：树 / 图 / 线段树 / 流程图 / DP 转移">
            <Network size={14} />
            <span className="lbl">图示</span>
          </button>
          <button className="bar-btn" onClick={() => { setDiffInit(null); setDiffOpen(true); }} title="代码对比：逐行标出两个版本的差异">
            <GitCompare size={14} />
            <span className="lbl">对比</span>
          </button>
          <button className="bar-btn" onClick={() => setStressInit(pickStressCodes(text))} title="多轮对拍：生成器造数据，双程序自动跑很多轮找反例">
            <FlaskConical size={14} />
            <span className="lbl">对拍</span>
          </button>
          <button className="bar-btn" onClick={() => setAiState({ task: null })} title="AI 助手：免注册免费模型，支持题解、代码审查、运行分析与生成测试">
            <Bot size={14} />
            <span className="lbl">AI</span>
          </button>
          <button className="bar-btn" onClick={openRunnerAtCaret} title="编译运行 C++：在线 g++ 跑光标处代码块，自动对样例">
            <Play size={14} />
            <span className="lbl">运行</span>
          </button>
          <button className="bar-btn" onClick={() => setMathOpen(true)} title="公式可视化编辑器：符号面板 + 实时预览">
            <Sigma size={14} />
            <span className="lbl">公式</span>
          </button>
          <button className="bar-btn" onClick={() => setVersionsOpen(true)} title="版本管理：自动快照与恢复">
            <History size={14} />
            <span className="lbl">版本</span>
          </button>
          <button className="bar-btn palette-cta" onClick={() => setPaletteOpen(true)} title="命令面板：搜索全部功能（Ctrl+Shift+P）">
            <Command size={14} />
            <span className="lbl">命令</span>
            <span className="btn-kbd">Ctrl+Shift+P</span>
          </button>
        </div>

        <div className="topbar-group pop-anchor">
          <button className={"bar-btn" + (outline ? " on" : "")} onClick={() => setOutline((o) => !o)} title="大纲（点击跳转标题）">
            <ListTree size={14} />
            <span className="lbl">大纲</span>
            <ChevronDown size={11} />
          </button>
          {outline && (
            <>
              <div className="pop-mask" onClick={() => setOutline(false)} />
              <div className="pop outline-pop thin">
                <div className="pop-title">大纲 · {rendered.headings.length}</div>
                {rendered.headings.length === 0 && <div className="pop-empty">还没有标题，试试 Ctrl+1</div>}
                {rendered.headings.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => jumpLine(h.line)}
                    className={"outline-item d" + Math.min(6, h.depth)}
                  >
                    <span className="outline-dot" />
                    <span className="truncate">{h.text || "（空标题）"}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="topbar-spacer" />

        <div className="theme-row" role="group" aria-label="主题">
          {THEMES.map((t) => (
            <button
              key={t.id}
              title={t.name}
              aria-label={"主题 " + t.name}
              className={"swatch" + (theme === t.id ? " on" : "")}
              style={{ background: t.sw }}
              onClick={() => setTheme(t.id)}
            />
          ))}
        </div>

        <div className="zoom-row" role="group" aria-label="字号">
          <button className="bar-btn tiny" onClick={() => setFontSize((s) => Math.max(11, s - 1))} title="减小字号">
            <Minus size={13} />
          </button>
          <span className="zoom-val">{fontSize}</span>
          <button className="bar-btn tiny" onClick={() => setFontSize((s) => Math.min(22, s + 1))} title="增大字号">
            <Plus size={13} />
          </button>
        </div>

        <div className="seg" role="group" aria-label="视图">
          <button className={eff === "edit" ? "on" : ""} onClick={() => setView("edit")} title="仅编辑">
            <PenLine size={13} />
            <span className="lbl">编辑</span>
          </button>
          {wide && (
            <button className={eff === "split" ? "on" : ""} onClick={() => setView("split")} title="分栏">
              <Columns2 size={13} />
              <span className="lbl">分栏</span>
            </button>
          )}
          <button className={eff === "preview" ? "on" : ""} onClick={() => setView("preview")} title="仅预览">
            <LayoutList size={13} />
            <span className="lbl">预览</span>
          </button>
        </div>

        <button className="bar-btn" onClick={() => setFocus((f) => !f)} title="专注模式（Ctrl+Shift+F）">
          <Maximize size={14} />
          <span className="lbl">专注</span>
        </button>
      </header>

      <main ref={mainRef} className="main">
        <section className={"pane-editor" + (eff === "split" ? " split" : "")} style={{ display: eff === "preview" ? "none" : "flex", ...(eff === "split" ? { flex: `0 0 ${Math.round(splitRatio * 1000) / 10}%` } : {}) }}>
          <Editor
            ref={edRef}
            value={text}
            diags={diags}
            fontSize={fontSize}
            onChange={onChange}
            onScroll={syncFromEditor}
            onCaret={handleCaret}
            onShowHelp={() => setHelp(true)}
          />
          {atCaret.length > 0 && (
            <div className="caret-hint">
              {atCaret.map((d, i) => (
                <div key={i} className="caret-hint-row">
                  <CircleAlert size={13} className="ico" style={{ color: d.rule === "katex" ? "var(--warn)" : "var(--err)" }} />
                  <span className="msg">{d.message}</span>
                  {d.fix && (
                    <button className="mini-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFix(d)}>
                      <Wrench size={11} />
                      修复
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {eff === "split" && (
          <div className="splitter" onPointerDown={onSplitterDown} role="separator" aria-orientation="vertical" aria-label="调整分栏宽度" title="拖动调整分栏宽度" />
        )}

        <section className="pane-preview" style={{ display: eff === "edit" ? "none" : "block" }}>
          <Preview
            ref={pvRef}
            html={rendered.html}
            blocksRef={blocksRef}
            onScroll={syncFromPreview}
            onRendered={onRendered}
            onBlockDoubleClick={onBlockDoubleClick}
            onRunCode={(idx) => {
              const all = extractCodeBlocks(text);
              openRunner(all.filter((b) => isCppLang(b.lang))[idx], all, true);
            }}
            onAiCode={(idx) => {
              const blk = extractCodeBlocks(text).filter((b) => isCppLang(b.lang))[idx];
              if (blk) setAiState({ task: aiExplainTask(blk.code) });
            }}
          />
          {eff !== "edit" && (
            <div className="pv-fabs">
              <button className="fab" onClick={gotoCaretInPreview} title="定位到光标所在段落">
                <Crosshair size={14} />
              </button>
              <button className="fab" onClick={() => pvRef.current?.scrollTo({ top: 0, behavior: "smooth" })} title="回到顶部">
                <ArrowUpToLine size={14} />
              </button>
            </div>
          )}
        </section>

        {focus && (
          <button className="focus-exit" onClick={() => setFocus(false)} title="退出专注模式（Esc）">
            <Minimize size={13} />
            退出专注
          </button>
        )}
        {dragging && <div className="drop-mask">松开鼠标，打开 Markdown 文件</div>}
        {toast && <div className="toast">{toast}</div>}
      </main>

      {drawer && (
        <section className="drawer">
          <div className="drawer-head">
            <span className="drawer-title">
              {ok ? <Check size={14} style={{ color: "var(--ok)" }} /> : <TriangleAlert size={14} style={{ color: "var(--err)" }} />}
              规范检查
            </span>
            <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>
              全部 <b>{diags.length}</b>
            </button>
            {RULES.map((r) => (
              <button key={r} className={"chip" + (filter === r ? " on" : "")} onClick={() => setFilter(r)}>
                {RULE_LABEL[r]} <b>{counts[r]}</b>
              </button>
            ))}
            <div className="topbar-spacer" />
            <button className="bar-btn" onClick={formatDoc} title="合并多余空行、去行尾空格、修正标题跳级">
              <Sparkles size={13} />
              一键整理
            </button>
            {fixable > 0 && (
              <button className="bar-btn accented" onClick={fixAll} title="自动修复全部可修复的问题">
                <Wrench size={13} />
                一键修复 {fixable} 处
              </button>
            )}
            <button className="bar-btn tiny" onClick={() => setDrawer(false)} title="收起（Esc）">
              <X size={14} />
            </button>
          </div>
          <div className="drawer-body thin">
            {quality.length > 0 && (
              <>
                <div className="pop-title" style={{ padding: "10px 14px 2px" }}>题解完整性 · {quality.length}</div>
                {quality.map((q) => (
                  <div key={q.id} className="drawer-row" onClick={() => jumpLine(q.line)}>
                    <span className="drawer-pos">{q.line + 1}:1</span>
                    <span className="drawer-rule warn">完整性</span>
                    <span className="drawer-msg">{q.message}</span>
                  </div>
                ))}
              </>
            )}
            {shown.length === 0 && quality.length === 0 && (
              <div className="drawer-empty">
                <Check size={15} style={{ color: "var(--ok)" }} /> 这一类没有问题，继续保持。
              </div>
            )}
            {shown.length === 0 && quality.length > 0 && (
              <div className="drawer-empty">这一类行内规范没有问题；上面的完整性建议可以看看。</div>
            )}
            {shown.map((d, i) => (
              <div key={i} className="drawer-row" onClick={() => jumpDiag(d)}>
                <span className="drawer-pos">
                  {d.line + 1}:{d.col + 1}
                </span>
                <span className={"drawer-rule" + (d.rule === "katex" ? " warn" : "")}>{RULE_LABEL[d.rule]}</span>
                <span className="drawer-msg">{d.message}</span>
                {d.fix && (
                  <button
                    className="mini-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyFix(d);
                    }}
                  >
                    <Wrench size={11} />
                    修复
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="statusbar">
        <button className={"bar-btn" + (drawer ? " on" : "")} onClick={() => setDrawer((d) => !d)} title="规范检查面板">
          {ok ? <Check size={13} style={{ color: "var(--ok)" }} /> : <TriangleAlert size={13} style={{ color: "var(--err)" }} />}
          <span className={ok ? "ok-text" : "err-text"}>{ok ? "符合规范" : `${diags.length} 处问题`}</span>
        </button>
        <span className="status-sep" />
        <span>
          行 {caret.line + 1} · 列 {caret.col + 1}
        </span>
        <span className="status-sep" />
        <span>{words} 字</span>
        {caretBlock && (
          <>
            <span className="status-sep" />
            <button className="bar-btn" onClick={() => openRunner(caretBlock, docBlocks, true)} title="编译运行光标所在的这段 C++（自动带样例）">
              <Play size={12} />
              <span>运行这段</span>
            </button>
            <button className="bar-btn" onClick={() => setAiState({ task: aiExplainTask(caretBlock.code) })} title="让 AI 讲解光标所在的这段代码">
              <Bot size={12} />
              <span>AI 讲解</span>
            </button>
            <button
              className="bar-btn"
              onClick={() => setAiState({ task: {
                title: "AI 代码审查",
                kickoff: `请对下面的 C++ 代码做一次严格的 OI/ICPC 代码审查。重点检查：算法正确性与不变量、边界条件、整数溢出、未定义行为、复杂度、常数和实现细节。按严重程度列出问题；没有证据不要臆测。若发现问题，给出最小修改方案。\n\n\`\`\`cpp\n${caretBlock.code.slice(0, 9000)}\n\`\`\``,
              } })}
              title="检查正确性、边界、溢出、复杂度与常数"
            >
              <Bot size={12} />
              <span>AI 审查</span>
            </button>
            <button
              className="bar-btn"
              onClick={() => {
                const items = buildBatchItems();
                if (items.length) setBatchItems(items);
                else setToast("文档里还没有 C++ 代码块");
              }}
              title="把文档里每段 C++ 都带样例逐个跑一遍"
            >
              <ListChecks size={12} />
              <span>逐段验证</span>
            </button>
          </>
        )}
        {pendingFormulas.length > 0 && (
          <>
            <span className="status-sep" />
            <button className="bar-btn" onClick={jumpPendingFormula} title="定位下一处待补公式 $\square$">
              <Crosshair size={13} style={{ color: "var(--err)" }} />
              <span>{pendingFormulas.length} 处公式待补</span>
            </button>
          </>
        )}
        <span className="status-sep" />
        <span>{text.length} 字符</span>
        <span className="status-sep" />
        <span>约 {readMin} 分钟</span>
        <span className="topbar-spacer" />
        <span className="status-hint">
          <Keyboard size={12} />
          Ctrl+/ 快捷键
        </span>
        <span className="status-sep" />
        <span className="status-save">{saved ? "已自动保存" : "保存中…"}</span>
      </footer>

      <input
        ref={pdfFileRef}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadPdf(f);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,.cpp,.cc,.cxx,.pdf,text/markdown,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadAnyFile(f);
          e.target.value = "";
        }}
      />

      {batchItems && (
        <BatchDialog
          items={batchItems}
          onClose={() => setBatchItems(null)}
          onOpenRun={(item) => {
            setBatchItems(null);
            setRunInit({ code: item.code, stdin: item.stdin, expected: item.expected });
          }}
          onAiAnalyze={(item, r, expected, actual) => {
            setBatchItems(null);
            setAiState({ task: aiAnalyzeTask(item.code, item.stdin, r, expected, actual) });
          }}
        />
      )}
      {aiState && (
        <AiDialog
          key={(aiState.task ? aiState.task.title + "|" + aiState.task.kickoff.length : "chat") + "|" + (aiState.apply?.label ?? "")}
          task={aiState.task}
          applyAction={aiState.apply}
          startWithSettings={aiState.settings}
          onClose={() => setAiState(null)}
          onInsert={(t, replace) => {
            const ed = edRef.current;
            if (!ed) return;
            if (replace && aiState.sel) {
              ed.replace(aiState.sel.from, aiState.sel.to, t);
              setToast("已用 AI 结果替换选区");
            } else {
              insertAtCaret(t);
              setToast("AI 回复已插入文档");
            }
            setAiState(null);
          }}
        />
      )}
      {diagramOpen && (
        <DiagramDialog
          onClose={() => setDiagramOpen(false)}
          onInsert={(svg) => {
            insertBlock("\n\n" + svg + "\n\n");
            setToast("图示已插入题解");
          }}
        />
      )}
      {diffOpen && (
        <DiffDialog
          initialA={diffInit?.a ?? firstCode}
          initialB={diffInit?.b ?? ""}
          onClose={() => setDiffOpen(false)}
          onInsert={(diffText) => {
            insertBlock("\n\n```diff\n" + diffText + "\n```\n\n");
            setToast("对比结果已插入");
          }}
          onStress={(a, b) => {
            setDiffOpen(false);
            setStressInit({ gen: DEFAULT_GEN, a, b });
          }}
          onVersus={(a, b) => {
            // 从版本对比进来时两边是整篇文档，先抽出各自第一段 C++ 代码再对拍
            const pick = (t: string) => {
              const blocks = extractCodeBlocks(t);
              if (!blocks.length) return t;
              return blocks.filter((x) => isCppLang(x.lang))[0]?.code ?? "";
            };
            const ca = pick(a);
            const cb = pick(b);
            if (!ca.trim() || !cb.trim()) {
              setToast("对拍需要两边各有一段 C++ 代码");
              return;
            }
            setDiffOpen(false);
            setRunInit({ code: ca, stdin: "", expected: "", versus: cb });
          }}
        />
      )}
      {runInit && (
        <RunDialog
          initialCode={runInit.code}
          initialStdin={runInit.stdin}
          initialExpected={runInit.expected}
          versusCode={runInit.versus}
          onStress={(a, b) => {
            setRunInit(null);
            setStressInit({ gen: DEFAULT_GEN, a, b });
          }}
          onAiAnalyze={({ code: c, stdin: si, result, expected, actual, codeB, resultB }) => {
            const task = aiAnalyzeTask(c, si, result, expected, actual, codeB, resultB);
            const back = { stdin: si, expected: expected ?? "" };
            setRunInit(null);
            setAiState({ task, apply: {
              label: "替换代码并重新编译",
              run: (answer) => {
                const fixed = (/```(?:cpp|c\+\+|c)?\s*\n([\s\S]*?)```/i.exec(answer)?.[1] ?? stripCodeFence(answer)).trim();
                if (!fixed.trim() || !/#include|int\s+main|using\s+namespace/.test(fixed)) {
                  setToast("AI 回复里没有识别到完整 C++ 程序，未替换代码");
                  return;
                }
                setAiState(null);
                requestAnimationFrame(() => setRunInit({ code: fixed, stdin: back.stdin, expected: back.expected }));
                setToast("已载入 AI 修改版代码，请检查后编译");
              },
            } });
          }}
          onAiData={(code) => {
            const back = { code, expected: runInit?.expected ?? "", versus: runInit?.versus };
            setAiState({
              task: {
                title: "AI 生成测试数据",
                kickoff: `下面是一段 C++ 程序，请为它生成一组有代表性的测试输入：覆盖常规情况与边界情况（最小/最大/空或单元素等，按题目语义来），规模适中。只输出输入数据本身，可以用 \`\`\`text 代码块包住，不要任何解释文字。\n\n\`\`\`cpp\n${code.slice(0, 6000)}\n\`\`\``,
              },
              apply: {
                label: "用作输入数据",
                run: (t) => {
                  const data = stripCodeFence(t);
                  setAiState(null);
                  setRunInit(null);
                  requestAnimationFrame(() => setRunInit({ code: back.code, stdin: data, expected: back.expected, versus: back.versus }));
                  setToast("已把 AI 生成的数据填入运行框");
                },
              },
            });
          }}
          onClose={() => setRunInit(null)}
          onInsertOutput={(snippet) => {
            const pos = runInit.insertAfter;
            const ed = edRef.current;
            if (ed && pos !== undefined) ed.replace(pos, pos, "\n\n" + snippet + "\n");
            else insertBlock("\n\n" + snippet + "\n\n");
            setRunInit(null);
            setToast("运行输出已插入文档");
          }}
        />
      )}
      {stressInit && (
        <StressDialog
          initialGen={stressInit.gen}
          initialA={stressInit.a}
          initialB={stressInit.b}
          onClose={() => setStressInit(null)}
          onInsert={(snippet) => {
            insertBlock("\n\n" + snippet + "\n\n");
            setStressInit(null);
            setToast("反例已插入文档");
          }}
          onOpenRun={(init) => {
            setStressInit(null);
            setRunInit({ code: init.code, stdin: init.stdin, expected: init.expected });
          }}
          onAiGen={(a, b) => {
            const back = { a, b };
            setAiState({
              task: {
                title: "AI 写数据生成器",
                kickoff: `请根据下面【待测代码】的输入格式，写一个 C++ 随机数据生成器：从 stdin 读入一个整数种子、用 mt19937 生成小规模随机数据（保证格式合法、数值范围容易暴露 bug），只输出生成器代码本身（用 \`\`\`cpp 代码块包住），不要解释。\n\n【待测代码】\n\`\`\`cpp\n${b.slice(0, 6000)}\n\`\`\`${a.trim() ? `\n\n【标程（输入格式相同，可参考）】\n\`\`\`cpp\n${a.slice(0, 4000)}\n\`\`\`` : ""}`,
              },
              apply: {
                label: "填入生成器",
                run: (t) => {
                  const code2 = stripCodeFence(t);
                  setAiState(null);
                  setStressInit(null);
                  requestAnimationFrame(() => setStressInit({ gen: code2, a: back.a, b: back.b }));
                  setToast("已把 AI 写的生成器填入对拍");
                },
              },
            });
          }}
          onAiAnalyze={({ a, b, input, outA, outB }) => {
            setStressInit(null);
            setAiState({
              task: {
                title: "AI 分析反例",
                kickoff: `对拍发现待测代码 B 在一组数据上和标程 A 输出不一致，请分析 B 最可能错在哪，并给出改法。\n\n标程 A：\n\`\`\`cpp\n${a.slice(0, 5000)}\n\`\`\`\n\n待测 B：\n\`\`\`cpp\n${b.slice(0, 5000)}\n\`\`\`\n\n反例输入：\n\`\`\`text\n${input.slice(0, 2000)}\n\`\`\`\n\nA 输出：\n\`\`\`text\n${outA.slice(0, 1000)}\n\`\`\`\n\nB 输出：\n\`\`\`text\n${outB.slice(0, 1000)}\n\`\`\``,
              },
            });
          }}
        />
      )}
      {mathOpen && (
        <MathEditor
          onClose={() => setMathOpen(false)}
          onInsert={(tex, display) => {
            if (display) insertBlock("\n\n$$\n" + tex + "\n$$\n\n");
            else insertAtCaret("$" + tex + "$");
            setToast("公式已插入");
          }}
        />
      )}
      {versionsOpen && (
        <VersionsDialog
          versions={versions}
          currentText={text}
          onClose={() => setVersionsOpen(false)}
          onSave={() => {
            pushVersion("手动保存", text);
            setToast("已保存新版本");
          }}
          onRestore={(v) => {
            pushVersion("恢复前自动保存", text);
            edRef.current?.replaceAll(v.text);
            setVersionsOpen(false);
            setToast("已恢复到：" + v.name);
          }}
          onDelete={(id) => setVersions((vs) => vs.filter((x) => x.id !== id))}
          onRunVersion={(v) => {
            const all = extractCodeBlocks(v.text);
            const first = all.filter((b) => isCppLang(b.lang))[0];
            if (!first) {
              setToast("这个版本里没有 C++ 代码块");
              return;
            }
            setVersionsOpen(false);
            const init = buildRunInit(first, all, false);
            if (init) setRunInit(init);
          }}
          onCompare={(v) => {
            setDiffInit({ a: v.text, b: text });
            setVersionsOpen(false);
            setDiffOpen(true);
          }}
        />
      )}
      {paletteOpen && <Palette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
    </div>
  );
}

type PaletteIcon = typeof Command;

interface PaletteCmd {
  id: string;
  title: string;
  desc: string;
  category: string;
  keywords: string;
  shortcut?: string;
  icon: PaletteIcon;
  run(): void;
}

const PALETTE_CATEGORY_ORDER = ["最近使用", "插入", "文档", "检查", "视图", "导出", "主题", "模板", "帮助"];
const PALETTE_SUGGESTIONS = ["图示", "公式", "PDF", "导出", "主题", "检查"];

function isSubsequence(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i >= needle.length) return true;
  }
  return needle.length === 0;
}

function paletteScore(cmd: PaletteCmd, q: string): number {
  if (!q) return 0;
  const title = cmd.title.toLowerCase();
  const hay = `${cmd.title} ${cmd.desc} ${cmd.category} ${cmd.keywords}`.toLowerCase();
  if (title.startsWith(q)) return 0;
  if (title.includes(q)) return 1;
  if (cmd.keywords.toLowerCase().includes(q)) return 2;
  if (cmd.category.toLowerCase().includes(q)) return 3;
  if (cmd.desc.toLowerCase().includes(q)) return 4;
  if (isSubsequence(hay, q)) return 6;
  return Infinity;
}

interface PaletteEntry {
  cmd: PaletteCmd;
  heading?: string;
}

function Palette({ commands, onClose }: { commands: PaletteCmd[]; onClose(): void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("moxu:palette-recent") ?? "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
    } catch {
      return [];
    }
  });

  const shown = useMemo<PaletteEntry[]>(() => {
    const kw = q.trim().toLowerCase();
    if (kw) {
      return commands
        .map((cmd, index) => ({ cmd, index, score: paletteScore(cmd, kw) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map(({ cmd }) => ({ cmd }));
    }
    const entries: PaletteEntry[] = [];
    const used = new Set<string>();
    const recent = recentIds
      .map((id) => commands.find((c) => c.id === id))
      .filter((c): c is PaletteCmd => !!c)
      .slice(0, 5);
    recent.forEach((cmd, i) => {
      entries.push({ cmd, heading: i === 0 ? "最近使用" : undefined });
      used.add(cmd.id);
    });
    for (const category of PALETTE_CATEGORY_ORDER) {
      if (category === "最近使用") continue;
      let first = true;
      for (const cmd of commands) {
        if (cmd.category !== category || used.has(cmd.id)) continue;
        entries.push({ cmd, heading: first ? category : undefined });
        first = false;
        used.add(cmd.id);
      }
    }
    return entries;
  }, [commands, q, recentIds]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    setSel((v) => Math.min(v, Math.max(0, shown.length - 1)));
  }, [shown.length]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-palette-index="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel, shown]);

  const runAt = (i: number) => {
    const cmd = shown[i]?.cmd;
    if (!cmd) return;
    const next = [cmd.id, ...recentIds.filter((x) => x !== cmd.id)].slice(0, 6);
    try {
      localStorage.setItem("moxu:palette-recent", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setRecentIds(next);
    cmd.run();
    onClose();
  };

  const selected = shown[sel]?.cmd;

  return (
    <div className="modal-mask palette-mask" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <span className="palette-search-icon">
            <Command size={16} />
          </span>
          <input
            autoFocus
            className="palette-input"
            placeholder="搜索功能：图示、PDF、导出、主题、检查…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => (shown.length ? (v + 1) % shown.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => (shown.length ? (v - 1 + shown.length) % shown.length : 0));
              } else if (e.key === "PageDown") {
                e.preventDefault();
                setSel((v) => Math.min(shown.length - 1, v + 6));
              } else if (e.key === "PageUp") {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 6));
              } else if (e.key === "Home") {
                e.preventDefault();
                setSel(0);
              } else if (e.key === "End") {
                e.preventDefault();
                setSel(Math.max(0, shown.length - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(sel);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            aria-label="命令搜索"
            aria-expanded={shown.length > 0}
          />
          <span className="palette-count">{shown.length} 项</span>
          <kbd className="palette-esc">Esc</kbd>
        </div>

        {!q && (
          <div className="palette-suggest" aria-label="常用搜索">
            <span>试试：</span>
            {PALETTE_SUGGESTIONS.map((x) => (
              <button key={x} onClick={() => setQ(x)}>
                {x}
              </button>
            ))}
          </div>
        )}

        <div className="palette-list thin" ref={listRef} role="listbox" aria-label="命令列表">
          {shown.map((entry, i) => {
            const c = entry.cmd;
            const Icon = c.icon;
            return (
              <div key={c.id}>
                {entry.heading && <div className="palette-group">{entry.heading}</div>}
                <button
                  data-palette-index={i}
                  role="option"
                  aria-selected={i === sel}
                  className={"palette-item" + (i === sel ? " sel" : "")}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => runAt(i)}
                >
                  <span className="palette-icon">
                    <Icon size={15} />
                  </span>
                  <span className="palette-main">
                    <span className="palette-title">{c.title}</span>
                    <span className="palette-desc">{c.desc}</span>
                  </span>
                  <span className="palette-cat">{c.category}</span>
                  {c.shortcut && <kbd className="palette-kbd">{c.shortcut}</kbd>}
                </button>
              </div>
            );
          })}
          {shown.length === 0 && (
            <div className="palette-empty">
              <div>没有找到匹配的功能。</div>
              <div className="palette-empty-tip">换个更短的词，比如「图」「PDF」「导出」；也可以清空搜索查看全部功能。</div>
              <button className="mini-btn" onClick={() => setQ("")}>
                清空搜索
              </button>
            </div>
          )}
        </div>

        <div className="palette-foot">
          <span className="palette-selected">
            {selected ? (
              <>
                <b>{selected.title}</b>
                <span>{selected.desc}</span>
              </>
            ) : (
              "选择一个功能查看说明"
            )}
          </span>
          <span className="palette-keys">
            <kbd>↑↓</kbd> 选择 <kbd>Enter</kbd> 执行 <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">快捷键与语法速查</div>
            <div className="modal-sub">工具栏里每个图标都有悬停提示，这里是一份完整清单。</div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>
        <div className="modal-grid">
          {SHORTCUTS.map((g) => (
            <div key={g.group} className="modal-group">
              <div className="modal-group-title">{g.group}</div>
              {g.items.map(([k, v]) => (
                <div key={k} className="modal-row">
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-foot">
          公式用 KaTeX 渲染，行内 <code>$x$</code> / <code>\(x\)</code>，行间 <code>$$…$$</code> / <code>\[…\]</code> / <code>{"\\begin{align}…"}</code>；
          列表与公式的缩进、编号、嵌套都会被规范检查一并考虑。
        </div>
      </div>
    </div>
  );
}
