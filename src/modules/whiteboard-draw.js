/* The whiteboard's drawing layer: tools and colours, item geometry and hit tests, painting to a canvas, PNG export, and undo history. */
import { ls } from "../core/pref.js";
import { W, D } from "../core/store.js";
import { toast } from "../core/bus.js";
import { openMod } from "../shell/os.js";
import { byTitle, openPage, makePage } from "./pages.js";
import { decode, outline, centerline, distSeg } from "../core/ink.js";
import { layoutText, drawLayout } from "../core/mathtype.js";

const TOOLS = [
  ["select", "pointer", "Select", "v"],
  ["hand", "hand", "Pan", "h"],
  ["pen", "pen", "Pen", "p"],
  ["hl", "marker", "Highlighter", "m"],
  ["eraser", "eraser", "Eraser", "e"],
  ["text", "text", "Text", "t"],
  ["note", "sticky", "Sticky note", "n"],
  ["r", "rect", "Rectangle", "r"],
  ["e", "ellipse", "Ellipse", "o"],
  ["a", "arrow", "Arrow", "a"],
  ["l", "line", "Line", "l"],
];
const PEN = ["", "#e03131", "#1c7ed6", "#2f9e44", "#f08c00", "#9c36b5", "#868e96"];
const HL = ["#ffd43b", "#69db7c", "#f783ac", "#4dabf7", "#ffa94d"];
const NOTE = ["#fff3a3", "#ffd6e7", "#d0ebff", "#d3f9d8", "#ececec"];
const SZ = {
  pen: [2.5, 5, 10],
  hl: [14, 24, 40],
  shape: [2, 3.5, 6],
  text: [18, 28, 44],
  note: [16, 22, 32],
};
const NPAD = 0.75;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const r1 = v => Math.round(v * 10) / 10;
const strip = o => {
  const r = { ...o };
  delete r._id;
  return r;
};
const now = () => new Date().toISOString();
export const boards = () =>
  D.boards.slice().sort((a, b) => String(b.upd || b.at).localeCompare(String(a.upd || a.at)));
const itemsOf = b =>
  D.ink.filter(i => i.b === b).sort((a, b) => (a.o || 0) - (b.o || 0) || (a._id < b._id ? -1 : 1));
function newBoard(title) {
  const id = uid();
  W.set("boards", id, { title: title || "Board " + (D.boards.length + 1), at: now(), upd: now() });
  ls.set("os-wb", id);
  return id;
}
export function openBoard(id, item) {
  ls.set("os-wb", id);
  if (item) ls.set("os-wb-focus", item);
  openMod("whiteboard", true);
}

/* ---- geometry cache: outlines / text layouts, rebuilt only when an item's shape changes ---- */
const GEO = new Map();
function geo(it) {
  const sig =
    it.t === "s" || it.t === "h"
      ? it.p + "|" + it.l
      : it.t === "x"
        ? it.s + "|" + it.f
        : it.t === "n"
          ? it.s + "|" + it.f + "|" + it.w
          : "";
  let g = GEO.get(it._id);
  if (g && g.sig === sig) return g;
  g = { sig };
  if (it.t === "s" || it.t === "h") {
    const P = decode(it.p || "", it.q);
    g.pts = P.length ? P : [{ x: 0, y: 0, p: 0.5 }];
    g.path = it.t === "s" ? outline(g.pts, it.l) : centerline(g.pts);
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1e9,
      y1 = -1e9;
    for (const p of g.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    g.bb = { x0, y0, x1, y1 };
  } else if (it.t === "x") g.L = layoutText(it.s, it.f || SZ.text[0]);
  else if (it.t === "n") {
    const f = it.f || 16;
    g.L = layoutText(it.s, f, Math.max(20, (it.w || 180) - 2 * f * NPAD));
  }
  GEO.set(it._id, g);
  return g;
}
const noteH = it => {
  const f = it.f || 16;
  return Math.max(it.h || 140, geo(it).L.h + 2 * f * NPAD);
};
export function bbox(it) {
  if (it.t === "s" || it.t === "h") {
    const g = geo(it),
      k = it.k || 1,
      pd = (it.t === "h" ? it.l / 2 : it.l * 0.6) * k;
    return {
      x0: it.x + g.bb.x0 * k - pd,
      y0: it.y + g.bb.y0 * k - pd,
      x1: it.x + g.bb.x1 * k + pd,
      y1: it.y + g.bb.y1 * k + pd,
    };
  }
  if (it.t === "r" || it.t === "e") {
    const p = (it.l || 2) / 2;
    return {
      x0: Math.min(it.x, it.x + it.w) - p,
      y0: Math.min(it.y, it.y + it.h) - p,
      x1: Math.max(it.x, it.x + it.w) + p,
      y1: Math.max(it.y, it.y + it.h) + p,
    };
  }
  if (it.t === "l" || it.t === "a") {
    const p = Math.max(it.l || 2, it.t === "a" ? ah(it) : 0);
    return {
      x0: Math.min(it.x, it.u) - p,
      y0: Math.min(it.y, it.v) - p,
      x1: Math.max(it.x, it.u) + p,
      y1: Math.max(it.y, it.v) + p,
    };
  }
  if (it.t === "x") {
    const L = geo(it).L;
    return { x0: it.x, y0: it.y, x1: it.x + Math.max(L.w, 8), y1: it.y + L.h };
  }
  if (it.t === "n") return { x0: it.x, y0: it.y, x1: it.x + (it.w || 180), y1: it.y + noteH(it) };
  return { x0: it.x || 0, y0: it.y || 0, x1: it.x || 0, y1: it.y || 0 };
}
/* all the samples the browser saw since the last move (smoother, faster ink) */
const evs = e => {
  const c = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
  return c && c.length ? c : [e];
};
const ah = it => Math.max(10, (it.l || 2) * 3.2);
const union = bs =>
  bs.reduce(
    (a, b) => ({
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1),
    }),
    { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 },
  );
const meets = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/* does (x,y) touch the item? inside = boxes count when you click inside them (select), not only their outline (eraser) */
function hit(it, x, y, tol, inside) {
  const b = bbox(it);
  if (x < b.x0 - tol || x > b.x1 + tol || y < b.y0 - tol || y > b.y1 + tol) return false;
  if (it.t === "s" || it.t === "h") {
    const g = geo(it),
      k = it.k || 1,
      lx = (x - it.x) / k,
      ly = (y - it.y) / k,
      r = tol / k + (it.t === "h" ? it.l / 2 : it.l * 0.55),
      P = g.pts;
    if (P.length === 1) return Math.hypot(lx - P[0].x, ly - P[0].y) <= r;
    for (let i = 1; i < P.length; i++)
      if (distSeg(lx, ly, P[i - 1].x, P[i - 1].y, P[i].x, P[i].y) <= r) return true;
    return false;
  }
  if (it.t === "r") {
    const x0 = Math.min(it.x, it.x + it.w),
      y0 = Math.min(it.y, it.y + it.h),
      x1 = x0 + Math.abs(it.w),
      y1 = y0 + Math.abs(it.h);
    if (inside && x >= x0 && x <= x1 && y >= y0 && y <= y1) return true;
    const t = tol + (it.l || 2) / 2;
    return (
      distSeg(x, y, x0, y0, x1, y0) <= t ||
      distSeg(x, y, x1, y0, x1, y1) <= t ||
      distSeg(x, y, x1, y1, x0, y1) <= t ||
      distSeg(x, y, x0, y1, x0, y0) <= t
    );
  }
  if (it.t === "e") {
    const a = Math.abs(it.w) / 2 || 1,
      c = Math.abs(it.h) / 2 || 1,
      cx = it.x + it.w / 2,
      cy = it.y + it.h / 2,
      r = Math.hypot((x - cx) / a, (y - cy) / c);
    return (inside && r <= 1) || Math.abs(r - 1) * Math.min(a, c) <= tol + (it.l || 2) / 2;
  }
  if (it.t === "l" || it.t === "a") return distSeg(x, y, it.x, it.y, it.u, it.v) <= tol + (it.l || 2) / 2;
  return true;
}
function moved(it, dx, dy) {
  const o = { ...it, x: r1(it.x + dx), y: r1(it.y + dy) };
  if (it.t === "l" || it.t === "a") {
    o.u = r1(it.u + dx);
    o.v = r1(it.v + dy);
  }
  return o;
}
function scaled(it, ax, ay, sx, sy) {
  const X = v => r1(ax + (v - ax) * sx),
    Y = v => r1(ay + (v - ay) * sy),
    o = { ...it, x: X(it.x), y: Y(it.y) };
  if (it.t === "s" || it.t === "h") o.k = Math.round((it.k || 1) * sx * 1000) / 1000;
  else if (it.t === "x") o.f = r1((it.f || 18) * sx);
  else if (it.t === "n") {
    o.w = r1((it.w || 180) * sx);
    o.h = r1((it.h || 140) * sx);
    o.f = r1((it.f || 16) * sx);
  } else if (it.t === "r" || it.t === "e") {
    o.w = r1(it.w * sx);
    o.h = r1(it.h * sy);
  } else {
    o.u = X(it.u);
    o.v = Y(it.v);
  }
  return o;
}

/* ---- painting ---- */
const theme = el => {
  const cs = getComputedStyle(el || document.documentElement),
    g = v => cs.getPropertyValue(v).trim();
  return {
    ink: g("--ink") || "#111",
    paper: g("--paper") || "#fff",
    mute: g("--ink-3") || "#888",
    sel: g("--sel") || "#2a2a2a",
  };
};
function arrowHead(g, x, y, u, v, l) {
  const a = Math.atan2(v - y, u - x),
    h = Math.max(10, l * 3.2);
  g.beginPath();
  g.moveTo(u - h * Math.cos(a - 0.45), v - h * Math.sin(a - 0.45));
  g.lineTo(u, v);
  g.lineTo(u - h * Math.cos(a + 0.45), v - h * Math.sin(a + 0.45));
  g.stroke();
}
function paint(g, it, C) {
  const col = it.c || C.ink;
  g.fillStyle = g.strokeStyle = col;
  g.lineCap = "round";
  g.lineJoin = "round";
  if (it.t === "s") {
    const e = geo(it);
    g.save();
    g.translate(it.x, it.y);
    if (it.k && it.k !== 1) g.scale(it.k, it.k);
    g.fill(e.path);
    g.restore();
  } else if (it.t === "h") {
    const e = geo(it);
    g.save();
    g.translate(it.x, it.y);
    if (it.k && it.k !== 1) g.scale(it.k, it.k);
    g.globalAlpha = 0.4;
    g.strokeStyle = it.c || HL[0];
    g.lineWidth = it.l;
    g.stroke(e.path);
    g.restore();
  } else if (it.t === "r") {
    g.lineWidth = it.l || 2;
    g.strokeRect(it.x, it.y, it.w, it.h);
  } else if (it.t === "e") {
    g.lineWidth = it.l || 2;
    g.beginPath();
    g.ellipse(it.x + it.w / 2, it.y + it.h / 2, Math.abs(it.w / 2), Math.abs(it.h / 2), 0, 0, Math.PI * 2);
    g.stroke();
  } else if (it.t === "l" || it.t === "a") {
    g.lineWidth = it.l || 2;
    g.beginPath();
    g.moveTo(it.x, it.y);
    g.lineTo(it.u, it.v);
    g.stroke();
    if (it.t === "a") arrowHead(g, it.x, it.y, it.u, it.v, it.l || 2);
  } else if (it.t === "x") drawLayout(g, geo(it).L, it.x, it.y);
  else if (it.t === "n") {
    const e = geo(it),
      w = it.w || 180,
      h = noteH(it),
      f = it.f || 16;
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(it.x + 3, it.y + 4, w, h);
    g.fillStyle = it.c || NOTE[0];
    g.fillRect(it.x, it.y, w, h);
    g.strokeStyle = "rgba(0,0,0,.35)";
    g.lineWidth = 1;
    g.strokeRect(it.x + 0.5, it.y + 0.5, w - 1, h - 1);
    g.fillStyle = g.strokeStyle = "#1b1b1b";
    drawLayout(g, e.L, it.x + f * NPAD, it.y + f * NPAD * 0.7);
  }
}
function linkAt(it, x, y) {
  if (it.t !== "x" && it.t !== "n") return null;
  const L = geo(it).L,
    f = it.f || 16,
    ox = it.t === "n" ? it.x + f * NPAD : it.x,
    oy = it.t === "n" ? it.y + f * NPAD * 0.7 : it.y;
  const l = L.links.find(r => x >= ox + r.x && x <= ox + r.x + r.w && y >= oy + r.y && y <= oy + r.y + r.h);
  return l ? l.t : null;
}
const goLink = t => {
  const p = byTitle(t);
  openPage(p ? p._id : makePage({ title: t }));
};

export function exportPNG(items, title) {
  if (!items.length) {
    toast("Nothing to export yet");
    return;
  }
  const C = theme(),
    b = union(items.map(bbox)),
    pad = 32,
    w = b.x1 - b.x0 + pad * 2,
    h = b.y1 - b.y0 + pad * 2,
    k = Math.min(2, 4096 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  const g = c.getContext("2d");
  g.fillStyle = C.paper;
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(k, 0, 0, k, (pad - b.x0) * k, (pad - b.y0) * k);
  items.forEach(it => paint(g, it, C));
  c.toBlob(bl => {
    const u = URL.createObjectURL(bl),
      a = document.createElement("a");
    a.href = u;
    a.download = (title || "board").replace(/[\/:*?"<>|]/g, "-") + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  }, "image/png");
}

/* ---- history: each entry is [[id, before|null, after|null], ...] ---- */
const H = { b: null, undo: [], redo: [] };
const ops = (ch, i) => ch.map(c => (c[i] ? ["set", "ink", c[0], strip(c[i])] : ["del", "ink", c[0]]));
let lastTouch = 0;
function commit(ch, bid) {
  if (!ch.length) return;
  W.batch(ops(ch, 2));
  H.undo.push(ch);
  if (H.undo.length > 200) H.undo.shift();
  H.redo = [];
  if (Date.now() - lastTouch > 30000) {
    lastTouch = Date.now();
    W.upd("boards", bid, { upd: now() });
  }
}
const undo = () => {
  const ch = H.undo.pop();
  if (ch) {
    W.batch(ops(ch, 1));
    H.redo.push(ch);
  }
};
const redo = () => {
  const ch = H.redo.pop();
  if (ch) {
    W.batch(ops(ch, 2));
    H.undo.push(ch);
  }
};

export {
  H,
  HL,
  NOTE,
  NPAD,
  PEN,
  SZ,
  TOOLS,
  commit,
  evs,
  geo,
  goLink,
  hit,
  itemsOf,
  linkAt,
  meets,
  moved,
  newBoard,
  now,
  paint,
  r1,
  redo,
  scaled,
  strip,
  theme,
  uid,
  undo,
  union,
};
