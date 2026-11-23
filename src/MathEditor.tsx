import { useMemo, useRef, useState } from "react";
import katex from "katex";
import { Star, X } from "lucide-react";
import { MATH_MACROS } from "./mathre";
import { renderMath } from "./markdown";

interface Props {
  onClose(): void;
  onInsert(tex: string, display: boolean): void;
}

const SYMBOLS: { label: string; snippet: string }[] = [
  { label: "\\frac{a}{b}", snippet: "\\frac{a}{b}" },
  { label: "\\sqrt{x}", snippet: "\\sqrt{}" },
  { label: "\\sum", snippet: "\\sum_{i=1}^{n}" },
  { label: "\\prod", snippet: "\\prod_{i=1}^{n}" },
  { label: "\\int", snippet: "\\int_{a}^{b}" },
  { label: "\\lim", snippet: "\\lim_{n \\to \\infty}" },
  { label: "\\binom{n}{k}", snippet: "\\binom{n}{k}" },
  { label: "x^{2}", snippet: "^{}" },
  { label: "x_{i}", snippet: "_{}" },
  { label: "\\le", snippet: "\\le " },
  { label: "\\ge", snippet: "\\ge " },
  { label: "\\ne", snippet: "\\ne " },
  { label: "\\infty", snippet: "\\infty" },
  { label: "\\alpha", snippet: "\\alpha" },
  { label: "\\beta", snippet: "\\beta" },
  { label: "\\log", snippet: "\\log" },
  { label: "\\gcd", snippet: "\\gcd" },
  { label: "\\operatorname", snippet: "\\operatorname{}" },
  { label: "\\mathrm{d}", snippet: "\\mathrm{d}" },
  { label: "\\left(", snippet: "\\left( \\right)" },
];

const TEMPLATES: { name: string; tex: string; display: boolean }[] = [
  { name: "求和公式", tex: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}", display: true },
  { name: "对齐推导", tex: "\\begin{aligned}\n\\operatorname{ans} &= \\max_{i<j}(a_i+a_j) \\\\\n&= a_{(1)} + a_{(2)}\n\\end{aligned}", display: true },
  { name: "分段函数", tex: "f(x)=\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}", display: true },
  { name: "矩阵 2×2", tex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", display: true },
  { name: "矩阵 3×3", tex: "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}", display: true },
  { name: "二项分布", tex: "P(X=k) = \\binom{n}{k} p^k (1-p)^{n-k}", display: false },
];

const FAV_KEY = "moxu:favtex";

function loadFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function MathEditor({ onClose, onInsert }: Props) {
  const [tex, setTex] = useState("\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}");
  const [display, setDisplay] = useState(true);
  const [favs, setFavs] = useState<string[]>(loadFavs);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { html, err } = useMemo(() => {
    if (!tex.trim()) return { html: "", err: "" };
    try {
      katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: "ignore", macros: MATH_MACROS });
      return { html: renderMath(tex, display), err: "" };
    } catch (e) {
      return { html: "", err: String((e as Error).message || e).replace(/^KaTeX parse error:\s*/, "") };
    }
  }, [tex, display]);

  const insertSnippet = (snip: string) => {
    const ta = taRef.current;
    if (!ta) {
      setTex((t) => t + snip);
      return;
    }
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const next = tex.slice(0, s) + snip + tex.slice(e);
    setTex(next);
    requestAnimationFrame(() => {
      ta.focus();
      const caret = snip.includes("{}") ? s + snip.indexOf("{}") + 1 : s + snip.length;
      ta.setSelectionRange(caret, caret);
    });
  };

  const toggleFav = () => {
    if (!tex.trim()) return;
    setFavs((f) => {
      const next = f.includes(tex) ? f.filter((x) => x !== tex) : [tex, ...f].slice(0, 12);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal dlg-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">公式可视化编辑器</div>
            <div className="modal-sub">左边点符号或写 LaTeX，右边实时预览（KaTeX 与题解里同一套宏）；函数名请用 \operatorname 直立排版。</div>
          </div>
          <button className="bar-btn tiny" onClick={onClose} title="关闭（Esc）">
            <X size={15} />
          </button>
        </div>

        <div className="math-ed-body">
          <div className="math-ed-left">
            <div className="symbol-grid">
              {SYMBOLS.map((s) => (
                <button key={s.label} className="symbol-btn" onClick={() => insertSnippet(s.snippet)} title={s.snippet}>
                  {s.label.replace(/\\/g, "")}
                </button>
              ))}
            </div>
            <div className="math-ed-templates">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  className="mini-btn"
                  onClick={() => {
                    setTex(t.tex);
                    setDisplay(t.display);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            {favs.length > 0 && (
              <div className="math-ed-favs">
                <span className="diagram-hint">收藏：</span>
                {favs.map((f, i) => (
                  <button key={i} className="mini-btn" title={f} onClick={() => setTex(f)}>
                    {f.slice(0, 22)}…
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="math-ed-right">
            <textarea
              ref={taRef}
              className="diagram-input thin"
              value={tex}
              onChange={(e) => setTex(e.target.value)}
              spellCheck={false}
              rows={5}
              aria-label="LaTeX 源码"
              placeholder="\\sum_{i=1}^{n} i"
            />
            <div className="diagram-toolrow">
              <div className="seg" role="group" aria-label="公式形态">
                <button className={!display ? "on" : ""} onClick={() => setDisplay(false)}>
                  行内 $…$
                </button>
                <button className={display ? "on" : ""} onClick={() => setDisplay(true)}>
                  行间 $$…$$
                </button>
              </div>
              <button className="mini-btn" onClick={toggleFav} title="收藏这条公式">
                <Star size={11} />
                {favs.includes(tex) ? "已收藏" : "收藏"}
              </button>
            </div>
            <div className={"math-preview thin" + (err ? " err" : "")}>
              {err ? (
                <span className="diagram-err">公式语法错误：{err}</span>
              ) : html ? (
                <div dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <span className="diagram-hint">预览会出现在这里。</span>
              )}
            </div>
          </div>
        </div>

        <div className="modal-foot-actions">
          <button
            className="bar-btn accented"
            disabled={!tex.trim() || !!err}
            onClick={() => {
              onInsert(tex.trim(), display);
              onClose();
            }}
          >
            {display ? "插入行间公式" : "插入行内公式"}
          </button>
        </div>
      </div>
    </div>
  );
}
