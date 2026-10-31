/* Setup: the first run on a new device (Start > Setup… runs it again). An installer-style dialog: name the OS; sync, only
   when the app came from a server (its token; a second device gets everything from it and can finish on any step);
   timezone and currencies; the assistant (optional module "ai", with name and pronouns when on); look (skin or a pack
   file). Server-tied modules stay in Profile > Modules. Shown once (pref os-setup) and only on a device with no data
   and no sync set up, so existing installs never see it. */
import { useState, useEffect, useRef } from "preact/hooks";
import { html, TZ } from "../core/lib.js";
import { D, COLS, meta } from "../core/store.js";
import { ls, useMedia } from "../core/pref.js";
import { toast } from "../core/bus.js";
import { ART, AI } from "../core/pack.js";
import { look, setLook, cleanAI } from "../core/look.js";
import { DEFAULT_NAME } from "../brand.js";
import { profile, setProfile, PRONOUNS } from "../core/profile.js";
import { syncConfig, connectWith, native, HOME_SERVER, hashPair, dropHashPair } from "../core/sync.js";
import { openMod } from "../shell/os.js";
import { SKINS, applySkin } from "../shell/skins.js";
import { Btn, Field, Select, Combo, Check } from "../ui/index.js";
import { ZONES, CODES, curOpt, code } from "./profile.js";
import { wanted, setWanted, useMods } from "../core/features.js";
import { applyPack } from "./theme.js";
import { keepPack } from "./packs.js";

/* the server this copy came from: the pack's (native builds), else the page's own origin */
const ownServer = () =>
  native ? HOME_SERVER : /^https?:/.test(location.protocol) ? location.origin : HOME_SERVER;
const empty = () => COLS.every(c => c === "config" || !(D[c] || []).length);
export const openSetup = async () => {
  if (!found) await findServer();
  dispatchEvent(new Event("os-setup"));
};
/* at start: a device that already has data or sync (or answered the old sync question) counts as set up */
export async function firstRun() {
  /* a pairing link on a device that's already set up: straight to Sync with the code filled in */
  if (ls.get("os-setup", false)) {
    if (hashPair() && !syncConfig().on) openMod("sync", true);
    return;
  }
  if (ls.get("os-sync-asked", false) || syncConfig().url || !empty()) {
    ls.set("os-setup", true);
    return;
  }
  await findServer();
  openSetup();
}
/* a sync server answers /api/ping (401 without a token); a plain web host doesn't */
let found = "";
async function findServer() {
  const u = ownServer();
  found = "";
  if (!u) return;
  try {
    const r = await fetch(u.replace(/\/+$/, "") + "/api/ping", { cache: "no-store" });
    const j = await r.json();
    if ((r.status === 401 || r.status === 200) && "ok" in j) found = u;
  } catch {
    // no server at this address
  }
}

const fromProfile = () => {
  const p = profile();
  return {
    name: p.name,
    pronouns: p.pronouns,
    tz: p.tz,
    cur: curOpt(p.cur),
    cur2: p.cur2 ? curOpt(p.cur2) : "",
  };
};
const host = u => {
  try {
    return new URL(u).host;
  } catch (e) {
    return u;
  }
};
function Setup({ close }) {
  useMods();
  const phone = useMedia("(max-width:860px)"),
    known = syncConfig().url || found,
    [server, setServer] = useState(known);
  /* no known server = nothing to connect to here (Start > Sync later), except in the installed app, which can name one */
  const STEPS = [
    ["welcome", "Welcome"],
    known || native ? ["sync", "Sync"] : null,
    ["region", "Time and money"],
    ["ai", "Assistant"],
    ["look", "Look"],
  ].filter(Boolean);
  const [i, setI] = useState(0),
    k = STEPS[i][0];
  const [os, setOs] = useState(ls.get("os-name", DEFAULT_NAME));
  const [tok, setTok] = useState(hashPair),
    [msg, setMsg] = useState(""),
    [linked, setLinked] = useState(false),
    [filled, setFilled] = useState(false);
  const [f, setF] = useState(fromProfile),
    touched = useRef(false);
  const [skin, setSkin] = useState(ls.get("os-skin", "gray")),
    [packName, setPack] = useState("");
  const fi = useRef();
  const set = n => v => {
    touched.current = true;
    setF(o => ({ ...o, [n]: v }));
  };
  /* a connected server may already have a profile: show it unless they've typed over it */
  useEffect(() => {
    if (!touched.current) setF(fromProfile());
  }, [k, filled]);
  const link = async () => {
    if (!server.trim()) return setMsg("Enter the server address first.");
    setMsg("Connecting…");
    const e = await connectWith(server.trim(), tok);
    if (e) {
      setMsg(e);
      return;
    }
    setLinked(true);
    const had = (D.config || []).some(x => x._id === "profile");
    setFilled(had);
    setMsg(had ? "Connected, and your settings came over from the server." : "Connected.");
  };
  /* opened from a pairing link (the QR in Pair a device): connect right away */
  useEffect(() => {
    if (hashPair()) {
      dropHashPair();
      if (server) link().then(() => syncConfig().on && toast("Paired with " + host(server)));
    }
  }, []);
  const finish = async () => {
    const bad =
      f.tz && !ZONES.includes(f.tz)
        ? "Pick a timezone from the list"
        : !CODES.includes(code(f.cur))
          ? "Pick a home currency from the list"
          : f.cur2 && !CODES.includes(code(f.cur2))
            ? "Pick the second currency from the list, or leave it empty"
            : "";
    if (bad) {
      setI(STEPS.findIndex(x => x[0] === "region"));
      toast(bad);
      return;
    }
    if (touched.current || !filled)
      await setProfile({
        name: f.name,
        pronouns: f.pronouns,
        tz: f.tz,
        cur: code(f.cur),
        cur2: f.cur2 ? code(f.cur2) : "",
      });
    if (an.trim() && an.trim() !== AI.name)
      setLook({ ai: cleanAI({ ...(look().ai || {}), name: an.trim() }) });
    ls.set("os-name", os.trim() || DEFAULT_NAME);
    ls.set("os-setup", true);
    ls.set("os-sync-asked", true);
    close();
    if (f.tz && f.tz !== TZ) setTimeout(() => location.reload(), 300);
    else toast((os.trim() || DEFAULT_NAME) + " is ready");
  };
  const skip = () => {
    ls.set("os-setup", true);
    ls.set("os-sync-asked", true);
    close();
  };
  const pack = async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const o = JSON.parse(await file.text()),
        { r } = await applyPack(o);
      keepPack(o, r.name || file.name.replace(/\.json$/i, ""))
        .then(id => setLook({ pack: id }))
        .catch(() => {});
      setPack(file.name);
      setSkin(ls.get("os-skin", "gray"));
      if (r.name && os === DEFAULT_NAME) setOs(r.name);
    } catch (err) {
      toast(err.message || "That isn't a toybox pack file");
    }
  };
  const [an, setAn] = useState(AI.name);
  const row = (l, el) => html`<label class="su-r"><span>${l}</span>${el}</label>`;
  const ai = wanted("ai");
  const body = {
    welcome: html`<h2>Welcome</h2>
      ${row("Name your OS", html`<${Field} value=${os} maxlength="24" onInput=${e => setOs(e.target.value)} aria-label="OS name"/>`)}`,
    sync: html`<h2>Sync</h2><p>${known ? `This app came from ${host(known)}. Enter the pairing code it gave you` : "If another computer hosts sync for you, enter its address and a pairing code from it (Start > Sync > Pair a device there)"} to keep your devices in sync, or go on without it to keep everything on this device.</p>
      ${known ? null : row("Server address", html`<${Field} autocomplete="off" spellcheck="false" value=${server} placeholder="https://pc.tailnet.ts.net" onInput=${e => setServer(e.target.value)} aria-label="Server address"/>`)}
      ${row("Pairing code", html`<${Field} autocomplete="off" autocapitalize="characters" spellcheck="false" value=${tok} placeholder="ABCD-2345" onInput=${e => setTok(e.target.value)} onEnter=${link} aria-label="Pairing code"/>`)}
      <div class="su-act"><${Btn} onClick=${link} disabled=${linked || !tok.trim()}>${linked ? "Connected" : "Connect"}<//><span class=${"su-msg" + (!linked && msg && msg !== "Connecting…" ? " late" : "")}>${msg}</span></div>`,
    region: html`<h2>Time and money</h2>
      ${row("Timezone", html`<${Combo} value=${f.tz} options=${() => ZONES} onInput=${set("tz")} placeholder="Region/City" aria-label="Timezone"/>`)}
      ${row("Home currency", html`<${Combo} value=${f.cur} options=${() => CODES.map(curOpt)} onInput=${set("cur")} aria-label="Home currency"/>`)}
      ${row("Second currency", html`<${Combo} value=${f.cur2} options=${() => CODES.map(curOpt)} onInput=${set("cur2")} placeholder="none" aria-label="Second currency"/>`)}`,
    ai: html`<h2>Assistant</h2><p>Optional. Needs a model on your server or this computer.</p>
      <label class="su-ck"><${Check} on=${ai} label="Use the assistant" onClick=${() => setWanted("ai", !ai)}/>Use the assistant</label>
      ${
        ai
          ? html`${row("Its name", html`<${Field} value=${an} maxlength="24" onInput=${e => setAn(e.target.value)} aria-label="Assistant name"/>`)}
        ${row("Your name", html`<${Field} value=${f.name} onInput=${e => set("name")(e.target.value)} aria-label="Your name"/>`)}
        ${row("Pronouns", html`<${Select} opts=${PRONOUNS} value=${f.pronouns} onChange=${set("pronouns")}/>`)}`
          : null
      }`,
    look: html`<h2>Look</h2>
      <div class="su-skins">${SKINS.map(
        ([v, l, c]) =>
          html`<button type="button" key=${v} class="su-skin" aria-pressed=${String(skin === v)} onClick=${() => {
            applySkin(v);
            setSkin(v);
          }}><i style=${"background:" + c}/>${l}</button>`,
      )}</div>
      <div class="su-act"><${Btn} icon="import" onClick=${() => fi.current.click()}>Load a pack file…<//>${packName ? html`<span class="su-msg">Loaded ${packName}</span>` : null}</div>
      <input ref=${fi} type="file" accept=".json,application/json" hidden onChange=${pack}/>`,
  }[k];
  /* the server filled everything in: any step can finish */
  const last = i === STEPS.length - 1,
    done = last || filled;
  return html`<div class="su-scrim"><div class="win su-win" role="dialog" aria-modal="true" aria-label="Setup">
    <div class="tb"><span class="t">Setup</span></div>
    <div class="su-main">
      ${
        phone
          ? null
          : html`<div class="su-side">${ART.startArt || ART.avatar ? html`<img src=${ART.startArt || ART.avatar} alt=""/>` : html`<b class="su-os">${os || DEFAULT_NAME}</b>`}
        <ol>${STEPS.map(([s, l], j) => html`<li key=${s} class=${j === i ? "on" : j < i ? "done" : ""}>${l}</li>`)}</ol></div>`
      }
      <div class="su-body" key=${k}>${phone ? html`<small class="su-n">Step ${i + 1} of ${STEPS.length}</small>` : null}${body}</div>
    </div>
    <div class="su-ft">
      ${i ? html`<${Btn} onClick=${() => setI(i - 1)}>Back<//>` : html`<${Btn} onClick=${skip}>Skip setup<//>`}
      <span class="su-sp"/>
      ${done && !last ? html`<${Btn} onClick=${() => setI(i + 1)}>Next<//>` : null}
      <${Btn} go onClick=${done ? finish : () => setI(i + 1)}>${done ? "Finish" : "Next"}<//>
    </div>
  </div></div>`;
}
/* mounted once in App.js */
export function SetupHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const f = () => setOpen(true);
    addEventListener("os-setup", f);
    return () => removeEventListener("os-setup", f);
  }, []);
  return open ? html`<${Setup} close=${() => setOpen(false)}/>` : null;
}
