/* Theme editor > Icons: redraw any app icon cell by cell, in the five theme shades or up to 16 colours of its own. Every stroke saves to config/look (core/look.js setIcon),
   so the taskbar, tabs and title bars change as you draw; Reset puts the pack's drawing back. */
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { useCols } from "../core/store.js";
import { AI } from "../core/pack.js";
import { setIcon, iconSet, useLook } from "../core/look.js";
import { PX, PAL, grid, rects, rowsOf, palOf, AppIcon } from "../ui/appicons.js";
import { UX } from "../ui/uiicons.js";
import { Tools, Btn, Group, Seg } from "../ui/index.js";
import { actionSheet } from "../ui/sheet.js";

const NAMES = () => [
  ["today", "Today"],
  ["habits", "Habits"],
  ["timer", "Timer"],
  ["plan", "Plan"],
  ["calendar", "Calendar"],
  ["board", "Board"],
  ["reminders", "Reminders"],
  ["notes", "Notes"],
  ["inbox", "Inbox"],
  ["tools", "Tools"],
  ["whiteboard", "Draw"],
  ["graph", "Graph"],
  ["gcalc", "Calc"],
  ["links", "Links"],
  ["buddy", AI.name],
  ["money", "Spending"],
  ["subs", "Subs"],
  ["loans", "Loans"],
  ["wishlist", "Wishlist"],
  ["jobs", "Jobs"],
  ["sync", "Sync"],
  ["nijika", "Home server"],
  ["theme", "Theme"],
  ["profile", "Profile"],
  ["moodle", "Moodle"],
  ["models", "Models"],
  ["cmd", "Command"],
];
/* the interface icons (pixel twins of the line icons: buttons, toolbars, menus) */
const CALL = {
  selall: "Select all",
  chev: "Chevron",
  svc: "Service",
  term: "Terminal",
  wiki: "Wiki link",
  applied: "Check",
  gear: "Settings",
  graphc: "Graphing",
};
const MENU = Object.keys(UX).map(k => [k, CALL[k] || k[0].toUpperCase() + k.slice(1)]);
const INKS = [
  ["K", "Ink"],
  ["D", "Dark"],
  ["M", "Mid"],
  ["L", "Light"],
  ["W", "White"],
  [".", "Clear"],
];
const SHADE = { K: 17, D: 85, M: 138, L: 200, W: 255 };

/* the board's cell lines live in the same 16x16 space as the pixels, so they always line up */
const LINES = Array.from({ length: 15 }, (_, i) => `M${i + 1} 0V16M0 ${i + 1}H16`).join("");
const OVER = `<path class="icgl" d="${LINES}"/>`;
const toRows = cells => Array.from({ length: 16 }, (_, y) => cells.slice(y * 16, y * 16 + 16).join(""));
const toCells = g => rowsOf(g).join("").split("");
/* cells + colours -> what's stored: plain rows unless a colour of its own is used */
const enc = (c, p) => {
  const r = toRows(c);
  return r.some(x => /[0-9a-f]/.test(x)) ? { r, p } : r;
};
const hex = (r, g, b) => "#" + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, "0")).join("");
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function flood(c, x, y, ink) {
  const from = c[y * 16 + x];
  if (from === ink) return c;
  const n = [...c],
    st = [[x, y]];
  while (st.length) {
    const [a, b] = st.pop();
    if (a < 0 || b < 0 || a > 15 || b > 15 || n[b * 16 + a] !== from) continue;
    n[b * 16 + a] = ink;
    st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
  }
  return n;
}
/* a picture -> 16x16: greys become the theme shades, colours keep their own (the 16 most common); transparent stays clear */
function fromPicture(file) {
  return new Promise((ok, no) => {
    const u = URL.createObjectURL(file),
      i = new Image();
    i.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const k = 16 / Math.max(i.width, i.height),
        w = i.width * k,
        h = i.height * k,
        x = c.getContext("2d");
      x.drawImage(i, (16 - w) / 2, (16 - h) / 2, w, h);
      URL.revokeObjectURL(u);
      const d = x.getImageData(0, 0, 16, 16).data,
        cells = [],
        seen = new Map();
      for (let q = 0; q < 256; q++) {
        const c = [d[q * 4], d[q * 4 + 1], d[q * 4 + 2]];
        if (d[q * 4 + 3] < 110) cells.push(".");
        else if (Math.max(...c) - Math.min(...c) < 24) {
          const v = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
          cells.push(
            Object.keys(SHADE).reduce((a, b) => (Math.abs(SHADE[b] - v) < Math.abs(SHADE[a] - v) ? b : a)),
          );
        } else {
          const k = hex(...c.map(v => Math.round(v / 32) * 32));
          seen.set(k, (seen.get(k) || 0) + 1);
          cells.push(c);
        }
      }
      /* most common first; a colour close to one already kept (soft edges) folds into it */
      const p = [];
      for (const [k] of [...seen].sort((a, b) => b[1] - a[1]))
        if (p.length < 16 && !p.some(c => dist(rgb(c), rgb(k)) < 3600)) p.push(k);
      const pr = p.map(rgb);
      ok({
        cells: cells.map(c =>
          typeof c === "string" ? c : PAL[pr.reduce((a, v, i) => (dist(v, c) < dist(pr[a], c) ? i : a), 0)],
        ),
        p,
      });
    };
    i.onerror = () => {
      URL.revokeObjectURL(u);
      no(new Error("That file isn't an image"));
    };
    i.src = u;
  });
}

export function IconTab() {
  useCols("config");
  useLook();
  const [id, setId] = useState("today"),
    [cells, setCells] = useState(() => toCells(grid("today"))),
    [pal, setPal] = useState(() => palOf(grid("today"))),
    [ink, setInk] = useState("K"),
    [tool, setTool] = useState("pen"),
    hist = useRef([]),
    redo = useRef([]),
    wrap = useRef(),
    down = useRef(null),
    fi = useRef(),
    ci = useRef(),
    recolor = useRef(-1),
    board = useRef();
  const pick = n => {
    setId(n);
    setCells(toCells(grid(n)));
    setPal(palOf(grid(n)));
    hist.current = [];
    redo.current = [];
  };
  useEffect(() => {
    if (down.current) return;
    setCells(toCells(grid(id)));
    setPal(p => {
      const g = palOf(grid(id));
      /* keep colours added here but not used yet */
      return g.length >= p.length || p.slice(0, g.length).join() !== g.join() ? g : p;
    });
  }, [id, JSON.stringify(grid(id))]);
  const save = (c, before, p = pal, pb = pal) => {
    hist.current = [...hist.current.slice(-40), [before, pb]];
    redo.current = [];
    setIcon(id, enc(c, p));
  };
  const at = e => {
    const r = board.current.getBoundingClientRect(),
      x = Math.floor(((e.clientX - r.left) / r.width) * 16),
      y = Math.floor(((e.clientY - r.top) / r.height) * 16);
    return x < 0 || y < 0 || x > 15 || y > 15 ? null : [x, y];
  };
  const paint = (c, p) => {
    if (!p || c[p[1] * 16 + p[0]] === down.current.ink) return c;
    const n = [...c];
    n[p[1] * 16 + p[0]] = down.current.ink;
    return n;
  };
  const onDown = e => {
    const p = at(e);
    if (!p) return;
    e.preventDefault();
    /* right-click / pen eraser button = clear */
    const use = e.button === 2 || e.button === 5 ? "." : ink;
    if (tool === "fill") {
      const n = flood(cells, p[0], p[1], use);
      if (n !== cells) {
        setCells(n);
        save(n, cells);
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = { ink: use, before: cells };
    setCells(c => paint(c, p));
  };
  const onMove = e => {
    if (!down.current) return;
    (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach(ev => setCells(c => paint(c, at(ev))));
  };
  const onUp = () => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    setCells(c => {
      if (c.join("") !== d.before.join("")) save(c, d.before);
      return c;
    });
  };
  const step = (from, to, none) => {
    const b = from.current.pop();
    if (!b) return toast(none);
    to.current = [...to.current, [cells, pal]];
    setCells(b[0]);
    setPal(b[1]);
    setIcon(id, enc(b[0], b[1]));
  };
  const undo = () => step(hist, redo, "Nothing to undo"),
    again = () => step(redo, hist, "Nothing to redo");
  /* Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z while nothing else has focus (or focus is in the editor) */
  const keys = useRef();
  keys.current = { undo, again };
  useEffect(() => {
    const f = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const a = document.activeElement;
      if (a && a !== document.body && !(wrap.current && wrap.current.contains(a))) return;
      if (!wrap.current || !wrap.current.offsetParent) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) keys.current.undo();
      else if (k === "y" || (k === "z" && e.shiftKey)) keys.current.again();
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);
  const set = (n, msg, p = pal) => {
    save(n, cells, p);
    setCells(n);
    setPal(p);
    if (msg) toast(msg);
  };
  /* the colour input either adds a colour or changes one (every cell drawn in it changes with it) */
  const colour = v => {
    const i = recolor.current;
    if (i >= 0) {
      const p = pal.map((c, j) => (j === i ? v : c));
      return set(cells, null, p);
    }
    if (pal.includes(v)) return setInk(PAL[pal.indexOf(v)]);
    if (pal.length >= 16) return toast("16 colours per icon");
    setPal([...pal, v]);
    setInk(PAL[pal.length]);
  };
  /* the browser opens its colour picker where the input is, so move the (invisible) input to the button first */
  const openColour = (i, e) => {
    recolor.current = i;
    const c = ci.current,
      b = e && e.currentTarget.getBoundingClientRect();
    if (b) c.style.cssText = `left:${b.left}px;top:${b.bottom}px`;
    c.value = i >= 0 ? pal[i] : "#3a6ea5";
    c.click();
  };
  const tidy = () => {
    const used = [...new Set(cells.filter(c => PAL.includes(c)))].sort(),
      p = used.map(c => pal[PAL.indexOf(c)]),
      n = cells.map(c => (PAL.includes(c) ? PAL[used.indexOf(c)] : c));
    set(
      n,
      pal.length - p.length ? "Removed " + (pal.length - p.length) + " unused" : "Every colour is in use",
      p,
    );
    if (PAL.includes(ink) && !used.includes(ink)) setInk("K");
  };
  const names = [...NAMES(), ...MENU],
    label = (names.find(x => x[0] === id) || [id, id])[1];
  const menu = e =>
    actionSheet(
      label,
      [
        [
          "copy",
          "Start from another icon…",
          () =>
            actionSheet(
              "Copy from",
              names
                .filter(x => x[0] !== id)
                .map(([k, l]) => [k, l, () => set(toCells(grid(k)), "Copied " + l, palOf(grid(k)))]),
            ),
        ],
        ["image", "From a picture…", () => fi.current.click()],
        ["mirror", "Mirror", () => set(toCells(toRows(cells).map(r => [...r].reverse().join(""))))],
        pal.length ? ["trash", "Remove unused colours", tidy] : null,
        ["trash", "Clear", () => set(Array(256).fill("."))],
        "-",
        iconSet(id)
          ? [
              "undo",
              "Reset to original",
              () => {
                hist.current = [...hist.current, [cells, pal]];
                setIcon(id, null);
                setCells(toCells(PX[id] || UX[id] || PX.plan));
                setPal([]);
                toast(label + " reset", { label: "Undo", run: undo });
              },
            ]
          : null,
      ],
      e.currentTarget,
    );
  const svg = rects(enc(cells, pal));
  return html`
    <div class="thg" ref=${wrap}><${Group} title="Icons"/>
      <div class="icpk" role="listbox" aria-label="App icons">${NAMES().map(
        ([k, l]) =>
          html`<button type="button" key=${k} role="option" class=${"btn icpi" + (iconSet(k) ? " mine" : "")} aria-selected=${String(k === id)} title=${l} aria-label=${l} onClick=${() => pick(k)}><${AppIcon} id=${k}/></button>`,
      )}</div>
      <${Group} title="Interface icons"/>
      <div class="icpk" role="listbox" aria-label="Interface icons">${MENU.map(
        ([k, l]) =>
          html`<button type="button" key=${k} role="option" class=${"btn icpi" + (iconSet(k) ? " mine" : "")} aria-selected=${String(k === id)} title=${l} aria-label=${l} onClick=${() => pick(k)}><${AppIcon} id=${k}/></button>`,
      )}</div>
      <div class="iced">
        <svg ref=${board} class="aic icbd" viewBox="0 0 16 16" role="img" aria-label=${label + " icon, 16 by 16"}
          onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp} onContextMenu=${e => e.preventDefault()}
          dangerouslySetInnerHTML=${{ __html: svg + OVER }}/>
        <div class="icside">
          <b class="icname">${label}${iconSet(id) ? html`<small> · yours</small>` : null}</b>
          <div class="icinks">${INKS.map(
            ([k, l]) =>
              html`<button type="button" key=${k} class=${"btn icink"} aria-pressed=${String(ink === k)} title=${l} aria-label=${l} onClick=${() => setInk(k)}><i class=${"ics ics-" + (k === "." ? "x" : k)}/></button>`,
          )}</div>
          <div class="icinks icpal">${pal.map(
            (c, i) =>
              html`<button type="button" key=${i} class="btn icink" aria-pressed=${String(ink === PAL[i])} title=${c + (ink === PAL[i] ? " (tap again to change)" : "")} aria-label=${"Colour " + c}
                onClick=${e => (ink === PAL[i] ? openColour(i, e) : setInk(PAL[i]))}><i class="ics" style=${"background:" + c}/></button>`,
          )}${pal.length < 16 ? html`<${Btn} cls="icink icadd" icon="plus" aria-label="Add a colour" title="Add a colour" onClick=${e => openColour(-1, e)}/>` : null}</div>
          <input ref=${ci} type="color" class="iccol" tabindex="-1" aria-hidden="true" onChange=${e => colour(e.target.value.toLowerCase())}/>
          <${Tools}><${Seg}>
            <${Btn} icon="pen" aria-pressed=${String(tool === "pen")} onClick=${() => setTool("pen")}>Pen<//>
            <${Btn} icon="bucket" aria-pressed=${String(tool === "fill")} onClick=${() => setTool("fill")}>Fill<//>
          <//><${Btn} icon="undo" aria-label="Undo" title="Undo (Ctrl+Z)" onClick=${undo}/><${Btn} icon="redo" aria-label="Redo" title="Redo (Ctrl+Y)" onClick=${again}/><${Btn} icon="more" aria-label="More" onClick=${menu}/><//>
          <div class="icprev">
            <span><svg class="ic aic" viewBox="0 0 16 16" dangerouslySetInnerHTML=${{ __html: svg }}/><svg class="aic ic32" viewBox="0 0 16 16" dangerouslySetInnerHTML=${{ __html: svg }}/></span>
            <span class="dk"><svg class="ic aic" viewBox="0 0 16 16" dangerouslySetInnerHTML=${{ __html: svg }}/><svg class="aic ic32" viewBox="0 0 16 16" dangerouslySetInnerHTML=${{ __html: svg }}/></span>
          </div>
        </div>
      </div>
      <input ref=${fi} type="file" accept="image/*" hidden onChange=${async e => {
        const f = e.target.files[0];
        e.target.value = "";
        if (!f) return;
        try {
          const g = await fromPicture(f);
          set(g.cells, "Picture turned into pixels", g.p);
        } catch (err) {
          toast(err.message);
        }
      }}/>
    </div>`;
}
