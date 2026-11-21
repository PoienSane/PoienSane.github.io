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
}

const Preview = memo(
  forwardRef<HTMLDivElement, Props>(function Preview({ html, blocksRef, onScroll, onRendered, onBlockDoubleClick }, ref) {
    const contentRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const el = contentRef.current;
      if (!el) return;
      el.innerHTML = html;
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
      const btn = target.closest<HTMLElement>("[data-copy]");
      if (!btn) return;
      const code = btn.closest("figure")?.querySelector("pre")?.textContent ?? "";
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
    }, []);

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
