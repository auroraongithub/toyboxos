/* The block editor's pieces: caret helpers for contenteditable, the block and insert menus, and the math, image and table blocks. */
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../core/lib.js";
import { Icon } from "../ui/index.js";
import { toHTML, fromDOM, tidy, bid, TEXTY } from "../core/blocks.js";
import { toMathML } from "../core/mathtype.js";
import { fileUrl } from "../core/files.js";
import { Actions } from "../ui/sheet.js";

/* ---------- caret helpers ---------- */
const textNodes = el => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n =>
      n.parentElement && n.parentElement.closest(".wk,.mth")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const a = [];
  while (w.nextNode()) a.push(w.currentNode);
  return a;
};
function caretOff(el) {
  const s = getSelection();
  if (!s.rangeCount || !el.contains(s.anchorNode)) return -1;
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(s.anchorNode, s.anchorOffset);
  return r.toString().length;
}
function rangeAt(el, from, to) {
  const r = document.createRange();
  let pos = 0,
    sset = false;
  for (const n of textNodes(el)) {
    const len = n.nodeValue.length;
    if (!sset && from <= pos + len) {
      r.setStart(n, from - pos);
      sset = true;
    }
    if (sset && to <= pos + len) {
      r.setEnd(n, to - pos);
      return r;
    }
    pos += len;
  }
  if (!sset) r.setStart(el, el.childNodes.length);
  r.setEnd(el, el.childNodes.length);
  return r;
}
function setCaret(el, off) {
  const s = getSelection(),
    r =
      off >= 1e8
        ? (() => {
            const x = document.createRange();
            x.selectNodeContents(el);
            x.collapse(false);
            return x;
          })()
        : rangeAt(el, off, off);
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
}
const collapsed = () => {
  const s = getSelection();
  return s.rangeCount && s.isCollapsed;
};
const caretRect = () => {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0).cloneRange();
  r.collapse(true);
  let b = r.getClientRects()[0];
  if (!b) {
    const sp = document.createElement("span");
    sp.textContent = "​";
    r.insertNode(sp);
    b = sp.getBoundingClientRect();
    sp.remove();
  }
  return b;
};
function onEdgeLine(el, top) {
  const c = caretRect(),
    b = el.getBoundingClientRect();
  if (!c) return true;
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
  return top ? c.top - b.top < lh * 0.8 : b.bottom - c.bottom < lh * 0.8;
}
function splitAt(el) {
  const s = getSelection();
  if (!s.rangeCount) return [fromDOM(el), ""];
  const r = s.getRangeAt(0).cloneRange();
  r.deleteContents();
  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(el, el.childNodes.length);
  const box = document.createElement("div");
  box.appendChild(tail.extractContents());
  return [tidy(fromDOM(el)), tidy(fromDOM(box))];
}
const visLen = md => {
  const d = document.createElement("div");
  d.innerHTML = toHTML(md);
  return textNodes(d).reduce((a, n) => a + n.nodeValue.length, 0);
};

/* contentEditable that only rewrites its DOM when the markdown changes from outside (typing never jumps the caret) */
function Editable({ text, cls, ph, elRef, onText, ...p }) {
  const r = useRef(),
    last = useRef(null);
  useLayoutEffect(() => {
    const el = r.current;
    if (el && text !== last.current) {
      el.innerHTML = toHTML(text);
      last.current = text;
      el.toggleAttribute("data-empty", !el.textContent);
    }
  }, [text]);
  return html`<div ref=${e => {
    r.current = e;
    if (elRef) elRef(e);
  }} class=${"ce " + (cls || "")} contenteditable="true" spellcheck="true" data-ph=${ph || ""}
    onInput=${e => {
      const el = e.currentTarget;
      el.toggleAttribute("data-empty", !el.textContent);
      const md = tidy(fromDOM(el));
      last.current = md;
      onText(md, el, e);
      if (el.isConnected) last.current = tidy(fromDOM(el));
    }} ...${p}/>`;
}

/* ---------- menus ---------- */
export const TYPES = [
  ["p", "Text", "note", "Plain writing"],
  ["h1", "Heading 1", "H1", "Big section title"],
  ["h2", "Heading 2", "H2", "Medium title"],
  ["h3", "Heading 3", "H3", "Small title"],
  ["ul", "Bulleted list", "bullets", "- "],
  ["ol", "Numbered list", "list", "1. "],
  ["todo", "To-do", "task", "[] "],
  ["quote", "Quote", "wiki", "> "],
  ["callout", "Callout", "pin", "Boxed note with an emoji"],
  ["code", "Code", "code", "```"],
  ["math", "Equation", "calc", "$$ LaTeX or f(x)=x^2 $$"],
  ["table", "Table", "table", "Rows and columns"],
  ["img", "Image", "image", "Upload or paste"],
  ["embed", "YouTube", "open", "Paste a video link"],
  ["hr", "Divider", "more", "---"],
  ["link", "Link to page", "wiki", "[["],
];
const TI = k => TYPES.find(t => t[0] === k);
const glyph = i => (/^H\d$/.test(i) ? html`<b class="tg">${i}</b>` : html`<${Icon} n=${i}/>`);
/* block menu body (sheet on phones, popover on desktop) */
function BlockMenu({ b, turn, acts, close }) {
  return html`<div class="bkm"><small class="pth">Turn into</small><div class="tgrid">${TYPES.filter(
    t => !["img", "embed", "hr", "link", "table"].includes(t[0]),
  ).map(
    t =>
      html`<button class=${"mi" + (b.t === t[0] ? " on" : "")} onClick=${() => {
        close();
        turn(b.id, t[0]);
      }}>${glyph(t[2])}<span>${t[1]}</span></button>`,
  )}</div>
    <div class="sep"/><${Actions} items=${acts} close=${close}/></div>`;
}
function InsertMenu({ pick, close }) {
  return html`<div class="acts insm">${TYPES.map(
    t =>
      html`<button class="mi" onClick=${() => {
        close();
        pick(t[0]);
      }}>${glyph(t[2])}<span>${t[1]}<em>${t[3]}</em></span></button>`,
  )}</div>`;
}
const touch = () => matchMedia("(pointer:coarse)").matches;
const safeUrl = u => /^(https?:|mailto:)/i.test(u);
const CALLOUTS = ["💡", "⚠️", "📌", "❓", "✅", "📝", "🔥", "⭐"];

function fresh(t, o = {}) {
  const b = { id: bid(), t };
  if (t === "table")
    Object.assign(b, {
      rows: [
        ["", ""],
        ["", ""],
      ],
    });
  else if (t === "card") Object.assign(b, { q: "", a: "" });
  else if (t === "code" || t === "math") Object.assign(b, { lang: "", text: "" });
  else if (t === "callout") Object.assign(b, { icon: "💡", text: "" });
  else if (t === "todo") Object.assign(b, { done: false, text: "" });
  else if (TEXTY.has(t)) b.text = "";
  return Object.assign(b, o);
}

function MathBlock({ b, reg, onText, onDone, onGone }) {
  const [ed, setEd] = useState(!b.text);
  const ta = useRef();
  useEffect(() => {
    if (ed && ta.current) {
      ta.current.focus();
      ta.current.setSelectionRange(1e9, 1e9);
    }
  }, [ed]);
  return html`<div class="bmx" ref=${reg} tabindex=${ed ? -1 : 0} onKeyDown=${e => {
    if (!ed && e.target === e.currentTarget) {
      if (e.key === "Enter") {
        e.preventDefault();
        setEd(true);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        onGone();
      }
    }
  }}>
    ${b.text ? html`<div class="mxb" title="Click to edit" onClick=${() => setEd(true)} dangerouslySetInnerHTML=${{ __html: toMathML(b.text, true) }}/>` : null}
    ${
      ed
        ? html`<textarea ref=${ta} class="mxs" spellcheck="false" rows=${Math.max(1, String(b.text).split("\n").length)} placeholder="LaTeX, or plain like f(x)=x^2+1" aria-label="Equation" value=${b.text}
      onInput=${e => {
        onText(e.target.value);
        e.target.rows = Math.max(1, e.target.value.split("\n").length);
      }}
      onBlur=${() => {
        if (b.text) setEd(false);
      }}
      onKeyDown=${e => {
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          if (b.text) {
            setEd(false);
            onDone();
          } else onGone();
        } else if (e.key === "Backspace" && !e.target.value) {
          e.preventDefault();
          onGone();
        }
      }}/>`
        : null
    }</div>`;
}

function Img({ b, reg, onAlt, onDel }) {
  const [src, setSrc] = useState(/^sos:/.test(b.src) ? "" : b.src);
  useEffect(() => {
    if (/^sos:/.test(b.src)) fileUrl(b.src.slice(4)).then(u => setSrc(u || ""));
    else setSrc(b.src);
  }, [b.src]);
  return html`<figure class="bim" tabindex="0" ref=${reg} onKeyDown=${e => {
    if (e.target === e.currentTarget && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      onDel();
    }
  }}>
    ${src ? html`<img src=${src} alt=${b.alt || ""} loading="lazy" referrerpolicy="no-referrer"/>` : html`<div class="wk-miss">image not synced yet</div>`}
    <input class="cap2" value=${b.alt || ""} placeholder="Caption" aria-label="Caption" onInput=${e => onAlt(e.target.value)}/></figure>`;
}

function Table({ b, reg, set, setCell }) {
  const rows = b.rows || [[""]],
    w = Math.max(1, ...rows.map(r => r.length));
  const go = (r, c) => {
    const el = document.querySelector(`[data-cell="${b.id}:${r}:${c}"]`);
    if (el) {
      el.focus();
      setCaret(el, 1e9);
    }
  };
  return html`<div class="btw"><table class="btab"><tbody>${rows.map(
    (r, ri) => html`<tr key=${ri}>${Array.from(
      { length: w },
      (_, ci) => html`<td key=${ci} class=${ri === 0 ? "th" : ""}>
      <${Editable} text=${r[ci] || ""} data-cell=${b.id + ":" + ri + ":" + ci} elRef=${ri === 0 && ci === 0 ? reg(b.id) : null} onText=${md => setCell(ri, ci, md.replace(/\n/g, " "))}
        onKeyDown=${e => {
          if (e.key === "Tab") {
            e.preventDefault();
            const n = ri * w + ci + (e.shiftKey ? -1 : 1);
            if (n >= rows.length * w) {
              set([...rows, Array(w).fill("")]);
              setTimeout(() => go(rows.length, 0), 30);
            } else if (n >= 0) go(Math.floor(n / w), n % w);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (ri === rows.length - 1) {
              set([...rows, Array(w).fill("")]);
              setTimeout(() => go(ri + 1, ci), 30);
            } else go(ri + 1, ci);
          }
        }}/></td>`,
    )}
      ${rows.length > 1 ? html`<td class="tx"><button class="x1" aria-label="Delete row" onClick=${() => set(rows.filter((_, i) => i !== ri))}>×</button></td>` : html`<td class="tx"/>`}</tr>`,
  )}</tbody></table>
    <div class="tbtns"><button class="ppadd" onClick=${() => set([...rows, Array(w).fill("")])}><${Icon} n="plus"/>Row</button><button class="ppadd" onClick=${() => set(rows.map(r => [...r, ""]))}><${Icon} n="plus"/>Column</button>
      ${w > 1 ? html`<button class="ppadd" onClick=${() => set(rows.map(r => r.slice(0, w - 1)))}><${Icon} n="skip"/>Last column</button>` : null}</div></div>`;
}

export {
  BlockMenu,
  CALLOUTS,
  Editable,
  Img,
  InsertMenu,
  MathBlock,
  TI,
  Table,
  caretOff,
  caretRect,
  collapsed,
  fresh,
  glyph,
  onEdgeLine,
  rangeAt,
  safeUrl,
  setCaret,
  splitAt,
  touch,
  visLen,
};
