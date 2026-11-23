import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Clipboard,
  Code,
  Copy,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  Italic,
  Keyboard,
  Link2,
  List,
  ListCheck,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  ListRestart,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Sigma,
  SquareCode,
  SquareSigma,
  Strikethrough,
  Table,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Diag } from "./lint";
import { DISPLAY_OPEN_RE, INLINE_MATH_SRC } from "./mathre";
import { normLang } from "./markdown";
import {
  MATH_TEMPLATES,
  TEMPLATES,
  applyList,
  backspaceAtStart,
  deleteLines,
  duplicateLines,
  imageCmd,
  indentList,
  insertTemplate,
  insertText,
  linkCmd,
  moveLines,
  newline,
  renumberList,
  setHeading,
  tab as tabCmd,
  toggleFence,
  toggleLineKind,
  toggleTask,
  wrapInline,
  type Doc,
} from "./commands";

export interface EditorHandle {
  ta: HTMLTextAreaElement | null;
  yAtLine(line: number): number;
  lineAtY(y: number): number;
  replace(from: number, to: number, text: string): void;
  replaceAll(text: string): void;
  jumpTo(from: number, to: number): void;
  focus(): void;
}

interface Props {
  value: string;
  diags: Diag[];
  fontSize: number;
  onChange(v: string): void;
  onScroll(): void;
  onCaret(): void;
  onShowHelp(): void;
}

// ---------------------------------------------------------------- 行内高亮

interface Seg {
  t: string;
  cls: string;
}

const INLINE_RULES: [RegExp, string][] = [
  [/`[^`\n]+`/g, "tk-ic"],
  [/!\[[^\]\n]*\]\([^)\n]*\)/g, "tk-img"],
  [/\[[^\]\n]*\]\([^)\n]*\)/g, "tk-link"],
  [/\*\*[^*\n]+\*\*/g, "tk-strong"],
  [/(^|[^*\w])\*[^*\n]+\*(?!\*)/g, "tk-em"],
  [/~~[^~\n]+~~/g, "tk-del"],
  [/<\/?[A-Za-z][^>\n]*>/g, "tk-html"],
];

const MATH_RE = new RegExp("(?<!\\\\)(?:" + INLINE_MATH_SRC + ")", "g");
const ENV_TOKEN_RE = /\\begin\{[A-Za-z*]+\}|\\end\{[A-Za-z*]+\}/g;

function paintLine(text: string, ctx: string): Seg[] {
  const n = text.length;
  if (n === 0) return [];
  const fill = new Array<string>(n).fill("");
  const mark = (s: number, e: number, cls: string) => {
    for (let k = Math.max(0, s); k < Math.min(n, e); k++) if (!fill[k]) fill[k] = cls;
  };

  for (const m of text.matchAll(ENV_TOKEN_RE)) mark(m.index!, m.index! + m[0].length, "tk-env");

  const [kind, arg] = ctx.split(":");
  let base = "";
  if (kind === "fence") {
    base = arg ? "tk-fence tk-" + arg : "tk-fence";
  } else if (kind === "code") {
    base = "tk-code";
  } else if (kind === "math") {
    base = "tk-math";
  } else {
    const q = /^(?:\s*>+\s?)+/.exec(text);
    if (q) mark(0, q[0].length, "tk-mark");
    const off = q ? q[0].length : 0;
    const li = /^(\s*)((?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)/.exec(text.slice(off));
    if (li) mark(off + li[1].length, off + li[1].length + li[2].length, "tk-mark-todo");
    const h = /^( {0,3})(#{1,6})(\s+)/.exec(text);
    if (h) {
      mark(0, h[1].length + h[2].length, "tk-hmark");
      base = "tk-h";
    }
    if (/^\s*\|/.test(text)) {
      for (let k = 0; k < n; k++) if (text[k] === "|") mark(k, k + 1, "tk-pipe");
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(text)) base = "tk-thead";
    }
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) base = "tk-hr";
    if (/^ {0,3}\$\$/.test(text)) base = "tk-math";
  }

  if (kind === "n" || kind === "h" || kind === "q") {
    for (const [re, cls] of INLINE_RULES) {
      for (const m of text.matchAll(re)) {
        const s = m.index! + (m[1] ? m[1].length : 0);
        mark(s, m.index! + m[0].length, cls);
      }
    }
    for (const m of text.matchAll(MATH_RE)) mark(m.index!, m.index! + m[0].length, "tk-math");
  }

  const out: Seg[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && fill[j] === fill[i]) j++;
    out.push({ t: text.slice(i, j), cls: (base + (fill[i] ? " " + fill[i] : "")).trim() });
    i = j;
  }
  return out;
}

const Line = memo(function Line({ text, ctx }: { text: string; ctx: string }) {
  const segs = useMemo(() => paintLine(text, ctx), [text, ctx]);
  if (!segs.length) return <div className="ln">{"\u200b"}</div>;
  return (
    <div className="ln">
      {segs.map((s, i) => (s.cls ? <span key={i} className={s.cls}>{s.t}</span> : s.t))}
    </div>
  );
});

// ---------------------------------------------------------------- 行模型

function useLineModel(value: string, diags: Diag[]) {
  return useMemo(() => {
    const lines = value.split("\n");
    const starts: number[] = [];
    let acc = 0;
    for (const l of lines) {
      starts.push(acc);
      acc += l.length + 1;
    }
    const ctx: string[] = [];
    let fence: { ch: string; len: number } | null = null;
    let display: string | null = null; // 尚未闭合的行间公式定界符
    for (const line of lines) {
      if (fence) {
        const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (m && m[1][0] === fence.ch && m[1].length >= fence.len) {
          fence = null;
          ctx.push("fence:");
        } else ctx.push("code");
        continue;
      }
      if (display) {
        if (line.includes(display)) display = null;
        ctx.push("math");
        continue;
      }
      const fm = line.match(/^ {0,3}(`{3,}|~{3,})\s*(\S*)/);
      if (fm) {
        fence = { ch: fm[1][0], len: fm[1].length };
        ctx.push("fence:" + normLang(fm[2]));
        continue;
      }
      const dm = DISPLAY_OPEN_RE.exec(line);
      if (dm) {
        const env = dm[1];
        const closeTok = env ? "\\end{" + env + "}" : dm[0].trimStart() === "$$" ? "$$" : "\\]";
        if (!line.slice(dm[0].length).includes(closeTok)) display = closeTok;
        ctx.push("math");
        continue;
      }
      if (/^ {0,3}#{1,6}\s/.test(line)) ctx.push("h");
      else if (/^\s*>/.test(line)) ctx.push("q");
      else ctx.push("n");
    }

    const per: string[][] = lines.map(() => []);
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
    for (const d of diags) {
      const l0 = lineOf(d.from);
      const l1 = lineOf(Math.max(d.from, d.to - 1));
      for (let l = l0; l <= l1; l++) {
        const s = Math.max(d.from, starts[l]) - starts[l];
        const e = Math.min(d.to, starts[l] + lines[l].length) - starts[l];
        if (e > s) per[l].push(`${s}-${e}${d.rule === "katex" ? "k" : ""}`);
      }
    }
    return { lines, ctx, dg: per.map((p) => p.join(",")) };
  }, [value, diags]);
}

function countLines(text: string, pos: number) {
  let n = 0;
  let i = -1;
  while ((i = text.indexOf("\n", i + 1)) >= 0 && i < pos) n++;
  return n;
}

// ---------------------------------------------------------------- 悬浮提示 / 菜单

function Tip({ label, hint, x, y }: { label: string; hint?: string; x: number; y: number }) {
  return createPortal(
    <div className="tb-tip" style={{ left: x, top: y }} role="tooltip">
      <span className="tb-tip-label">{label}</span>
      {hint && <span className="tb-tip-hint">{hint}</span>}
    </div>,
    document.body,
  );
}

interface BtnProps {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onClick?: () => void;
  onMenu?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

function TBtn({ icon: Icon, label, hint, onClick, onMenu }: BtnProps) {
  const groupRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = groupRef.current?.getBoundingClientRect();
      if (!r) return;
      setTip({ x: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110), y: r.bottom + 8 });
    }, 260);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const bind = {
    onMouseEnter: show,
    onMouseLeave: hide,
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => e.preventDefault(),
  };
  const split = Boolean(onClick && onMenu);

  return (
    <>
      <span ref={groupRef} className={"tb-slot" + (split ? " split" : "")}>
        <button
          type="button"
          className={"tb-btn" + (!onClick && onMenu ? " has-caret" : "")}
          aria-label={label}
          {...bind}
          onClick={(e) => {
            hide();
            if (onClick) onClick();
            else onMenu?.(e);
          }}
        >
          <Icon size={15} strokeWidth={1.9} />
          {!onClick && onMenu && <ChevronDown size={9} className="tb-caret" strokeWidth={2.6} />}
        </button>
        {split && (
          <button
            type="button"
            className="tb-btn tb-caret-btn"
            aria-label={label + "（更多）"}
            title=""
            {...bind}
            onClick={(e) => {
              hide();
              onMenu!(e);
            }}
          >
            <ChevronDown size={10} strokeWidth={2.6} />
          </button>
        )}
      </span>
      {tip && <Tip label={label} hint={hint} x={tip.x} y={tip.y} />}
    </>
  );
}

interface MenuItem {
  icon?: LucideIcon;
  text: string;
  hint?: string;
  run(): void;
}

function PopMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="pop tb-menu"
      style={{ left: Math.min(x, window.innerWidth - 200), top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          className="tb-menu-item"
          onClick={() => {
            it.run();
            onClose();
          }}
        >
          {it.icon ? <it.icon size={14} /> : <span className="tb-menu-dot" />}
          <span className="tb-menu-text">{it.text}</span>
          {it.hint && <span className="tb-menu-hint">{it.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- 编辑器

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { value, diags, fontSize, onChange, onScroll, onCaret, onShowHelp },
  ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const metrics = useRef<{ tops: number[]; hs: number[] }>({ tops: [], hs: [] });
  const model = useLineModel(value, diags);

  const tbRef = useRef<HTMLDivElement>(null);
  const [caretBox, setCaretBox] = useState<{ top: number; h: number } | null>(null);
  const [sb, setSb] = useState({ h: 0, y: 0, on: false, drag: false });
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [edge, setEdge] = useState("");

  const pendingSel = useRef<[number, number] | null>(null);
  const breakCoalesce = useRef(true);
  const applyingHistory = useRef(false);
  const lastRecord = useRef(0);
  const hist = useRef<{ list: { text: string; sel: [number, number] }[]; at: number }>({
    list: [{ text: value, sel: [0, 0] }],
    at: 0,
  });

  // ---------- 度量 ----------
  const measure = useCallback(() => {
    const kids = linesRef.current?.children;
    if (!kids) return;
    const tops: number[] = new Array(kids.length);
    const hs: number[] = new Array(kids.length);
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      tops[i] = el.offsetTop;
      hs[i] = el.offsetHeight;
    }
    metrics.current = { tops, hs };
  }, []);

  const syncBack = useCallback(() => {
    const ta = taRef.current;
    if (backRef.current && ta) {
      backRef.current.scrollTop = ta.scrollTop;
      backRef.current.scrollLeft = ta.scrollLeft;
    }
  }, []);

  const updateSb = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const track = ta.clientHeight;
    const ratio = track / Math.max(1, ta.scrollHeight);
    const h = Math.max(28, Math.round(track * ratio));
    const max = Math.max(1, ta.scrollHeight - ta.clientHeight);
    const y = Math.round((ta.scrollTop / max) * Math.max(0, track - h));
    setSb((s) => (s.h === h && s.y === y ? s : { ...s, h, y }));
  }, []);

  /** 当前光标所在行的底色条 */
  const paintCaretRow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const line = countLines(ta.value, ta.selectionStart);
    const { tops, hs } = metrics.current;
    if (!tops.length) return setCaretBox(null);
    const i = Math.min(line, tops.length - 1);
    setCaretBox((b) => (b && b.top === tops[i] && b.h === hs[i] ? b : { top: tops[i], h: hs[i] }));
  }, []);

  const handleSel = useCallback(() => {
    paintCaretRow();
    onCaret();
  }, [paintCaretRow, onCaret]);

  useLayoutEffect(() => {
    measure();
    syncBack();
    updateSb();
    paintCaretRow();
  }, [value, fontSize, measure, syncBack, updateSb, paintCaretRow]);

  // 键盘选中、拖拽选中、鼠标点选都会触发 selectionchange，统一在这里兜底
  useEffect(() => {
    let raf = 0;
    const onSel = () => {
      const ta = taRef.current;
      if (!ta || document.activeElement !== ta) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => handleSel());
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      cancelAnimationFrame(raf);
    };
  }, [handleSel]);

  // 工具栏：两端渐隐提示 + 滚轮横向滚动
  useEffect(() => {
    const el = tbRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const l = el.scrollLeft > 2;
      const r = el.scrollLeft < max - 2;
      const v = (l ? "l" : "") + (r ? "r" : "");
      setEdge((e) => (e === v ? e : v));
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      measure();
      syncBack();
      updateSb();
      paintCaretRow();
    });
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [measure, syncBack, updateSb, paintCaretRow]);

  // ---------- 文本应用 ----------
  const applyDoc = useCallback(
    (doc: Doc) => {
      const ta = taRef.current;
      if (!ta) return;
      breakCoalesce.current = true;
      if (doc.text === ta.value) {
        ta.setSelectionRange(doc.sel[0], doc.sel[1]);
        handleSel();
        return;
      }
      pendingSel.current = doc.sel;
      onChange(doc.text);
    },
    [onChange, handleSel],
  );

  const scrollCaretIntoView = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const line = countLines(ta.value, ta.selectionStart);
    const { tops, hs } = metrics.current;
    if (!tops.length) return;
    const l = Math.min(line, tops.length - 1);
    const y = tops[l];
    const h = hs[l] || 24;
    if (y < ta.scrollTop + 8 || y + h > ta.scrollTop + ta.clientHeight - 8) {
      ta.scrollTop = Math.max(0, y - ta.clientHeight * 0.42);
      syncBack();
      updateSb();
    }
  }, [syncBack, updateSb]);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    measure();
    const p = pendingSel.current;
    if (p) {
      pendingSel.current = null;
      ta.setSelectionRange(p[0], Math.min(p[1], ta.value.length));
      scrollCaretIntoView();
      syncBack();
      updateSb();
      handleSel();
    } else {
      paintCaretRow();
    }
  }, [value, measure, scrollCaretIntoView, syncBack, updateSb, handleSel, paintCaretRow]);

  // ---------- 撤销栈 ----------
  useEffect(() => {
    const ta = taRef.current;
    const h = hist.current;
    if (applyingHistory.current) {
      applyingHistory.current = false;
      return;
    }
    if (h.list[h.at]?.text === value) return;
    const now = Date.now();
    const sel: [number, number] = ta ? [ta.selectionStart, ta.selectionEnd] : [value.length, value.length];
    const top = h.list[h.at];
    const coalesce = !breakCoalesce.current && now - lastRecord.current < 520 && top && top.text.length > 0;
    breakCoalesce.current = false;
    if (coalesce) {
      top.text = value;
      top.sel = sel;
    } else {
      h.list = h.list.slice(0, h.at + 1);
      h.list.push({ text: value, sel });
      if (h.list.length > 300) h.list.shift();
      h.at = h.list.length - 1;
    }
    lastRecord.current = now;
  }, [value]);

  const jumpSnapshot = useCallback(
    (delta: -1 | 1) => {
      const h = hist.current;
      const target = h.at + delta;
      if (target < 0 || target >= h.list.length) return;
      h.at = target;
      const snap = h.list[target];
      breakCoalesce.current = true;
      const ta = taRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      if (snap.text !== ta.value) {
        applyingHistory.current = true;
        pendingSel.current = snap.sel;
        onChange(snap.text);
      } else {
        ta.setSelectionRange(snap.sel[0], snap.sel[1]);
        handleSel();
      }
    },
    [onChange, handleSel],
  );

  const undo = useCallback(() => jumpSnapshot(-1), [jumpSnapshot]);
  const redo = useCallback(() => jumpSnapshot(1), [jumpSnapshot]);

  // ---------- 命令 ----------
  const run = useCallback(
    (fn: (d: Doc) => Doc) => {
      const ta = taRef.current;
      if (!ta) return;
      const doc: Doc = { text: ta.value, sel: [ta.selectionStart, ta.selectionEnd] };
      const out = fn(doc);
      if (out === doc) return;
      ta.focus({ preventScroll: true });
      applyDoc(out);
    },
    [applyDoc],
  );

  type MenuKind = "heading" | "lang" | "listBullet" | "listOrdered" | "listTask" | "mathInline" | "mathDisplay";

  const menuItems = (kind: MenuKind): MenuItem[] => {
    if (kind === "heading") {
      const icons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];
      return [
        { icon: Pilcrow, text: "正文", hint: "Ctrl+0", run: () => run((d) => setHeading(d, 0)) },
        ...icons.map((icon, i) => ({
          icon,
          text: `标题 ${i + 1}`,
          hint: `Ctrl+${i + 1}`,
          run: () => run((d) => setHeading(d, i + 1)),
        })),
      ];
    }
    if (kind === "lang") {
      return [
        { icon: SquareCode, text: "C++ 代码块", run: () => run((d) => toggleFence(d, "cpp")) },
        { icon: SquareCode, text: "Python 代码块", run: () => run((d) => toggleFence(d, "py")) },
        { icon: SquareCode, text: "纯文本块", run: () => run((d) => toggleFence(d, "text")) },
        { icon: Table, text: "插入表格", hint: "Ctrl+Alt+T", run: () => run((d) => insertTemplate(d, TEMPLATES.table())) },
      ];
    }
    if (kind === "listBullet") {
      return [
        { icon: List, text: "无序列表 · 短横线", hint: "-", run: () => run((d) => applyList(d, { kind: "bullet", bullet: "-" })) },
        { icon: List, text: "无序列表 · 星号", hint: "*", run: () => run((d) => applyList(d, { kind: "bullet", bullet: "*" })) },
        { icon: List, text: "无序列表 · 加号", hint: "+", run: () => run((d) => applyList(d, { kind: "bullet", bullet: "+" })) },
        { icon: ListTodo, text: "转为任务列表", run: () => run((d) => applyList(d, { kind: "task" })) },
        { icon: ListOrdered, text: "转为有序列表", run: () => run((d) => applyList(d, { kind: "ordered" })) },
        { icon: Pilcrow, text: "取消列表", run: () => run((d) => applyList(d, { kind: "none" })) },
      ];
    }
    if (kind === "listOrdered") {
      return [
        { icon: ListOrdered, text: "有序列表 1.", hint: "1.", run: () => run((d) => applyList(d, { kind: "ordered", delim: "." })) },
        { icon: ListOrdered, text: "有序列表 1)", hint: "1)", run: () => run((d) => applyList(d, { kind: "ordered", delim: ")" })) },
        { icon: ListRestart, text: "重新编号（按层级）", hint: "Ctrl+Shift+N", run: () => run(renumberList) },
        { icon: List, text: "转为无序列表", run: () => run((d) => applyList(d, { kind: "bullet" })) },
        { icon: Pilcrow, text: "取消列表", run: () => run((d) => applyList(d, { kind: "none" })) },
      ];
    }
    if (kind === "listTask") {
      return [
        { icon: ListTodo, text: "插入任务项 - [ ]", run: () => run((d) => applyList(d, { kind: "task" })) },
        { icon: ListCheck, text: "勾选 / 取消勾选", run: () => run((d) => toggleTask(d)) },
        { icon: List, text: "转为无序列表", run: () => run((d) => applyList(d, { kind: "bullet" })) },
        { icon: Pilcrow, text: "取消列表", run: () => run((d) => applyList(d, { kind: "none" })) },
      ];
    }
    if (kind === "mathInline") {
      const tpl = (make: () => string) => () => run((d) => insertText(d, make()));
      return [
        { icon: Sigma, text: "行内公式 $x$", hint: "Ctrl+M", run: () => run((d) => wrapInline(d, "$", "$", "x")) },
        { icon: Sigma, text: "行内公式 \\(x\\)", run: () => run((d) => wrapInline(d, "\\(", "\\)", "x")) },
        { icon: Sigma, text: "分式 \\frac{a}{b}", run: tpl(MATH_TEMPLATES.frac) },
        { icon: Sigma, text: "根号 \\sqrt{x}", run: tpl(MATH_TEMPLATES.sqrt) },
        { icon: Sigma, text: "求和 \\sum_{i=1}^{n}", run: tpl(MATH_TEMPLATES.sum) },
        { icon: Sigma, text: "连乘 \\prod_{i=1}^{n}", run: tpl(MATH_TEMPLATES.prod) },
        { icon: Sigma, text: "积分 \\int_{a}^{b}", run: tpl(MATH_TEMPLATES.integral) },
        { icon: Sigma, text: "极限 \\lim_{n\\to\\infty}", run: tpl(MATH_TEMPLATES.limit) },
        { icon: Sigma, text: "组合数 \\binom{n}{k}", run: tpl(MATH_TEMPLATES.binom) },
        { icon: Sigma, text: "函数名 \\operatorname{lca}", hint: "直立排版", run: tpl(MATH_TEMPLATES.operator) },
      ];
    }
    return [
      { icon: SquareSigma, text: "行间公式 $$ … $$", hint: "Ctrl+Shift+M", run: () => run((d) => insertTemplate(d, MATH_TEMPLATES.display())) },
      { icon: SquareSigma, text: "行间公式 \\[ … \\]", run: () => run((d) => insertTemplate(d, MATH_TEMPLATES.bracket())) },
      { icon: SquareSigma, text: "对齐环境 aligned", run: () => run((d) => insertTemplate(d, MATH_TEMPLATES.aligned())) },
      { icon: SquareSigma, text: "分段函数 cases", run: () => run((d) => insertTemplate(d, MATH_TEMPLATES.cases())) },
      { icon: SquareSigma, text: "矩阵 pmatrix", run: () => run((d) => insertTemplate(d, MATH_TEMPLATES.matrix())) },
      { icon: SquareSigma, text: "编号公式 equation", run: () => run((d) => insertTemplate(d, MATH_TEMPLATES.equation())) },
    ];
  };

  const openMenu = (kind: MenuKind) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 6, items: menuItems(kind) });
  };

  const pastePlain = async () => {
    const ta = taRef.current;
    if (!ta) return;
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      ta.focus({ preventScroll: true });
      applyDoc({ text: ta.value.slice(0, s) + t + ta.value.slice(e), sel: [s + t.length, s + t.length] });
    } catch {
      /* 剪贴板不可用 */
    }
  };

  // ---------- 键盘 ----------
  const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = ev.currentTarget;
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.nativeEvent.isComposing || ev.keyCode === 229) return; // 输入法组字中，交给 IME
    const k = ev.key.toLowerCase();

    if (mod && !ev.shiftKey && !ev.altKey) {
      const plain: Record<string, () => void> = {
        z: undo,
        y: redo,
        b: () => run((d) => wrapInline(d, "**", "**", "加粗文字")),
        i: () => run((d) => wrapInline(d, "*", "*", "斜体文字")),
        m: () => run((d) => wrapInline(d, "$", "$", "x")),
        k: () => run((d) => linkCmd(d)),
        "`": () => run((d) => wrapInline(d, "`", "`", "code")),
        "0": () => run((d) => setHeading(d, 0)),
        "1": () => run((d) => setHeading(d, 1)),
        "2": () => run((d) => setHeading(d, 2)),
        "3": () => run((d) => setHeading(d, 3)),
        "4": () => run((d) => setHeading(d, 4)),
        "5": () => run((d) => setHeading(d, 5)),
        "6": () => run((d) => setHeading(d, 6)),
        "/": onShowHelp,
      };
      if (plain[k]) {
        ev.preventDefault();
        plain[k]();
        return;
      }
    }
    if (mod && ev.altKey && k === "t") {
      ev.preventDefault();
      run((d) => insertTemplate(d, TEMPLATES.table()));
      return;
    }
    if (mod && ev.shiftKey && !ev.altKey) {
      const shiftMap: Record<string, () => void> = {
        z: redo,
        x: () => run((d) => wrapInline(d, "~~", "~~", "删除线")),
        m: () => run((d) => insertTemplate(d, MATH_TEMPLATES.display())),
        n: () => run(renumberList),
        d: () => run((d) => duplicateLines(d)),
        k: () => run((d) => deleteLines(d)),
        c: () => run((d) => toggleFence(d, "cpp")),
        ".": () => run((d) => toggleLineKind(d, "quote")),
        l: () => run((d) => toggleLineKind(d, "ordered")),
        u: () => run((d) => toggleLineKind(d, "bullet")),
        t: () => run((d) => toggleLineKind(d, "task")),
      };
      if (shiftMap[k]) {
        ev.preventDefault();
        shiftMap[k]();
        return;
      }
    }
    if (mod && !ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      run((d) => setHeading(d, ev.key === "ArrowUp" ? "up" : "down"));
      return;
    }
    if (ev.altKey && !mod && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      run((d) => moveLines(d, ev.key === "ArrowUp" ? -1 : 1));
      return;
    }
    if (ev.key === "Tab" && !mod && !ev.altKey) {
      ev.preventDefault();
      run((d) => tabCmd(d, ev.shiftKey));
      return;
    }
    if (ev.key === "Backspace" && !mod && !ev.altKey && ta.selectionStart === ta.selectionEnd) {
      const out = backspaceAtStart({ text: ta.value, sel: [ta.selectionStart, ta.selectionEnd] });
      if (out) {
        ev.preventDefault();
        applyDoc(out);
        return;
      }
    }
    if (ev.key === "Enter" && !mod && !ev.shiftKey && !ev.altKey) {
      const out = newline({ text: ta.value, sel: [ta.selectionStart, ta.selectionEnd] });
      if (out) {
        ev.preventDefault();
        applyDoc(out);
      }
    }
  };

  // ---------- 自绘滚动条 ----------
  const dragRef = useRef<{ startY: number; startTop: number; track: number; h: number } | null>(null);

  const onSbDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const ta = taRef.current;
    if (!ta) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startTop: ta.scrollTop, track: ta.clientHeight, h: sb.h };
    setSb((s) => ({ ...s, drag: true }));
  };
  const onSbMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const ta = taRef.current;
    if (!d || !ta) return;
    const max = Math.max(1, ta.scrollHeight - ta.clientHeight);
    ta.scrollTop = d.startTop + (e.clientY - d.startY) * (max / Math.max(1, d.track - d.h));
    syncBack();
    updateSb();
  };
  const onSbUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setSb((s) => ({ ...s, drag: false }));
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // ---------- 对外 ----------
  useImperativeHandle(ref, () => ({
    get ta() {
      return taRef.current;
    },
    focus() {
      taRef.current?.focus();
    },
    yAtLine(line: number) {
      const { tops, hs } = metrics.current;
      if (!tops.length) return 0;
      const l = Math.max(0, Math.min(tops.length - 1, Math.floor(line)));
      return tops[l] + (line - l) * hs[l];
    },
    lineAtY(y: number) {
      const { tops, hs } = metrics.current;
      if (!tops.length) return 0;
      let lo = 0;
      let hi = tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo + Math.max(0, Math.min(1, (y - tops[lo]) / (hs[lo] || 1)));
    },
    replace(from, to, text) {
      const ta = taRef.current;
      if (!ta) return;
      applyDoc({ text: ta.value.slice(0, from) + text + ta.value.slice(to), sel: [from + text.length, from + text.length] });
    },
    replaceAll(text) {
      applyDoc({ text, sel: [0, 0] });
    },
    jumpTo(from, to) {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(from, to);
      scrollCaretIntoView();
      syncBack();
      updateSb();
      handleSel();
    },
  }));

  return (
    <div className="ed-wrap" style={{ ["--fs" as string]: `${fontSize}px` }}>
      <div className="tb-wrap" data-edge={edge}>
        <div ref={tbRef} className="tb" role="toolbar" aria-label="Markdown 工具栏">
          <TBtn icon={Undo2} label="撤销" hint="Ctrl+Z" onClick={undo} />
          <TBtn icon={Redo2} label="重做" hint="Ctrl+Shift+Z" onClick={redo} />
          <span className="tb-sep" />
          <TBtn icon={ChevronsUp} label="提升标题一级" hint="H2 → H1 · Ctrl+↑" onClick={() => run((d) => setHeading(d, "up"))} />
          <TBtn icon={ChevronsDown} label="降低标题一级" hint="H1 → H2 · Ctrl+↓" onClick={() => run((d) => setHeading(d, "down"))} />
          <TBtn icon={Heading} label="标题级别" hint="正文 / H1–H6" onMenu={openMenu("heading")} />
          <span className="tb-sep" />
          <TBtn icon={Bold} label="加粗" hint="Ctrl+B" onClick={() => run((d) => wrapInline(d, "**", "**", "加粗文字"))} />
          <TBtn icon={Italic} label="斜体" hint="Ctrl+I" onClick={() => run((d) => wrapInline(d, "*", "*", "斜体文字"))} />
          <TBtn icon={Strikethrough} label="删除线" hint="Ctrl+Shift+X" onClick={() => run((d) => wrapInline(d, "~~", "~~", "删除线"))} />
          <TBtn icon={Code} label="行内代码" hint="Ctrl+`" onClick={() => run((d) => wrapInline(d, "`", "`", "code"))} />
          <TBtn
            icon={Sigma}
            label="行内公式"
            hint="Ctrl+M · $x$ 或 \\(x\\)"
            onClick={() => run((d) => wrapInline(d, "$", "$", "x"))}
            onMenu={openMenu("mathInline")}
          />
          <span className="tb-sep" />
          <TBtn icon={Quote} label="引用" hint="Ctrl+Shift+." onClick={() => run((d) => toggleLineKind(d, "quote"))} />
          <TBtn
            icon={List}
            label="无序列表"
            hint="Ctrl+Shift+U · - * +"
            onClick={() => run((d) => toggleLineKind(d, "bullet"))}
            onMenu={openMenu("listBullet")}
          />
          <TBtn
            icon={ListOrdered}
            label="有序列表"
            hint="Ctrl+Shift+L · 1. 1)"
            onClick={() => run((d) => toggleLineKind(d, "ordered"))}
            onMenu={openMenu("listOrdered")}
          />
          <TBtn
            icon={ListTodo}
            label="任务列表"
            hint="Ctrl+Shift+T · - [ ]"
            onClick={() => run((d) => toggleLineKind(d, "task"))}
            onMenu={openMenu("listTask")}
          />
          <TBtn icon={ListRestart} label="重新编号列表" hint="Ctrl+Shift+N · 按层级" onClick={() => run(renumberList)} />
          <TBtn icon={ListIndentIncrease} label="列表降一层" hint="Tab" onClick={() => run((d) => indentList(d, 1))} />
          <TBtn icon={ListIndentDecrease} label="列表升一层" hint="Shift+Tab" onClick={() => run((d) => indentList(d, -1))} />
          <span className="tb-sep" />
          <TBtn icon={Link2} label="插入链接" hint="Ctrl+K" onClick={() => run((d) => linkCmd(d))} />
          <TBtn icon={ImageIcon} label="插入图片" hint="![说明](地址)" onClick={() => run((d) => imageCmd(d))} />
          <TBtn icon={SquareCode} label="代码块" hint="Ctrl+Shift+C" onMenu={openMenu("lang")} />
          <TBtn
            icon={SquareSigma}
            label="行间公式"
            hint="Ctrl+Shift+M · $$ \\[ 环境"
            onClick={() => run((d) => insertTemplate(d, MATH_TEMPLATES.display()))}
            onMenu={openMenu("mathDisplay")}
          />
          <TBtn icon={Table} label="插入表格" hint="Ctrl+Alt+T" onClick={() => run((d) => insertTemplate(d, TEMPLATES.table()))} />
          <TBtn icon={Minus} label="分割线" hint="输入 ---" onClick={() => run((d) => insertTemplate(d, TEMPLATES.hr()))} />
          <span className="tb-sep" />
          <TBtn icon={ArrowUp} label="整行上移" hint="Alt+↑" onClick={() => run((d) => moveLines(d, -1))} />
          <TBtn icon={ArrowDown} label="整行下移" hint="Alt+↓" onClick={() => run((d) => moveLines(d, 1))} />
          <TBtn icon={Copy} label="复制当前行" hint="Ctrl+Shift+D" onClick={() => run((d) => duplicateLines(d))} />
          <TBtn icon={Trash2} label="删除当前行" hint="Ctrl+Shift+K" onClick={() => run((d) => deleteLines(d))} />
          <span className="tb-sep" />
          <TBtn icon={Clipboard} label="粘贴为纯文本" hint="去掉富文本格式" onClick={() => void pastePlain()} />
          <TBtn icon={Keyboard} label="快捷键与语法速查" hint="Ctrl+/" onClick={onShowHelp} />
        </div>
      </div>

      <div ref={bodyRef} className="ed-body">
        <div ref={backRef} className="ed-text ed-back" aria-hidden>
          {caretBox && <div className="ed-cur" style={{ top: caretBox.top, height: caretBox.h }} />}
          <div ref={linesRef}>
            {model.lines.map((l, i) => (
              <Line key={i} text={l} ctx={model.ctx[i]} />
            ))}
          </div>
        </div>
        <textarea
          ref={taRef}
          className="ed-text ed-input"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="soft"
          aria-label="Markdown 源码编辑区"
          placeholder="在这里书写 Markdown……"
          onChange={(e) => onChange(e.target.value)}
          onScroll={() => {
            syncBack();
            updateSb();
            setSb((s) => (s.on ? s : { ...s, on: true }));
            paintCaretRow();
            onScroll();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={handleSel}
          onClick={handleSel}
          onSelect={handleSel}
          onFocus={() => setSb((s) => ({ ...s, on: true }))}
          onBlur={() => setSb((s) => ({ ...s, on: false }))}
        />
        <div className={"ed-sb" + (sb.on || sb.drag ? " on" : "") + (sb.drag ? " drag" : "")} aria-hidden>
          <div
            className="ed-sb-thumb"
            style={{ height: sb.h, transform: `translateY(${sb.y}px)` }}
            onPointerDown={onSbDown}
            onPointerMove={onSbMove}
            onPointerUp={onSbUp}
            onPointerCancel={onSbUp}
          />
        </div>
      </div>

      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
});

export default Editor;
