/* Desktop layout: where the decorations sit (header, clock, mascot window, each badge, the desktop figure).
   A piece with no entry stays in its normal place. A moved piece is {at, x, y, w, s, r, z}: at = the screen point
   it hangs from ("tl" "t" "tr" "l" "c" "r" "bl" "b" "br"), x/y = offset of its top-left from that point,
   w = its width when it left the flow, s = scale, r = rotation in degrees. hide = not shown.
   Stickers are pieces too, id "st:<random>": {k:"img"|"text", src ("sos:<id>"), text, font, size, color}; with win set
   they hang from that window instead of the screen (at/x/y measured on the window's box) and move with it.
   win looks: {<window id>: {bg:{src, op 0-1}, cap:{src}}} = a picture behind a window's content / on its title bar.
   ph = the phone list: {order:["badges","clock","mascot","stickers"], hide:{<section, badge:i or st:id>:true}} (phones stack the side
   widgets under Today; they ignore p).
   Saved as config/layout (synced, so every desktop shares it) unless this device keeps its own (pref os-layout-mine). */
import { useState, useEffect } from "preact/hooks";
import { D, W, onChange } from "./store.js";
import { ls } from "./pref.js";

export const AT = {
  tl: [0, 0],
  t: [0.5, 0],
  tr: [1, 0],
  l: [0, 0.5],
  c: [0.5, 0.5],
  r: [1, 0.5],
  bl: [0, 1],
  b: [0.5, 1],
  br: [1, 1],
};
const subs = new Set();
const emit = () => subs.forEach(f => f());
queueMicrotask(() =>
  onChange(c => {
    if (c === "*" || c === "config") emit();
  }),
);
export const mine = () => ls.get("os-layout-mine", false);
/* while editing, changes go to a draft (Done saves it, Cancel drops it); hist = its undo steps */
let draft = null,
  hist = [];
const saved = () => {
  const l = mine() ? ls.get("os-layout", null) : (D.config || []).find(x => x._id === "layout");
  return { p: (l && l.p) || {}, win: (l && l.win) || {}, ph: (l && l.ph) || {} };
};
export const layout = () => {
  const s = saved();
  return draft ? { ...s, p: draft } : s;
};
export const pieceOf = id => layout().p[id] || null;
const write = (p, win = saved().win, ph = saved().ph) => {
  const o = { p, win, ph, upd: new Date().toISOString() };
  if (mine()) {
    ls.set("os-layout", o);
    emit();
  } else W.set("config", "layout", o);
};
export const setLayout = l => write({ ...((l && l.p) || {}) }, (l && l.win) || {}, (l && l.ph) || {});
export const setPiece = (id, o) => {
  const p = { ...layout().p };
  if (o) p[id] = { ...(p[id] || {}), ...o };
  else delete p[id];
  write(p);
};
export const resetLayout = () => write({});
/* window looks are saved straight away (they aren't part of the edit-mode draft) */
export const winLook = id => saved().win[id] || {};
export const setWinLook = (id, o) => {
  const win = { ...saved().win };
  if (o && Object.keys(o).length) win[id] = o;
  else delete win[id];
  write(saved().p, win);
};
export const newStickerId = () => "st:" + Math.random().toString(36).slice(2, 10);
/* the phone list */
export const PHONE = ["badges", "clock", "mascot", "stickers"];
export const phone = () => {
  const ph = saved().ph,
    o = (Array.isArray(ph.order) ? ph.order : []).filter(x => PHONE.includes(x));
  return {
    order: [...o, ...PHONE.filter(x => !o.includes(x))],
    hide: ph.hide && typeof ph.hide === "object" ? ph.hide : {},
  };
};
export const setPhone = o => {
  const s = saved();
  write(s.p, s.win, { ...phone(), ...o });
};
/* this device keeps its own copy (starts from the shared one) or goes back to the shared one */
export const setMine = v => {
  if (v) ls.set("os-layout", layout());
  ls.set("os-layout-mine", !!v);
  emit();
};
export const useLayout = () => {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return layout();
};

/* edit mode (desktop only) */
export const isEditing = () => !!draft;
const stored = () => saved().p;
export const setEditing = v => {
  draft = v ? JSON.parse(JSON.stringify(stored())) : null;
  hist = [];
  document.body.toggleAttribute("data-ledit", !!v);
  emit();
};
/* step = a finished gesture (goes on the undo list); live moves only redraw */
export const edit = (id, o, step = true) => {
  if (!draft) return;
  if (step) hist.push(JSON.stringify(draft));
  if (hist.length > 80) hist.shift();
  const p = { ...draft };
  if (o) p[id] = { ...(p[id] || {}), ...o };
  else delete p[id];
  draft = p;
  emit();
};
export const editAll = p => {
  if (!draft) return;
  hist.push(JSON.stringify(draft));
  draft = { ...p };
  emit();
};
export const undoEdit = () => {
  if (!draft || !hist.length) return false;
  draft = JSON.parse(hist.pop());
  emit();
  return true;
};
export const doneEditing = () => {
  const p = draft;
  setEditing(false);
  if (p) write(p);
};

/* the work area pieces must stay inside: the viewport above the taskbar */
export const bounds = () => {
  const tb = document.querySelector(".taskbar");
  return {
    w: innerWidth,
    h: innerHeight - (tb && getComputedStyle(tb).display !== "none" ? tb.offsetHeight : 0),
  };
};
/* the anchor nearest a box's centre, and the offset that keeps its top-left where it is */
export function anchorFor(left, top, w, h) {
  const B = bounds(),
    cx = (left + w / 2) / B.w,
    cy = (top + h / 2) / B.h,
    col = cx < 1 / 3 ? 0 : cx < 2 / 3 ? 0.5 : 1,
    row = cy < 1 / 3 ? 0 : cy < 2 / 3 ? 0.5 : 1;
  const at = Object.keys(AT).find(k => AT[k][0] === col && AT[k][1] === row);
  return { at, x: Math.round(left - col * B.w), y: Math.round(top - row * B.h) };
}
/* the same inside a window's box (window stickers) */
export function anchorIn(left, top, w, h, W, H) {
  const cx = (left + w / 2) / W,
    cy = (top + h / 2) / H,
    col = cx < 1 / 3 ? 0 : cx < 2 / 3 ? 0.5 : 1,
    row = cy < 1 / 3 ? 0 : cy < 2 / 3 ? 0.5 : 1;
  return {
    at: Object.keys(AT).find(k => AT[k][0] === col && AT[k][1] === row),
    x: Math.round(left - col * W),
    y: Math.round(top - row * H),
  };
}
export const baseXY = p => {
  const B = bounds(),
    [ax, ay] = AT[p.at] || AT.tl;
  return [ax * B.w + (p.x || 0), ay * B.h + (p.y || 0)];
};
