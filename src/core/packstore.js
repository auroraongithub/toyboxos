/* Pack store: shared packs listed in a store index (store/index.json in the public repo, or any server that serves the
   same folder layout, e.g. the sync server's /store/). Everything that comes in is data: the index is cut down to known
   fields, pictures are sniffed by their bytes, and the pack file has to match the index's sha256 before it goes through
   importPack/applyPack, whose allowlists (cleanIcons, cleanLayout, cleanAI, theme clean) are the real guard.
   Installed packs are ordinary `packs` docs with store {id, v, src}; uninstalling the pack in use goes back to the
   build's own look. A shared pack never switches modules on or off. */
import { ls } from "./pref.js";
import { syncConfig } from "./sync.js";
import { sha256 } from "./sha256.js";

export const HOME = "https://raw.githubusercontent.com/auroraongithub/toyboxos/main/store/";
const MAXINDEX = 1 << 20,
  MAXPIC = 3 << 20,
  MAXPACK = 15 << 20;

/* where to look: the public index, the sync server's /store/ when sync is set up, and any added by hand */
export const extraSources = () => ls.get("os-store-src", []);
export function sources() {
  const s = syncConfig(),
    own = s && s.on && s.url ? s.url.replace(/\/+$/, "") + "/store/" : "";
  return [...new Set([HOME, own, ...extraSources()].filter(Boolean))];
}
export const okSource = u => {
  try {
    const x = new URL(u);
    return (
      x.protocol === "https:" || (x.protocol === "http:" && /^(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+)$/.test(x.hostname))
    );
  } catch (e) {
    return false;
  }
};
export const hostOf = u => {
  try {
    const x = new URL(u);
    return x.hostname === "raw.githubusercontent.com" ? "github.com/" + x.pathname.split("/").slice(1, 3).join("/") : x.host;
  } catch (e) {
    return u;
  }
};

/* ---- reading with a size cap ---- */
async function bytes(url, max) {
  /* raw.githubusercontent.com keeps files in its own cache for minutes (even for revalidation), so the index and a
     pack file can disagree right after a push: a fresh query makes it fetch the current one */
  if (/^https:\/\/raw\.githubusercontent\.com\//.test(url)) url += (url.includes("?") ? "&" : "?") + "t=" + Date.now();
  const r = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error(r.status === 404 ? "not found" : "HTTP " + r.status);
  const n = +r.headers.get("content-length") || 0;
  if (n > max) throw new Error("too big");
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > max) throw new Error("too big");
  return b;
}
const text = b => new TextDecoder().decode(b);

/* ---- the index ---- */
const ID = /^[a-z0-9][a-z0-9-]{1,31}$/,
  FILE = /^packs\/[a-z0-9][a-z0-9-]{1,31}\/[a-z0-9_.-]{1,40}\.json$/,
  PIC = /^packs\/[a-z0-9][a-z0-9-]{1,31}\/[a-z0-9_.-]{1,40}\.(webp|png|jpe?g|gif)$/,
  SHA = /^[0-9a-f]{64}$/,
  HEX = /^#[0-9a-f]{6}$/i;
const s = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const n = (v, hi) => (Number.isFinite(+v) ? Math.max(0, Math.min(hi, Math.round(+v))) : 0);
export function cleanEntry(e, src) {
  if (!e || typeof e !== "object" || !ID.test(e.id) || !FILE.test(e.file) || !SHA.test(e.sha256)) return null;
  const size = n(e.size, MAXPACK + 1);
  if (!size || size > MAXPACK) return null;
  const h = e.has && typeof e.has === "object" ? e.has : {};
  return {
    id: e.id,
    src,
    name: s(e.name, 40) || e.id,
    by: s(e.by, 40),
    desc: s(e.desc, 300),
    v: s(String(e.v ?? "1"), 12) || "1",
    license: s(e.license, 40),
    credits: s(e.credits, 200),
    tags: (Array.isArray(e.tags) ? e.tags : []).map(t => s(t, 16).toLowerCase()).filter(Boolean).slice(0, 6),
    file: e.file,
    sha256: e.sha256,
    size,
    thumb: PIC.test(e.thumb || "") ? e.thumb : "",
    shots: (Array.isArray(e.shots) ? e.shots : []).filter(x => PIC.test(x || "")).slice(0, 4),
    colours: (Array.isArray(e.colours) ? e.colours : []).filter(c => HEX.test(c || "")).slice(0, 4),
    has: {
      theme: !!h.theme,
      wall: !!h.wall,
      art: n(h.art, 99),
      badges: n(h.badges, 99),
      pics: n(h.pics, 99),
      say: n(h.say, 99),
      icons: n(h.icons, 999),
      ai: s(h.ai, 24),
      layout: !!h.layout,
    },
  };
}
export async function loadIndex(src) {
  const j = JSON.parse(text(await bytes(src + "index.json", MAXINDEX)));
  if (!j || j.toybox_store !== 1 || !Array.isArray(j.packs)) throw new Error("not a pack store");
  const out = [],
    seen = new Set();
  for (const e of j.packs.slice(0, 500)) {
    const c = cleanEntry(e, src);
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}
/* every source at once; a source that fails is reported, the rest still list. Last good list is kept for offline */
export async function loadAll() {
  const res = await Promise.all(
    sources().map(src =>
      loadIndex(src).then(
        packs => ({ src, packs }),
        e => ({ src, err: e.message || "unreachable" }),
      ),
    ),
  );
  const packs = res.flatMap(r => r.packs || []),
    errs = res.filter(r => r.err && !(r.src !== HOME && r.err === "not found"));
  if (packs.length) ls.set("os-store-cache", packs);
  return { packs: packs.length ? packs : ls.get("os-store-cache", []).map(e => cleanEntry(e, e.src)).filter(Boolean), errs, offline: !packs.length && errs.length > 0 };
}

/* ---- pictures: only real png/jpeg/webp/gif bytes, shown through a blob URL of that type ---- */
const sniff = b =>
  b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    ? "image/png"
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
      ? "image/jpeg"
      : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
        ? "image/webp"
        : b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46
          ? "image/gif"
          : "";
const pics = new Map();
export function picUrl(src, path) {
  const k = src + path;
  if (!pics.has(k))
    pics.set(
      k,
      bytes(k, MAXPIC)
        .then(b => {
          const t = sniff(b);
          return t ? URL.createObjectURL(new Blob([b], { type: t })) : "";
        })
        .catch(() => ""),
    );
  return pics.get(k);
}

/* ---- the pack file: fetched once, checked against the index's hash ---- */
const files = new Map();
export function packFile(e) {
  const k = e.src + e.file + "#" + e.sha256;
  if (!files.has(k))
    files.set(
      k,
      (async () => {
        const b = await bytes(e.src + e.file, MAXPACK);
        if ((await sha256(b)) !== e.sha256)
          throw new Error("The pack file doesn't match the store's fingerprint");
        const o = JSON.parse(text(b));
        if (!o || o.toybox_pack !== 1) throw new Error("That isn't a toybox pack file");
        delete o.modules;
        return o;
      })(),
    );
  const p = files.get(k);
  p.catch(() => files.delete(k));
  return p;
}

/* what a parsed pack would show, from the file itself (only the parts importPack keeps) */
const DATA = /^data:image\/(png|jpeg|webp|gif);base64,/;
export function contents(o) {
  const art = Object.entries(o.art && typeof o.art === "object" ? o.art : {})
      .filter(([, v]) => typeof v === "string" && DATA.test(v))
      .slice(0, 16),
    m = o.mascot || {},
    ai = o.ai && typeof o.ai === "object" ? o.ai : {};
  return {
    art,
    pics: (Array.isArray(m.pics) ? m.pics : []).filter(p => p && DATA.test(p.src || "")).slice(0, 12),
    say: (Array.isArray(m.say) ? m.say : []).filter(x => typeof x === "string").slice(0, 40),
    badges: (Array.isArray(o.badges) ? o.badges : []).filter(b => b && typeof b === "object").slice(0, 16),
    ai: { name: s(ai.name, 24), full: s(ai.full, 40), persona: typeof ai.persona === "string" ? ai.persona.slice(0, 12000) : "" },
  };
}
/* one entry per id across sources: the first source wins (the public store first) */
export const dedupe = list => {
  const seen = new Set();
  return list.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)));
};
