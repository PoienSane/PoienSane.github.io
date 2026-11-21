import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FolderOpen,
  ListTree,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
  Minus,
  Plus,
} from "lucide-react";
import Editor, { type EditorHandle } from "./Editor";
import Preview, { type Block } from "./Preview";
import { renderMarkdown } from "./markdown";
import { applyAllFixes, lintMarkdown, RULE_LABEL, type Diag, type Rule } from "./lint";
import { DEFAULT_DOC, SKELETON } from "./templates";

type View = "edit" | "split" | "preview";

const THEMES: { id: string; name: string; sw: string }[] = [
  { id: "paper", name: "素白", sw: "linear-gradient(135deg,#ffffff 50%,#4f46e5 50%)" },
  { id: "ink", name: "墨夜", sw: "linear-gradient(135deg,#15171b 50%,#8b9cff 50%)" },
  { id: "sepia", name: "纸黄", sw: "linear-gradient(135deg,#f8f1e0 50%,#b45309 50%)" },
  { id: "nord", name: "靛青", sw: "linear-gradient(135deg,#1d2433 50%,#88c0d0 50%)" },
  { id: "mint", name: "薄荷", sw: "linear-gradient(135deg,#f3f9f7 50%,#0f9b7a 50%)" },
];

const RULES: Rule[] = ["punct", "end", "space", "latex", "katex"];

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
  const [fontSize, setFontSize] = useState(() => Number(ls.get("fs", "14")));
  const [view, setView] = useState<View>(() => ls.get("view", "split") as View);
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState<Rule | "all">("all");
  const [outline, setOutline] = useState(false);
  const [caret, setCaret] = useState({ pos: 0, line: 0, col: 0 });
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saved, setSaved] = useState(true);
  const wide = useWide();
  const eff: View = wide ? view : view === "split" ? "edit" : view;

  const edRef = useRef<EditorHandle>(null);
  const pvRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<Block[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------- 派生数据 ----------
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
  const caretTs = useRef(0);
  const suppressCaret = useRef(0);
  const caretLine = useRef(0);

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
    const line = caretLine.current;
    setActiveBlock(line);
    if (Date.now() < suppressCaret.current) return;
    const y = previewY(line + 0.5);
    const top = pv.scrollTop;
    const h = pv.clientHeight;
    if (y < top + h * 0.12 || y > top + h * 0.72) {
      owner.current = { who: "e", until: Date.now() + 140 };
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
    if (now - caretTs.current < 150) return; // 输入产生的自动滚动交给光标同步处理
    owner.current = { who: "e", until: now + 140 };
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
    owner.current = { who: "p", until: now + 140 };
    if (pv.scrollTop <= 0) ta.scrollTop = 0;
    else if (pv.scrollTop + pv.clientHeight >= pv.scrollHeight - 2) ta.scrollTop = ta.scrollHeight;
    else ta.scrollTop = Math.max(0, ed.yAtLine(lineForPreviewY(pv.scrollTop + 4)) - 4);
  }, [lineForPreviewY]);

  const handleCaret = useCallback(() => {
    const ta = edRef.current?.ta;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const line = before.split("\n").length - 1;
    const col = pos - (before.lastIndexOf("\n") + 1);
    caretLine.current = line;
    setCaret((c) => (c.pos === pos && c.line === line && c.col === col ? c : { pos, line, col }));
    caretTs.current = Date.now();
    syncCaret();
  }, [syncCaret]);

  const onRendered = useCallback(() => {
    owner.current = { who: "e", until: Date.now() + 150 }; // 忽略重绘引发的滚动事件
    if (Date.now() - caretTs.current < 1500) syncCaret();
    else setActiveBlock(caretLine.current);
  }, [syncCaret, setActiveBlock]);

  const onBlockDoubleClick = useCallback(
    (b: Block, ratio: number) => {
      const ed = edRef.current;
      const ta = ed?.ta;
      if (!ed || !ta) return;
      const line = Math.min(b.e - 1, b.s + Math.floor(ratio * (b.e - b.s)));
      const from = lineStart(ta.value, line);
      const to = lineStart(ta.value, line + 1) - 1;
      suppressCaret.current = Date.now() + 400;
      ed.jumpTo(from, Math.max(from, to));
    },
    [],
  );

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
  };

  const jumpDiag = (d: Diag) => edRef.current?.jumpTo(d.from, d.to);

  const jumpLine = (line: number) => {
    const ta = edRef.current?.ta;
    if (!ta) return;
    const from = lineStart(ta.value, line);
    edRef.current?.jumpTo(from, from);
    setOutline(false);
    // 标题跳转时让预览也跟随
    suppressCaret.current = 0;
    caretTs.current = Date.now();
    syncCaret();
  };

  const ok = diags.length === 0;

  return (
    <div
      className="app flex h-full flex-col"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
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
      {/* 顶栏 */}
      <header
        className="relative z-20 flex h-11 shrink-0 items-center gap-1.5 px-3"
        style={{ background: "var(--bar)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="flex items-center gap-2 pr-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--bar)" }}
          >
            墨
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            className="w-36 rounded-md bg-transparent px-1.5 py-1 text-[13px] outline-none focus:bg-[var(--accent-soft)]"
            style={{ color: "var(--fg)" }}
          />
        </div>

        <button className="bar-btn" onClick={() => fileRef.current?.click()} title="打开 .md 文件（也可拖入窗口）">
          <FolderOpen size={14} />
          <span className="hidden sm:inline">打开</span>
        </button>
        <button className="bar-btn" onClick={download} title="下载 .md">
          <Download size={14} />
          <span className="hidden sm:inline">导出</span>
        </button>
        <button className="bar-btn" onClick={insertSkeleton} title="插入题解骨架：题意 / 思路 / 证明 / 复杂度 / 双语言代码">
          <Sparkles size={14} />
          <span className="hidden sm:inline">题解骨架</span>
        </button>
        <div className="relative">
          <button className={"bar-btn" + (outline ? " on" : "")} onClick={() => setOutline((o) => !o)} title="大纲">
            <ListTree size={14} />
            <span className="hidden md:inline">大纲</span>
          </button>
          {outline && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOutline(false)} />
              <div className="pop thin left-0 top-9 max-h-80 w-64 overflow-y-auto py-1.5">
                {rendered.headings.length === 0 && (
                  <div className="px-3 py-2 text-[12.5px]" style={{ color: "var(--fg2)" }}>
                    还没有标题
                  </div>
                )}
                {rendered.headings.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => jumpLine(h.line)}
                    className="block w-full truncate py-1 pr-3 text-left text-[12.5px] hover:bg-[var(--accent-soft)]"
                    style={{ paddingLeft: 12 + (h.depth - 1) * 12, color: h.depth === 1 ? "var(--fg)" : "var(--fg2)" }}
                  >
                    {h.text}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex-1" />

        <div className="hidden items-center gap-1.5 sm:flex">
          {THEMES.map((t) => (
            <button
              key={t.id}
              title={t.name}
              className={"swatch" + (theme === t.id ? " on" : "")}
              style={{ background: t.sw }}
              onClick={() => setTheme(t.id)}
            />
          ))}
        </div>
        <div className="mx-1 hidden items-center sm:flex">
          <button className="bar-btn !px-1.5" onClick={() => setFontSize((s) => Math.max(11, s - 1))} title="减小字号">
            <Minus size={13} />
          </button>
          <span className="w-6 text-center text-[12px]" style={{ color: "var(--fg2)" }}>
            {fontSize}
          </span>
          <button className="bar-btn !px-1.5" onClick={() => setFontSize((s) => Math.min(22, s + 1))} title="增大字号">
            <Plus size={13} />
          </button>
        </div>
        <div className="seg">
          <button className={eff === "edit" ? "on" : ""} onClick={() => setView("edit")}>
            编辑
          </button>
          {wide && (
            <button className={eff === "split" ? "on" : ""} onClick={() => setView("split")}>
              分栏
            </button>
          )}
          <button className={eff === "preview" ? "on" : ""} onClick={() => setView("preview")}>
            预览
          </button>
        </div>
      </header>

      {/* 主区域 */}
      <main className="relative flex min-h-0 flex-1">
        <section
          className="relative min-w-0 flex-1"
          style={{ display: eff === "preview" ? "none" : "block", borderRight: eff === "split" ? "1px solid var(--line)" : "none" }}
        >
          <Editor
            ref={edRef}
            value={text}
            diags={diags}
            fontSize={fontSize}
            onChange={onChange}
            onScroll={syncFromEditor}
            onCaret={handleCaret}
          />
          {atCaret.length > 0 && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-start">
              <div className="pop pointer-events-auto !static max-w-md space-y-1 px-3 py-2 text-[12.5px]">
                {atCaret.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: d.rule === "katex" ? "#f59e0b" : "var(--err)" }} />
                    <span className="flex-1 leading-5">{d.message}</span>
                    {d.fix && (
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFix(d)}
                        className="shrink-0 rounded-md px-2 py-0.5 text-[12px]"
                        style={{ background: "var(--accent)", color: "var(--bar)" }}
                      >
                        修复
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="min-w-0 flex-1" style={{ display: eff === "edit" ? "none" : "block" }}>
          <Preview
            ref={pvRef}
            html={rendered.html}
            blocksRef={blocksRef}
            onScroll={syncFromPreview}
            onRendered={onRendered}
            onBlockDoubleClick={onBlockDoubleClick}
          />
        </section>

        {dragging && (
          <div
            className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-2xl text-sm"
            style={{ border: "2px dashed var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            松开鼠标，打开 .md 文件
          </div>
        )}
        {toast && (
          <div
            className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full px-4 py-1.5 text-[12.5px] shadow-lg"
            style={{ background: "var(--fg)", color: "var(--bar)" }}
          >
            {toast}
          </div>
        )}
      </main>

      {/* 问题面板 */}
      {drawer && (
        <div className="shrink-0" style={{ background: "var(--bar)", borderTop: "1px solid var(--line)" }}>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>
              全部 {diags.length}
            </button>
            {RULES.map((r) => (
              <button key={r} className={"chip" + (filter === r ? " on" : "")} onClick={() => setFilter(r)}>
                {RULE_LABEL[r]} {counts[r]}
              </button>
            ))}
            <div className="flex-1" />
            <button className="bar-btn !px-1.5" onClick={() => setDrawer(false)} title="收起">
              <X size={14} />
            </button>
          </div>
          <div className="thin max-h-48 overflow-y-auto" style={{ borderTop: "1px solid var(--line)" }}>
            {shown.length === 0 && (
              <div className="flex items-center gap-2 px-4 py-4 text-[12.5px]" style={{ color: "var(--fg2)" }}>
                <Check size={14} style={{ color: "var(--accent)" }} /> 这一类没有问题。
              </div>
            )}
            {shown.map((d, i) => (
              <div key={i} className="drawer-row" onClick={() => jumpDiag(d)}>
                <span className="w-14 shrink-0 pt-px text-[11.5px]" style={{ color: "var(--fg2)", fontFamily: "'Fira Code', monospace" }}>
                  {d.line + 1}:{d.col + 1}
                </span>
                <span className="w-16 shrink-0 text-[11.5px]" style={{ color: d.rule === "katex" ? "#f59e0b" : "var(--err)" }}>
                  {RULE_LABEL[d.rule]}
                </span>
                <span className="min-w-0 flex-1 leading-5">{d.message}</span>
                {d.fix && (
                  <button
                    className="shrink-0 rounded-md px-2 text-[12px] leading-5"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      applyFix(d);
                    }}
                  >
                    修复
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 状态栏 */}
      <footer
        className="flex h-8 shrink-0 items-center gap-2 px-2 text-[12px]"
        style={{ background: "var(--bar)", borderTop: drawer ? "1px solid var(--line)" : "1px solid var(--line)", color: "var(--fg2)" }}
      >
        <button className={"bar-btn" + (drawer ? " on" : "")} onClick={() => setDrawer((d) => !d)} title="规范检查">
          {ok ? <Check size={14} style={{ color: "#16a34a" }} /> : <TriangleAlert size={14} style={{ color: "var(--err)" }} />}
          <span style={{ color: ok ? "#16a34a" : "var(--err)" }}>{ok ? "符合规范" : `${diags.length} 处问题`}</span>
        </button>
        {fixable > 0 && (
          <button className="bar-btn" onClick={fixAll} title="自动修复全部可修复的问题">
            <Wrench size={13} />
            一键修复 {fixable}
          </button>
        )}
        <div className="flex-1" />
        <span className="hidden sm:inline">
          行 {caret.line + 1}，列 {caret.col + 1}
        </span>
        <span>{words} 字</span>
        <span className="hidden sm:inline">{saved ? "已自动保存" : "保存中…"}</span>
      </footer>

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
