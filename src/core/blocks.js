/* Pages are stored as markdown; the editor works on blocks. parse() and serialize() convert between them,
   and inline markdown <-> contentEditable HTML lives here too (toHTML / fromDOM).
   Supported inline: **bold** *italic* `code` ~~strike~~ ==mark== [text](url) [[Page|label]]  (\ escapes) */
import { esc } from "./md.js";
import { toMathML } from "./mathtype.js";

export const bid = () => Math.random().toString(36).slice(2, 10);
const YT =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}\S*$/;
const EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s+/u;
export const TEXTY = new Set(["p", "h1", "h2", "h3", "ul", "ol", "todo", "quote", "callout"]);
export const LISTY = new Set(["ul", "ol", "todo", "card"]);

/* ---------- markdown -> blocks ---------- */
export function parse(md) {
  const L = String(md || "")
      .replace(/\r\n?/g, "\n")
      .split("\n"),
    out = [];
  let i = 0;
  const isStart = l =>
    /^\s*(#{1,6}\s|>\s?|```|(?:[-*+]|\d+[.)])\s|(?:-{3,}|\*{3,}|_{3,})\s*$|\||\$\$)/.test(l) ||
    /^!\[[^\]]*\]\([^)]+\)\s*$/.test(l) ||
    /\s::\s/.test(l) ||
    YT.test(l.trim());
  while (i < L.length) {
    const l = L[i];
    let m;
    if (!l.trim()) {
      i++;
      continue;
    }
    if ((m = l.match(/^```\s*([\w+-]*)\s*$/))) {
      const body = [];
      i++;
      while (i < L.length && !/^```\s*$/.test(L[i])) body.push(L[i++]);
      i++;
      out.push({ id: bid(), t: "code", lang: m[1] || "", text: body.join("\n") });
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      out.push({ id: bid(), t: "hr" });
      i++;
      continue;
    }
    if ((m = l.match(/^\s*\$\$(.*)$/))) {
      const rest = m[1];
      const one = rest.match(/^(.*?)\$\$\s*$/);
      if (one) {
        out.push({ id: bid(), t: "math", text: one[1].trim() });
        i++;
        continue;
      }
      const body = rest.trim() ? [rest] : [];
      i++;
      while (i < L.length && !/\$\$\s*$/.test(L[i])) body.push(L[i++]);
      if (i < L.length) body.push(L[i++].replace(/\$\$\s*$/, ""));
      out.push({ id: bid(), t: "math", text: body.join("\n").trim() });
      continue;
    }
    if ((m = l.match(/^\s*\$(?!\s)([^$\n]*[^$\s\n])\$\s*$/))) {
      out.push({ id: bid(), t: "math", text: m[1].trim() });
      i++;
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      out.push({ id: bid(), t: "h" + Math.min(3, m[1].length), text: m[2] });
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      const body = [];
      while (i < L.length && /^>\s?/.test(L[i])) body.push(L[i++].replace(/^>\s?/, ""));
      const txt = body.join("\n"),
        em = txt.match(EMOJI);
      out.push(
        em
          ? { id: bid(), t: "callout", icon: em[1], text: txt.slice(em[0].length) }
          : { id: bid(), t: "quote", text: txt },
      );
      continue;
    }
    if ((m = l.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) {
      out.push({ id: bid(), t: "img", alt: m[1], src: m[2] });
      i++;
      continue;
    }
    if (YT.test(l.trim())) {
      out.push({ id: bid(), t: "embed", url: l.trim() });
      i++;
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      const row = x =>
        x
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map(c => c.trim());
      const rows = [row(l)];
      i += 2;
      while (i < L.length && /^\s*\|/.test(L[i])) rows.push(row(L[i++]));
      const w = Math.max(...rows.map(r => r.length));
      out.push({
        id: bid(),
        t: "table",
        rows: rows.map(r => {
          while (r.length < w) r.push("");
          return r;
        }),
      });
      continue;
    }
    if ((m = l.match(/^(\s*)[-*+]\s+\[( |x|X)\]\s?(.*)$/))) {
      out.push({ id: bid(), t: "todo", ind: Math.min(4, m[1].length >> 1), done: m[2] !== " ", text: m[3] });
      i++;
      continue;
    }
    if ((m = l.match(/^(\s*)[-*+]\s+(.*)$/))) {
      out.push({ id: bid(), t: "ul", ind: Math.min(4, m[1].length >> 1), text: m[2] });
      i++;
      continue;
    }
    if ((m = l.match(/^(\s*)\d+[.)]\s+(.*)$/))) {
      out.push({ id: bid(), t: "ol", ind: Math.min(4, m[1].length >> 1), text: m[2] });
      i++;
      continue;
    }
    if ((m = l.match(/^(.+?)\s::\s(.*)$/))) {
      out.push({ id: bid(), t: "card", q: m[1].trim(), a: m[2].trim() });
      i++;
      continue;
    }
    const body = [l];
    i++;
    while (i < L.length && L[i].trim() && !isStart(L[i])) body.push(L[i++]);
    out.push({ id: bid(), t: "p", text: body.join("\n") });
  }
  return out.length ? out : [{ id: bid(), t: "p", text: "" }];
}

/* ---------- blocks -> markdown ---------- */
export function serialize(bs) {
  const out = [];
  let prev = null,
    num = [];
  for (const b of bs) {
    const ind = "  ".repeat(b.ind || 0);
    let s;
    if (b.t !== "ol") num = [];
    switch (b.t) {
      case "h1":
      case "h2":
      case "h3":
        s = "#".repeat(+b.t[1]) + " " + b.text;
        break;
      case "ul":
        s = ind + "- " + b.text;
        break;
      case "ol": {
        const d = b.ind || 0;
        num = num.slice(0, d + 1);
        num[d] = (num[d] || 0) + 1;
        s = ind + num[d] + ". " + b.text;
        break;
      }
      case "todo":
        s = ind + "- [" + (b.done ? "x" : " ") + "] " + b.text;
        break;
      case "quote":
        s = String(b.text)
          .split("\n")
          .map(x => "> " + x)
          .join("\n");
        break;
      case "callout":
        s = String((b.icon || "💡") + " " + b.text)
          .split("\n")
          .map(x => "> " + x)
          .join("\n");
        break;
      case "code":
        s = "```" + (b.lang || "") + "\n" + b.text + "\n```";
        break;
      case "hr":
        s = "---";
        break;
      case "math":
        s = String(b.text || "").includes("\n") ? "$$\n" + b.text + "\n$$" : "$$" + (b.text || "") + "$$";
        break;
      case "img":
        s = "![" + (b.alt || "") + "](" + b.src + ")";
        break;
      case "embed":
        s = b.url;
        break;
      case "table": {
        const r = b.rows || [[""]],
          w = Math.max(1, ...r.map(x => x.length)),
          line = x =>
            "| " +
            Array.from({ length: w }, (_, i) =>
              String(x[i] || "")
                .replace(/\|/g, "\\|")
                .replace(/\n/g, " "),
            ).join(" | ") +
            " |";
        s = [
          line(r[0]),
          "|" + Array.from({ length: w }, () => "---").join("|") + "|",
          ...r.slice(1).map(line),
        ].join("\n");
        break;
      }
      case "card":
        s = (b.q || "").replace(/\n/g, " ") + " :: " + (b.a || "").replace(/\n/g, " ");
        break;
      default:
        s = b.text || "";
    }
    /* list-ish neighbours stay on consecutive lines, everything else gets a blank line between */
    if (prev)
      out.push(
        LISTY.has(prev.t) && LISTY.has(b.t) && (prev.t === "card") === (b.t === "card") ? "\n" : "\n\n",
      );
    out.push(s);
    prev = b;
  }
  const r = out.join("").replace(/\n{3,}/g, "\n\n");
  return r.trim() ? r : "";
}

/* ---------- inline markdown -> HTML (for contentEditable) ---------- */
export function toHTML(md) {
  let s = String(md || ""),
    o = "",
    i = 0;
  const tok = [
    [/^\\([\\`*_~\[\]=|#>+-])/, m => esc(m[1])],
    [
      /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/,
      m =>
        `<a class="wk" contenteditable="false" data-wiki="${esc(m[1].trim())}">${esc((m[2] || m[1]).trim())}</a>`,
    ],
    [/^\[([^\]\n]+)\]\(([^)\s]+)\)/, m => `<a href="${esc(m[2])}">${toHTML(m[1])}</a>`],
    [/^`([^`\n]+)`/, m => `<code>${esc(m[1])}</code>`],
    [
      /^\$(?!\s)([^$\n]*[^$\s\n])\$(?!\d)/,
      m => `<span class="mth" contenteditable="false" data-tex="${esc(m[1])}">${toMathML(m[1])}</span>`,
    ],
    [/^\*\*([^\n]+?)\*\*/, m => `<b>${toHTML(m[1])}</b>`],
    [/^__([^\n]+?)__/, m => `<b>${toHTML(m[1])}</b>`],
    [/^~~([^\n]+?)~~/, m => `<s>${toHTML(m[1])}</s>`],
    [/^==([^\n]+?)==/, m => `<mark>${toHTML(m[1])}</mark>`],
    [/^\*([^*\n]+?)\*/, m => `<i>${toHTML(m[1])}</i>`],
    [/^_([^_\n]+?)_(?![A-Za-z0-9])/, m => `<i>${toHTML(m[1])}</i>`],
  ];
  outer: while (i < s.length) {
    const rest = s.slice(i);
    if (rest[0] === "\n") {
      o += "<br>";
      i++;
      continue;
    }
    for (const [re, f] of tok) {
      const m = rest.match(re);
      if (m) {
        o += f(m);
        i += m[0].length;
        continue outer;
      }
    }
    o += esc(rest[0]);
    i++;
  }
  /* a trailing <br> is invisible in contentEditable; a second one makes the empty line show */
  return o.endsWith("<br>") ? o + "<br>" : o;
}

/* ---------- contentEditable DOM -> inline markdown ---------- */
const escText = t => t.replace(/([\\`*_~\[\]=])/g, "\\$1");
export function fromDOM(el) {
  let o = "";
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) {
      o += escText(n.nodeValue.replace(/ /g, " ").replace(/​/g, ""));
      return;
    }
    if (n.nodeType !== 1) return;
    const t = n.tagName,
      inner = () => fromDOM(n);
    if (t === "BR") {
      o += "\n";
      return;
    }
    if (t === "A" && n.classList.contains("wk")) {
      const w = n.dataset.wiki || n.textContent,
        l = n.textContent;
      o += "[[" + w + (l && l !== w ? "|" + l : "") + "]]";
      return;
    }
    if (t === "A") {
      const h = n.getAttribute("href") || "";
      const x = inner();
      o += h ? "[" + x + "](" + h + ")" : x;
      return;
    }
    if (t === "SPAN" && n.classList.contains("mth")) {
      o += "$" + (n.dataset.tex || "") + "$";
      return;
    }
    if (t === "CODE") {
      o += "`" + n.textContent.replace(/`/g, "'") + "`";
      return;
    }
    const wrap = w => {
      const x = inner();
      if (!x.trim()) {
        o += x;
        return;
      }
      const a = x.match(/^\s*/)[0],
        z = x.match(/\s*$/)[0];
      o += a + w + x.trim() + w + z;
    };
    const st = n.style || {};
    if (t === "B" || t === "STRONG" || +st.fontWeight >= 600 || st.fontWeight === "bold") return wrap("**");
    if (t === "I" || t === "EM" || st.fontStyle === "italic") return wrap("*");
    if (t === "S" || t === "STRIKE" || t === "DEL") return wrap("~~");
    if (t === "MARK") return wrap("==");
    if (t === "DIV" || t === "P") {
      if (o && !o.endsWith("\n")) o += "\n";
      o += inner();
      return;
    }
    o += inner();
  });
  return o;
}
/* the editor keeps one line break at most at the end */
export const tidy = s => s.replace(/\n+$/, "");
