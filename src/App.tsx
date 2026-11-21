import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpToLine,
  Check,
  ChevronDown,
  CircleAlert,
  Columns2,
  Crosshair,
  Download,
  FileText,
  FolderOpen,
  Keyboard,
  LayoutList,
  ListTree,
  Minus,
  PenLine,
  Plus,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import Editor, { type EditorHandle } from "./Editor";
import Preview, { type Block } from "./Preview";
import { renderMarkdown } from "./markdown";
import { applyAllFixes, lintMarkdown, RULE_LABEL, type Diag, type Rule } from "./lint";
import { DEFAULT_DOC, SKELETON } from "./templates";

type View = "edit" | "split" | "preview";

const THEMES: { id: string; name: string; sw: string }[] = [
  { id: "paper", name: "素白", sw: "linear-gradient(135deg,#ffffff 50%,#5b5bd6 50%)" },
  { id: "ink", name: "墨夜", sw: "linear-gradient(135deg,#15171b 50%,#8fa2ff 50%)" },
  { id: "sepia", name: "纸黄", sw: "linear-gradient(135deg,#f8f1e0 50%,#b4530a 50%)" },
  { id: "nord", name: "靛青", sw: "linear-gradient(135deg,#1b2230 50%,#88c0d0 50%)" },
  { id: "mint", name: "薄荷", sw: "linear-gradient(135deg,#f3f9f7 50%,#0e9b78 50%)" },
];

const RULES: Rule[] = ["punct", "end", "space", "latex", "katex"];

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
      ["Ctrl + Shift + P", "插入表格"],
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
  const wide = useWide();
  const eff: View = wide ? view : view === "preview" ? "preview" : "edit";

  const edRef = useRef<EditorHandle>(null);
  const pvRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<Block[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------- 派生 ----------
  const diags = useMemo(() => lintMarkdown(text), [text]);
  const deferred = useDeferredValue(text);
  const rendered = useMemo(() => renderMarkdown(deferred), [deferred]);
  const words = useMemo(() => {
    const han = (deferred.match(/[\u3400-\u9fff]/g) || []).length;
    const en = (deferred.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
    return han + en;
  }, [deferred]);
  const counts = useMemo(() => {
    const c: Record<Rule, number> = { punct: 0, end: 0, space: 0, latex: 0, katex: 0 };
    for (const d of diags) c[d.rule]++;
    return c;
  }, [diags]);
  const fixable = useMemo(() => diags.filter((d) => d.fix).length, [diags]);
  const shown = useMemo(() => (filter === "all" ? diags : diags.filter((d) => d.rule === filter)), [diags, filter]);
  const atCaret = useMemo(() => diags.filter((d) => caret.pos >= d.from && caret.pos <= d.to).slice(0, 2), [diags, caret.pos]);

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

  const insertSkeleton = () => {
    const ed = edRef.current;
    const ta = ed?.ta;
    if (!ed || !ta) return;
    if (text.trim() === "") {
      ed.replaceAll(`# 题号 题解\n\n${SKELETON}`);
    } else {
      const pos = ta.selectionStart;
      const before = text.slice(0, pos);
      const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      ed.replace(pos, ta.selectionEnd, `${lead}${SKELETON}\n`);
    }
    setToast("已插入题解骨架");
  };

  const loadFile = async (f: File) => {
    const t = (await f.text()).replace(/\r\n?/g, "\n");
    edRef.current?.replaceAll(t);
    setName(f.name);
    setToast(`已打开 ${f.name}`);
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
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (e.key === "Escape") {
        setHelp(false);
        setOutline(false);
        setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ok = diags.length === 0;

  return (
    <div
      className="app"
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
        if (f) loadFile(f);
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

        <div className="topbar-group">
          <button className="bar-btn" onClick={() => fileRef.current?.click()} title="打开 .md 文件（也可以直接拖进窗口）">
            <FolderOpen size={14} />
            <span className="lbl">打开</span>
          </button>
          <button className="bar-btn" onClick={download} title="导出 Markdown（Ctrl+S）">
            <Download size={14} />
            <span className="lbl">导出</span>
          </button>
          <button className="bar-btn" onClick={insertSkeleton} title="插入题解骨架：题意 / 思路 / 证明 / 复杂度 / 双语言代码">
            <Sparkles size={14} />
            <span className="lbl">题解骨架</span>
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
      </header>

      <main className="main">
        <section className={"pane-editor" + (eff === "split" ? " split" : "")} style={{ display: eff === "preview" ? "none" : "flex" }}>
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

        <section className="pane-preview" style={{ display: eff === "edit" ? "none" : "block" }}>
          <Preview
            ref={pvRef}
            html={rendered.html}
            blocksRef={blocksRef}
            onScroll={syncFromPreview}
            onRendered={onRendered}
            onBlockDoubleClick={onBlockDoubleClick}
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
            {shown.length === 0 && (
              <div className="drawer-empty">
                <Check size={15} style={{ color: "var(--ok)" }} /> 这一类没有问题，继续保持。
              </div>
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
        <span className="topbar-spacer" />
        <span className="status-hint">
          <Keyboard size={12} />
          Ctrl+/ 快捷键
        </span>
        <span className="status-sep" />
        <span className="status-save">{saved ? "已自动保存" : "保存中…"}</span>
      </footer>

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = "";
        }}
      />

      {help && <HelpDialog onClose={() => setHelp(false)} />}
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
