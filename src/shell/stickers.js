/* Stickers: pictures (GIFs keep moving), and text, placed anywhere on the desktop or on a window (core/layout.js).
   Phones have no free desktop: the desktop ones sit on a shelf under Today (PhoneStickers, a section of the phone
   list), turned as on the desktop and shrunk to fit; window stickers stay on the desktop. */
import { useState, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { useMedia } from "../core/pref.js";
import { fileUrl } from "../core/files.js";
import { useLayout } from "../core/layout.js";
import { Piece } from "./piece.js";

function Pic({ src }) {
  const [u, setU] = useState(null);
  useEffect(() => {
    let live = true;
    if (src && src.startsWith("sos:"))
      fileUrl(src.slice(4)).then(
        x => {
          if (live) setU(x);
        },
        () => {},
      );
    return () => {
      live = false;
    };
  }, [src]);
  return u
    ? html`<img class="stk-i" src=${u} alt="" draggable="false"/>`
    : html`<div class="stk-i stk-wait"/>`;
}
export const StickerBody = ({ p }) =>
  p.k === "text"
    ? html`<div class="stk-t" style=${`font-family:${p.font || "inherit"};font-size:${p.size || 20}px;color:${p.color || "var(--ink)"}`}>${p.text || ""}</div>`
    : html`<${Pic} src=${p.src}/>`;
const list = (L, win) =>
  Object.entries(L.p).filter(([k, v]) => k.startsWith("st:") && (win ? v.win === win : !v.win));
/* on the desktop (outside .desk: under the windows unless brought forward) */
export function Stickers() {
  const L = useLayout(),
    mobile = useMedia("(max-width:860px)");
  if (mobile) return null;
  return list(L).map(([k, v]) => html`<${Piece} key=${k} id=${k} out cls="stk"><${StickerBody} p=${v}/><//>`);
}
/* on a window: rendered inside it by ui/index.js Window */
export function WinStickers({ win }) {
  const L = useLayout(),
    mobile = useMedia("(max-width:860px)");
  if (mobile) return null;
  return list(L, win).map(
    ([k, v]) => html`<${Piece} key=${k} id=${k} inWin cls="stk"><${StickerBody} p=${v}/><//>`,
  );
}
/* phones: the desktop stickers in a row that wraps, each one hideable in the phone list */
export function PhoneStickers({ hide = {} }) {
  const L = useLayout(),
    items = list(L).filter(([k]) => !hide[k]);
  if (!items.length) return null;
  return html`<div class="stk-shelf">${items.map(
    ([
      k,
      v,
    ]) => html`<div key=${k} class="stk-ph" style=${`transform:rotate(${v.r || 0}deg);` + (v.k === "text" ? "" : `width:${Math.min(160, Math.round((v.w || 120) * (v.s || 1)))}px`)}>
    <${StickerBody} p=${v.k === "text" ? { ...v, size: Math.min(40, Math.round((v.size || 20) * (v.s || 1))) } : v}/></div>`,
  )}</div>`;
}
export const desktopStickers = L => list(L);
