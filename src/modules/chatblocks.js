/* Rich blocks Osage can put in a reply: ```graph (one equation per line) and ```cards (term :: answer lines).
   md.js leaves a .cbk placeholder; the chat mounts these components into it. */
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { html } from "../core/lib.js";
import { compileAll, trace, implicit } from "../core/graphmath.js";
import { W, D } from "../core/store.js";
import { ls } from "../core/pref.js";
import { toast, warn } from "../core/bus.js";
import { openMod } from "../shell/os.js";
import { Btn } from "../ui/index.js";
import { toMathML } from "../core/mathtype.js";

const PAL = ["#d6453d", "#2f7ed8", "#2e9e4f", "#8a5cd6", "#e08a1e", "#17a2b8", "#d6409f"];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const niceStep = (px, k) => {
  const t = px / k,
    p = Math.pow(10, Math.floor(Math.log10(t))),
    m = t / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
};
const tick = (v, st) =>
  Math.abs(v) < st * 1e-9 ? "0" : String(+v.toFixed(Math.max(0, -Math.floor(Math.log10(st)) + 1)));

/* "view: -5,5,-2,10" optional first line; the rest are rows (newline or ; separated) */
export function parseGraph(src) {
  let view = null;
  const rows = [];
  String(src || "")
    .split("\n")
    .forEach(l => {
      const m = l.match(/^\s*view\s*:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+))?/i);
      if (m) {
        view = m.slice(1).map(v => (v == null ? null : +v));
        return;
      }
      l.split(/\s*;\s*/).forEach(t => {
        t = t.trim();
        if (t) rows.push({ id: uid(), t });
      });
    });
  return { rows: rows.slice(0, 8), view };
}

export function ChatGraph({ src }) {
  const { rows, view } = useMemo(() => parseGraph(src), [src]);
  const cv = useRef(),
    box = useRef();
  const C = useMemo(() => {
    const E = { x: 0, y: 0, t: 0, theta: 0 };
    return { E, ...compileAll(rows, E, {}) };
  }, [src]);
  const draw = () => {
    const c = cv.current,
      b = box.current;
    if (!c || !b) return;
    const w = Math.max(180, b.clientWidth),
      h = Math.round(Math.min(300, Math.max(180, w * 0.62))),
      dpr = devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.height = h + "px";
    const g = c.getContext("2d"),
      cs = getComputedStyle(b),
      ink = cs.getPropertyValue("--ink").trim() || "#111",
      paper = cs.getPropertyValue("--paper").trim() || "#fff";
    const { plans, E } = C;
    for (const n of C.free) if (!(n in E) || Number.isNaN(E[n])) E[n] = 1;
    let x0 = view ? view[0] : -10,
      x1 = view ? view[1] : 10,
      y0 = view && view[2] != null ? view[2] : null,
      y1 = view && view[3] != null ? view[3] : null;
    if (y0 == null) {
      const ys = [];
      rows.forEach(r => {
        const p = plans[r.id];
        if (p && p.kind === "fn")
          for (let i = 0; i <= 240; i++) {
            try {
              const y = p.f(x0 + ((x1 - x0) * i) / 240);
              if (isFinite(y) && Math.abs(y) < 1e4) ys.push(y);
            } catch {
              // points outside the function's domain are skipped
            }
          }
      });
      if (ys.length > 4) {
        ys.sort((a, b) => a - b);
        let lo = ys[Math.floor(ys.length * 0.04)],
          hi = ys[Math.ceil(ys.length * 0.96) - 1];
        const m = (((x1 - x0) * h) / w / 2) * 1.6,
          lo2 = Math.max(lo, -m),
          hi2 = Math.min(hi, m);
        if (hi2 - lo2 > m * 0.4) {
          lo = lo2;
          hi = hi2;
        } /* keep the view square-ish: a steep curve leaves the window instead of flattening the rest */
        const pad = (hi - lo || 2) * 0.12;
        y0 = Math.min(lo - pad, 0 - pad * 0.3);
        y1 = Math.max(hi + pad, 0 + pad * 0.3);
      } else {
        const m = ((x1 - x0) * h) / w / 2;
        y0 = -m;
        y1 = m;
      }
    }
    const kx = w / (x1 - x0),
      ky = h / (y1 - y0),
      sX = x => (x - x0) * kx,
      sY = y => h - (y - y0) * ky,
      toX = px => x0 + px / kx,
      toY = py => y1 - py / ky;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);
    const sx = niceStep(70, kx),
      sy = niceStep(50, ky);
    g.lineWidth = 1;
    g.strokeStyle = ink;
    g.globalAlpha = 0.14;
    g.beginPath();
    for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) {
      const p = Math.round(sX(x)) + 0.5;
      g.moveTo(p, 0);
      g.lineTo(p, h);
    }
    for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) {
      const p = Math.round(sY(y)) + 0.5;
      g.moveTo(0, p);
      g.lineTo(w, p);
    }
    g.stroke();
    const ax = Math.min(Math.max(sX(0), 0), w),
      ay = Math.min(Math.max(sY(0), 0), h);
    g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(0, Math.round(ay) + 0.5);
    g.lineTo(w, Math.round(ay) + 0.5);
    g.moveTo(Math.round(ax) + 0.5, 0);
    g.lineTo(Math.round(ax) + 0.5, h);
    g.stroke();
    g.globalAlpha = 0.8;
    g.fillStyle = ink;
    g.font = "10.5px Tahoma,Verdana,sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    const ly = Math.min(Math.max(ay + 3, 1), h - 13);
    for (let x = Math.ceil(x0 / sx) * sx; x <= x1; x += sx) {
      if (Math.abs(x) < sx * 1e-6) continue;
      g.fillText(tick(x, sx), sX(x), ly);
    }
    g.textAlign = ax > w - 34 ? "right" : "left";
    g.textBaseline = "middle";
    const lx = ax > w - 34 ? ax - 4 : Math.max(ax + 4, 1);
    for (let y = Math.ceil(y0 / sy) * sy; y <= y1; y += sy) {
      if (Math.abs(y) < sy * 1e-6) continue;
      g.fillText(tick(y, sy), lx, sY(y));
    }
    g.globalAlpha = 1;
    g.lineWidth = 2.2;
    g.lineJoin = g.lineCap = "round";
    rows.forEach((r, i) => {
      const p = plans[r.id];
      if (!p) return;
      const col = PAL[i % PAL.length];
      g.strokeStyle = g.fillStyle = col;
      try {
        let segs = null;
        if (p.kind === "fn") {
          const rg = p.range ? [p.range[0](), p.range[1]()] : null;
          segs = trace(
            px => {
              const x = toX(px);
              if (rg && (x < rg[0] || x > rg[1])) return null;
              const y = p.f(x);
              if (!isFinite(y)) return null;
              const s = sY(y);
              return Math.abs(s) > 1e7 ? null : [px, s];
            },
            -1,
            w + 1,
            w + 2,
            w * 1.2,
          );
        } else if (p.kind === "xfn")
          segs = trace(
            py => {
              const x = p.f(toY(py));
              return isFinite(x) ? [sX(x), py] : null;
            },
            -1,
            h + 1,
            h + 2,
            w * 1.2,
          );
        else if (p.kind === "vline") {
          const x = p.c();
          if (isFinite(x)) segs = [[sX(x), 0, sX(x), h]];
        } else if (p.kind === "param") {
          const lo = p.lo(),
            hi = p.hi();
          if (hi > lo)
            segs = trace(
              t => {
                E.t = t;
                const x = p.fx(),
                  y = p.fy();
                return isFinite(x) && isFinite(y) ? [sX(x), sY(y)] : null;
              },
              lo,
              hi,
              900,
              w * 4,
            );
        } else if (p.kind === "polar") {
          const lo = p.lo(),
            hi = p.hi();
          if (hi > lo)
            segs = trace(
              th => {
                E.theta = th;
                const q = p.f();
                return isFinite(q) ? [sX(q * Math.cos(th)), sY(q * Math.sin(th))] : null;
              },
              lo,
              hi,
              1400,
              w * 4,
            );
        } else if (p.kind === "imp") {
          const a = implicit(p.F, w, h, toX, toY, 5);
          g.beginPath();
          for (let k = 0; k < a.length; k += 4) {
            g.moveTo(a[k], a[k + 1]);
            g.lineTo(a[k + 2], a[k + 3]);
          }
          g.stroke();
          return;
        } else if (p.kind === "pts") {
          for (const [x, y] of p.pts()) {
            if (!isFinite(x) || !isFinite(y)) continue;
            g.beginPath();
            g.arc(sX(x), sY(y), 4.5, 0, 7);
            g.fill();
          }
          return;
        }
        if (!segs) return;
        g.beginPath();
        for (const s of segs) {
          if (s.length < 4) continue;
          g.moveTo(s[0], s[1]);
          for (let k = 2; k < s.length; k += 2) g.lineTo(s[k], s[k + 1]);
        }
        g.stroke();
      } catch (e) {
        warn("graph block", e);
      }
    });
  };
  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [src]);
  const open = () => {
    const id = uid(),
      t = new Date().toISOString();
    W.set("graphs", id, {
      title: rows[0] ? rows[0].t.slice(0, 24) : "Graph",
      rows,
      vars: {},
      view: { cx: view ? (view[0] + view[1]) / 2 : 0, cy: 0, k: 50 },
      tbl: { id: "", x0: 0, dx: 1 },
      at: t,
      upd: t,
    });
    ls.set("os-gr-cur", id);
    ls.set("os-gc-mode", "graph");
    openMod("calc", true);
  };
  const errs = rows.map(r => C.plans[r.id]).filter(p => p && p.kind === "err");
  return html`<div class="cgr" ref=${box}><canvas ref=${cv} role="img" aria-label=${"Graph of " + rows.map(r => r.t).join(", ")}/>
    <div class="cgl">${rows.map((r, i) => html`<span key=${r.id}><i style=${"background:" + PAL[i % PAL.length]}/>${r.t}</span>`)}<${Btn} cls="cgo" onClick=${open}>Open in Graph<//></div>
    ${errs.length ? html`<div class="cge">${errs[0].msg}</div>` : null}</div>`;
}

/* flashcards: tap to flip, save into a page's deck */
export function parseCards(src) {
  let title = "";
  const cards = [];
  String(src || "")
    .split("\n")
    .forEach(l => {
      const t = l.match(/^\s*title\s*:\s*(.+)$/i);
      if (t) {
        title = t[1].trim();
        return;
      }
      const m = l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").match(/^(.+?)\s*::\s*(.+)$/);
      if (m) cards.push({ q: m[1].trim(), a: m[2].trim() });
    });
  return { title, cards };
}
const mathy = s => s.replace(/\$([^$\n]+)\$/g, (_, t) => toMathML(t));
export function ChatCards({ src }) {
  const { title, cards } = useMemo(() => parseCards(src), [src]);
  const [open, setOpen] = useState({}),
    [saved, setSaved] = useState("");
  const save = async () => {
    const name = title || "Flashcards";
    const { addCards } = await import("./study.js");
    let p = D.pages.find(x => String(x.title).toLowerCase() === name.toLowerCase());
    if (!p) {
      const pages = await import("./pages.js");
      const id = pages.makePage({ title: name });
      p = D.pages.find(x => x._id === id) || { _id: id, deck: [] };
    }
    addCards(p, cards);
    setSaved(name);
    toast("Saved " + cards.length + " cards to " + name);
  };
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return html`<div class="ccd">
    ${title ? html`<b class="cct">${title}</b>` : null}
    <div class="ccg">${cards.map(
      (
        c,
        i,
      ) => html`<button key=${i} class=${"cc" + (open[i] ? " on" : "")} aria-pressed=${String(!!open[i])} onClick=${() => setOpen(o => ({ ...o, [i]: !o[i] }))}>
      <span class="ccq" dangerouslySetInnerHTML=${{ __html: mathy(esc(c.q)) }}/><span class="cca" dangerouslySetInnerHTML=${{ __html: open[i] ? mathy(esc(c.a)) : "tap to flip" }}/></button>`,
    )}</div>
    <div class="ccb"><${Btn} onClick=${() => setOpen(cards.every((_, i) => open[i]) ? {} : Object.fromEntries(cards.map((_, i) => [i, 1])))}>${cards.every((_, i) => open[i]) ? "Hide all" : "Show all"}<//>
      <${Btn} go onClick=${save}>${saved ? "Saved to " + saved : "Save " + cards.length + " cards"}<//></div></div>`;
}
