/* A movable desktop piece (core/layout.js). In its normal place it is display:contents, so the default layout is
   exactly what it was. Once moved it is fixed on the screen, scaled and rotated, and nudged back inside the
   work area whenever the window size changes (the saved spot stays; only the drawing moves). Phones ignore it. */
import { useRef, useState, useLayoutEffect, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { useMedia } from "../core/pref.js";
import { useLayout, bounds, baseXY, AT, phone } from "../core/layout.js";

export const PIECES = { banner: "Header", clock: "Clock", mascot: "Mascot window", stand: "Desktop figure" };
export const pieceLabel = id =>
  PIECES[id] ||
  (id.startsWith("badge:") ? "Badge " + (+id.slice(6) + 1) : id.startsWith("st:") ? "Sticker" : id);

/* out = the piece sits outside .desk (header, desktop figure): .desk is its own stacking layer (z 1) there */
export function Piece({ id, children, cls = "", out, inWin }) {
  const L = useLayout(),
    mobile = useMedia("(max-width:860px)"),
    p = L.p[id],
    ref = useRef(),
    [fix, setFix] = useState([0, 0]);
  const free = !mobile && p && p.at && !inWin;
  /* keep it on screen: measure, then shift by whatever sticks out (bigger than the screen = pin its top-left) */
  useLayoutEffect(() => {
    if (!free) return;
    const f = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect(),
        B = bounds();
      const x0 = r.left - fix[0],
        y0 = r.top - fix[1];
      let dx = 0,
        dy = 0;
      if (x0 + r.width > B.w) dx = B.w - (x0 + r.width);
      if (x0 + dx < 0) dx = -x0;
      if (y0 + r.height > B.h) dy = B.h - (y0 + r.height);
      if (y0 + dy < 0) dy = -y0;
      dx = Math.round(dx);
      dy = Math.round(dy);
      if (dx !== fix[0] || dy !== fix[1]) setFix([dx, dy]);
    };
    f();
    addEventListener("resize", f);
    const ro = new ResizeObserver(f);
    if (ref.current) ro.observe(ref.current);
    return () => {
      removeEventListener("resize", f);
      ro.disconnect();
    };
  }, [free, p && p.at, p && p.x, p && p.y, p && p.s, p && p.r, p && p.w, fix[0], fix[1]]);
  useEffect(() => {
    if (!free && (fix[0] || fix[1])) setFix([0, 0]);
  }, [free]);
  if (mobile ? phone().hide[id] : p && p.hide)
    return html`<div class="piece" data-piece=${id} data-hidden="" style="display:none"/>`;
  /* a window sticker: placed on its window's box, moves and stacks with it */
  if (inWin && p && p.at) {
    const [ax, ay] = AT[p.at] || AT.tl;
    return html`<div class=${"piece free inwin " + cls} data-piece=${id} style=${`position:absolute;left:calc(${ax * 100}% + ${p.x || 0}px);top:calc(${ay * 100}% + ${p.y || 0}px);${p.w ? "width:" + p.w + "px;" : ""}z-index:${8 + (p.z || 0)};transform:rotate(${p.r || 0}deg) scale(${p.s || 1});transform-origin:50% 50%`}>${children}</div>`;
  }
  if (!free) return html`<div class="piece" data-piece=${id} style="display:contents">${children}</div>`;
  const [x, y] = baseXY(p);
  /* under the windows by default, over them once brought forward: inside .desk the windows layer is z 3 (wm.css .mcol), outside it .desk itself is z 1 */
  const z = p.z || 0,
    zi = out ? (z > 0 ? 1 + z : 0) : z > 0 ? 3 + z : 2 + z;
  const st =
    `position:fixed;left:${Math.round(x)}px;top:${Math.round(y)}px;${p.w ? "width:" + p.w + "px;" : ""}z-index:${zi};` +
    `transform:translate(${fix[0]}px,${fix[1]}px) rotate(${p.r || 0}deg) scale(${p.s || 1});transform-origin:50% 50%`;
  return html`<div ref=${ref} class=${"piece free " + cls} data-piece=${id} data-fit=${fix[0] || fix[1] ? "1" : null} style=${st}>${children}</div>`;
}
