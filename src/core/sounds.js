/* Alarm sounds: real recordings only (public domain / CC0 from Wikimedia Commons, a few from the Android Open Source
   Project; sources in assets/sounds/LICENSE.md), shipped in dist/sounds and fetched when one plays.
   your own sound files are saved like page attachments (IndexedDB + the sync server), so every device gets them.
   The choice is synced in config/alarm {sound, own: [{id, name}]}; a reminder can carry its own `sound`.
   A sound key is a preset id or "f:<file id>" (your own). */
import { D, W } from "./store.js";
import { toast, warn } from "./bus.js";
import { saveFile, fileUrl } from "./files.js";
import { syncConfig, HOME_SERVER } from "./sync.js";

export const PRESETS = [
  ["mechanical", "Alarm clock bell"],
  ["digital", "Digital alarm clock"],
  ["classic", "Classic bell"],
  ["schoolbell", "School bell"],
  ["telephone", "Old telephone"],
  ["rooster", "Rooster"],
  ["beep", "Beeping"],
  ["buzzer", "Buzzer"],
  ["smoke", "Smoke alarm"],
  ["siren", "Siren"],
];
const conf = () => (D.config || []).find(x => x._id === "alarm") || {};
export const ownSounds = () => (Array.isArray(conf().own) ? conf().own : []);
const known = k =>
  PRESETS.some(p => p[0] === k) || (/^f:/.test(k || "") && ownSounds().some(o => "f:" + o.id === k));
export const defaultSound = () => (known(conf().sound) ? conf().sound : "mechanical");
export const soundOf = r => (r && known(r.sound) ? r.sound : defaultSound());
export const soundName = k => {
  const p = PRESETS.find(x => x[0] === k);
  if (p) return p[1];
  const o = ownSounds().find(x => "f:" + x.id === k);
  return o ? o.name : "Alarm clock bell";
};
const save = o => W.set("config", "alarm", { ...conf(), ...o, upd: new Date().toISOString() });
export const setDefaultSound = k => save({ sound: k });

/* where a sound's file is: next to the app, then on the sync server (older native installs don't have dist/sounds) */
async function urls(k) {
  if (/^f:/.test(k)) {
    const u = await fileUrl(k.slice(2));
    return u ? [u] : [];
  }
  const srv = (syncConfig().url || HOME_SERVER).replace(/\/+$/, "");
  return ["sounds/" + k + ".ogg", ...(srv ? [srv + "/sounds/" + k + ".ogg"] : [])];
}

/* play a sound (looping for a ringing alarm); returns stop() */
export function play(k, loop = false) {
  let stop = () => {},
    done = false;
  (async () => {
    /* the chosen sound, then the default bell if that one can't be found (offline, removed file) */
    const list = [...(await urls(k)), ...(k === "mechanical" ? [] : await urls("mechanical"))];
    for (const u of list) {
      if (done) return;
      const a = new Audio(u);
      a.loop = loop;
      try {
        await a.play();
        if (done) return a.pause();
        stop = () => {
          a.pause();
          a.src = "";
        };
        return;
      } catch (e) {
        if (e && e.name === "NotAllowedError") return; // the page may not make sound yet (no tap so far)
      }
    }
  })();
  return () => {
    done = true;
    stop();
  };
}
let pv = null;
export const preview = k => {
  if (pv) pv();
  pv = play(k);
};
export const stopPreview = () => {
  if (pv) pv();
  pv = null;
};

/* your own sound: any audio file up to 5 MB */
export async function addOwnSound(file) {
  if (!file) return null;
  if (!/^audio\//.test(file.type)) {
    toast("That isn't an audio file");
    return null;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast("Sounds can be up to 5 MB");
    return null;
  }
  const id = await saveFile(file, file.name),
    name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || "My sound";
  save({ own: [...ownSounds(), { id, name }] });
  return "f:" + id;
}
export function removeOwnSound(id) {
  const was = conf();
  save({ own: ownSounds().filter(o => o.id !== id), sound: was.sound === "f:" + id ? "mechanical" : was.sound });
  toast("Sound removed", { label: "Undo", run: () => W.set("config", "alarm", was) });
}

/* Android rings with the app closed, so it keeps its own copy of your sounds (presets are built into the APK) */
const sent = new Set();
export async function nativeSound(B, k) {
  if (!/^f:/.test(k) || sent.has(k) || typeof B.alarmSound !== "function") return;
  try {
    if (B.hasSound && B.hasSound(k.slice(2))) return sent.add(k);
    const u = (await urls(k))[0];
    if (!u) return;
    const b = await (await fetch(u)).blob();
    const b64 = await new Promise(r => {
      const f = new FileReader();
      f.onload = () => r(String(f.result).split(",")[1] || "");
      f.readAsDataURL(b);
    });
    if (b64) B.alarmSound(k.slice(2), b64);
    sent.add(k);
  } catch (e) {
    warn("native sound", e);
  }
}
