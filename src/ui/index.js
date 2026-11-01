/* The XP kit. Every module is built from these pieces only, so they all look and behave the same. */
import { useState, useRef, useEffect } from "preact/hooks";
import { html, mmss, curSym } from "../core/lib.js";
import { ls, usePref } from "../core/pref.js";
import { Icon, Brand } from "./icons.js";
import { AppIcon, grid as appGrid } from "./appicons.js";
import { ART, AI } from "../core/pack.js";
import { home, second } from "../core/profile.js";
import { useLayout } from "../core/layout.js";
import { fileUrl } from "../core/files.js";
import { WinStickers } from "../shell/stickers.js";
import { on as featOn } from "../core/features.js";
/* "sos:<id>" -> a url (window looks) */
function useSrc(r) {
  const [u, setU] = useState(null);
  useEffect(() => {
    let live = true;
    if (r && r.startsWith("sos:"))
      fileUrl(r.slice(4)).then(
        x => {
          if (live) setU(x);
        },
        () => {},
      );
    else setU(null);
    return () => {
      live = false;
    };
  }, [r]);
  return u;
}
export { Icon, Brand, AppIcon };

/* ---- layout ---- */
export const Tools = ({ children, frm = true, cls = "" }) =>
  html`<div class=${"tools" + (frm ? " frm" : "") + (cls ? " " + cls : "")}>${children}</div>`;
/* the filler takes whatever height a tall window leaves under the content and shows a faint drawing there
   (desktop windows only; hidden when the gap is small) */
export const Panel = ({ children, cls = "" }) =>
  html`<div class=${"panel" + (cls ? " " + cls : "")}>${children}<div class="pfill" aria-hidden="true">${(ART.panelFill || []).map((a, i) => (a ? html`<img class=${"pa" + (i + 1)} src=${a} alt=""/>` : null))}</div></div>`;
/* how wide the window around el is: "xs" <440, "s" <620, "m" <900, "l" (desktop windows; phones are always "xs") */
export const widthOf = w => (w < 440 ? "xs" : w < 620 ? "s" : w < 900 ? "m" : "l");
export function useWinWidth(ref) {
  const [b, setB] = useState("l");
  useEffect(() => {
    const el = ref.current && ref.current.closest(".win");
    if (!el) return;
    const f = () => setB(widthOf(el.clientWidth));
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return b;
}
/* keep: still shown on phones (the rest are hidden there: they mostly repeat the screen) */
/* a status bar only says what the screen doesn't already show; with nothing to say there is none */
export const StatusBar = ({ items = [], keep }) =>
  !items.filter(Boolean).length
    ? null
    : html`<div class=${"statusbar" + (keep ? " keep" : "")}>${items.filter(Boolean).map(t => html`<span>${t}</span>`)}<span/></div>`;
export const Group = ({ title, meta }) =>
  html`<div class="gh"><span>${title}</span>${meta ? html`<span class="gm">${meta}</span>` : null}</div>`;
export const Empty = ({ children, pad }) =>
  html`<div class="emp" style=${pad ? "padding:8px" : ""}>${children || "Nothing here."}</div>`;
export const List = ({ children }) => html`<div class="ll">${children}</div>`;

/* ---- controls ---- */
export const Btn = ({ icon, go, wide, cls = "", children, ...p }) =>
  html`<button type="button" class=${"btn" + (go ? " go" : "") + (icon && (children == null || children === false) ? " ico" : "") + (cls ? " " + cls : "")} style=${wide ? "min-width:" + wide + "px" : p.style} ...${p}>${icon ? html`<${Icon} n=${icon}/>` : null}${children}</button>`;
export const AddBtn = ({ onClick }) => html`<${Btn} go icon="plus" onClick=${onClick}>Add<//>`;
const pick = e => {
  try {
    if (e.target.showPicker) e.target.showPicker();
  } catch {
    // showPicker needs a user gesture in some browsers
  }
};
export const Field = ({ w, cls = "", onEnter, onEsc, inputRef, ...p }) =>
  html`<input ref=${inputRef} onClick=${p.type === "date" || p.type === "time" ? pick : null} class=${"field" + (w ? " " + w : "") + (cls ? " " + cls : "")} maxlength="200" onKeyDown=${e => {
    if (e.key === "Enter" && onEnter) onEnter(e);
    else if (e.key === "Escape" && onEsc) onEsc(e);
  }} ...${p}/>`;
/* a short tick on phones when something gets checked off */
export const tick = () => {
  if (navigator.vibrate && matchMedia("(pointer:coarse)").matches)
    try {
      navigator.vibrate(12);
    } catch {
      // vibration is optional
    }
};
export const Check = ({ on, label = "Done", onClick }) =>
  html`<button class="ck" role="checkbox" aria-checked=${String(!!on)} aria-label=${label} onClick=${e => {
    if (!on) tick();
    onClick && onClick(e);
  }}/>`;
export const Star = ({ on, label = "Pin", onClick }) =>
  html`<button class="star" aria-pressed=${String(!!on)} aria-label=${label} onClick=${onClick}>${on ? "★" : "☆"}</button>`;
export const Del = ({ onClick }) =>
  html`<button class="x1" aria-label="Delete" onClick=${onClick}>×</button>`;
export const Tag = ({ children, k, ...p }) =>
  html`<span class=${"tag" + (k ? " k" : "")} ...${p}>${children}</span>`;
export const Seg = ({ children }) => html`<div class="seg">${children}</div>`;

export function Tabs({ items, cur, onChange, counts }) {
  return html`<div class="tabs" role="tablist">${items.map(([k, l]) => html`<button class="tab" role="tab" aria-selected=${String(k === cur)} onClick=${() => onChange(k)}>${l}${counts && counts[k] != null ? html`<b>${counts[k]}</b>` : null}</button>`)}</div>`;
}

/* dropdown that matches the theme (native <select> never does) */
/* a dropdown list floats on the screen (fixed) under its control, or above it when there's more room there,
   so it never stretches the window it sits in; scrolling what it sits in closes it (not some other window scrolling,
   like Osage's chat following a new message) */
function useFloat(open, setOpen) {
  const ref = useRef(),
    [st, setSt] = useState("");
  useEffect(() => {
    if (!open) {
      setSt("");
      return;
    }
    const el = ref.current;
    if (!el) return;
    const tb = document.querySelector(".taskbar"),
      H = tb && getComputedStyle(tb).display !== "none" ? tb.getBoundingClientRect().top : innerHeight;
    const r = el.getBoundingClientRect(),
      below = H - r.bottom - 6,
      above = r.top - 6,
      up = below < 180 && above > below;
    setSt(
      `position:fixed;left:${Math.round(Math.min(r.left, innerWidth - Math.max(r.width, 120) - 4))}px;min-width:${Math.round(r.width)}px;right:auto;` +
        (up
          ? `bottom:${Math.round(innerHeight - r.top)}px;top:auto;max-height:${Math.round(Math.min(260, above))}px`
          : `top:${Math.round(r.bottom)}px;max-height:${Math.round(Math.min(260, Math.max(80, below)))}px`),
    );
    const off = e => {
      const t = e.target;
      if (t && t.closest && t.closest(".dd")) return; // the list's own scrolling
      if (e.type === "scroll" && t !== document && !(t.contains && t.contains(el))) return;
      setOpen(false);
    };
    addEventListener("scroll", off, true);
    addEventListener("resize", off);
    return () => {
      removeEventListener("scroll", off, true);
      removeEventListener("resize", off);
    };
  }, [open]);
  return [ref, st];
}
export function Select({ opts, value, onChange }) {
  const [open, setOpen] = useState(false),
    [ref, st] = useFloat(open, setOpen);
  const lab = (opts.find(o => o[0] === value) || opts[0])[1];
  return html`<div class="dsel" ref=${ref}>
    <button type="button" class="selb" aria-haspopup="listbox" onClick=${() => setOpen(!open)} onBlur=${() => setTimeout(() => setOpen(false), 120)}><span class="sl">${lab}</span></button>
    ${
      open && st
        ? html`<div class="dd" style=${st}>${opts.map(
            ([k, l]) =>
              html`<button type="button" class=${"mi" + (k === value ? " on" : "")} onMouseDown=${e => {
                e.preventDefault();
                setOpen(false);
                onChange(k);
              }}>${l}</button>`,
          )}</div>`
        : null
    }
  </div>`;
}
/* text input with a suggestion list */
export function Combo({ value, onInput, options, ...p }) {
  const [open, setOpen] = useState(false),
    [ref, st] = useFloat(open, setOpen);
  const v = (value || "").trim().toLowerCase();
  const o = options().filter(x => !v || x.toLowerCase().includes(v));
  return html`<div class="combo" ref=${ref}>
    <${Field} value=${value} onInput=${e => {
      onInput(e.target.value);
      setOpen(true);
    }} onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 120)} ...${p}/>
    ${
      open && st && o.length
        ? html`<div class="dd" style=${st}>${o.map(
            x =>
              html`<button type="button" class="mi" onMouseDown=${e => {
                e.preventDefault();
                onInput(x);
                setOpen(false);
              }}>${x}</button>`,
          )}</div>`
        : null
    }
  </div>`;
}

/* currency picker: the profile's home + second currency */
export const curs = () =>
  [home(), second()].filter(Boolean).map(c => [c, (curSym(c).trim() + " " + c).trim()]);
export const CYC = [
  ["mo", "Monthly"],
  ["yr", "Yearly"],
];
export const TYP = [
  ["out", "Spent"],
  ["in", "Earned"],
];
export const DIRS = [
  ["owe", "I owe"],
  ["owed", "Owed to me"],
];
const SEL = {
  get cur() {
    return curs();
  },
  cycle: CYC,
  type: TYP,
  dir: DIRS,
};

/* inline edit row. specs: [{k, t:text|num|date|time|cur|cycle|type|dir, ph, w}] */
export function EditRow({ specs, init, onSave, onCancel }) {
  const [v, setV] = useState(() =>
    Object.fromEntries(
      specs.map(s => [
        s.k,
        init[s.k] == null
          ? s.t === "cur"
            ? home()
            : s.t === "cycle"
              ? "mo"
              : s.t === "type"
                ? "out"
                : s.t === "dir"
                  ? "owe"
                  : ""
          : init[s.k],
      ]),
    ),
  );
  const ref = useRef();
  useEffect(() => {
    const f = ref.current && ref.current.querySelector("input");
    if (f) f.focus();
  }, []);
  const go = () => {
    const o = {};
    for (const s of specs) {
      const x = v[s.k];
      o[s.k] = s.t === "num" ? parseFloat(x) || 0 : typeof x === "string" ? x.trim() : x;
    }
    onSave(o);
    onCancel();
  };
  return html`<div class="lr edit" ref=${ref}>
    ${specs.map(s =>
      SEL[s.t]
        ? html`<${Select} opts=${SEL[s.t]} value=${v[s.k]} onChange=${x => setV({ ...v, [s.k]: x })}/>`
        : html`<${Field} w=${s.w} type=${s.t === "num" ? "number" : s.t === "date" ? "date" : s.t === "time" ? "time" : "text"} step=${s.t === "num" ? "any" : null} inputMode=${s.t === "num" ? "decimal" : null} placeholder=${s.ph || ""} aria-label=${s.ph || s.k} value=${v[s.k]} onInput=${e => setV({ ...v, [s.k]: e.target.value })} onEnter=${go} onEsc=${onCancel}/>`,
    )}
    <${Btn} go wide=${56} onClick=${go}>Save<//><${Btn} wide=${56} onClick=${onCancel}>Cancel<//>
  </div>`;
}
/* hook: which row is being edited */
export const useEditing = () => {
  const [id, set] = useState(null);
  return [id, set, () => set(null)];
};

/* ---- window ----
   Desktop: windows float on a desk that is exactly the viewport. Each keeps {x,y,w,h,max} in pref os-pos;
   drag the title bar, resize from the right/bottom edges or the corner, double-click the title to maximise.
   A newly opened window lands on top, cascaded, as tall as the work area. Drag a title bar to the left/right
   edge = half the screen, to the top = maximise (dragging a snapped window away gives its old size back).
   tileWindows() lays every open window out side by side. Phones: one full-screen window, none of this. */
let zTop = 20;
const SIZES = {
  today: [640],
  plan: [900],
  notes: [1000],
  buddy: [720],
  money: [720],
  jobs: [760],
  sync: [540, 380],
  nijika: [900],
};
const wide = () => matchMedia("(min-width:861px)").matches;
const deskBox = () => {
  const d = document.getElementById("mcol");
  return d ? { w: d.clientWidth, h: d.clientHeight } : { w: innerWidth, h: innerHeight - 200 };
};
/* stacking order survives reloads: os-z lists window ids bottom -> top */
const raise = id => {
  const o = ls.get("os-z", []).filter(x => x !== id);
  o.push(id);
  ls.set("os-z", o);
  return ++zTop;
};
const zInit = id => {
  const o = ls.get("os-z", []),
    i = o.indexOf(id);
  zTop = Math.max(zTop, 20 + o.length);
  return i < 0 ? raise(id) : 20 + i;
};
export const front = id => window.dispatchEvent(new CustomEvent("os-front", { detail: id }));
/* locked windows (pref os-lock, this device) stay where they are like the desktop widgets: no drag, no resize,
   no maximise, and they sit under the other windows */
/* maximise/restore from outside the window (right-click menus) */
export const maxWin = id => window.dispatchEvent(new CustomEvent("os-max", { detail: id }));
export const isMaxed = id => !!(ls.get("os-pos", {})[id] || {}).max;
export const isLocked = id => ls.get("os-lock", []).includes(id);
export const setLocked = (id, v) => {
  ls.set("os-lock", [...ls.get("os-lock", []).filter(x => x !== id), ...(v ? [id] : [])]);
  dispatchEvent(new CustomEvent("os-lock", { detail: id }));
};
/* where the desk starts under the header: new windows open there, but can be dragged anywhere */
const deskTop = () => {
  const d = document.querySelector(".desk"),
    m = document.getElementById("mcol");
  return d ? Math.round(d.getBoundingClientRect().top - (m ? m.getBoundingClientRect().top : 0)) + 10 : 0;
};
/* the work area: under the header, left of the desk widgets, down to the taskbar */
const work = () => {
  const D = deskBox(),
    T = deskTop(),
    side = D.w >= 1100 ? 236 : 0;
  return { x: 16, y: T, w: D.w - side - 28, h: D.h - T - 8 };
};
function place(id) {
  const D = deskBox(),
    A = work(),
    [w0, h0] = SIZES[id] || [640],
    w = Math.min(w0, A.w),
    h = Math.min(h0 || A.h, A.h);
  const open = [...document.querySelectorAll("#mcol > .win")].filter(e => e.dataset.win !== id).length;
  /* Today + Jobs split the work area; anything else cascades on top */
  const tw = Math.floor((A.w - 12) * 0.5);
  if (id === "today") return { x: A.x, y: A.y, w: A.w >= 900 ? tw : w, h };
  if (id === "jobs" && A.w >= 900) return { x: A.x + tw + 12, y: A.y, w: A.w - tw - 12, h };
  const k = open % 6,
    hh = Math.min(h, A.h - k * 26);
  return { x: Math.min(A.x + k * 30, D.w - w - 8), y: A.y + k * 26, w, h: hh };
}
/* Tile: the window you're using (top of the stack) gets the big column on the left, sized for what it holds;
   the rest share the remaining columns, stacked when there are more windows than columns fit. Each window's
   weight says how much room its content wants (Notes and Plan more than Money). */
const WEIGHT = {
  notes: 1.6,
  plan: 1.4,
  jobs: 1.15,
  today: 1.1,
  buddy: 1,
  money: 0.9,
  nijika: 1.3,
  sync: 0.7,
};
export function tileWindows() {
  const open = [...document.querySelectorAll("#mcol > .win.fl:not(.min)")].map(e => e.dataset.win);
  if (!open.length) return;
  const z = ls.get("os-z", []),
    ids = open.slice().sort((a, b) => z.indexOf(b) - z.indexOf(a)); /* top first */
  const A = work(),
    g = 10,
    n = ids.length,
    P = ls.get("os-pos", {}),
    wt = id => WEIGHT[id] || 1;
  const fit = Math.max(1, Math.floor((A.w + g) / (380 + g))),
    rowsMax = Math.max(1, Math.floor((A.h + g) / (240 + g)));
  let cols;
  if (n <= fit) cols = ids.map(id => [id]); /* one row, side by side */
  else {
    /* master column + the rest stacked into as few columns as their heights allow */
    /* narrower columns (down to 300px, which windows now handle) beat windows too short to use */
    const rest = ids.slice(1),
      most = Math.max(fit, Math.floor((A.w + g) / (300 + g))) - 1,
      k = Math.max(1, Math.min(most, Math.ceil(rest.length / rowsMax)));
    cols = [[ids[0]]];
    for (let c = 0; c < k; c++) cols.push([]);
    rest.forEach((id, i) => cols[1 + (i % k)].push(id));
  }
  const cw = cols.map(
    (c, i) => ((i === 0 && n > cols.length ? 1.25 : 1) * c.reduce((a, id) => a + wt(id), 0)) / c.length,
  );
  const tot = cw.reduce((a, b) => a + b, 0),
    free = A.w - g * (cols.length - 1);
  /* no column under 300px (a window's minimum): the side columns get at least that, the master takes what's left */
  let W = cw.map(v => Math.round((free * v) / tot));
  if (W.some(v => v < 300)) {
    const side = W.slice(1).map(v => Math.max(300, v)),
      rest = free - side.reduce((a, b) => a + b, 0);
    W = rest >= 300 ? [rest, ...side] : cw.map(() => Math.floor(free / cw.length));
  }
  let x = A.x;
  cols.forEach((c, i) => {
    const w = i === cols.length - 1 ? A.x + A.w - x : W[i];
    const ht = c.reduce((a, id) => a + wt(id), 0),
      fh = A.h - g * (c.length - 1);
    let y = A.y;
    c.forEach((id, j) => {
      const h = j === c.length - 1 ? A.y + A.h - y : Math.round((fh * wt(id)) / ht);
      P[id] = { x, y, w, h };
      y += h + g;
    });
    x += w + g;
  });
  ls.set("os-pos", P);
  ids
    .slice()
    .reverse()
    .forEach(id => dispatchEvent(new CustomEvent("os-front", { detail: id })));
  dispatchEvent(new Event("os-layout"));
}
/* the window on top (for Alt+W) */
export const topWindow = () => {
  const o = ls.get("os-z", []),
    open = [...document.querySelectorAll("#mcol > .win.fl:not(.min)")].map(e => e.dataset.win);
  for (let i = o.length - 1; i >= 0; i--) if (open.includes(o[i])) return o[i];
  return open[0] || "";
};
let snapEl = null;
const snapShow = r => {
  if (!r) {
    if (snapEl) snapEl.hidden = true;
    return;
  }
  if (!snapEl) {
    snapEl = document.createElement("div");
    snapEl.className = "snapv";
    document.getElementById("mcol").appendChild(snapEl);
  }
  Object.assign(snapEl.style, { left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
  snapEl.hidden = false;
};
/* positions used to be measured from the desk under the header; shift saved ones once so nothing jumps */
let migrated = false;
function migrate() {
  if (migrated || ls.get("os-pos-v", 1) >= 2) return;
  migrated = true;
  const T = deskTop();
  if (!T) return;
  const P = ls.get("os-pos", {});
  Object.values(P).forEach(p => {
    if (p && p.w) {
      p.x += 12;
      p.y += T;
    }
  });
  ls.set("os-pos", P);
  ls.set("os-pos-v", 2);
}
const clamp = (p, D) => {
  const w = Math.max(300, Math.min(p.w, D.w)),
    h = Math.max(150, Math.min(p.h, D.h));
  return {
    ...p,
    w,
    h,
    x: Math.max(80 - w, Math.min(p.x, D.w - 80)),
    y: Math.max(0, Math.min(p.y, D.h - 30)),
  };
};
export function Window({
  id,
  title,
  mod = true,
  cur,
  min,
  onMin,
  onClose,
  cls = "",
  children,
  label,
  desk,
  deco,
}) {
  const ref = useRef(),
    [pos, setPos] = useState(null),
    [z, setZ] = useState(() => zInit(id)),
    [lk, setLk] = useState(() => isLocked(id));
  useEffect(() => {
    const f = e => {
      if (e.detail === id) setLk(isLocked(id));
    };
    addEventListener("os-lock", f);
    return () => removeEventListener("os-lock", f);
  }, [id]);
  const locked = desk && lk;
  /* window look (core/layout.js win): a picture behind the content and every content surface (paper, rows, toolbars, strips)
     made see-through by op, on .mbody only so the frame, title bar and buttons stay solid; a title bar picture */
  const lw = (useLayout().win || {})[id] || {},
    bgU = useSrc(lw.bg && lw.bg.src),
    capU = useSrc(lw.cap && lw.cap.src);
  let look = "",
    inner = "";
  if (bgU) {
    const cs = getComputedStyle(document.documentElement),
      k = Math.round((1 - Math.max(0.05, Math.min(0.95, lw.bg.op ?? 0.35))) * 100),
      see = v => `color-mix(in srgb,${cs.getPropertyValue(v).trim() || "#fff"} ${k}%,transparent)`;
    look += `--wbg:url("${bgU}");`;
    inner = ["--paper", "--alt", "--face", "--face-2", "--hover"].map(v => `${v}:${see(v)}`).join(";");
  }
  if (capU) look += `--wcap:url("${capU}");`;
  const save = p => {
    const P = ls.get("os-pos", {});
    P[id] = p;
    ls.set("os-pos", P);
  };
  /* first layout (and after "Reset layout"): stored spot or a fresh cascaded one; keep it on screen when the viewport changes */
  useEffect(() => {
    if (!desk) return;
    const load = () => {
      migrate();
      const P = ls.get("os-pos", {})[id];
      const D = deskBox();
      setPos(clamp(P && P.w ? P : place(id), D));
    };
    load();
    const r = () => setPos(p => p && clamp(p, deskBox()));
    addEventListener("resize", r);
    addEventListener("os-layout", load);
    const f = e => {
      if (e.detail === id) setZ(raise(id));
    };
    addEventListener("os-front", f);
    return () => {
      removeEventListener("resize", r);
      removeEventListener("os-layout", load);
      removeEventListener("os-front", f);
    };
  }, [id, desk]);
  const drag = (e, mode) => {
    if (
      !desk ||
      locked ||
      e.button !== 0 ||
      !pos ||
      (mode === "move" && (e.target.closest(".cap") || pos.max))
    )
      return;
    e.preventDefault();
    const t = e.currentTarget,
      sx = e.clientX,
      sy = e.clientY,
      D = deskBox(),
      M = document.getElementById("mcol").getBoundingClientRect();
    setZ(raise(id));
    let p0 = { ...pos };
    /* a snapped window pulled away gets its own size back, under the pointer where it was grabbed */
    if (mode === "move" && p0.r) {
      const f = (sx - M.left - p0.x) / p0.w;
      p0 = { x: Math.round(sx - M.left - p0.r.w * f), y: p0.y, w: p0.r.w, h: p0.r.h };
    }
    t.setPointerCapture(e.pointerId);
    document.body.classList.add(mode === "move" ? "wm-move" : "wm-size");
    let last = p0,
      snap = null;
    const mv = ev => {
      const dx = ev.clientX - sx,
        dy = ev.clientY - sy;
      let n = { ...p0 };
      if (mode !== "move") delete n.r;
      if (mode === "move") {
        n.x = p0.x + dx;
        n.y = p0.y + dy;
        const px = ev.clientX - M.left,
          py = ev.clientY - M.top;
        snap =
          px <= 6
            ? { x: 0, y: 0, w: Math.round(D.w / 2), h: D.h }
            : px >= D.w - 6
              ? { x: Math.round(D.w / 2), y: 0, w: D.w - Math.round(D.w / 2), h: D.h }
              : py <= 4
                ? "max"
                : null;
        snapShow(snap === "max" ? { x: 0, y: 0, w: D.w, h: D.h } : snap);
      } else {
        if (mode.includes("e")) n.w = p0.w + dx;
        if (mode.includes("s")) n.h = p0.h + dy;
        if (mode.includes("n")) {
          n.h = Math.max(150, p0.h - dy);
          n.y = p0.y + p0.h - n.h;
        }
        if (mode.includes("w")) {
          n.w = Math.max(300, p0.w - dx);
          n.x = p0.x + p0.w - n.w;
        }
      }
      if (mode !== "move") {
        n.w = Math.max(300, Math.min(n.w, D.w - Math.max(0, n.x)));
        n.h = Math.max(150, Math.min(n.h, D.h - Math.max(0, n.y)));
      }
      last = clamp(n, D);
      setPos(last);
    };
    const up = () => {
      t.removeEventListener("pointermove", mv);
      t.removeEventListener("pointerup", up);
      t.removeEventListener("pointercancel", up);
      document.body.classList.remove("wm-move", "wm-size");
      snapShow(null);
      const r = { w: p0.w, h: p0.h };
      if (snap === "max") last = { ...p0, max: true };
      else if (snap) last = { ...snap, r };
      setPos(last);
      save(last);
    };
    t.addEventListener("pointermove", mv);
    t.addEventListener("pointerup", up);
    t.addEventListener("pointercancel", up);
  };
  const toggleMax = () => {
    if (!desk || !pos || locked) return;
    const n = { ...pos, max: !pos.max };
    setPos(n);
    save(n);
    setZ(raise(id));
  };
  useEffect(() => {
    const f = e => e.detail === id && toggleMax();
    addEventListener("os-max", f);
    return () => removeEventListener("os-max", f);
  });
  const cap = (c, l, fn, kids) =>
    html`<span class=${"cap " + c} role="button" tabindex="0" aria-label=${l} title=${l} onClick=${fn} onKeyDown=${e => {
      if (e.key === "Enter" || e.key === " ") fn();
    }}>${kids || html`<i/>`}</span>`;
  /* width bucket for CSS: .win[data-w=s] ... (set straight on the element, no re-render) */
  useEffect(() => {
    const el = ref.current;
    if (!el || !desk) return;
    const f = () => {
      const b = widthOf(el.clientWidth);
      if (el.dataset.w !== b) el.dataset.w = b;
    };
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desk]);
  const zz = locked ? 3 : z;
  const st =
    (desk && pos
      ? pos.max
        ? `left:0;top:0;width:100%;height:100%;z-index:${zz};`
        : `left:${pos.x}px;top:${pos.y}px;width:${pos.w}px;height:${pos.h}px;z-index:${zz};`
      : "") + look;
  return html`<section ref=${ref} data-win=${id} class=${"win" + (mod ? " mod" : "") + (cls ? " " + cls : "") + (cur ? " cur" : "") + (min ? " min" : "") + (desk ? " fl" : "") + (pos && pos.max ? " max" : "") + (locked ? " lk" : "")} data-wbg=${bgU ? "" : null} data-wcap=${capU ? "" : null} style=${st} aria-label=${label || title}
      onPointerDownCapture=${() => {
        if (desk && !locked && z !== zTop) setZ(raise(id));
      }}>
    <div class="tb" onPointerDown=${e => drag(e, "move")} onDblClick=${e => {
      if (!e.target.closest(".cap")) toggleMax();
    }}>${appGrid(id) ? html`<${AppIcon} id=${id}/>` : null}<span class="t">${title}</span>
      ${desk && id !== "buddy" && id !== "sync" && featOn("ai") ? cap("ai", "Ask " + AI.name + " about this", () => window.dispatchEvent(new CustomEvent("os-ask", { detail: id })), html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v8H8l-3.5 3v-3H2z"/></svg>`) : null}
      ${locked ? cap("lkc", "Locked in place: click to unlock", () => setLocked(id, false), html`<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>`) : null}
      ${onMin ? cap("mn", "Minimise", onMin) : null}${desk && !locked ? cap("mx" + (pos && pos.max ? " on" : ""), pos && pos.max ? "Restore" : "Maximise", toggleMax) : null}${onClose ? cap("x", "Close", onClose) : null}</div>
    ${mod ? html`<div class="mbody" style=${inner}>${children}</div>` : desk ? html`<div class="mbody nb" style=${inner}>${children}</div>` : children}
    ${deco || null}${desk ? html`<${WinStickers} win=${id}/>` : null}
    ${desk && !locked && !(pos && pos.max) ? html`<i class="rz re" onPointerDown=${e => drag(e, "e")}/><i class="rz rs" onPointerDown=${e => drag(e, "s")}/><i class="rz rw" onPointerDown=${e => drag(e, "w")}/><i class="rz rse" onPointerDown=${e => drag(e, "se")}/><i class="rz rsw" onPointerDown=${e => drag(e, "sw")}/><i class="rz rn" onPointerDown=${e => drag(e, "n")}/><i class="rz rnw" onPointerDown=${e => drag(e, "nw")}/><i class="rz rne" onPointerDown=${e => drag(e, "ne")}/>` : null}
  </section>`;
}
export const resetWindowPositions = () => {
  ls.set("os-pos", {});
  dispatchEvent(new Event("os-layout"));
};
