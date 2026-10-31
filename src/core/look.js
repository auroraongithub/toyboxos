/* The user's own look on top of the build's pack: art in any slot, mascot pictures and lines, badges, the webring
   label and the assistant's name and voice. Saved as config/look (synced); pictures go through core/files.js
   (IndexedDB here, /api/file on the server, fetched on other devices) and are referenced as "sos:<id>".
   Pack files (one JSON with the theme, every picture inline and the module defaults) export and import here. */
import { useState, useEffect } from "preact/hooks";
import { D, W, onChange } from "./store.js";
import { pack, BASE, ART, AI } from "./pack.js";
import { saveFile, fileUrl } from "./files.js";
import { ls } from "./pref.js";
import { reg } from "../shell/os.js";
import { cleanB2 } from "../shell/badge2.js";
import { FONTS } from "../shell/theme.js";
import { layout, setLayout, AT, PHONE } from "./layout.js";
import { PX } from "../ui/appicons.js";
import { UX } from "../ui/uiicons.js";

/* [slot, label, where it shows, longest side when uploaded] */
export const SLOTS = [
  ["banner", "Banner", "Header background (the theme editor's Colours > Pictures banner wins)", 1400],
  ["bannerFace", "Banner face", "Clickable face on the banner", 300],
  ["logo", "Logo", "Start button, phone menu button", 160],
  ["wordmark", "Wordmark", "Start menu header (default name only)", 500],
  ["avatar", "Start menu avatar", "Top of the Start menu", 240],
  ["startArt", "Start menu corner", "Bottom of the Start menu's side column", 400],
  ["stand", "Desktop figure", "Big figure at the desktop's left edge (wide screens)", 900],
  ["clockPeek", "Clock peek", "Peeks over the clock widget", 300],
  ["mascotPeek", "Mascot peek", "Peeks over the mascot window", 300],
  ["jobsPeek", "Jobs peek", "Peeks over the Jobs window", 300],
  ["panelFill.0", "Window corner 1", "Faint drawing in the empty bottom of tall windows", 500],
  ["panelFill.1", "Window corner 2", "Second drawing for the window corners", 500],
  ["emptyNotes", "Notes, nothing open", "Notes when no page is open", 600],
  ["aiAvatar", "Assistant avatar", "Beside every reply, the chat intro, the title bar icon", 300],
  ["egg", "Flush egg", "The thing that rises for the flush easter egg", 500],
];
export const STYLES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const MAX = { badges: 16, pics: 12, say: 40 };

const saved = () => (D.config || []).find(x => x._id === "look") || {};
export const look = saved;
const baseArt = s =>
  s.startsWith("panelFill.") ? (BASE.art.panelFill || [])[+s.split(".")[1]] || null : BASE.art[s] || null;
/* ref -> url: "sos:<id>" a stored picture, "base:<slot>" the pack's own, "slot:<slot>" whatever that slot shows now, "" none */
async function url(ref, cur) {
  if (!ref) return null;
  if (ref.startsWith("sos:")) return await fileUrl(ref.slice(4)).catch(() => null);
  if (ref.startsWith("base:")) return baseArt(ref.slice(5));
  if (ref.startsWith("slot:")) return cur ? cur(ref.slice(5)) : null;
  if (ref.startsWith("pic:")) {
    const p = BASE.mascot && BASE.mascot.pics[+ref.slice(4)];
    return p ? p.src : null;
  }
  if (ref.startsWith("badge:")) {
    const b = BASE.badges && BASE.badges[+ref.slice(6)];
    return (b && b.art) || null;
  }
  return null;
}

/* ---- live layer ---- */
const subs = new Set();
const emit = () => subs.forEach(f => f());
export const useLook = () => {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
};
let gen = 0;
export async function applyLook() {
  const g = ++gen,
    d = saved(),
    a = d.art || {};
  const art = { ...BASE.art },
    pf = [...(BASE.art.panelFill || [])];
  for (const [s] of SLOTS) {
    if (!(s in a)) continue;
    const u = await url(a[s]);
    if (s.startsWith("panelFill.")) pf[+s.split(".")[1]] = u;
    else art[s] = u;
  }
  art.panelFill = pf.filter(Boolean).length ? pf.filter(Boolean) : null;
  const cur = s => (s.startsWith("panelFill.") ? pf[+s.split(".")[1]] || null : art[s] || null);
  /* designed badges (v2) carry pictures in the background and in layers */
  const v2 = async b => ({
    ...b,
    bg: { ...b.bg, url: await url(b.bg && b.bg.src, cur) },
    layers: await Promise.all(
      (b.layers || []).map(async l => (l.t === "pic" ? { ...l, url: await url(l.src, cur) } : l)),
    ),
  });
  const badges = Array.isArray(d.badges)
    ? await Promise.all(
        d.badges.map(async b => (b && b.v === 2 ? v2(b) : { ...b, art: await url(b.art, cur) })),
      )
    : BASE.badges;
  let mascot = BASE.mascot;
  if (Array.isArray(d.pics) || Array.isArray(d.say)) {
    const pics = Array.isArray(d.pics)
      ? (
          await Promise.all(
            d.pics.map(async p => ({ name: p.name || "picture", bg: p.bg || "", src: await url(p.src) })),
          )
        ).filter(p => p.src)
      : BASE.mascot
        ? BASE.mascot.pics
        : [];
    mascot = pics.length
      ? {
          alt: (BASE.mascot && BASE.mascot.alt) || AI.name,
          pics,
          say: Array.isArray(d.say) ? d.say : (BASE.mascot && BASE.mascot.say) || [],
        }
      : null;
  }
  if (g !== gen) return; // a newer edit already started
  for (const k of Object.keys(ART)) delete ART[k];
  Object.assign(ART, art);
  pack.badges = badges;
  pack.icons = { ...BASE.icons, ...cleanIcons(d.icons) };
  pack.mascot = mascot;
  pack.widgets.mascot = d.mascot === false ? false : Array.isArray(d.pics) ? !!mascot : BASE.widgets.mascot;
  for (const k of Object.keys(AI)) delete AI[k];
  Object.assign(AI, BASE.ai, cleanAI(d.ai));
  reg.names.buddy = AI.name;
  emit();
}
queueMicrotask(() => {
  onChange(c => {
    if (c === "*" || c === "config") applyLook();
  });
  applyLook();
});

/* ---- edits ---- */
const put = o => W.set("config", "look", { ...saved(), ...o, upd: new Date().toISOString() });
export const setLook = put;
/* a picked File -> webp at the slot's size -> stored, returns its ref */
export async function storePic(file, max = 600) {
  if (!/^image\//.test(file.type || "")) throw new Error("That file isn't an image");
  /* GIFs stay as they are so they keep moving (redrawing one on a canvas keeps only its first frame) */
  if (file.type === "image/gif") {
    if (file.size > 8e6) throw new Error("That GIF is over 8 MB");
    return "sos:" + (await saveFile(file, file.name));
  }
  const blob = await shrinkBlob(file, max);
  return "sos:" + (await saveFile(blob, file.name));
}
export function shrinkBlob(file, max) {
  return new Promise((ok, no) => {
    const u = URL.createObjectURL(file),
      i = new Image();
    i.onload = () => {
      const k = Math.min(1, max / Math.max(i.width, i.height)),
        c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(i.width * k));
      c.height = Math.max(1, Math.round(i.height * k));
      c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      c.toBlob(b => (b ? ok(b) : no(new Error("Couldn't read that image"))), "image/webp", 0.86);
    };
    i.onerror = () => {
      URL.revokeObjectURL(u);
      no(new Error("That file isn't an image"));
    };
    i.src = u;
  });
}
export const setSlot = (s, ref) => put({ art: { ...(saved().art || {}), [s]: ref } });
export const resetSlot = s => {
  const a = { ...(saved().art || {}) };
  delete a[s];
  return put({ art: a });
};
/* app icons: {id: 16 rows of 16 cells}; null puts the pack's own back */
export const setIcon = (id, g) => {
  const i = { ...(saved().icons || {}) };
  if (g) i[id] = g;
  else delete i[id];
  return put({ icons: i });
};
export const iconSet = id => id in (saved().icons || {});
export const slotSet = s => s in (saved().art || {});
export const slotUrl = s =>
  s.startsWith("panelFill.") ? (ART.panelFill || [])[+s.split(".")[1]] || null : ART[s] || null;

/* the editable lists start from the pack's own when the user hasn't changed them yet */
export const picRefs = () =>
  Array.isArray(saved().pics)
    ? saved().pics
    : BASE.mascot
      ? BASE.mascot.pics.map((p, i) => ({ src: "pic:" + i, name: p.name, bg: p.bg || "" }))
      : [];
export const sayLines = () =>
  Array.isArray(saved().say) ? saved().say : (BASE.mascot && BASE.mascot.say) || [];
export const badgeRefs = () =>
  Array.isArray(saved().badges)
    ? saved().badges
    : (BASE.badges || []).map((b, i) => ({
        style: b.style || "a",
        text: b.text || "",
        art: b.art ? "badge:" + i : "",
        crop: b.crop || [],
      }));

/* ---- cleaning: everything imported or typed goes through these ---- */
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const REF =
  /^(sos:[A-Za-z0-9_-]{16,64}|base:[A-Za-z.0-9]{1,20}|slot:[A-Za-z.0-9]{1,20}|pic:\d{1,2}|badge:\d{1,2}|)$/;
const ref = v => (typeof v === "string" && REF.test(v) ? v : "");
const ROW = /^[KDMLW.0-9a-f]{16}$/,
  RGB = /^#[0-9a-f]{6}$/i;
/* a drawing is 16 rows, or {r: rows, p: colours} when it uses its own colours; anything else is dropped */
const cleanIcon = v => {
  const rows = Array.isArray(v) ? v : v && Array.isArray(v.r) ? v.r : null,
    p =
      v && !Array.isArray(v) && Array.isArray(v.p)
        ? v.p.filter(c => typeof c === "string" && RGB.test(c)).slice(0, 16)
        : [];
  if (!rows || rows.length !== 16 || !rows.every(x => typeof x === "string" && ROW.test(x))) return null;
  const r = rows.map(x => x.replace(/[0-9a-f]/g, c => (parseInt(c, 16) < p.length ? c : ".")));
  return r.some(x => /[0-9a-f]/.test(x)) ? { r, p: p.map(c => c.toLowerCase()) } : r;
};
export const cleanIcons = o => {
  const r = {};
  if (o && typeof o === "object")
    for (const id of [...Object.keys(PX), ...Object.keys(UX)]) {
      const g = id in o ? cleanIcon(o[id]) : null;
      if (g) r[id] = g;
    }
  return r;
};
/* crop values go into an inline style: only sizes and positions made of numbers, px/%, and a few keywords */
const LEN =
  /^(-?\d{1,4}(\.\d{1,2})?(px|%)?|auto|cover|contain|center|top|bottom|left|right)( (-?\d{1,4}(\.\d{1,2})?(px|%)?|auto|center|top|bottom|left|right))?$/;
const crop = c =>
  Array.isArray(c)
    ? c.slice(0, 2).map(x => (typeof x === "string" && LEN.test(x.trim()) ? x.trim() : ""))
    : [];
export const cleanBadge = b =>
  b && b.v === 2
    ? cleanB2(b, ref)
    : {
        style: STYLES.includes(b && b.style) ? b.style : "a",
        text: str(b && b.text, 40),
        art: ref(b && b.art),
        crop: crop(b && b.crop),
      };
export function cleanAI(o) {
  if (!o || typeof o !== "object") return {};
  const r = {};
  for (const [k, n] of [
    ["name", 24],
    ["full", 40],
    ["intro", 300],
    ["persona", 12000],
  ])
    if (typeof o[k] === "string" && (k !== "name" || o[k].trim())) r[k] = o[k].slice(0, n);
  if (["her", "his", "their", ""].includes(o.her)) r.her = o.her;
  return r;
}
const HEX = /^(#[0-9a-f]{3,8}|transparent|)$/i;
/* a layout from a pack: known piece ids and numbers in range only (they go into inline styles), fonts from the list */
const FONT_OK = new Set(FONTS.map(f => f[0])),
  ID = /^(banner|clock|mascot|stand|badge:\d{1,2}|st:[a-z0-9]{4,12})$/,
  WID = /^[a-z0-9_-]{1,30}$/i;
const num = (v, lo, hi) => {
  v = +v;
  return isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 100) / 100)) : undefined;
};
export function cleanLayout(l, keep = ref) {
  const p = {},
    win = {},
    o = l && typeof l === "object" ? l : {};
  for (const [id, v] of Object.entries(o.p && typeof o.p === "object" ? o.p : {}).slice(0, 80)) {
    if (!ID.test(id) || !v || typeof v !== "object") continue;
    const q = {};
    if (v.at in AT) {
      q.at = v.at;
      q.x = num(v.x, -5000, 5000) || 0;
      q.y = num(v.y, -5000, 5000) || 0;
    }
    for (const [k, lo, hi] of [
      ["w", 8, 4000],
      ["s", 0.1, 8],
      ["r", -360, 360],
      ["z", -1, 9],
    ])
      if (v[k] != null && num(v[k], lo, hi) !== undefined) q[k] = num(v[k], lo, hi);
    if (v.hide) q.hide = true;
    if (id.startsWith("st:")) {
      if (v.k === "text") {
        q.k = "text";
        q.text = str(v.text, 300);
        q.font = FONT_OK.has(v.font) ? v.font : "";
        q.size = num(v.size, 6, 200) || 24;
        q.color = HEX.test(v.color || "") && v.color ? v.color : "";
      } else {
        q.k = "img";
        q.src = keep(v.src);
        if (!q.src) continue;
      }
      if (typeof v.win === "string" && WID.test(v.win)) q.win = v.win;
    }
    p[id] = q;
  }
  for (const [id, v] of Object.entries(o.win && typeof o.win === "object" ? o.win : {}).slice(0, 40)) {
    if (!WID.test(id) || !v) continue;
    const q = {};
    if (v.bg && keep(v.bg.src)) q.bg = { src: keep(v.bg.src), op: num(v.bg.op, 0, 1) ?? 0.35 };
    if (v.cap && keep(v.cap.src)) q.cap = { src: keep(v.cap.src) };
    if (q.bg || q.cap) win[id] = q;
  }
  const ph = o.ph || {},
    hide = {};
  for (const k of Object.keys(ph.hide && typeof ph.hide === "object" ? ph.hide : {}))
    if (/^(badges|clock|mascot|stickers|badge:\d{1,2}|st:[a-z0-9]{4,12})$/.test(k) && ph.hide[k])
      hide[k] = true;
  return {
    p,
    win,
    ph: { order: (Array.isArray(ph.order) ? ph.order : []).filter(x => PHONE.includes(x)), hide },
  };
}
const cleanPic = p => ({
  src: ref(p && p.src),
  name: str(p && p.name, 40) || "picture",
  bg: HEX.test((p && p.bg) || "") ? p.bg : "",
});

/* ---- pack files ---- */
const DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
async function inline(u) {
  if (!u) return "";
  if (u.startsWith("data:")) return u;
  try {
    const b = await (await fetch(u)).blob();
    return await new Promise(r => {
      const f = new FileReader();
      f.onload = () => r(f.result);
      f.readAsDataURL(b);
    });
  } catch (e) {
    return "";
  }
}
/* everything this OS shows right now, pictures inline: someone else can import it as is */
export async function exportPack({ theme, modules }) {
  const art = {};
  for (const [s] of SLOTS) art[s] = await inline(slotUrl(s));
  const badges = [];
  for (const b of pack.badges || [])
    badges.push(
      b.v === 2
        ? {
            ...b,
            bg: { ...b.bg, src: await inline(b.bg && b.bg.url), url: undefined },
            layers: await Promise.all(
              (b.layers || []).map(async l =>
                l.t === "pic" ? { ...l, src: await inline(l.url), url: undefined } : l,
              ),
            ),
          }
        : { style: b.style, text: b.text, art: await inline(b.art), crop: b.crop || [] },
    );
  const pics = [];
  for (const p of (pack.mascot && pack.mascot.pics) || [])
    pics.push({ name: p.name, bg: p.bg || "", src: await inline(p.src) });
  return {
    toybox_pack: 1,
    name: ls.get("os-name", "") || "",
    theme: theme || null,
    art,
    mascot: { pics, say: (pack.mascot && pack.mascot.say) || [], show: pack.widgets.mascot !== false },
    badges,
    icons: { ...pack.icons },
    ai: {
      name: AI.name,
      full: AI.full || "",
      her: AI.her || "",
      intro: AI.intro || "",
      persona: AI.persona || "",
    },
    modules: modules || {},
    layout: await packLayout(),
  };
}
/* the layout with sticker and window-look pictures inline */
async function packLayout() {
  const L = layout(),
    fu = async r =>
      typeof r === "string" && r.startsWith("sos:") ? inline(await fileUrl(r.slice(4)).catch(() => "")) : "";
  const p = {},
    win = {};
  for (const [id, v] of Object.entries(L.p)) p[id] = v.src ? { ...v, src: await fu(v.src) } : v;
  for (const [id, v] of Object.entries(L.win))
    win[id] = {
      ...(v.bg ? { bg: { ...v.bg, src: await fu(v.bg.src) } } : {}),
      ...(v.cap ? { cap: { src: await fu(v.cap.src) } } : {}),
    };
  return { p, win, ph: L.ph };
}
const toBlob = d => fetch(d).then(r => r.blob());
/* a pack file -> config/look (pictures stored again here); returns {theme, modules} for the caller to apply */
export async function importPack(o) {
  if (!o || o.toybox_pack !== 1) throw new Error("That isn't a toybox pack file");
  const keep = new Map(),
    pic = async d => {
      if (typeof d !== "string" || !DATA.test(d) || d.length > 6e6) return "";
      if (!keep.has(d)) keep.set(d, "sos:" + (await saveFile(await toBlob(d), "pack")));
      return keep.get(d);
    };
  const art = {};
  if (o.art && typeof o.art === "object")
    for (const [s] of SLOTS) if (s in o.art) art[s] = await pic(o.art[s]);
  const badges = [];
  for (const b of (Array.isArray(o.badges) ? o.badges : []).slice(0, MAX.badges)) {
    if (b && b.v === 2) {
      const bg = { ...(b.bg || {}), src: await pic(b.bg && b.bg.src) },
        layers = [];
      for (const l of (Array.isArray(b.layers) ? b.layers : []).slice(0, 8))
        layers.push(l && l.t === "pic" ? { ...l, src: await pic(l.src) } : l);
      badges.push(cleanBadge({ ...b, bg, layers }));
    } else badges.push(cleanBadge({ ...b, art: await pic(b && b.art) }));
  }
  const m = o.mascot || {},
    pics = [];
  for (const p of (Array.isArray(m.pics) ? m.pics : []).slice(0, MAX.pics)) {
    const src = await pic(p && p.src);
    if (src) pics.push(cleanPic({ ...p, src }));
  }
  const say = (Array.isArray(m.say) ? m.say : [])
    .filter(x => typeof x === "string")
    .slice(0, MAX.say)
    .map(x => x.slice(0, 120));
  await put({
    art,
    badges,
    pics,
    say,
    icons: cleanIcons(o.icons),
    ai: cleanAI(o.ai),
    mascot: o.mascot && o.mascot.show === false ? false : true,
  });
  /* older packs have no layout: leave the current one alone */
  if (o.layout && typeof o.layout === "object") {
    const L = o.layout,
      p = {},
      win = {};
    for (const [id, v] of Object.entries(L.p && typeof L.p === "object" ? L.p : {}).slice(0, 80))
      p[id] = v && v.src ? { ...v, src: await pic(v.src) } : v;
    for (const [id, v] of Object.entries(L.win && typeof L.win === "object" ? L.win : {}).slice(0, 40))
      win[id] = v
        ? { bg: v.bg && { ...v.bg, src: await pic(v.bg.src) }, cap: v.cap && { src: await pic(v.cap.src) } }
        : v;
    setLayout(cleanLayout({ p, win, ph: L.ph }));
  }
  return {
    theme: o.theme,
    modules: o.modules && typeof o.modules === "object" ? o.modules : null,
    name: str(o.name, 24),
  };
}
export const resetLook = () => W.set("config", "look", { upd: new Date().toISOString() });
export { cleanPic, ref as cleanRef, MAX };
