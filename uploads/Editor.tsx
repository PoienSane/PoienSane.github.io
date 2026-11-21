import {
  forwardRef,
  memo,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from "react";
import type { Diag } from "./lint";
import { INLINE_MATH_SRC } from "./mathre";
import { normLang } from "./markdown";

export interface EditorHandle {
  ta: HTMLTextAreaElement | null;
  yAtLine(line: number): number;
  lineAtY(y: number): number;
  replace(from: number, to: number, text: string, selFrom?: number, selTo?: number): void;
  replaceAll(text: string): void;
  jumpTo(from: number, to: number): void;
}

interface Props {
  value: string;
  diags: Diag[];
  fontSize: number;
  onChange(v: string): void;
  onScroll(): void;
  onCaret(): void;
}

// ---------- 行级高亮 ----------
interface Range {
  s: number;
  e: number;
  cls: string;
}

const Line = memo(function Line({ text, ctx, dg }: { text: string; ctx: string; dg: string }) {
  const segs = useMemo(() => {
    let base = "";
    const inl: Range[] = [];
    const [kind, arg] = ctx.split(":");
    if (kind === "fence") base = "tk-fence " + (arg || "");
    else if (kind === "code") base = "tk-code";
    else if (kind === "math") base = "tk-math";
    else {
      let off = 0;
      if (kind === "h") base = "tk-h";
      if (kind === "q") {
        const m = text.match(/^(\s*>\s?)+/);
        if (m) {
          inl.push({ s: 0, e: m[0].length, cls: "tk-mark" });
          off = m[0].length;
          base = "tk-quote";
        }
      }
      if (kind === "n" || kind === "q") {
        const m = text.slice(off).match(/^\s*(?:[-*+]|\d{1,9}[.)])\s/);
        if (m) inl.push({ s: off, e: off + m[0].length, cls: "tk-mark" });
      }
      const taken: boolean[] = new Array(text.length).fill(false);
      for (const x of text.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)) {
        inl.push({ s: x.index!, e: x.index! + x[0].length, cls: "tk-ic" });
        for (let k = x.index!; k < x.index! + x[0].length; k++) taken[k] = true;
      }
      for (const x of text.matchAll(new RegExp("(?<!\\\\)(?:" + INLINE_MATH_SRC + ")", "g"))) {
        if (taken[x.index!]) continue;
        inl.push({ s: x.index!, e: x.index! + x[0].length, cls: "tk-math" });
      }
    }
    // 诊断区间
    const dr: { s: number; e: number; k: boolean }[] = [];
    if (dg) {
      for (const part of dg.split(",")) {
        const m = part.match(/^(\d+)-(\d+)(k?)$/);
        if (m) dr.push({ s: +m[1], e: +m[2], k: m[3] === "k" });
      }
    }
    const pts = new Set<number>([0, text.length]);
    for (const r of inl) {
      pts.add(r.s);
      pts.add(r.e);
    }
    for (const r of dr) {
      pts.add(Math.min(r.s, text.length));
      pts.add(Math.min(r.e, text.length));
    }
    const sorted = [...pts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
    const out: { t: string; cls: string }[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a === b) continue;
      let cls = base;
      for (const r of inl) if (r.s <= a && r.e >= b) cls += " " + r.cls;
      for (const r of dr) if (r.s <= a && r.e >= b) cls += r.k ? " dg katex-e" : " dg";
      out.push({ t: text.slice(a, b), cls });
    }
    return out;
  }, [text, ctx, dg]);

  return (
    <div className="ln">
      {segs.length === 0 ? "\u200b" : segs.map((s, i) => (s.cls.trim() ? <span key={i} className={s.cls.trim()}>{s.t}</span> : s.t))}
    </div>
  );
});

function useLineModel(value: string, diags: Diag[]) {
  return useMemo(() => {
    const lines = value.split("\n");
    const starts: number[] = [];
    let acc = 0;
    for (const l of lines) {
      starts.push(acc);
      acc += l.length + 1;
    }
    // 上下文
    const ctx: string[] = [];
    let fence: { ch: string; len: number } | null = null;
    let display = false;
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
        if (line.includes("$$")) display = false;
        ctx.push("math");
        continue;
      }
      const fm = line.match(/^ {0,3}(`{3,}|~{3,})\s*(\S*)/);
      if (fm) {
        fence = { ch: fm[1][0], len: fm[1].length };
        ctx.push("fence:" + normLang(fm[2]));
        continue;
      }
      if (/^ {0,3}\$\$/.test(line)) {
        if (line.indexOf("$$", line.search(/\$\$/) + 2) < 0) display = true;
        ctx.push("math");
        continue;
      }
      if (/^ {0,3}#{1,6}\s/.test(line)) ctx.push("h");
      else if (/^\s*>/.test(line)) ctx.push("q");
      else ctx.push("n");
    }
    // 诊断分行
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

// ---------- 组件 ----------
const Editor = forwardRef<EditorHandle, Props>(function Editor({ value, diags, fontSize, onChange, onScroll, onCaret }, ref) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const metrics = useRef<{ tops: number[]; hs: number[] }>({ tops: [], hs: [] });
  const model = useLineModel(value, diags);

  const measure = () => {
    const back = backRef.current;
    if (!back) return;
    const kids = back.firstElementChild?.children;
    if (!kids) return;
    const tops: number[] = new Array(kids.length);
    const hs: number[] = new Array(kids.length);
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      tops[i] = el.offsetTop;
      hs[i] = el.offsetHeight;
    }
    metrics.current = { tops, hs };
  };

  useLayoutEffect(measure, [value, fontSize]);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const syncBack = () => {
    if (backRef.current && taRef.current) backRef.current.scrollTop = taRef.current.scrollTop;
  };
  useLayoutEffect(syncBack);

  const exec = (from: number, to: number, text: string) => {
    const ta = taRef.current!;
    ta.focus();
    ta.setSelectionRange(from, to);
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      ta.setRangeText(text, from, to, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  useImperativeHandle(ref, () => ({
    get ta() {
      return taRef.current;
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
    replace(from, to, text, selFrom, selTo) {
      exec(from, to, text);
      const ta = taRef.current!;
      if (selFrom !== undefined) ta.setSelectionRange(selFrom, selTo ?? selFrom);
      onCaret();
    },
    replaceAll(text) {
      exec(0, taRef.current!.value.length, text);
      onCaret();
    },
    jumpTo(from, to) {
      const ta = taRef.current!;
      ta.focus();
      ta.setSelectionRange(from, to);
      const line = ta.value.slice(0, from).split("\n").length - 1;
      const { tops, hs } = metrics.current;
      if (tops.length) {
        const y = tops[Math.min(line, tops.length - 1)] + (hs[Math.min(line, hs.length - 1)] || 0) / 2;
        const target = Math.max(0, y - ta.clientHeight * 0.4);
        // 仅当目标不在视野内时滚动
        if (y < ta.scrollTop + 40 || y > ta.scrollTop + ta.clientHeight - 60) ta.scrollTop = target;
      }
      syncBack();
      onCaret();
    },
  }));

  const wrapSel = (open: string, close = open) => {
    const ta = taRef.current!;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
      const inner = sel.slice(open.length, sel.length - close.length);
      exec(s, e, inner);
      ta.setSelectionRange(s, s + inner.length);
    } else {
      exec(s, e, open + sel + close);
      ta.setSelectionRange(s + open.length, s + open.length + sel.length);
    }
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = ev.currentTarget;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && !ev.shiftKey && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === "b") {
        ev.preventDefault();
        wrapSel("**");
        return;
      }
      if (k === "i") {
        ev.preventDefault();
        wrapSel("*");
        return;
      }
      if (k === "m") {
        ev.preventDefault();
        wrapSel("$");
        return;
      }
    }
    if (ev.key === "Tab" && !ev.shiftKey && !mod) {
      ev.preventDefault();
      exec(ta.selectionStart, ta.selectionEnd, "  ");
      return;
    }
    if (ev.key === "Enter" && !mod && !ev.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const pos = ta.selectionStart;
      const ls = ta.value.lastIndexOf("\n", pos - 1) + 1;
      const line = ta.value.slice(ls, pos);
      const m = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
      if (m && !/^\s*(\*\*|---|\*\*\*)/.test(line)) {
        ev.preventDefault();
        if (m[3].trim() === "") {
          exec(ls, pos, "");
        } else {
          const marker = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
          exec(pos, pos, `\n${m[1]}${marker} `);
        }
      }
    }
  };

  return (
    <div ref={wrapRef} className="ed-wrap h-full w-full" style={{ ["--fs" as string]: `${fontSize}px` }}>
      <div ref={backRef} className="ed-text ed-back" aria-hidden>
        <div>
          {model.lines.map((l, i) => (
            <Line key={i} text={l} ctx={model.ctx[i]} dg={model.dg[i]} />
          ))}
        </div>
      </div>
      <textarea
        ref={taRef}
        className="ed-text"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="soft"
        placeholder="在这里书写 Markdown……"
        onChange={(e) => onChange(e.target.value)}
        onScroll={() => {
          syncBack();
          onScroll();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onCaret}
        onClick={onCaret}
        onSelect={onCaret}
      />
    </div>
  );
});

export default Editor;
