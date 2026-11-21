import { Marked, type Tokens } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import python from "highlight.js/lib/languages/python";
import { INLINE_MATH_SRC } from "./mathre";

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
function renderMath(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  const hit = mathCache.get(key);
  if (hit) return hit;
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: "html",
      strict: "ignore",
      errorColor: "var(--err)",
    });
  } catch {
    html = `<code>${esc(tex)}</code>`;
  }
  if (mathCache.size > 2000) mathCache.clear();
  mathCache.set(key, html);
  return html;
}

const marked = new Marked({ gfm: true, breaks: false });

const inlineRe = new RegExp("^(?:" + INLINE_MATH_SRC + ")");

marked.use({
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start(src: string) {
        const m = /(?:^|\n)( {0,3}\$\$)/.exec(src);
        return m ? m.index + m[0].length - m[1].length : undefined;
      },
      tokenizer(src: string) {
        const m = /^ {0,3}\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n+|$)/.exec(src);
        if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
        return undefined;
      },
      renderer(token) {
        return `<div class="math-block">${renderMath(token.text, true)}</div>\n`;
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start(src: string) {
        const i = src.indexOf("$");
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = inlineRe.exec(src);
        if (m) return { type: "inlineMath", raw: m[0], text: (m[1] ?? m[2]) as string, display: m[1] !== undefined };
        return undefined;
      },
      renderer(token) {
        return renderMath(token.text, !!token.display);
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
      return (
        `<figure class="code code-${l}"><figcaption><span class="dot"></span><span class="name">${label}</span>` +
        `<button type="button" data-copy="1">复制</button></figcaption>` +
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
        headings.push({ depth: (t as Tokens.Heading).depth, text: (t as Tokens.Heading).text.replace(/[*_`$]/g, ""), line });
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
  const html = DOMPurify.sanitize(out.join("\n"), { ADD_ATTR: ["data-copy"] });
  return { html, headings };
}
