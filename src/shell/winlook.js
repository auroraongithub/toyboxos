/* Window look (window right-click / its taskbar button / Edit layout > Windows): a picture behind the window's
   content, how much of it shows through, and a picture on its title bar. Saved in config/layout win (core/layout.js). */
import { useState, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { fileUrl } from "../core/files.js";
import { storePic } from "../core/look.js";
import { winLook, setWinLook, useLayout } from "../core/layout.js";
import { openSheet, actionSheet } from "../ui/sheet.js";
import { Btn, Group } from "../ui/index.js";
import { reg } from "./os.js";

const pick = f => {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = "image/*";
  i.className = "led-file";
  i.onchange = () => {
    const x = i.files[0];
    i.remove();
    if (x) f(x);
  };
  document.body.appendChild(i);
  i.click();
};
function Thumb({ r, empty }) {
  const [u, setU] = useState(null);
  useEffect(() => {
    let live = true;
    if (r)
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
  return html`<div class="lkpv wl-pv">${u ? html`<img src=${u} alt=""/>` : html`<span>${empty}</span>`}</div>`;
}
function Ed({ id }) {
  useLayout();
  const lw = winLook(id),
    [op, setOp] = useState(lw.bg ? Math.round((lw.bg.op ?? 0.35) * 100) : 35);
  const save = o => setWinLook(id, { ...winLook(id), ...o });
  const up = (k, max, extra) =>
    pick(async f => {
      try {
        save({ [k]: { ...(winLook(id)[k] || {}), src: await storePic(f, max), ...extra } });
      } catch (e) {
        toast(e.message);
      }
    });
  const drop = k => {
    const o = { ...winLook(id) };
    delete o[k];
    setWinLook(id, o);
  };
  return html`<div class="wl">
    <${Group} title="Behind the content"/>
    <div class="wl-row"><${Thumb} r=${lw.bg && lw.bg.src} empty="none"/>
      <div class="wl-c"><div class="lkb"><${Btn} onClick=${() => up("bg", 1600, { op: op / 100 })}>${lw.bg ? "Change…" : "Choose picture…"}<//>${lw.bg ? html`<${Btn} onClick=${() => drop("bg")}>Remove<//>` : null}</div>
        ${lw.bg ? html`<label class="wl-op">Shows through <input type="range" min="5" max="95" value=${op} onInput=${e => setOp(+e.target.value)} onChange=${e => save({ bg: { ...winLook(id).bg, op: +e.target.value / 100 } })}/> <b>${op}%</b></label>` : null}</div></div>
    <${Group} title="Title bar"/>
    <div class="wl-row"><${Thumb} r=${lw.cap && lw.cap.src} empty="theme colour"/>
      <div class="wl-c"><div class="lkb"><${Btn} onClick=${() => up("cap", 1000)}>${lw.cap ? "Change…" : "Choose picture…"}<//>${lw.cap ? html`<${Btn} onClick=${() => drop("cap")}>Remove<//>` : null}</div></div></div>
  </div>`;
}
export const openWinLook = id =>
  openSheet({ title: "Look: " + (reg.names[id] || id), Body: Ed, props: { id } });
/* pick one of the open windows first */
export const pickWinLook = at => {
  const wins = [...document.querySelectorAll("#mcol > .win.fl")].map(w => w.dataset.win);
  if (!wins.length) {
    toast("Open a window first");
    return;
  }
  actionSheet(
    "Window look",
    wins.map(w => ["grid", reg.names[w] || w, () => openWinLook(w)]),
    at,
  );
};
