/* Pack library (Theme editor > Packs): every pack file loaded here or in Setup, and every "Save current look", is kept as a
   `packs` doc {name, file (the pack JSON in the file store, so it syncs and other devices fetch it), thumb (small data URL),
   colours[], sig}. Use = applyPack on that file; the built-in tile goes back to the build's own pack. config/look.pack
   remembers which one is in use (synced). */
import { useState, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { D, W, useCols, drop } from "../core/store.js";
import { ls } from "../core/pref.js";
import { saveFile, fileUrl } from "../core/files.js";
import { pack, BASE, ART } from "../core/pack.js";
import { look, setLook, resetLook, exportPack } from "../core/look.js";
import { layout, setLayout, resetLayout } from "../core/layout.js";
import { FEATURES, wanted } from "../core/features.js";
import { SKINS, applySkin } from "../shell/skins.js";
import { setTheme, applyTheme, blank } from "../shell/theme.js";
import { Btn, Group, Icon } from "../ui/index.js";
import { actionSheet, askText } from "../ui/sheet.js";
import { applyPack } from "./theme.js";

const hash = s => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + "-" + s.length.toString(36);
};
/* a 96px picture for the tile: the pack's avatar, logo or wordmark */
async function thumbOf(o) {
  const a = o.art || {},
    src = a.avatar || a.logo || a.wordmark || a.bannerFace || "";
  if (!src) return "";
  try {
    const i = new Image();
    i.src = src;
    await i.decode();
    const k = 96 / Math.max(i.width, i.height),
      c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(i.width * k));
    c.height = Math.max(1, Math.round(i.height * k));
    c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
    return c.toDataURL("image/webp", 0.8);
  } catch (e) {
    return "";
  }
}
const coloursOf = o => {
  const t = o.theme || {},
    v = t.vars || {},
    g = t.g || {},
    sk = (SKINS.find(s => s[0] === t.base) || SKINS[0])[2];
  return [
    v["--desk"] || sk,
    g.cap || v["--frame"] || "#222222",
    v["--face"] || "#ece9d8",
    v["--sel"] || "#333333",
  ].slice(0, 4);
};

/* keep a pack (the parsed file) in the library; the same file twice is kept once. Returns its id */
export async function keepPack(o, name) {
  const s = JSON.stringify(o),
    sig = hash(s),
    have = (D.packs || []).find(p => p.sig === sig);
  if (have) return have._id;
  const file = await saveFile(new Blob([s], { type: "application/json" }), (name || "pack") + ".json");
  const id = "pk" + Math.random().toString(36).slice(2, 10);
  await W.set("packs", id, {
    name: (name || o.name || "Pack").slice(0, 40),
    file,
    thumb: await thumbOf(o),
    colours: coloursOf(o),
    sig,
    at: new Date().toISOString(),
  });
  return id;
}
export const inUse = () => look().pack || "";
const mark = id => setLook({ pack: id });

/* undo for any switch: the look, the theme and the layout as they were */
const snapshot = () => {
  const L = JSON.parse(JSON.stringify(look())),
    T = ls.get("os-theme", null),
    Y = JSON.parse(JSON.stringify(layout()));
  return () => {
    W.set("config", "look", { ...L, upd: new Date().toISOString() });
    setTheme(() => T || { ...blank(), on: false });
    applyTheme();
    if (T && T.base) applySkin(T.base, true);
    setLayout(Y);
  };
};

async function use(p) {
  const undo = snapshot();
  toast("Switching…");
  try {
    const u = await fileUrl(p.file);
    if (!u) throw new Error("This pack's file isn't on this device yet. Sync, then try again.");
    const o = JSON.parse(await (await fetch(u)).text());
    await applyPack(o);
    mark(p._id);
    toast(p.name + " is on", { label: "Undo", run: undo });
  } catch (e) {
    toast(e.message || "Couldn't open that pack");
  }
}
function useBuiltIn() {
  const undo = snapshot();
  resetLook();
  setTheme(x => ({ ...x, on: false }));
  applyTheme();
  resetLayout();
  toast("Back to the built-in look", { label: "Undo", run: undo });
}
async function saveCurrent() {
  const name = await askText({
    title: "Save the current look",
    value: ls.get("os-name", "") || "My look",
    ok: "Save",
  });
  if (!name || !name.trim()) return;
  toast("Packing…");
  const mods = {};
  for (const f of FEATURES) mods[f.id] = wanted(f.id);
  const o = await exportPack({ theme: ls.get("os-theme", null), modules: mods });
  o.name = name.trim();
  const id = await keepPack(o, name.trim());
  mark(id);
  toast("Saved as " + name.trim());
}
async function download(p) {
  const u = await fileUrl(p.file);
  if (!u) {
    toast("This pack's file isn't on this device yet");
    return;
  }
  const l = document.createElement("a");
  l.href = u;
  l.download = p.name.replace(/[^\w .-]+/g, "").trim() + ".json";
  l.click();
}
export async function loadPackFile(file) {
  let o;
  try {
    o = JSON.parse(await file.text());
  } catch (e) {
    toast("That isn't a toybox pack file");
    return;
  }
  const undo = snapshot();
  try {
    const { r } = await applyPack(o);
    const id = await keepPack(o, r.name || file.name.replace(/\.json$/i, ""));
    mark(id);
    toast("Pack added and on", { label: "Undo", run: undo });
  } catch (e) {
    toast(e.message || "That isn't a toybox pack file");
  }
}

function Tile({ p, on }) {
  const menu = e => {
    e.stopPropagation();
    actionSheet(
      p.name,
      [
        on ? null : ["applied", "Use", () => use(p)],
        [
          "edit",
          "Rename…",
          () =>
            askText({ title: "Pack name", value: p.name, ok: "Rename" }).then(v => {
              if (v && v.trim()) W.upd("packs", p._id, { name: v.trim().slice(0, 40) });
            }),
        ],
        ["export", "Export file", () => download(p)],
        "-",
        [
          "trash",
          "Remove from the list",
          () => {
            if (on) setLook({ pack: "" });
            drop("packs", p._id, "Pack removed");
          },
          { danger: true },
        ],
      ],
      e.currentTarget,
    );
  };
  return html`<div class=${"pkt" + (on ? " on" : "")}>
    <button type="button" class="pkp" aria-pressed=${String(on)} aria-label=${"Use " + p.name} onClick=${() => on || use(p)}>
      <span class="pkv">${p.thumb ? html`<img src=${p.thumb} alt=""/>` : html`<${Icon} n="image"/>`}</span>
      <span class="pkc">${(p.colours || []).map((c, i) => html`<i key=${i} style=${"background:" + c}/>`)}</span>
      <b>${p.name}</b><small>${on ? "In use" : "Use"}</small></button>
    <${Btn} icon="more" cls="pkm" aria-label=${p.name + " options"} onClick=${menu}/>
  </div>`;
}

export function PacksTab() {
  useCols("packs", "config");
  const list = [...(D.packs || [])].sort((a, b) => (b.at || "").localeCompare(a.at || "")),
    cur = inUse();
  const custom =
    !!Object.keys(look()).filter(k => !["upd", "pack", "_id", "at", "_u"].includes(k)).length ||
    (ls.get("os-theme", null) || {}).on;
  const builtOn = !cur && !custom;
  const fi = e => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = ".json,application/json";
    i.className = "led-file";
    i.onchange = () => {
      const f = i.files[0];
      i.remove();
      if (f) loadPackFile(f);
    };
    document.body.appendChild(i);
    i.click();
  };
  return html`<div class="thg"><${Group} title="Packs" meta=${html`<span class="lkn">${list.length + 1}</span>`}/>
    <div class="pks">
      <div class=${"pkt" + (builtOn ? " on" : "")}>
        <button type="button" class="pkp" aria-pressed=${String(builtOn)} aria-label="Use the built-in look" onClick=${() => builtOn || useBuiltIn()}>
          <span class="pkv">${BASE.art.avatar || BASE.art.logo ? html`<img src=${BASE.art.avatar || BASE.art.logo} alt=""/>` : html`<${Icon} n="image"/>`}</span>
          <span class="pkc">${coloursOf({ theme: { base: ls.get("os-skin", "gray") } }).map((c, i) => html`<i key=${i} style=${"background:" + c}/>`)}</span>
          <b>Built-in</b><small>${builtOn ? "In use" : "Use"}</small></button>
      </div>
      ${list.map(p => html`<${Tile} key=${p._id} p=${p} on=${cur === p._id}/>`)}
      <button type="button" class="pkadd" onClick=${fi}><${Icon} n="import"/>Add a pack file…</button>
      <button type="button" class="pkadd" onClick=${saveCurrent}><${Icon} n="plus"/>Save current look</button>
    </div></div>`;
}
