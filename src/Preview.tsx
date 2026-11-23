import { forwardRef, memo, useCallback, useLayoutEffect, useRef, type MutableRefObject } from "react";

export interface Block {
  s: number;
  e: number;
  el: HTMLElement;
}

interface Props {
  html: string;
  blocksRef: MutableRefObject<Block[]>;
  onScroll(): void;
  onRendered(): void;
  onBlockDoubleClick(block: Block, ratio: number): void;
  /** 点击 C++ 代码块上的「运行」：参数是本文档第几段 C++ 代码（0 起） */
  onRunCode?: (cppIndex: number) => void;
  /** 点击 C++ 代码块上的「AI 讲解」 */
  onAiCode?: (cppIndex: number) => void;
}

const Preview = memo(
  forwardRef<HTMLDivElement, Props>(function Preview({ html, blocksRef, onScroll, onRendered, onBlockDoubleClick, onRunCode, onAiCode }, ref) {
    const contentRef = useRef<HTMLDivElement>(null);
    // 已折叠代码块的序号集合：预览重渲染后按序号恢复折叠状态，
    // 否则随便打一个字，折叠就被 innerHTML 重置，看起来像“折叠按钮没有用”
    const foldedRef = useRef<Set<string>>(new Set());

    useLayoutEffect(() => {
      const el = contentRef.current;
      if (!el) return;
      el.innerHTML = html;
      // 行号列已由渲染器（markdown.ts）生成，这里只做兜底补齐
      el.querySelectorAll<HTMLElement>("figure.code pre").forEach((pre) => {
        if (pre.querySelector(".code-ln")) return;
        const code = pre.querySelector("code");
        if (!code) return;
        const raw = code.textContent ?? "";
        const lines = Math.max(1, raw.replace(/\n$/, "").split("\n").length);
        const gutter = document.createElement("span");
        gutter.className = "code-ln";
        gutter.setAttribute("aria-hidden", "true");
        gutter.textContent = Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n");
        pre.insertBefore(gutter, code);
      });
      // C++ 代码块标题栏补「运行」按钮（渲染器不认识这个动作，导出 HTML 时也不会带上）
      el.querySelectorAll<HTMLElement>('figure.code[data-lang="c++"] figcaption').forEach((cap) => {
        if (cap.querySelector("[data-run]")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.run = "1";
        btn.title = "在线编译运行这段 C++（Judge0 / Wandbox）";
        btn.innerHTML = '<span aria-hidden="true">▶</span> <span>运行</span>';
        cap.insertBefore(btn, cap.querySelector("[data-fold]"));
        if (!cap.querySelector("[data-aicode]")) {
          const aiBtn = document.createElement("button");
          aiBtn.type = "button";
          aiBtn.dataset.aicode = "1";
          aiBtn.title = "让 AI 讲解这段代码的思路与复杂度";
          aiBtn.textContent = "AI 讲解";
          cap.insertBefore(aiBtn, cap.querySelector("[data-fold]"));
        }
      });
      // 恢复折叠状态（按“第几个代码块”记键，改代码内容也不会丢；增删代码块时可能串位，可接受）
      el.querySelectorAll<HTMLElement>("figure.code").forEach((fig, idx) => {
        const key = "fig" + idx;
        fig.dataset.fkey = key;
        if (foldedRef.current.has(key)) {
          fig.classList.add("collapsed");
          const label = fig.querySelector<HTMLElement>(".fold-label");
          if (label) label.textContent = "展开";
        }
      });
      blocksRef.current = Array.from(el.querySelectorAll<HTMLElement>(":scope > .blk")).map((b) => ({
        s: Number(b.dataset.s),
        e: Number(b.dataset.e),
        el: b,
      }));
      onRendered();
    }, [html, blocksRef, onRendered]);

    const onClick = useCallback((ev: React.MouseEvent) => {
      const target = ev.target as HTMLElement;
      // 外链在预览中点击时不要跳出编辑器
      const a = target.closest<HTMLAnchorElement>("a[href]");
      if (a && !a.getAttribute("href")?.startsWith("#")) {
        ev.preventDefault();
        window.open(a.href, "_blank", "noopener,noreferrer");
        return;
      }
      const aiBtn = target.closest<HTMLElement>("[data-aicode]");
      if (aiBtn) {
        const fig = aiBtn.closest("figure");
        const figs = Array.from(contentRef.current?.querySelectorAll('figure.code[data-lang="c++"]') ?? []);
        const idx = fig ? figs.indexOf(fig as HTMLElement) : -1;
        if (idx >= 0) onAiCode?.(idx);
        return;
      }
      const runBtn = target.closest<HTMLElement>("[data-run]");
      if (runBtn) {
        const fig = runBtn.closest("figure");
        const figs = Array.from(contentRef.current?.querySelectorAll('figure.code[data-lang="c++"]') ?? []);
        const idx = fig ? figs.indexOf(fig as HTMLElement) : -1;
        if (idx >= 0) onRunCode?.(idx);
        return;
      }
      const foldBtn = target.closest<HTMLElement>("[data-fold]");
      if (foldBtn) {
        const fig = foldBtn.closest("figure");
        if (fig) {
          const collapsed = fig.classList.toggle("collapsed");
          const key = fig.dataset.fkey ?? "fig0";
          if (collapsed) foldedRef.current.add(key);
          else foldedRef.current.delete(key);
          const label = foldBtn.querySelector<HTMLElement>(".fold-label");
          if (label) label.textContent = collapsed ? "展开" : "折叠";
        }
        return;
      }
      const btn = target.closest<HTMLElement>("[data-copy]");
      if (!btn) return;
      // 只复制 code 元素本身，行号列（.code-ln）在 pre 里但不在 code 里，不会混进剪贴板
      const code = btn.closest("figure")?.querySelector("code")?.textContent ?? "";
      const done = () => {
        btn.dataset.state = "done";
        const label = btn.querySelector<HTMLElement>(".copy-label");
        if (label) label.textContent = "已复制";
        window.setTimeout(() => {
          btn.dataset.state = "";
          if (label) label.textContent = "复制";
        }, 1400);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(done);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        document.body.append(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      }
    }, [onRunCode, onAiCode]);

    const onDbl = useCallback(
      (ev: React.MouseEvent) => {
        const blkEl = (ev.target as HTMLElement).closest<HTMLElement>(".blk");
        if (!blkEl) return;
        const blk = blocksRef.current.find((b) => b.el === blkEl);
        if (!blk) return;
        const r = blkEl.getBoundingClientRect();
        onBlockDoubleClick(blk, Math.max(0, Math.min(1, (ev.clientY - r.top) / (r.height || 1))));
      },
      [blocksRef, onBlockDoubleClick],
    );

    return (
      <div ref={ref} className="pv-scroll" onScroll={onScroll} onClick={onClick} onDoubleClick={onDbl}>
        <article ref={contentRef} className="md" />
      </div>
    );
  }),
);

export default Preview;
