// node store/index.mjs [--check]  ->  store/index.json from store/packs/<id>/{meta.json, pack.json, shots}
// Checks every pack the way the app will (sizes, picture types, required license/credits) and pins each pack.json by
// sha256, so the app refuses a file that changed after review. --check only validates (for pull requests).
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PACKS = path.join(ROOT, "packs");
const ID = /^[a-z0-9][a-z0-9-]{1,31}$/,
  PIC = /^[a-z0-9_.-]{1,40}\.(webp|png|jpe?g|gif)$/,
  DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/,
  HEX = /^#[0-9a-f]{6}$/i;
const MAXPACK = 15 << 20,
  MAXPIC = 3 << 20;
// the colour each built-in skin's desktop shows (src/shell/skins.js)
const SKIN = { gray: "#8c8c8c", mono: "#f4f4f2", night: "#1d1d22", luna: "#245edb", olive: "#8b9a5b", teal: "#0e8686", sage: "#8ba587", bubble: "#ef7aa6", cherry: "#a8243a", lilac: "#8a78d6", sepia: "#9a7b55" };

const errs = [];
const bad = (id, m) => errs.push(id + ": " + m);
const str = (v, n) => typeof v === "string" && v.trim() && v.length <= n;

function images(o, at, id) {
  // every string that looks like a picture must be an inline png/jpeg/webp/gif; no remote URLs, no svg
  if (typeof o === "string") {
    if (/^(data:|https?:|\/\/|blob:|javascript:)/i.test(o) && !DATA.test(o)) bad(id, at + " is not an inline png/jpeg/webp/gif");
    return 0;
  }
  let n = 0;
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) n += images(v, at + "." + k, id) + (typeof v === "string" && DATA.test(v) ? 1 : 0);
  return n;
}

const out = [];
for (const id of fs.existsSync(PACKS) ? fs.readdirSync(PACKS).sort() : []) {
  const dir = path.join(PACKS, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (!ID.test(id)) {
    bad(id, "folder name must be 2-32 of a-z 0-9 -");
    continue;
  }
  let meta, raw, pack;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  } catch (e) {
    bad(id, "meta.json missing or not JSON");
    continue;
  }
  try {
    raw = fs.readFileSync(path.join(dir, "pack.json"));
    pack = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    bad(id, "pack.json missing or not JSON");
    continue;
  }
  if (raw.length > MAXPACK) bad(id, "pack.json is over 15 MB");
  if (!pack || pack.toybox_pack !== 1) bad(id, "pack.json is not a toybox pack (toybox_pack: 1)");
  if (!str(meta.name, 40)) bad(id, "meta.name: 1-40 characters");
  if (!str(meta.by, 40)) bad(id, "meta.by: who made it, 1-40 characters");
  if (!str(meta.license, 40)) bad(id, "meta.license: required (e.g. CC-BY-4.0, CC0-1.0, MIT, All rights reserved - shared with permission)");
  if (meta.desc != null && !str(meta.desc, 300)) bad(id, "meta.desc: up to 300 characters");
  const pics = images(pack, "pack", id);
  if (pics && !str(meta.credits, 200)) bad(id, "meta.credits: required when the pack has pictures (whose art it is)");
  const shots = (Array.isArray(meta.shots) ? meta.shots : []).slice(0, 4);
  for (const s of [meta.thumb, ...shots].filter(Boolean)) {
    if (!PIC.test(s) || !fs.existsSync(path.join(dir, s))) bad(id, "picture " + s + " missing or not webp/png/jpg/gif");
    else if (fs.statSync(path.join(dir, s)).size > MAXPIC) bad(id, s + " is over 3 MB");
  }
  if (!shots.length) bad(id, "meta.shots: at least one screenshot");
  const t = pack.theme && typeof pack.theme === "object" ? pack.theme : null,
    v = (t && t.vars) || {},
    g = (t && t.g) || {};
  const colours = [v["--desk"] || SKIN[t && t.base] || SKIN.gray, g.cap || v["--frame"] || "#222222", v["--face"] || "#ece9d8", v["--sel"] || "#333333"].filter(c => HEX.test(c));
  const art = pack.art && typeof pack.art === "object" ? Object.values(pack.art).filter(x => typeof x === "string" && DATA.test(x)).length : 0,
    m = pack.mascot || {};
  out.push({
    id,
    name: meta.name,
    by: meta.by,
    desc: meta.desc || "",
    v: String(meta.v || 1),
    license: meta.license,
    credits: meta.credits || "",
    tags: (meta.tags || []).slice(0, 6),
    file: "packs/" + id + "/pack.json",
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    size: raw.length,
    thumb: meta.thumb ? "packs/" + id + "/" + meta.thumb : "",
    shots: shots.map(s => "packs/" + id + "/" + s),
    colours,
    has: {
      theme: !!t,
      wall: !!(t && t.wall && t.wall.img),
      art,
      badges: Array.isArray(pack.badges) ? pack.badges.length : 0,
      pics: Array.isArray(m.pics) ? m.pics.length : 0,
      say: Array.isArray(m.say) ? m.say.length : 0,
      icons: pack.icons && typeof pack.icons === "object" ? Object.keys(pack.icons).length : 0,
      ai: (pack.ai && typeof pack.ai.name === "string" && pack.ai.name.slice(0, 24)) || "",
      layout: !!(pack.layout && pack.layout.p && Object.keys(pack.layout.p).length),
    },
  });
}
if (errs.length) {
  console.error(errs.join("\n"));
  process.exit(1);
}
if (!process.argv.includes("--check"))
  fs.writeFileSync(path.join(ROOT, "index.json"), JSON.stringify({ toybox_store: 1, packs: out }, null, 1) + "\n");
console.log(out.length + " packs ok");
