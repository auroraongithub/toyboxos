/* Alarm sounds. Presets ship in dist/sounds (Android Open Source Project tones, Apache-2.0: assets/sounds/LICENSE.md);
   your own sound files are saved like page attachments (IndexedDB + the sync server), so every device gets them.
   The choice is synced in config/alarm {sound, own: [{id, name}]}; a reminder can carry its own `sound`.
   A sound key is a preset id, "f:<file id>" (your own) or "chime" (the built-in synth beep, no file). */
import { D, W } from "./store.js";
import { toast, warn } from "./bus.js";
import { saveFile, fileUrl } from "./files.js";
import { syncConfig, HOME_SERVER } from "./sync.js";

export const PRESETS = [
  ["classic", "Classic bell"],
  ["beep", "Digital beep"],
  ["buzzer", "Buzzer"],
  ["rooster", "Rooster"],
  ["argon", "Argon"],
  ["helium", "Helium"],
  ["timing", "Timing"],
  ["osmium", "Osmium"],
  ["firedrill", "Fire drill"],
  ["chime", "Chime"],
];
const conf = () => (D.config || []).find(x => x._id === "alarm") || {};
export const ownSounds = () => (Array.isArray(conf().own) ? conf().own : []);
const known = k =>
  PRESETS.some(p => p[0] === k) || (/^f:/.test(k || "") && ownSounds().some(o => "f:" + o.id === k));
export const defaultSound = () => (known(conf().sound) ? conf().sound : "classic");
export const soundOf = r => (r && known(r.sound) ? r.sound : defaultSound());
export const soundName = k => {
  const p = PRESETS.find(x => x[0] === k);
  if (p) return p[1];
  const o = ownSounds().find(x => "f:" + x.id === k);
  return o ? o.name : "Classic bell";
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

/* the old two-tone beep: the "chime" sound, and the fallback when no file plays */
export function beep(n = 3) {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(),
        g = c.createGain();
      o.frequency.value = i % 2 ? 660 : 880;
      g.gain.value = 0.18;
      o.connect(g);
      g.connect(c.destination);
      o.start(c.currentTime + i * 0.28);
      o.stop(c.currentTime + i * 0.28 + 0.2);
    }
    setTimeout(() => c.close(), n * 280 + 400);
  } catch (e) {
    warn("alarm sound", e);
  }
}
const beepLoop = () => {
  beep(3);
  const t = setInterval(() => beep(3), 2500);
  return () => clearInterval(t);
};

/* play a sound (looping for a ringing alarm); returns stop() */
export function play(k, loop = false) {
  let stop = () => {},
    done = false;
  if (k === "chime") {
    if (!loop) beep(3);
    else stop = beepLoop();
    return () => stop();
  }
  (async () => {
    const list = await urls(k);
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
        if (e && e.name === "NotAllowedError") break; // the page may not make sound yet: the beep can't either, but try
      }
    }
    if (!done) stop = loop ? beepLoop() : (beep(3), () => {});
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
  save({ own: ownSounds().filter(o => o.id !== id), sound: was.sound === "f:" + id ? "classic" : was.sound });
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
