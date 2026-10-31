/* Markdown for pages. Raw HTML is escaped (imported .md files can't run scripts in here),
   links are limited to safe schemes, [[wiki links]] and YouTube embeds are added. */
import { Marked, Renderer } from "marked";
import { toMathML } from "./mathtype.js";

export const esc = s =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const safeHref = h => {
  h = String(h || "").trim();
  return /^(https?:|mailto:|tel:|#)/i.test(h) ? h : "";
};
const ytId = h => {
  const m = String(h).match(
    /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
};
const IMG = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

const wiki = {
  name: "wiki",
  level: "inline",
  start: src => {
    const i = src.search(/!?\[\[/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = /^(!?)\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]+))?\]\]/.exec(src);
    if (m)
      return { type: "wiki", raw: m[0], embed: !!m[1], target: m[2].trim(), label: (m[3] || m[2]).trim() };
  },
  renderer: t =>
    t.embed && IMG.test(t.target)
      ? `<span class="wk-miss" title="Image not imported">${esc(t.target)}</span>`
      : `<a href="#" class="wk" data-wiki="${esc(t.target)}">${esc(t.label)}</a>`,
};

const mathBlock = {
  name: "mathBlock",
  level: "block",
  start: src => {
    const i = src.search(/(?:^|\n)\s*\$/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m =
      /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) ||
      /^ {0,3}\$(?!\s)([^$\n]*[^$\s\n])\$[ \t]*(?:\n|$)/.exec(src);
    if (m && !/^[\d.,\s]+$/.test(m[1])) return { type: "mathBlock", raw: m[0], tex: m[1].trim() };
  },
  renderer: t => `<div class="mxb">${toMathML(t.tex, true)}</div>\n`,
};
const mathInline = {
  name: "mathInline",
  level: "inline",
  start: src => {
    const i = src.indexOf("$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = /^\$(?!\s)([^$\n]*[^$\s\n])\$(?!\d)/.exec(src);
    if (m && !/^[\d.,\s]+$/.test(m[1])) return { type: "mathInline", raw: m[0], tex: m[1] };
  },
  renderer: t => `<span class="mth">${toMathML(t.tex)}</span>`,
};

const renderer = {
  html: t => esc(t.text),
  link({ href, title, tokens }) {
    const h = safeHref(href),
      txt = this.parser.parseInline(tokens);
    if (!h) return txt;
    const ext = /^https?:/i.test(h);
    return `<a href="${esc(h)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${txt}</a>`;
  },
  image({ href, title, text }) {
    const h = String(href || "").trim(),
      alt = esc(text || "");
    if (/^sos:[\w-]+$/.test(h)) return `<img data-sos="${esc(h.slice(4))}" alt="${alt}" loading="lazy"/>`;
    if (/^https?:/i.test(h) || /^data:image\/(png|jpe?g|webp|gif);/i.test(h))
      return `<img src="${esc(h)}" alt="${alt}"${title ? ` title="${esc(title)}"` : ""} loading="lazy" referrerpolicy="no-referrer"/>`;
    return alt ? `<span class="wk-miss">${alt}</span>` : "";
  },
  paragraph({ tokens }) {
    /* a line that's only a YouTube link becomes the video */
    const real = tokens.filter(t => !(t.type === "text" && !t.text.trim()));
    if (real.length === 1 && real[0].type === "link") {
      const id = ytId(real[0].href);
      if (id)
        return `<div class="emb"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    }
    return `<p>${this.parser.parseInline(tokens)}</p>\n`;
  },
  code(t) {
    const l = String(t.lang || "")
      .trim()
      .toLowerCase();
    if (l === "graph" || l === "cards")
      return `<div class="cbk" data-k="${l}" data-src="${esc(t.text)}"><pre class="selectable">${esc(t.text)}</pre></div>
`;
    return Renderer.prototype.code.call(this, t);
  },
  checkbox: ({ checked }) => `<input type="checkbox" class="tk"${checked ? " checked" : ""}> `,
  table(t) {
    return `<div class="tbw">${Renderer.prototype.table.call(this, t)}</div>`;
  },
};

const md = new Marked({ gfm: true, breaks: true });
md.use({ extensions: [wiki, mathBlock, mathInline], renderer });

export const render = src => md.parse(String(src || ""));

/* [[targets]] in a body, lowercased */
export const wikiTargets = src => {
  const out = new Set();
  String(src || "").replace(/\[\[([^\]\n|#]+)/g, (_, t) => {
    out.add(t.trim().toLowerCase());
    return "";
  });
  return out;
};

/* toggle the n-th "- [ ]" task in the source */
export function toggleTask(src, n) {
  let i = -1;
  return String(src).replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/gm, (m, a, c, b) => {
    i++;
    return i === n ? a + (c === " " ? "x" : " ") + b : m;
  });
}

/* rename [[Old]] / [[Old|label]] / [[Old#h]] to the new title */
export function renameLinks(src, from, to) {
  const re = new RegExp(
    "(!?\\[\\[)" +
      from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "((?:#[^\\]\\n|]*)?(?:\\|[^\\]\\n]+)?\\]\\])",
    "gi",
  );
  return String(src).replace(re, (_, a, b) => a + to + b);
}

/* "key: value" front matter (Obsidian) -> [body, props] */
export function frontMatter(src) {
  const m = String(src).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return [src, []];
  const props = m[1]
    .split(/\r?\n/)
    .map(l => l.match(/^([\w][\w -]{0,40}):\s*(.*)$/))
    .filter(Boolean)
    .map(x => [x[1].trim(), x[2].trim().replace(/^["']|["']$/g, "")])
    .filter(p => p[1]);
  return [src.slice(m[0].length), props];
}
