/* The block editor (Notion-style). Pages stay markdown on disk; here they're blocks:
   type / for the block menu, # - 1. [] > ``` --- shortcuts, [[ links a page, select text for the format bar,
   ⋮⋮ (or right-click a block) for turn into / duplicate / move / delete, drag ⋮⋮ to reorder. */
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html, openExternal } from "../core/lib.js";
import { Icon } from "../ui/index.js";
import { parse, serialize, fromDOM, tidy, bid, TEXTY } from "../core/blocks.js";
import { toMathML, formulaLike } from "../core/mathtype.js";
import { saveFile } from "../core/files.js";
import { D } from "../core/store.js";
import { openSheet, askText } from "../ui/sheet.js";
import { toast } from "../core/bus.js";
import {
  BlockMenu,
  CALLOUTS,
  Editable,
  Img,
  InsertMenu,
  MathBlock,
  TI,
  TYPES,
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
} from "./editor-parts.js";

export function BlockEditor({ value, onChange, onWiki, onNewPage }) {
  const [bs, setBs] = useState(() => parse(value));
  const root = useRef(),
    els = useRef({}),
    focus = useRef(null),
    lastOut = useRef(value),
    undo = useRef([]),
    redo = useRef([]),
    snapAt = useRef(0),
    cur = useRef(bs);
  const [slash, setSlash] = useState(null),
    [ac, setAc] = useState(null),
    [bar, setBar] = useState(null),
    [drop, setDrop] = useState(null),
    [fid, setFid] = useState(null),
    [kb, setKb] = useState(0),
    [lf, setLf] = useState(null);
  const imgIn = useRef(),
    imgAt = useRef(null);
  cur.current = bs;

  /* someone else (sync, another window) changed the page while we're not typing in it */
  useEffect(() => {
    if (value !== lastOut.current && !(root.current && root.current.contains(document.activeElement))) {
      lastOut.current = value;
      setBs(parse(value));
    }
  }, [value]);
  useLayoutEffect(() => {
    const f = focus.current;
    if (!f) return;
    focus.current = null;
    const el = els.current[f.id + (f.part || "")];
    if (el) {
      el.focus();
      if (el.isContentEditable) setCaret(el, f.at === "end" ? 1e9 : f.at || 0);
    }
  });

  const commit = (nb, o = {}) => {
    if (o.snap || Date.now() - snapAt.current > 1200) {
      undo.current.push(cur.current);
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
      snapAt.current = Date.now();
    }
    cur.current = nb;
    setBs(nb);
    const s = serialize(nb);
    lastOut.current = s;
    onChange(s);
    if (o.focus) focus.current = o.focus;
  };
  const ix = id => cur.current.findIndex(b => b.id === id);
  const patch = (id, p, o) =>
    commit(
      cur.current.map(b => (b.id === id ? { ...b, ...p } : b)),
      o,
    );
  const insertAfter = (id, nb, o) => {
    const a = cur.current.slice(),
      i = ix(id);
    a.splice(i + 1, 0, ...[].concat(nb));
    commit(a, { snap: true, ...o });
  };
  const remove = (id, o) => {
    const a = cur.current.filter(b => b.id !== id);
    commit(a.length ? a : [fresh("p")], { snap: true, ...o });
  };
  const move = (id, d) => {
    const a = cur.current.slice(),
      i = ix(id),
      j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    commit(a, { snap: true, focus: { id, at: "end" } });
  };
  const moveTo = (id, to) => {
    const a = cur.current.slice(),
      i = ix(id),
      [b] = a.splice(i, 1);
    a.splice(to > i ? to - 1 : to, 0, b);
    commit(a, { snap: true });
  };
  const dup = id => {
    const b = cur.current[ix(id)];
    insertAfter(id, { ...JSON.parse(JSON.stringify(b)), id: bid() });
  };
  const textOf = b =>
    b.t === "card"
      ? [b.q, b.a].filter(Boolean).join(" ")
      : b.t === "table"
        ? (b.rows || []).flat().join(" ")
        : b.text || "";
  const turn = (id, t) => {
    const b = cur.current[ix(id)];
    if (!b || b.t === t) return;
    if (t === "link" || t === "img" || t === "embed") return action(id, t);
    const nb = fresh(t, { id: b.id, ind: b.ind });
    if (TEXTY.has(t)) nb.text = textOf(b);
    else if (t === "code") nb.text = textOf(b);
    else if (t === "card") {
      nb.q = textOf(b);
    }
    commit(
      cur.current.map(x => (x.id === id ? nb : x)),
      { snap: true, focus: { id, part: t === "card" ? "q" : "", at: "end" } },
    );
  };
  const undoIt = () => {
    const u = undo.current.pop();
    if (!u) return;
    redo.current.push(cur.current);
    cur.current = u;
    setBs(u);
    const s = serialize(u);
    lastOut.current = s;
    onChange(s);
  };
  const redoIt = () => {
    const u = redo.current.pop();
    if (!u) return;
    undo.current.push(cur.current);
    cur.current = u;
    setBs(u);
    const s = serialize(u);
    lastOut.current = s;
    onChange(s);
  };

  /* insert/convert for things that need more than a type change */
  function action(id, t) {
    const b = cur.current[ix(id)],
      empty = b && TEXTY.has(b.t) && !b.text;
    if (t === "img") {
      imgAt.current = { id, replace: empty };
      imgIn.current.click();
      return;
    }
    if (t === "embed") {
      askText({ title: "Embed a video", placeholder: "https://youtube.com/watch?v=…", ok: "Embed" }).then(
        u => {
          u = String(u || "").trim();
          if (!u) return;
          if (!/^https?:\/\//.test(u)) u = "https://" + u;
          const nb = fresh("embed", { url: u });
          if (empty)
            commit(
              cur.current.map(x => (x.id === id ? nb : x)),
              { snap: true },
            );
          else insertAfter(id, nb);
        },
      );
      return;
    }
    if (t === "link") {
      const el = els.current[id];
      if (!el) return;
      if (!TEXTY.has(b.t)) {
        const nb = fresh("p");
        insertAfter(id, nb, { focus: { id: nb.id } });
        setTimeout(() => {
          const e2 = els.current[nb.id];
          if (e2) {
            e2.focus();
            document.execCommand("insertText", false, "[[");
          }
        }, 30);
        return;
      }
      el.focus();
      setCaret(el, caretOff(el) < 0 ? 1e9 : caretOff(el));
      document.execCommand("insertText", false, "[[");
      return;
    }
    const nb = fresh(t);
    if (empty)
      commit(
        cur.current.map(x => (x.id === id ? { ...nb, id } : x)),
        { snap: true, focus: { id, part: t === "card" ? "q" : "" } },
      );
    else insertAfter(id, nb, { focus: { id: nb.id, part: t === "card" ? "q" : "" } });
  }
  const addImages = async (files, o) => {
    const ims = [];
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      ims.push(fresh("img", { alt: "", src: "sos:" + (await saveFile(f, f.name)) }));
    }
    if (!ims.length) return;
    if (o && o.replace)
      commit(
        cur.current.flatMap(x => (x.id === o.id ? ims : [x])),
        { snap: true },
      );
    else insertAfter(o ? o.id : cur.current[cur.current.length - 1].id, ims);
  };

  /* ---------- text block keys ---------- */
  function onKey(e, b, part) {
    const el = e.currentTarget,
      i = ix(b.id),
      prev = cur.current[i - 1],
      next = cur.current[i + 1],
      mod = e.ctrlKey || e.metaKey;
    if (e.isComposing) return;
    if (slash && slash.id === b.id) {
      const L = slashList(slash.q);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlash({
          ...slash,
          sel: (slash.sel + (e.key === "ArrowDown" ? 1 : L.length - 1)) % Math.max(1, L.length),
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (L.length) {
          e.preventDefault();
          pickSlash(L[slash.sel % L.length][0]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }
    if (ac && ac.id === b.id && ac.list.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setAc({ ...ac, sel: (ac.sel + (e.key === "ArrowDown" ? 1 : ac.list.length - 1)) % ac.list.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickWiki(ac.list[ac.sel]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAc(null);
        return;
      }
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoIt();
      return;
    }
    if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      redoIt();
      return;
    }
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      fmt("bold");
      return;
    }
    if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      fmt("italic");
      return;
    }
    if (mod && e.key.toLowerCase() === "e") {
      e.preventDefault();
      fmt("code");
      return;
    }
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      fmt("link");
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      fmt("strike");
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      dup(b.id);
      return;
    }
    if (mod && e.key === "/") {
      e.preventDefault();
      openMenu(b.id, el);
      return;
    }
    if (e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(b.id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (b.t === "card") {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (part === "q") {
          focus.current = { id: b.id, part: "a", at: 0 };
          setBs(cur.current.slice());
        } else {
          const nb = fresh("card");
          insertAfter(b.id, nb, { focus: { id: nb.id, part: "q" } });
        }
        return;
      }
      if (e.key === "Backspace" && collapsed() && caretOff(el) === 0) {
        if (part === "a") {
          e.preventDefault();
          focus.current = { id: b.id, part: "q", at: "end" };
          setBs(cur.current.slice());
          return;
        }
        if (!b.q && !b.a) {
          e.preventDefault();
          commit(
            cur.current.map(x => (x.id === b.id ? fresh("p", { id: b.id }) : x)),
            { snap: true, focus: { id: b.id } },
          );
          return;
        }
      }
      if (e.key === "Tab") {
        e.preventDefault();
        focus.current = { id: b.id, part: part === "q" ? "a" : "q", at: "end" };
        setBs(cur.current.slice());
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const [before, after] = splitAt(el),
        listy = ["ul", "ol", "todo"].includes(b.t);
      /* a line that is only a formula (f(x)=36x+3x^2-2x^3) becomes a centred equation */
      if (b.t === "p" && !after) {
        const plain = before.replace(/\\([\\`*_~\[\]=])/g, "$1");
        if (formulaLike(plain)) {
          const nb = fresh("p");
          const a = cur.current.map(x =>
            x.id === b.id ? fresh("math", { id: x.id, text: plain.trim() }) : x,
          );
          a.splice(i + 1, 0, nb);
          commit(a, { snap: true, focus: { id: nb.id, at: 0 } });
          return;
        }
      }
      if (listy && !before && !after) {
        commit(
          cur.current.map(x =>
            x.id === b.id ? (x.ind ? { ...x, ind: x.ind - 1 } : fresh("p", { id: x.id })) : x,
          ),
          { snap: true, focus: { id: b.id } },
        );
        return;
      }
      if (!before && after) {
        const nb = fresh("p");
        const a = cur.current.slice();
        a.splice(i, 0, nb);
        a[i + 1] = { ...b, text: after };
        commit(a, { snap: true, focus: { id: b.id, at: 0 } });
        return;
      }
      const nb = fresh(listy ? b.t : "p", { text: after, ind: listy ? b.ind : undefined });
      const a = cur.current.map(x => (x.id === b.id ? { ...x, text: before } : x));
      a.splice(i + 1, 0, nb);
      commit(a, { snap: true, focus: { id: nb.id, at: 0 } });
      return;
    }
    if (e.key === "Backspace" && collapsed() && caretOff(el) === 0) {
      if (b.t !== "p") {
        e.preventDefault();
        commit(
          cur.current.map(x =>
            x.id === b.id ? (x.ind ? { ...x, ind: x.ind - 1 } : fresh("p", { id: x.id, text: x.text })) : x,
          ),
          { snap: true, focus: { id: b.id, at: 0 } },
        );
        return;
      }
      if (!prev) return;
      e.preventDefault();
      if (TEXTY.has(prev.t)) {
        const off = visLen(prev.text);
        const a = cur.current
          .filter(x => x.id !== b.id)
          .map(x => (x.id === prev.id ? { ...x, text: tidy(x.text + b.text) } : x));
        commit(a, { snap: true, focus: { id: prev.id, at: off } });
      } else if (!b.text)
        remove(b.id, { focus: { id: prev.id, part: prev.t === "card" ? "a" : "", at: "end" } });
      else remove(prev.id, { focus: { id: b.id, at: 0 } });
      return;
    }
    if (
      e.key === "Delete" &&
      collapsed() &&
      caretOff(el) === el.textContent.length &&
      next &&
      TEXTY.has(next.t)
    ) {
      e.preventDefault();
      const off = visLen(b.text);
      commit(
        cur.current
          .filter(x => x.id !== next.id)
          .map(x => (x.id === b.id ? { ...x, text: tidy(x.text + next.text) } : x)),
        { snap: true, focus: { id: b.id, at: off } },
      );
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (["ul", "ol", "todo"].includes(b.t))
        patch(
          b.id,
          { ind: Math.max(0, Math.min(4, (b.ind || 0) + (e.shiftKey ? -1 : 1))) },
          { snap: true, focus: { id: b.id, at: caretOff(el) } },
        );
      return;
    }
    if (e.key === "ArrowUp" && collapsed() && onEdgeLine(el, true) && prev) {
      const t = focusable(i, -1);
      if (t) {
        e.preventDefault();
        focus.current = { id: t.id, part: t.t === "card" ? "a" : "", at: "end" };
        setBs(cur.current.slice());
      }
      return;
    }
    if (e.key === "ArrowDown" && collapsed() && onEdgeLine(el, false) && next) {
      const t = focusable(i, 1);
      if (t) {
        e.preventDefault();
        focus.current = { id: t.id, part: t.t === "card" ? "q" : "", at: 0 };
        setBs(cur.current.slice());
      }
      return;
    }
  }
  const focusable = (i, d) => {
    for (let j = i + d; j >= 0 && j < cur.current.length; j += d) {
      const x = cur.current[j];
      if (TEXTY.has(x.t) || x.t === "card") return x;
    }
    return null;
  };

  /* ---------- typing: shortcuts, / menu, [[ ---------- */
  const SHORT = [
    [/^#\s/, "h1", 2],
    [/^##\s/, "h2", 3],
    [/^###\s/, "h3", 4],
    [/^[-*+]\s/, "ul", 2],
    [/^1[.)]\s/, "ol", 3],
    [/^\[\s?\]\s/, "todo", -1],
    [/^>\s/, "quote", 2],
    [/^```/, "code", 3],
    [/^---$/, "hr", 3],
  ];
  function onText(b, md, el) {
    const raw = el.textContent.replace(/ /g, " ");
    if (b.t === "p") {
      for (const [re, t, n] of SHORT) {
        const m = raw.match(re);
        if (!m) continue;
        const cut = n < 0 ? m[0].length : n;
        rangeAt(el, 0, cut).deleteContents();
        const rest = tidy(fromDOM(el));
        if (t === "hr") {
          const nb = fresh("p");
          commit(
            cur.current.flatMap(x => (x.id === b.id ? [fresh("hr", { id: x.id }), nb] : [x])),
            { snap: true, focus: { id: nb.id } },
          );
          return;
        }
        if (t === "code") {
          commit(
            cur.current.map(x => (x.id === b.id ? fresh("code", { id: x.id, text: rest }) : x)),
            { snap: true, focus: { id: b.id } },
          );
          return;
        }
        commit(
          cur.current.map(x => (x.id === b.id ? fresh(t, { id: x.id, text: rest }) : x)),
          { snap: true, focus: { id: b.id, at: 0 } },
        );
        return;
      }
    }
    /* typing $x^2$ turns into a typeset chip as soon as the closing $ lands */
    {
      const s = getSelection(),
        an = s.rangeCount && s.anchorNode;
      if (an && an.nodeType === 3 && el.contains(an) && !an.parentElement.closest(".mth,code")) {
        const m = an.nodeValue.slice(0, s.anchorOffset).match(/\$(?!\s)([^$\n]*[^$\s\n])\$$/);
        if (m && !/\d/.test(an.nodeValue[s.anchorOffset] || "")) {
          const r = document.createRange();
          r.setStart(an, s.anchorOffset - m[0].length);
          r.setEnd(an, s.anchorOffset);
          r.deleteContents();
          const chip = Object.assign(document.createElement("span"), {
            className: "mth",
            contentEditable: "false",
          });
          chip.dataset.tex = m[1];
          chip.innerHTML = toMathML(m[1]);
          const sp = document.createTextNode("​");
          r.insertNode(sp);
          r.insertNode(chip);
          const c = document.createRange();
          c.setStart(sp, 1);
          c.collapse(true);
          s.removeAllRanges();
          s.addRange(c);
          md = tidy(fromDOM(el));
        }
      }
    }
    patch(b.id, { text: md });
    const off = caretOff(el),
      before = raw.slice(0, off);
    const sm = before.match(/(?:^|\s)\/([\w ]{0,20})$/);
    if (sm && !/\s{2}/.test(sm[1])) {
      const r = caretRect(),
        R = root.current.getBoundingClientRect();
      setSlash({
        id: b.id,
        q: sm[1],
        start: off - sm[1].length - 1,
        sel: slash && slash.id === b.id ? slash.sel : 0,
        x: r ? r.left - R.left : 0,
        y: r ? r.bottom - R.top : 0,
      });
    } else if (slash) setSlash(null);
    const wm = before.match(/\[\[([^\]\n]{0,60})$/);
    if (wm) {
      const q = wm[1].trim().toLowerCase(),
        list = D.pages
          .filter(p => !q || String(p.title).toLowerCase().includes(q))
          .slice(0, 7)
          .map(p => p.title);
      if (q && !list.some(x => x.toLowerCase() === q)) list.push(wm[1].trim());
      const r = caretRect(),
        R = root.current.getBoundingClientRect();
      setAc({
        id: b.id,
        start: off - wm[1].length - 2,
        end: off,
        list,
        sel: 0,
        x: r ? r.left - R.left : 0,
        y: r ? r.bottom - R.top : 0,
      });
    } else if (ac) setAc(null);
  }
  const slashList = q => {
    const ql = String(q || "")
      .trim()
      .toLowerCase();
    return TYPES.filter(t => !ql || t[1].toLowerCase().includes(ql) || t[0].startsWith(ql));
  };
  function pickSlash(t) {
    const s = slash;
    setSlash(null);
    const el = els.current[s.id];
    if (!el) return;
    const end = caretOff(el);
    rangeAt(el, s.start, end < 0 ? s.start + 1 + s.q.length : end).deleteContents();
    const md = tidy(fromDOM(el));
    el.toggleAttribute("data-empty", !el.textContent);
    cur.current = cur.current.map(x => (x.id === s.id ? { ...x, text: md } : x));
    const b = cur.current[ix(s.id)];
    if (["img", "embed", "link"].includes(t)) return action(s.id, t);
    if (!md && TEXTY.has(b.t)) {
      commit(
        cur.current.map(x => (x.id === s.id ? fresh(t, { id: x.id, ind: x.ind }) : x)),
        { snap: true, focus: { id: s.id, part: t === "card" ? "q" : "" } },
      );
      return;
    }
    if (TEXTY.has(t) && b.t === "p" && md && t !== "p") {
      commit(
        cur.current.map(x => (x.id === s.id ? fresh(t, { id: x.id, text: md }) : x)),
        { snap: true, focus: { id: s.id, at: "end" } },
      );
      return;
    }
    const nb = fresh(t);
    insertAfter(s.id, nb, { focus: { id: nb.id, part: t === "card" ? "q" : "" } });
  }
  function pickWiki(title) {
    const a = ac;
    setAc(null);
    const el = els.current[a.id];
    if (!el) return;
    if (!D.pages.some(p => String(p.title).toLowerCase() === title.toLowerCase()) && onNewPage)
      onNewPage(title);
    const r = rangeAt(el, a.start, caretOff(el));
    r.deleteContents();
    const chip = Object.assign(document.createElement("a"), { className: "wk", textContent: title });
    chip.contentEditable = "false";
    chip.dataset.wiki = title;
    const sp = document.createTextNode(" ");
    r.insertNode(sp);
    r.insertNode(chip);
    const s = getSelection(),
      c = document.createRange();
    c.setStartAfter(sp);
    c.collapse(true);
    s.removeAllRanges();
    s.addRange(c);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* ---------- selection format bar ---------- */
  /* placed once the selection settles (not on every selectionchange, which made it jump around);
     left-aligned to where the selection starts, above it on desktop, below it on touch (the phone's own menu sits above) */
  useEffect(() => {
    let t = 0;
    const touch = matchMedia("(pointer:coarse)").matches;
    const where = () => {
      const s = getSelection();
      if (!s.rangeCount || s.isCollapsed || !root.current) {
        setBar(null);
        return null;
      }
      const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement),
        ce = n && n.closest(".ce");
      if (!ce || !root.current.contains(ce)) {
        setBar(null);
        return null;
      }
      const rg = s.getRangeAt(0),
        rs = rg.getClientRects(),
        a = rs[0] || rg.getBoundingClientRect(),
        z = rs[rs.length - 1] || a,
        R = root.current.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(a.left - R.left, R.width - (touch ? 280 : 224))),
        y: touch ? z.bottom - R.top + 8 : a.top - R.top,
        below: touch,
        on: states(),
      };
    };
    const f = () => {
      clearTimeout(t);
      const s = getSelection();
      if (!s.rangeCount || s.isCollapsed) {
        setBar(null);
        return;
      }
      t = setTimeout(() => {
        const w = where();
        if (w)
          setBar(b =>
            b && b.x === w.x && b.y === w.y && JSON.stringify(b.on) === JSON.stringify(w.on) ? b : w,
          );
      }, 180);
    };
    document.addEventListener("selectionchange", f);
    return () => {
      clearTimeout(t);
      document.removeEventListener("selectionchange", f);
    };
  }, []);
  const inTag = sel => {
    const s = getSelection();
    if (!s.rangeCount) return null;
    let n = s.getRangeAt(0).commonAncestorContainer;
    n = n && (n.nodeType === 1 ? n : n.parentElement);
    const el = n && n.closest(sel);
    return el && root.current && root.current.contains(el) ? el : null;
  };
  const states = () => ({
    bold: document.queryCommandState("bold"),
    italic: document.queryCommandState("italic"),
    strike: document.queryCommandState("strikeThrough"),
    code: !!inTag("code"),
    mark: !!inTag("mark"),
    link: !!inTag("a:not(.wk)"),
  });
  const unwrap = el => {
    const p = el.parentNode;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  };
  const restore = r => {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  /* every button toggles: bold/italic/strike via the browser, code/highlight/link by unwrapping what's already there */
  async function fmt(k) {
    const s = getSelection();
    if (!s.rangeCount) return;
    const n = s.anchorNode,
      el = n && (n.nodeType === 1 ? n : n.parentElement).closest(".ce");
    if (!el) return;
    const fire = () => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      setBar(b => b && { ...b, on: states() });
    };
    if (k === "bold" || k === "italic") {
      document.execCommand(k);
      return fire();
    }
    if (k === "strike") {
      document.execCommand("strikeThrough");
      return fire();
    }
    if (k === "code" || k === "mark") {
      const tag = k === "code" ? "code" : "mark",
        have = inTag(tag);
      if (have) {
        const first = have.firstChild,
          last = have.lastChild;
        unwrap(have);
        if (first && last) {
          const r2 = document.createRange();
          r2.setStartBefore(first);
          r2.setEndAfter(last);
          restore(r2);
        }
        return fire();
      }
      const r = s.getRangeAt(0);
      if (r.collapsed) {
        toast("Select some text first");
        return;
      }
      const w = document.createElement(tag);
      w.appendChild(r.extractContents());
      w.querySelectorAll(tag).forEach(unwrap);
      r.insertNode(w);
      const c = document.createRange();
      c.selectNodeContents(w);
      restore(c);
      return fire();
    }
    if (k === "link") {
      const have = inTag("a:not(.wk)"),
        saved = s.getRangeAt(0).cloneRange();
      if (!have && saved.collapsed) {
        toast("Select the words to link first");
        return;
      }
      const v = await askText({
        title: have ? "Edit link" : "Add link",
        label: "Web address, or the name of a page",
        value: have ? have.getAttribute("href") || "" : "",
        placeholder: "https://… or Page name",
        ok: have ? "Save" : "Link",
        extra: have ? ["Remove link", ""] : null,
        at: el,
      });
      if (v === null) {
        el.focus();
        restore(saved);
        return;
      }
      el.focus();
      restore(saved);
      const u = v.trim();
      if (!u) {
        if (have) unwrap(have);
        return fire();
      }
      const url = /^[a-z][\w+.-]*:/i.test(u)
        ? u
        : /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(u)
          ? "https://" + u
          : null;
      if (url && !safeUrl(url)) {
        toast("Only http(s) and mailto links");
        return;
      }
      if (url) {
        if (have) have.setAttribute("href", url);
        else document.execCommand("createLink", false, url);
        return fire();
      }
      /* not a web address: link to a page by that name (made if missing) */
      if (onNewPage && !D.pages.some(p => String(p.title).toLowerCase() === u.toLowerCase())) onNewPage(u);
      const r = getSelection().getRangeAt(0),
        t = r.toString().trim() || u;
      if (have) unwrap(have);
      r.deleteContents();
      const chip = Object.assign(document.createElement("a"), { className: "wk", textContent: t });
      chip.contentEditable = "false";
      chip.dataset.wiki = u;
      r.insertNode(chip);
      return fire();
    }
    if (k === "wiki") {
      const r = s.getRangeAt(0),
        t = r.toString().trim();
      if (!t) {
        toast("Select the words to link first");
        return;
      }
      if (onNewPage && !D.pages.some(p => String(p.title).toLowerCase() === t.toLowerCase())) onNewPage(t);
      r.deleteContents();
      const chip = Object.assign(document.createElement("a"), { className: "wk", textContent: t });
      chip.contentEditable = "false";
      chip.dataset.wiki = t;
      r.insertNode(chip);
      return fire();
    }
  }

  /* ---------- phone toolbar: always there while a page is open on a phone; docked above the tab bar, riding
     on top of the keyboard while you type. With nothing focused it works on the block you were last in. ---------- */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !touch()) return;
    const f = () => setKb(Math.max(0, Math.round(innerHeight - (vv.offsetTop + vv.height))));
    vv.addEventListener("resize", f);
    vv.addEventListener("scroll", f);
    f();
    return () => {
      vv.removeEventListener("resize", f);
      vv.removeEventListener("scroll", f);
    };
  }, []);
  const kbOn = !!fid && touch();
  const dock = touch() && matchMedia("(max-width:860px)").matches;
  useEffect(() => {
    document.body.toggleAttribute("data-kb", kbOn);
    return () => document.body.removeAttribute("data-kb");
  }, [kbOn]);
  useEffect(() => {
    document.body.toggleAttribute("data-kdock", dock);
    return () => document.body.removeAttribute("data-kdock");
  }, [dock]);
  const onFocusIn = e => {
    const br = e.target.closest && e.target.closest(".br");
    setFid(br ? br.dataset.id : null);
    if (br) setLf(br.dataset.id);
  };
  const onFocusOut = () =>
    setTimeout(() => {
      if (!root.current || !root.current.contains(document.activeElement)) setFid(null);
    }, 120);
  const indent = d => {
    const b = cur.current[ix(fid || lf)];
    if (!b) return;
    if (!["ul", "ol", "todo"].includes(b.t)) {
      toast("Indent works on lists");
      return;
    }
    const el = els.current[b.id];
    patch(
      b.id,
      { ind: Math.max(0, Math.min(4, (b.ind || 0) + d)) },
      { snap: true, focus: { id: b.id, at: el ? caretOff(el) : "end" } },
    );
  };
  const fbk = fid && cur.current[ix(fid)];
  /* the block the toolbar acts on: the focused one, else the last one you were in, else the last block */
  const tbk = fbk || (lf && cur.current[ix(lf)]) || cur.current[cur.current.length - 1];
  const sel1 = f => () => {
    if (!fid) {
      toast("Select some text first");
      return;
    }
    f();
  };

  /* ---------- block menu (⋮⋮ click, right-click, Ctrl+/) ---------- */
  const openMenu = (id, at) => {
    setSlash(null);
    const b = cur.current[ix(id)];
    if (!b) return;
    const pc = !touch();
    const acts = [
      [
        "plus",
        "Add block below",
        () => {
          const nb = fresh("p");
          insertAfter(id, nb, { focus: { id: nb.id } });
        },
      ],
      ["export", "Copy as markdown", () => copyBlock(id)],
      ["cards", "Duplicate", () => dup(id), { sub: pc ? "Ctrl+D" : "" }],
      ["up", "Move up", () => move(id, -1), { sub: pc ? "Alt+Shift+↑" : "" }],
      ["down", "Move down", () => move(id, 1), { sub: pc ? "Alt+Shift+↓" : "" }],
      "-",
      [
        "trash",
        "Delete block",
        () => {
          const p = cur.current[ix(id) - 1];
          remove(id, { focus: p ? { id: p.id, at: "end" } : null });
        },
        { danger: true },
      ],
    ];
    openSheet({ title: (TI(b.t) || ["", "Block"])[1], Body: BlockMenu, props: { b, turn, acts }, at });
  };
  /* insert from the phone toolbar: an empty text block turns into the type, otherwise a new block goes below */
  const insertType = (id, t) => {
    const b = cur.current[ix(id)];
    if (!b) return;
    if (["img", "embed", "link"].includes(t)) return action(id, t);
    if (TEXTY.has(b.t) && !b.text) {
      commit(
        cur.current.map(x => (x.id === id ? fresh(t, { id: x.id, ind: x.ind }) : x)),
        { snap: true, focus: { id, part: t === "card" ? "q" : "" } },
      );
      return;
    }
    const nb = fresh(t);
    insertAfter(id, nb, { focus: { id: nb.id, part: t === "card" ? "q" : "" } });
  };
  const copyBlock = id => {
    const b = cur.current[ix(id)];
    try {
      navigator.clipboard.writeText(serialize([b]));
    } catch {
      // clipboard permission denied: nothing to copy
    }
  };

  /* ---------- drag ⋮⋮ to reorder (a tap opens the menu) ---------- */
  function grab(e, b) {
    if (e.button === 2) return;
    e.preventDefault();
    const h = e.currentTarget,
      x0 = e.clientX,
      y0 = e.clientY;
    let on = false,
      to = null;
    h.setPointerCapture(e.pointerId);
    const rows = () => [...root.current.querySelectorAll(":scope > .rows > .br")];
    const mv = ev => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      on = true;
      const R = root.current.getBoundingClientRect(),
        rs = rows();
      to = rs.length;
      let y = rs.length ? rs[rs.length - 1].getBoundingClientRect().bottom : R.top;
      for (let k = 0; k < rs.length; k++) {
        const r = rs[k].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          to = k;
          y = r.top;
          break;
        }
      }
      setDrop(y - R.top);
    };
    const upf = () => {
      h.removeEventListener("pointermove", mv);
      h.removeEventListener("pointerup", upf);
      h.removeEventListener("pointercancel", upf);
      setDrop(null);
      if (on && to != null) moveTo(b.id, to);
      else openMenu(b.id, h);
    };
    h.addEventListener("pointermove", mv);
    h.addEventListener("pointerup", upf);
    h.addEventListener("pointercancel", upf);
  }

  /* ---------- paste: images become image blocks, multi-line text becomes blocks ---------- */
  function onPaste(e, b) {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...(cd.files || [])];
    if (files.some(f => /^image\//.test(f.type))) {
      e.preventDefault();
      addImages(files, { id: b.id, replace: TEXTY.has(b.t) && !b.text });
      return;
    }
    const t = cd.getData("text/plain");
    if (!t) return;
    e.preventDefault();
    if (!t.includes("\n") || b.t === "card") {
      document.execCommand("insertText", false, t.replace(/\n/g, " "));
      return;
    }
    const el = els.current[b.id],
      [before, after] = splitAt(el),
      pb = parse(t);
    const a = cur.current.slice(),
      i = ix(b.id);
    a[i] = { ...b, text: before };
    const tail = after
      ? [fresh(["ul", "ol", "todo"].includes(b.t) ? b.t : "p", { text: after, ind: b.ind })]
      : [];
    a.splice(i + 1, 0, ...pb, ...tail);
    if (!before && TEXTY.has(b.t)) a.splice(i, 1);
    commit(a, { snap: true, focus: { id: pb[pb.length - 1].id, at: "end" } });
  }

  /* ---------- rendering ---------- */
  const reg =
    (id, part = "") =>
    el => {
      if (el) els.current[id + part] = el;
      else delete els.current[id + part];
    };
  const common = (b, part) => ({
    onKeyDown: e => onKey(e, b, part),
    onPaste: e => onPaste(e, b),
    onBlur: () =>
      setTimeout(() => {
        if (!root.current || !root.current.contains(document.activeElement)) {
          setSlash(null);
          setAc(null);
        }
      }, 150),
    onClick: e => {
      const mx = e.target.closest(".mth");
      if (mx) {
        const ce = mx.closest(".ce");
        askText({
          title: "Equation",
          label: "LaTeX or plain, like x^2 or \\frac{a}{b}",
          value: mx.dataset.tex || "",
          ok: "Save",
          extra: ["Remove", ""],
        }).then(v => {
          if (v === null || !ce) return;
          v = v.trim();
          if (v) {
            mx.dataset.tex = v;
            mx.innerHTML = toMathML(v);
          } else mx.remove();
          ce.dispatchEvent(new Event("input", { bubbles: true }));
        });
        return;
      }
      const a = e.target.closest("a");
      if (!a) return;
      if (a.classList.contains("wk")) {
        e.preventDefault();
        onWiki(a.dataset.wiki);
      } else if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const h = a.getAttribute("href") || "";
        if (safeUrl(h)) openExternal(h);
      }
    },
  });
  let num = [];
  const row = (b, i) => {
    if (b.t !== "ol") num = [];
    const ph = i === 0 && bs.length === 1 ? "Type / for blocks, [[ to link a page" : "Type / for blocks";
    let body;
    switch (b.t) {
      case "h1":
      case "h2":
      case "h3":
      case "p":
      case "quote":
        body = html`<${Editable} cls=${"b-" + b.t} text=${b.text} ph=${b.t === "p" ? ph : TI(b.t)[1]} elRef=${reg(b.id)} onText=${(md, el) => onText(b, md, el)} ...${common(b)}/>`;
        break;
      case "ul":
      case "ol":
      case "todo": {
        let mk;
        if (b.t === "ol") {
          const d = b.ind || 0;
          num = num.slice(0, d + 1);
          num[d] = (num[d] || 0) + 1;
          mk = html`<span class="mk">${num[d]}.</span>`;
        } else if (b.t === "ul") mk = html`<span class="mk">${["•", "◦", "▪", "•", "◦"][b.ind || 0]}</span>`;
        else
          mk = html`<button class="ck" role="checkbox" aria-checked=${String(!!b.done)} aria-label="Done" onClick=${() => patch(b.id, { done: !b.done }, { snap: true })}/>`;
        body = html`<div class=${"li" + (b.done ? " done" : "")} style=${"--ind:" + (b.ind || 0)}>${mk}<${Editable} text=${b.text} ph="List" elRef=${reg(b.id)} onText=${(md, el) => onText(b, md, el)} ...${common(b)}/></div>`;
        break;
      }
      case "callout":
        body = html`<div class="co"><button class="coi" title="Change icon" onClick=${() => patch(b.id, { icon: CALLOUTS[(CALLOUTS.indexOf(b.icon) + 1) % CALLOUTS.length] }, { snap: true })}>${b.icon || "💡"}</button>
        <${Editable} text=${b.text} ph="Callout" elRef=${reg(b.id)} onText=${(md, el) => onText(b, md, el)} ...${common(b)}/></div>`;
        break;
      case "card":
        body = html`<div class="cd"><${Editable} cls="cq" text=${b.q} ph="Term / question" elRef=${reg(b.id, "q")} onText=${md => patch(b.id, { q: md })} ...${common(b, "q")}/>
        <span class="cds" aria-hidden="true">::</span><${Editable} cls="ca2" text=${b.a} ph="Answer" elRef=${reg(b.id, "a")} onText=${md => patch(b.id, { a: md })} ...${common(b, "a")}/></div>`;
        break;
      case "code":
        body = html`<div class="bc"><input class="bcl" value=${b.lang || ""} placeholder="language" aria-label="Language" onInput=${e => patch(b.id, { lang: e.target.value.trim() })}/>
        <textarea ref=${reg(b.id)} class="bct" spellcheck="false" value=${b.text} aria-label="Code" rows=${Math.max(1, String(b.text).split("\n").length)}
          onInput=${e => {
            patch(b.id, { text: e.target.value });
            e.target.rows = Math.max(1, e.target.value.split("\n").length);
          }}
          onKeyDown=${e => {
            const t = e.target;
            if (e.key === "Tab") {
              e.preventDefault();
              document.execCommand("insertText", false, "  ");
            } else if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              const nb = fresh("p");
              insertAfter(b.id, nb, { focus: { id: nb.id } });
            } else if (e.key === "Backspace" && !t.value) {
              e.preventDefault();
              commit(
                cur.current.map(x => (x.id === b.id ? fresh("p", { id: x.id }) : x)),
                { snap: true, focus: { id: b.id } },
              );
            }
          }}/></div>`;
        break;
      case "math":
        body = html`<${MathBlock} b=${b} reg=${reg(b.id)} onText=${v => patch(b.id, { text: v })}
        onDone=${() => {
          const n = cur.current[ix(b.id) + 1];
          if (n && TEXTY.has(n.t)) {
            focus.current = { id: n.id, at: 0 };
            setBs(cur.current.slice());
          } else {
            const nb = fresh("p");
            insertAfter(b.id, nb, { focus: { id: nb.id } });
          }
        }}
        onGone=${() =>
          commit(
            cur.current.map(x => (x.id === b.id ? fresh("p", { id: x.id }) : x)),
            { snap: true, focus: { id: b.id } },
          )}/>`;
        break;
      case "hr":
        body = html`<div class="bhr" tabindex="0" ref=${reg(b.id)} onKeyDown=${e => {
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            remove(b.id);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const nb = fresh("p");
            insertAfter(b.id, nb, { focus: { id: nb.id } });
          }
        }}><hr/></div>`;
        break;
      case "img":
        body = html`<${Img} b=${b} reg=${reg(b.id)} onAlt=${v => patch(b.id, { alt: v })} onDel=${() => remove(b.id)}/>`;
        break;
      case "embed": {
        const m = String(b.url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
        body = html`<div class="bem" tabindex="0" ref=${reg(b.id)} onKeyDown=${e => {
          if (e.target === e.currentTarget && (e.key === "Backspace" || e.key === "Delete")) {
            e.preventDefault();
            remove(b.id);
          }
        }}>${m ? html`<div class="emb"><iframe src=${"https://www.youtube-nocookie.com/embed/" + m[1]} title="YouTube video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"/></div>` : html`<a href=${b.url} target="_blank" rel="noopener noreferrer">${b.url}</a>`}</div>`;
        break;
      }
      case "table":
        body = html`<${Table} b=${b} reg=${reg} set=${rows => patch(b.id, { rows }, { snap: true })} setCell=${(r, c, v) => patch(b.id, { rows: b.rows.map((x, i) => (i === r ? x.map((y, j) => (j === c ? v : y)) : x)) })}/>`;
        break;
      default:
        body = html`<${Editable} text=${b.text || ""} elRef=${reg(b.id)} onText=${(md, el) => onText(b, md, el)} ...${common(b)}/>`;
    }
    return html`<div class=${"br t-" + b.t} key=${b.id} data-id=${b.id} onContextMenu=${e => {
      if (e.shiftKey || e.target.closest("a[href]")) return; /* links get the app's Open link / Copy link menu */
      const s = getSelection();
      if (e.target.closest(".ce") && (touch() || (s && !s.isCollapsed))) return;
      /* touch: long-press in text selects it (the toolbar formats it) */ e.preventDefault();
      openMenu(b.id, { x: e.clientX, y: e.clientY });
    }}>
      <div class="bh"><button class="bp" title="Add a block below" aria-label="Add block below" onClick=${() => {
        const nb = fresh("p");
        insertAfter(b.id, nb, { focus: { id: nb.id } });
        setTimeout(() => {
          const el = els.current[nb.id];
          if (el) {
            document.execCommand("insertText", false, "/");
          }
        }, 40);
      }}><${Icon} n="plus"/></button>
        <button class="bg" title="Drag to move, click for options" aria-label="Block options" onPointerDown=${e => grab(e, b)} onContextMenu=${e => {
          e.preventDefault();
          openMenu(b.id, { x: e.clientX, y: e.clientY });
        }}><i/></button></div>
      <div class="bb">${body}</div></div>`;
  };
  const SL = slash ? slashList(slash.q) : [];
  return html`<div class="bed" ref=${root} onFocusIn=${onFocusIn} onFocusOut=${onFocusOut}>
    <div class="rows">${bs.map(row)}</div>
    <div class="bend" onClick=${() => {
      const l = cur.current[cur.current.length - 1];
      if (l && l.t === "p" && !l.text) {
        focus.current = { id: l.id, at: "end" };
        setBs(cur.current.slice());
      } else {
        const nb = fresh("p");
        insertAfter(l.id, nb, { focus: { id: nb.id } });
      }
    }}/>
    ${drop != null ? html`<div class="dropline" style=${"top:" + drop + "px"}/>` : null}
    ${
      slash && SL.length
        ? html`<div class="flo slm" style=${"left:" + Math.min(slash.x, (root.current ? root.current.clientWidth : 300) - 240) + "px;top:" + (slash.y + 4) + "px"} role="listbox" onMouseDown=${e => e.preventDefault()}>
      <small>Blocks</small>${SL.map((t, k) => html`<button class=${"mi" + (k === slash.sel % SL.length ? " on" : "")} role="option" onClick=${() => pickSlash(t[0])}>${glyph(t[2])}<span><b>${t[1]}</b><em>${t[3]}</em></span></button>`)}</div>`
        : null
    }
    ${
      ac && ac.list.length
        ? html`<div class="flo slm" style=${"left:" + Math.min(ac.x, (root.current ? root.current.clientWidth : 300) - 240) + "px;top:" + (ac.y + 4) + "px"} role="listbox" onMouseDown=${e => e.preventDefault()}>
      <small>Link to page</small>${ac.list.map((t, k) => {
        const p = D.pages.find(x => String(x.title).toLowerCase() === t.toLowerCase());
        return html`<button class=${"mi" + (k === ac.sel ? " on" : "")} role="option" onClick=${() => pickWiki(t)}>${p ? (p.icon ? html`<span class="emj">${p.icon}</span>` : html`<${Icon} n=${p.kind || "note"}/>`) : html`<${Icon} n="plus"/>`}<span><b>${p ? t : "New page: " + t}</b></span></button>`;
      })}</div>`
        : null
    }
    ${
      bar && !bar.below
        ? html`<div class=${"flo fbar" + (bar.below ? " below" : "")} style=${"left:" + bar.x + "px;top:" + bar.y + "px"} onMouseDown=${e => e.preventDefault()}>
      ${[
        ["bold", "B", "Bold (Ctrl+B)"],
        ["italic", "I", "Italic (Ctrl+I)"],
        ["strike", "S", "Strikethrough"],
        ["code", "code", "Code (Ctrl+E)"],
        ["mark", "mark", "Highlight"],
        ["link", "open", "Link (Ctrl+K)"],
        ["wiki", "wiki", "Link to a page"],
      ].map(
        ([k, g, l]) =>
          html`<button class=${"fb f-" + k + (bar.on && bar.on[k] ? " on" : "")} title=${l} aria-label=${l} aria-pressed=${String(!!(bar.on && bar.on[k]))} onClick=${() => fmt(k)}>${g.length === 1 ? html`<b>${g}</b>` : g === "mark" ? html`<b class="hlg">H</b>` : html`<${Icon} n=${g}/>`}</button>`,
      )}</div>`
        : null
    }
    ${
      (kbOn && fbk) || (dock && tbk)
        ? html`<div class=${"kbar" + (kbOn ? "" : " dock")} role="toolbar" aria-label="Editing tools" style=${kbOn ? "bottom:" + kb + "px" : ""} onPointerDown=${e => {
            if (e.target.closest("button")) e.preventDefault();
          }}>
      ${[
        [
          "plus",
          "Insert block",
          () => openSheet({ title: "Insert", Body: InsertMenu, props: { pick: t => insertType(tbk.id, t) } }),
        ],
        ["aa", "Turn into / block options", () => openMenu(tbk.id)],
        ["B", "Bold", sel1(() => fmt("bold")), "bold"],
        ["I", "Italic", sel1(() => fmt("italic")), "italic"],
        ["H", "Highlight", sel1(() => fmt("mark")), "mark"],
        ["open", "Link", sel1(() => fmt("link")), "link"],
        ["task", "To-do", () => turn(tbk.id, tbk.t === "todo" ? "p" : "todo"), null, tbk.t === "todo"],
        ["outdent", "Outdent", () => indent(-1)],
        ["indent", "Indent", () => indent(1)],
        ["undo", "Undo", () => undoIt()],
        kbOn
          ? [
              "chev",
              "Hide keyboard",
              () => {
                const a = document.activeElement;
                if (a && a.blur) a.blur();
                setFid(null);
              },
            ]
          : null,
      ]
        .filter(Boolean)
        .map(
          ([g, l, f, k, on]) =>
            html`<button class=${"kbb" + ((k && fid && bar && bar.on && bar.on[k]) || on ? " on" : "") + (g === "chev" ? " kdone" : "")} aria-label=${l} title=${l} onClick=${f}>${
              g === "aa"
                ? html`<b class="kaa">Aa</b>`
                : g.length === 1
                  ? html`<b class=${"k" + g}>${g}</b>`
                  : html`<${Icon} n=${g}/>`
            }</button>`,
        )}
    </div>`
        : null
    }
    <input ref=${imgIn} type="file" accept="image/*" multiple hidden onChange=${e => {
      addImages([...e.target.files], imgAt.current);
      e.target.value = "";
    }}/>
  </div>`;
}

/* display equation: centred, bigger; click to edit the source (live preview) */

export * from "./editor-parts.js";
