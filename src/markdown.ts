import { Marked, type Tokens } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import python from "highlight.js/lib/languages/python";
import {
  INLINE_MATH_SRC,
  MATH_MACROS,
  blockMathStart,
  matchBlockMath,
  mathGroup,
} from "./mathre";

hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("python", python);

export type Lang = "cpp" | "python" | "plain";

export function normLang(info: string | undefined): Lang {
  const l = (info || "").trim().split(/\s+/)[0].toLowerCase();
  if (["cpp", "c++", "cc", "cxx", "hpp", "c", "h"].includes(l)) return "cpp";
  if (["py", "python", "python3", "py3"].includes(l)) return "python";
  return "plain";
}

const LANG_LABEL: Record<Lang, string> = { cpp: "C++", python: "Python", plain: "" };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const mathCache = new Map<string, string>();

function katexOptions(display: boolean): katex.KatexOptions {
  return {
    displayMode: display,
    throwOnError: false,
    output: "html",
    strict: "ignore",
    trust: false,
    errorColor: "var(--err)",
    macros: MATH_MACROS,
  };
}

/** 渲染一段 TeX；出错时降级成代码样式，源码不会丢 */
export function renderMath(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  const hit = mathCache.get(key);
  if (hit) return hit;
  let html: string;
  try {
    html = katex.renderToString(tex, katexOptions(display));
  } catch (e) {
    html = `<code class="math-error" title="${esc(String((e as Error).message || e))}">${esc(tex)}</code>`;
  }
  if (mathCache.size > 2000) mathCache.clear();
  mathCache.set(key, html);
  return html;
}

const marked = new Marked({ gfm: true, breaks: false });

const inlineHead = new RegExp("^(?:" + INLINE_MATH_SRC + ")");

marked.use({
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start(src: string) {
        return blockMathStart(src);
      },
      tokenizer(src: string) {
        const m = matchBlockMath(src);
        if (!m) return undefined;
        return { type: "blockMath", raw: m.raw, text: m.body, env: m.env ?? "" };
      },
      renderer(token: Tokens.Generic) {
        const env = String(token.env ?? "");
        return (
          `<div class="math-block${env ? " has-env" : ""}"${env ? ` data-env="${esc(env)}"` : ""}>` +
          renderMath(String(token.text), true) +
          `</div>\n`
        );
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start(src: string) {
        const m = /[$]|\\[([]/.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        const m = inlineHead.exec(src);
        if (!m) return undefined;
        const g = mathGroup(m);
        if (!g || !g.body) return undefined;
        return { type: "inlineMath", raw: m[0], text: g.body, display: g.display };
      },
      renderer(token: Tokens.Generic) {
        const display = Boolean(token.display);
        const html = renderMath(String(token.text), display);
        return display ? `<span class="math-inline-display">${html}</span>` : html;
      },
    },
  ],
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const l = normLang(lang);
      let body: string;
      if (l === "plain") body = esc(text);
      else body = hljs.highlight(text, { language: l, ignoreIllegals: true }).value;
      const label = l === "plain" ? esc((lang || "text").split(/\s+/)[0] || "text") : LANG_LABEL[l];
      const langName = label || "text";
      return (
        `<figure class="code code-${l}" data-lang="${esc(langName.toLowerCase())}">` +
        `<figcaption><span class="dot"></span><span class="name">${langName}</span>` +
        `<button type="button" data-copy="1"><span class="copy-label">复制</span></button></figcaption>` +
        `<pre><code class="hljs">${body}</code></pre></figure>\n`
      );
    },
  },
});

export interface Heading {
  depth: number;
  text: string;
  line: number;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

export function renderMarkdown(src: string): Rendered {
  const tokens = marked.lexer(src);
  const headings: Heading[] = [];
  let line = 0;
  const out: string[] = [];
  for (const t of tokens) {
    const raw = t.raw;
    const nl = (raw.match(/\n/g) || []).length;
    if (t.type !== "space") {
      const span = raw.replace(/\n+$/, "").split("\n").length;
      if (t.type === "heading") {
        headings.push({ depth: (t as Tokens.Heading).depth, text: (t as Tokens.Heading).text.replace(/[*_`$\\]/g, ""), line });
      }
      let html = "";
      try {
        html = marked.parser([t]);
      } catch {
        html = `<p>${esc(raw)}</p>`;
      }
      out.push(`<div class="blk" data-s="${line}" data-e="${line + span}">${html}</div>`);
    }
    line += nl;
  }
  const html = DOMPurify.sanitize(out.join("\n"), {
    ADD_ATTR: ["data-copy", "data-lang", "data-env"],
    ADD_TAGS: ["annotation", "semantics", "mrow", "mi", "mo", "mn"],
  });
  return { html, headings };
}
