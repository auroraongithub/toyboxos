/* Custom theme: pref os-theme {on, base, vars{--token:#hex}, g{btn,cap,tbg,on}, font, title, bfont, wall{img,fit}, banner}
   laid over a base skin. Applied as one <style> on html[data-custom]; imported JSON is cleaned to known keys and
   plain colours / allowlisted fonts / data:image URLs only, so a shared theme can't inject CSS. */
import { ls } from "../core/pref.js";
import { applySkin, SKINS } from "./skins.js";

/* [token, label, group]. Gradients (buttons, title bars, taskbar, pressed) are built from one colour each (G). */
export const TOKENS = [
  ["--desk", "Desktop", "Desktop"],
  ["--face", "Window", "Windows"],
  ["--face-2", "Window, light", "Windows"],
  ["--paper", "Content", "Windows"],
  ["--alt", "Alternate rows", "Windows"],
  ["--hover", "Hover", "Windows"],
  ["--code", "Code", "Windows"],
  ["--ink", "Text", "Text"],
  ["--ink-2", "Text, soft", "Text"],
  ["--ink-3", "Text, faint", "Text"],
  ["--on-dark", "Text on dark", "Text"],
  ["--frame", "Outlines", "Lines"],
  ["--edge", "Edges", "Lines"],
  ["--edge-2", "Edges, light", "Lines"],
  ["--line", "Rules", "Lines"],
  ["--line-2", "Rules, strong", "Lines"],
  ["--hi", "Bevel light", "Lines"],
  ["--sel", "Selection", "Accents"],
  ["--dark", "Dark panels", "Accents"],
  ["--mark", "Highlighter", "Accents"],
  ["--danger", "Danger", "Accents"],
  ["--pink", "Pink", "Accents"],
];
export const G = [
  ["tbg", "Taskbar", "Desktop"],
  ["cap", "Title bars", "Desktop"],
  ["btn", "Buttons", "Accents"],
  ["on", "Pressed / on", "Accents"],
];
export const GROUPS = ["Desktop", "Windows", "Text", "Lines", "Accents"];
export const FONTS = [
  ["", "Skin default"],
  ["Tahoma, Verdana, sans-serif", "Tahoma"],
  ["Verdana, Tahoma, sans-serif", "Verdana"],
  ['"Segoe UI", system-ui, sans-serif', "Segoe UI"],
  ['"Trebuchet MS", Tahoma, sans-serif', "Trebuchet"],
  ['Georgia, "Times New Roman", serif', "Georgia"],
  ['"Courier New", Courier, monospace', "Courier"],
  ['Consolas, "Courier New", monospace', "Consolas"],
  ['"Comic Sans MS", "Comic Neue", cursive', "Comic Sans"],
  ['"DotGothic16", "Courier New", monospace', "DotGothic16"],
  ["system-ui, sans-serif", "System"],
];
export const FITS = [
  ["cover", "Fill"],
  ["contain", "Fit"],
  ["tile", "Tile"],
  ["center", "Centre"],
];

const HEX = /^#[0-9a-f]{6}$/i,
  IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i;
const okFont = f => FONTS.some(x => x[0] === f);
export const blank = () => ({
  on: true,
  base: ls.get("os-skin", "gray"),
  vars: {},
  g: {},
  font: "",
  title: "",
  bfont: "",
  wall: null,
  banner: "",
});

/* keep only what the editor itself could have made */
export function clean(t) {
  if (!t || typeof t !== "object") throw new Error("not a theme");
  const o = blank();
  o.on = t.on !== false;
  if (SKINS.some(s => s[0] === t.base)) o.base = t.base;
  for (const [k] of TOKENS) if (t.vars && HEX.test(t.vars[k] || "")) o.vars[k] = t.vars[k].toLowerCase();
  for (const [k] of G) if (t.g && HEX.test(t.g[k] || "")) o.g[k] = t.g[k].toLowerCase();
  for (const k of ["font", "title", "bfont"]) if (okFont(t[k] || "")) o[k] = t[k] || "";
  if (t.wall && IMG.test(t.wall.img || ""))
    o.wall = { img: t.wall.img, fit: FITS.some(f => f[0] === t.wall.fit) ? t.wall.fit : "cover" };
  if (o.wall) {
    const n = (v, d) => (isFinite(+v) && v !== "" && v != null ? Math.max(0, Math.min(100, Math.round(+v * 10) / 10)) : d);
    o.wall.x = n(t.wall.x, 50);
    o.wall.y = n(t.wall.y, 50);
  }
  if (IMG.test(t.banner || "")) o.banner = t.banner;
  if (t.bpos && typeof t.bpos === "object") {
    const n = (v, lo, hi, d) => (isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v * 10) / 10)) : d);
    o.bpos = { x: n(t.bpos.x, 0, 100, 50), y: n(t.bpos.y, 0, 100, 30), z: n(t.bpos.z, 1, 4, 1) };
  }
  if (t.seed && HEX.test(t.seed.c || ""))
    o.seed = {
      c: t.seed.c.toLowerCase(),
      dark: !!t.seed.dark,
      k: STRENGTH.some(x => x[0] === t.seed.k) ? t.seed.k : "normal",
    };
  return o;
}

/* colour maths for the gradients */
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = a =>
  "#" +
  a
    .map(v =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
export const shade = (h, f) => hex(rgb(h).map(v => (f > 0 ? v + (255 - v) * f : v * (1 + f))));
export const lum = h => {
  const [r, g, b] = rgb(h).map(v => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const grad = {
  btn: c => `linear-gradient(180deg,${shade(c, 0.6)} 0%,${shade(c, 0.25)} 45%,${c} 100%)`,
  cap: c => `linear-gradient(180deg,${shade(c, 0.3)},${shade(c, -0.45)})`,
  tbg: c =>
    `linear-gradient(180deg,${shade(c, 0.45)} 0%,${c} 9%,${shade(c, -0.25)} 42%,${shade(c, -0.5)} 88%,${shade(c, 0.1)} 100%)`,
  on: c => `linear-gradient(180deg,${shade(c, 0.2)},${shade(c, -0.3)})`,
};

/* any CSS colour -> #rrggbb (for the colour inputs); gradients give their middle stop */
let cx;
export function toHex(v) {
  v = (v || "").trim();
  if (!v) return "#808080";
  const stops = v.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);
  if (/gradient/.test(v) && stops) v = stops[Math.floor(stops.length / 2)];
  cx = cx || document.createElement("canvas").getContext("2d");
  cx.fillStyle = "#808080";
  cx.fillStyle = v;
  const f = cx.fillStyle;
  if (f[0] === "#") return f;
  const m = f.match(/[\d.]+/g);
  return m ? hex(m.slice(0, 3).map(Number)) : "#808080";
}

export function css(t) {
  const v = [];
  for (const [k] of TOKENS) if (t.vars[k]) v.push(k + ":" + t.vars[k]);
  if (t.g.btn)
    v.push(
      "--btn:" + grad.btn(t.g.btn),
      "--btn-down:linear-gradient(180deg," + shade(t.g.btn, -0.12) + "," + shade(t.g.btn, 0.15) + ")",
    );
  if (t.g.cap) v.push("--cap:" + grad.cap(t.g.cap), "--cap-x:" + grad.cap(shade(t.g.cap, -0.3)));
  if (t.g.tbg) v.push("--tbg:" + grad.tbg(t.g.tbg));
  if (t.g.on) v.push("--btn-on:" + grad.on(t.g.on));
  if (t.font) v.push("--font:" + t.font);
  if (t.title) v.push("--title:" + t.title);
  if (t.bfont) v.push("--bfont:" + t.bfont);
  if (t.vars["--paper"]) v.push("color-scheme:" + (lum(t.vars["--paper"]) < 0.4 ? "dark" : "light"));
  let s = `html:root[data-custom]{${v.join(";")}}`;
  if (t.wall) {
    const w = t.wall,
      tile = w.fit === "tile",
      at = (w.x == null ? 50 : w.x) + "% " + (w.y == null ? 50 : w.y) + "%";
    // !important: skins set their own body background with more specific selectors (themes.css)
    s += `html[data-custom] body{background:var(--desk) url("${w.img}") ${tile ? "top left/auto repeat" : at + "/" + (w.fit === "center" ? "auto" : w.fit) + " no-repeat"} fixed!important}`;
  }
  return s;
}

let el;
export function applyTheme() {
  const t = ls.get("os-theme", null),
    root = document.documentElement;
  if (!t || !t.on) {
    delete root.dataset.custom;
    if (el) el.textContent = "";
    return;
  }
  if (t.base && root.dataset.skin !== t.base) applySkin(t.base, true);
  el = el || document.head.appendChild(Object.assign(document.createElement("style"), { id: "os-theme" }));
  el.textContent = css(t);
  root.dataset.custom = "";
}
export const setTheme = f => {
  ls.set("os-theme", f(ls.get("os-theme", null) || blank()));
  applyTheme();
};

/* images are shrunk before they go into localStorage (5 MB for everything) */
export function shrink(file, max) {
  return new Promise((ok, no) => {
    const u = URL.createObjectURL(file),
      i = new Image();
    i.onload = () => {
      const k = Math.min(1, max / Math.max(i.width, i.height)),
        c = document.createElement("canvas");
      c.width = Math.round(i.width * k);
      c.height = Math.round(i.height * k);
      c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      ok(c.toDataURL("image/webp", 0.82));
    };
    i.onerror = () => {
      URL.revokeObjectURL(u);
      no(new Error("That file isn't an image"));
    };
    i.src = u;
  });
}

/* random palette: one hue, light or dark, laid over a plain base skin so text and content colours stay readable */
const hsl = (h, s, l) => {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l),
    f = n => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
        .toString(16)
        .padStart(2, "0");
    };
  return "#" + f(0) + f(8) + f(4);
};
export function randomTheme() {
  const r = (a, b) => a + Math.random() * (b - a),
    h = Math.round(r(0, 360)),
    s = Math.round(r(35, 75)),
    dark = Math.random() < 0.25;
  const h2 = (h + Math.round(r(-25, 25)) + 360) % 360;
  if (dark)
    return {
      ...blank(),
      on: true,
      base: "night",
      vars: {
        "--desk": hsl(h, r(20, 40), r(7, 12)),
        "--face": hsl(h, r(10, 18), 17),
        "--face-2": hsl(h, r(10, 18), 14),
        "--alt": hsl(h, r(10, 18), 15),
        "--sel": hsl(h2, s, 62),
        "--edge-2": hsl(h, 12, 26),
      },
      g: { tbg: hsl(h, s * 0.6, 26), cap: hsl(h2, s * 0.6, 30), btn: hsl(h, 12, 26), on: hsl(h2, s, 52) },
    };
  return {
    ...blank(),
    on: true,
    base: "gray",
    vars: {
      "--desk": hsl(h, r(25, 55), r(42, 68)),
      "--face": hsl(h, r(12, 28), r(86, 91)),
      "--face-2": hsl(h, r(12, 28), r(94, 97)),
      "--alt": hsl(h, r(12, 28), r(92, 95)),
      "--sel": hsl(h2, s, r(20, 30)),
      "--edge-2": hsl(h, r(8, 16), 68),
    },
    g: {
      tbg: hsl(h, s, r(32, 44)),
      cap: hsl(h2, s, r(34, 46)),
      btn: hsl(h, r(10, 25), r(82, 90)),
      on: hsl(h2, s, r(34, 44)),
    },
  };
}
export function randomize() {
  const old = ls.get("os-theme", null),
    n = randomTheme(),
    keep = old || blank();
  setTheme(() => ({
    ...n,
    font: keep.font,
    title: keep.title,
    bfont: keep.bfont,
    wall: keep.wall,
    banner: keep.banner,
  }));
  return old;
}

/* one colour -> a whole theme. Every token is derived from the colour's hue, with lightness fixed per role so text,
   content and selections stay readable whatever was picked; k = how much of the colour reaches the surfaces. */
const toHsl = c => {
  const [r, g, b] = rgb(c).map(v => v / 255),
    mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    l = (mx + mn) / 2,
    d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
};
export const STRENGTH = [
  ["soft", "Soft", 0.55],
  ["normal", "Normal", 1],
  ["bold", "Bold", 1.6],
];
export const SEEDS = [
  "#8c8c8c",
  "#5a6470",
  "#2f7fb5",
  "#4a6fa5",
  "#3f4a8a",
  "#6c5ce0",
  "#8a5fb0",
  "#c25b85",
  "#a8243a",
  "#b5523b",
  "#c27a2c",
  "#8a6a4a",
  "#9a8a3c",
  "#7a8c3c",
  "#5c8a4a",
  "#2f8f83",
];
const ensure = (c, on, min) => {
  for (let i = 0; i < 14 && contrast(on, c) < min; i++) c = shade(c, -0.08);
  return c;
};
export function fromColour(c, dark, k = "normal") {
  const [h, s0] = toHsl(c),
    m = (STRENGTH.find(x => x[0] === k) || STRENGTH[1])[2],
    s = f => Math.min(100, s0 * f * m),
    x = (f, l) => hsl(h, s(f), l);
  const S = Math.min(100, s0 * Math.min(m, 1.2));
  if (dark)
    return {
      base: "night",
      vars: {
        "--desk": x(0.45, 10),
        "--face": x(0.16, 17),
        "--face-2": x(0.16, 14),
        "--paper": x(0.12, 11),
        "--alt": x(0.14, 14),
        "--hover": x(0.2, 22),
        "--code": x(0.12, 18),
        "--ink": x(0.08, 92),
        "--ink-2": x(0.08, 73),
        "--ink-3": x(0.08, 56),
        "--on-dark": "#ffffff",
        "--frame": x(0.2, 3),
        "--edge": x(0.12, 6),
        "--edge-2": x(0.14, 27),
        "--line": x(0.12, 20),
        "--line-2": x(0.12, 30),
        "--hi": x(0.1, 30),
        "--sel": ensure(hsl(h, S, 46), "#ffffff", 4.6),
        "--dark": x(0.2, 6),
      },
      g: { tbg: x(0.6, 22), cap: hsl(h, S * 0.8, 32), btn: x(0.15, 27), on: hsl(h, S, 44) },
    };
  return {
    base: "gray",
    vars: {
      "--desk": x(0.55, 56),
      "--face": x(0.2, 90),
      "--face-2": x(0.16, 95.5),
      "--paper": x(0.1, 99),
      "--alt": x(0.16, 96),
      "--hover": x(0.22, 91),
      "--code": x(0.16, 93),
      "--ink": x(0.25, 8),
      "--ink-2": x(0.14, 30),
      "--ink-3": x(0.1, 47),
      "--on-dark": "#ffffff",
      "--frame": x(0.3, 6),
      "--edge": x(0.14, 38),
      "--edge-2": x(0.14, 66),
      "--line": x(0.14, 92),
      "--line-2": x(0.14, 80),
      "--hi": "#ffffff",
      "--sel": ensure(hsl(h, S, 30), "#ffffff", 4.6),
      "--dark": x(0.3, 9),
    },
    g: { tbg: hsl(h, S, 36), cap: hsl(h, S, 40), btn: x(0.22, 90), on: hsl(h, S, 34) },
  };
}
/* WCAG contrast of two #hex colours */
const rl = h => {
  const [r, g, b] = rgb(h).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const x = rl(a),
    y = rl(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/* [text token, background token, minimum ratio, where] checked by the editor */
export const PAIRS = [
  ["--ink", "--paper", 4.5, "on Content"],
  ["--ink", "--face", 4.5, "on Window"],
  ["--ink-2", "--paper", 4.5, "on Content"],
  ["--ink-3", "--paper", 2.8, "on Content"],
  ["--on-dark", "--sel", 4.5, "on Selection"],
  ["--on-dark", "--dark", 4.5, "on Dark panels"],
];
