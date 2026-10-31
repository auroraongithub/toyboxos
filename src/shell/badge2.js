/* Designed badges (v:2): an 88x31 canvas drawn in HTML, so GIFs keep moving.
   {v:2, bg:{k:"color"|"grad"|"stripes"|"pic", c1, c2, dir, src, fit}, bd:{k:"bevel"|"solid"|"dotted"|"double"|"none", c},
    layers:[{t:"text", text, font, size, color, bold, it, u, st, up, sh, al, ls, lh, x, y, r} | {t:"pic", src, x, y, w, h, iw, ix, iy, r}]}  (r = rotation in degrees)
   A picture layer is a frame (x,y,w,h, clipped) with the image inside it (iw wide, moved by ix,iy). Picture refs
   ("sos:<id>", "slot:<slot>", "badge:<i>") are turned into urls by core/look.js before drawing.
   Text: al = align lines l|c|r|j (justify stretches each line to the longest), it/u/st/up = italic, underline,
   strikethrough, uppercase, ls = letter spacing px, lh = line height %. */
import { html } from "../core/lib.js";
import { FONTS } from "./theme.js";

export const BW = 88,
  BH = 31;
export const BORDERS = [
  ["bevel", "Bevel"],
  ["solid", "Line"],
  ["dotted", "Dotted"],
  ["double", "Double"],
  ["none", "None"],
];
export const BGS = [
  ["color", "Colour"],
  ["grad", "Gradient"],
  ["stripes", "Stripes"],
  ["pic", "Picture"],
];
const FONT_OK = new Set(FONTS.map(f => f[0]));
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const col = (v, d) => (typeof v === "string" && HEX.test(v) ? v : d);
const num = (v, lo, hi, d) => {
  v = +v;
  return isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d;
};
const REF = /^(sos:[A-Za-z0-9_-]{16,64}|slot:[A-Za-z.0-9]{1,20}|badge:\d{1,2}|)$/;
const ref = v => (typeof v === "string" && REF.test(v) ? v : "");

export function cleanB2(b, keepSrc = ref) {
  const g = (b && b.bg) || {},
    d = (b && b.bd) || {};
  const layers = (Array.isArray(b && b.layers) ? b.layers : []).slice(0, 8).map(l =>
    l && l.t === "pic"
      ? {
          t: "pic",
          src: keepSrc(l.src),
          x: num(l.x, -88, 88, 0),
          y: num(l.y, -31, 31, 0),
          w: num(l.w, 4, 88, 30),
          h: num(l.h, 4, 31, 31),
          iw: num(l.iw, 4, 400, 30),
          ix: num(l.ix, -400, 400, 0),
          iy: num(l.iy, -400, 400, 0),
          r: num(l.r, -180, 180, 0),
        }
      : {
          t: "text",
          text: typeof (l && l.text) === "string" ? l.text.slice(0, 60) : "",
          font: FONT_OK.has(l && l.font) ? l.font : "",
          size: num(l && l.size, 5, 24, 10),
          color: col(l && l.color, "#111111"),
          bold: !!(l && l.bold),
          sh: !!(l && l.sh),
          al: ["l", "c", "r", "j"].includes(l && l.al) ? l.al : l && l.c ? "c" : "l",
          it: !!(l && l.it),
          u: !!(l && l.u),
          st: !!(l && l.st),
          up: !!(l && l.up),
          ls: Math.max(-1, Math.min(4, Math.round((+(l && l.ls) || 0) * 10) / 10)),
          lh: num(l && l.lh, 70, 180, 105),
          x: num(l && l.x, -88, 88, 4),
          y: num(l && l.y, -31, 31, 4),
          r: num(l && l.r, -180, 180, 0),
        },
  );
  return {
    v: 2,
    bg: {
      k: BGS.some(x => x[0] === g.k) ? g.k : "color",
      c1: col(g.c1, "#ffffff"),
      c2: col(g.c2, "#bdbdbd"),
      dir: num(g.dir, 0, 359, 180),
      src: keepSrc(g.src),
      fit: ["cover", "contain", "tile"].includes(g.fit) ? g.fit : "cover",
    },
    bd: { k: BORDERS.some(x => x[0] === d.k) ? d.k : "bevel", c: col(d.c, "#000000") },
    layers,
  };
}
const bgCss = (g, u) =>
  g.k === "grad"
    ? `background:linear-gradient(${g.dir}deg,${g.c1},${g.c2})`
    : g.k === "stripes"
      ? `background:repeating-linear-gradient(${g.dir}deg,${g.c1} 0 2px,${g.c2} 2px 4px)`
      : g.k === "pic" && u
        ? `background:${g.c1} url("${u}") ${g.fit === "tile" ? "0 0/auto repeat" : "center/" + g.fit + " no-repeat"}`
        : `background:${g.c1}`;
const bdCss = d =>
  d.k === "none"
    ? "border:0"
    : d.k === "bevel"
      ? `border:1px solid ${d.c};box-shadow:inset 1px 1px 0 rgba(255,255,255,.75),inset -1px -1px 0 rgba(0,0,0,.35)`
      : d.k === "double"
        ? `border:3px double ${d.c}`
        : `border:1px ${d.k} ${d.c}`;
const ALIGN = { c: "center", r: "right", j: "justify;text-align-last:justify;text-justify:inter-character" };
const textCss = l =>
  (ALIGN[l.al] ? ";text-align:" + ALIGN[l.al] : "") +
  (l.it ? ";font-style:italic" : "") +
  (l.u || l.st
    ? ";text-decoration:" + [l.u ? "underline" : "", l.st ? "line-through" : ""].join(" ").trim()
    : "") +
  (l.up ? ";text-transform:uppercase" : "") +
  (l.ls ? ";letter-spacing:" + l.ls + "px" : "") +
  (l.lh && l.lh !== 105 ? ";line-height:" + l.lh / 100 : "");
const rot = l => (l.r ? `;transform:rotate(${l.r}deg)` : "");
const lines = t => t.split("\n").flatMap((l, i) => (i ? [html`<br/>`, l] : [l]));
/* b has urls already (b.bg.url, layer.url) */
export function Badge2({ b, name, sel, onLayer }) {
  const g = b.bg || {},
    layers = b.layers || [];
  return html`<span class="b88 b2" style=${bgCss(g, g.url) + ";" + bdCss(b.bd || {})}>
    ${layers.map((l, i) =>
      l.t === "pic"
        ? html`<span key=${i} class=${"b2l b2p" + (sel === i ? " on" : "")} data-l=${i} style=${`left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px` + rot(l)} onPointerDown=${onLayer && (e => onLayer(e, i))}>
          ${l.url ? html`<img src=${l.url} alt="" draggable="false" style=${`width:${l.iw}px;left:${l.ix}px;top:${l.iy}px`}/>` : null}</span>`
        : html`<span key=${i} class=${"b2l b2t" + (sel === i ? " on" : "")} data-l=${i} onPointerDown=${onLayer && (e => onLayer(e, i))}
          style=${`left:${l.x}px;top:${l.y}px;font-family:${l.font || "Verdana, sans-serif"};font-size:${l.size}px;color:${l.color};font-weight:${l.bold ? 700 : 400}${l.sh ? ";text-shadow:1px 1px 0 rgba(0,0,0,.55)" : ""}${textCss(l)}` + rot(l)}>${lines((l.text || "").replace("{name}", name || ""))}</span>`,
    )}
  </span>`;
}

/* a classic badge (style a-h + art + crop) as a designed one, as close as it gets */
const CLASSIC = {
  a: ["grad", "#ffffff", "#bdbdbd", "#111111", ""],
  b: ["color", "#111111", "#111111", "#ffffff", '"Courier New", Courier, monospace'],
  c: ["stripes", "#000000", "#333333", "#ffffff", ""],
  d: ["color", "#e8e8e6", "#e8e8e6", "#111111", ""],
  e: ["grad", "#f2f2f0", "#c9c9c6", "#111111", ""],
  f: ["color", "#111111", "#111111", "#ffffff", '"Courier New", Courier, monospace'],
  g: ["stripes", "#e9e9e7", "#d6d6d3", "#111111", '"DotGothic16", "Courier New", monospace'],
  h: ["color", "#ffffff", "#ffffff", "#111111", ""],
};
const LEFT = new Set(["b", "d", "e", "g"]);
const hexOf = rgb => {
  const v = (rgb.match(/\d+/g) || []).slice(0, 3).map(n => (+n).toString(16).padStart(2, "0"));
  return v.length === 3 ? "#" + v.join("") : null;
};
/* draw the classic badge off screen with the live CSS and read back its boxes, relative to the inside of the border */
function measure(c, name) {
  if (typeof document === "undefined" || !document.body) return null;
  const host = document.createElement("div"),
    b = document.createElement("span"),
    s = document.createElement("span");
  host.style.cssText = "position:fixed;left:-999px;top:0;visibility:hidden;pointer-events:none";
  b.className = "b88 " + (c.style || "a") + (c.art ? "" : " noart");
  if (c.art) {
    const i = document.createElement("i");
    i.className = "art";
    b.append(i);
  }
  (c.text || "")
    .replace("{name}", name || "")
    .split("\n")
    .forEach((l, i) => s.append(...(i ? [document.createElement("br"), l] : [l])));
  b.append(s);
  host.append(b);
  document.body.append(host);
  try {
    const B = b.getBoundingClientRect(),
      bs = getComputedStyle(b),
      ox = B.left + (parseFloat(bs.borderLeftWidth) || 0),
      oy = B.top + (parseFloat(bs.borderTopWidth) || 0),
      T = s.getBoundingClientRect(),
      ts = getComputedStyle(s),
      a = b.querySelector(".art"),
      A = a && a.getBoundingClientRect(),
      ink = hexOf(ts.color);
    return {
      art: A
        ? {
            x: Math.round(A.left - ox),
            y: Math.round(A.top - oy),
            w: Math.round(A.width),
            h: Math.round(A.height),
          }
        : null,
      text: {
        x: Math.round(T.left - ox),
        y: Math.round(T.top - oy),
        size: Math.round(parseFloat(ts.fontSize)) || 10,
        ls: parseFloat(ts.letterSpacing) || 0,
        ...(ink ? { color: ink } : {}),
      },
    };
  } finally {
    host.remove();
  }
}
export function fromClassic(c, name) {
  const [k, c1, c2, ink, font] = CLASSIC[c.style] || CLASSIC.a,
    left = LEFT.has(c.style),
    art = !!c.art;
  const layers = [];
  /* where the classic badge actually puts its picture and text (measured; guesses when there's no page) */
  const m = measure(c, name);
  if (art) {
    const pos = ((c.crop && c.crop[1]) || "0px 0px").split(" ").map(v => parseInt(v, 10) || 0),
      box = (m && m.art) || { x: left ? 0 : 58, y: 0, w: 30, h: 31 };
    layers.push({
      t: "pic",
      src: c.art,
      ...box,
      iw: parseInt((c.crop && c.crop[0]) || "", 10) || box.w,
      ix: pos[0],
      iy: pos[1],
    });
  }
  const t = (c.text || "").split("\n");
  layers.push({
    t: "text",
    text: c.text || "",
    font,
    color: ink,
    bold: true,
    sh: k === "stripes" && ink === "#ffffff",
    al: "c",
    ...(m ? m.text : { size: t.length > 1 ? 9 : 10, x: art ? (left ? 33 : 4) : 6, y: t.length > 1 ? 5 : 10 }),
  });
  return cleanB2(
    {
      v: 2,
      bg: { k, c1, c2, dir: k === "stripes" ? (c.style === "g" ? 0 : 90) : 180 },
      bd: { k: "solid", c: "#000000" },
      layers,
    },
    x => (typeof x === "string" ? x : ""),
  );
}
export const blankB2 = () =>
  cleanB2({
    v: 2,
    bg: { k: "grad", c1: "#ffffff", c2: "#bdbdbd", dir: 180 },
    bd: { k: "bevel", c: "#000000" },
    layers: [
      {
        t: "text",
        text: "MY\nBADGE",
        font: "Verdana, Tahoma, sans-serif",
        size: 9,
        color: "#111111",
        bold: true,
        x: 6,
        y: 5,
      },
    ],
  });
