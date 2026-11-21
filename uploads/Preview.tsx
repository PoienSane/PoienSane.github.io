import { forwardRef, memo, useLayoutEffect, useRef, type MutableRefObject } from "react";

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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html]);

    const onClick = (ev: React.MouseEvent) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-copy]");
      if (!btn) return;
      const code = btn.closest("figure")?.querySelector("pre")?.textContent ?? "";
      navigator.clipboard?.writeText(code).then(() => {
        btn.textContent = "已复制";
        setTimeout(() => (btn.textContent = "复制"), 1200);
      });
    };

    const onDbl = (ev: React.MouseEvent) => {
      const blkEl = (ev.target as HTMLElement).closest<HTMLElement>(".blk");
      if (!blkEl) return;
      const blk = blocksRef.current.find((b) => b.el === blkEl);
      if (!blk) return;
      const r = blkEl.getBoundingClientRect();
      onBlockDoubleClick(blk, Math.max(0, Math.min(1, (ev.clientY - r.top) / (r.height || 1))));
    };

    return (
      <div ref={ref} className="pv-scroll h-full w-full" onScroll={onScroll} onClick={onClick} onDoubleClick={onDbl}>
        <div ref={contentRef} className="md" />
      </div>
    );
  }),
);

export default Preview;
