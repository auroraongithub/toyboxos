import { useState, useEffect } from "preact/hooks";
import { html, dkey, today, mmss, plural } from "../core/lib.js";
import { ls } from "../core/pref.js";
import { toast, warn } from "../core/bus.js";
import { useCols, W, D } from "../core/store.js";
import { Tabs, Panel, StatusBar, Btn, Field, Seg } from "../ui/index.js";
import { openMod } from "../shell/os.js";
import { askPermission } from "../core/alarms.js";
import { play, defaultSound } from "../core/sounds.js";
const NB = () => window.AndroidBridge || null;

const PM = { focus: 25, short: 5, long: 15 };
const ps = Object.assign(
  { mode: "focus", remain: PM.focus * 60, running: false, endAt: 0, label: "" },
  ls.get("os-pomo", {}),
);
const subs = new Set();
const emit = () => subs.forEach(f => f());
const save = () => ls.set("os-pomo", ps);
export const remain = () =>
  ps.running ? Math.max(0, Math.round((ps.endAt - Date.now()) / 1000)) : ps.remain;
export const start = () => {
  if (ps.running) return;
  ps.endAt = Date.now() + ps.remain * 1000;
  ps.running = true;
  save();
  emit();
  askPermission();
  const B = NB();
  if (B)
    try {
      B.timerStart(ps.mode, ps.label || "", ps.endAt);
    } catch (e) {
      warn("android timer", e);
    }
};
export const timerState = () => ({ mode: ps.mode, running: ps.running, label: ps.label, left: remain() });
export const setLabel = label => {
  ps.label = label;
  save();
  emit();
};
/* the end time is fixed, so the count survives the app being backgrounded; this tells you when it ends while you're away */
function notify() {
  if (NB() || !document.hidden || !window.Notification || Notification.permission !== "granted") return;
  const t = ps.mode === "focus" ? "Focus session done" : "Break's over",
    o = { body: ps.label || "toybox.os timer", tag: "sos-timer", renotify: true };
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller)
      navigator.serviceWorker.ready.then(r => r.showNotification(t, o));
    else new Notification(t, o);
  } catch (e) {
    warn("notification", e);
  }
}
export const pause = () => {
  if (!ps.running) return;
  ps.remain = remain();
  ps.running = false;
  save();
  emit();
  const B = NB();
  if (B)
    try {
      B.timerPause();
    } catch (e) {
      warn("android timer", e);
    }
};
export const setMode = m => {
  ps.mode = m;
  ps.remain = PM[m] * 60;
  ps.running = false;
  save();
  emit();
  const B = NB();
  if (B)
    try {
      B.timerStop();
    } catch (e) {
      warn("android timer", e);
    }
};
function finish() {
  ps.running = false;
  notify();
  if (ps.mode === "focus") {
    W.add("pomos", { mins: PM.focus, label: ps.label || "" });
    const n = D.pomos.filter(p => dkey(new Date(p.at)) === today()).length + 1;
    ps.mode = n % 4 === 0 ? "long" : "short";
  } else ps.mode = "focus";
  ps.remain = PM[ps.mode] * 60;
  save();
  if (!NB()) play(defaultSound()); // the alarm sound, once
  toast("Timer done");
  emit();
  const B = NB();
  if (B)
    try {
      B.timerClear();
    } catch (e) {
      warn("android timer", e);
    }
}
/* the notification's Pause / Resume / Stop buttons change the native timer; take its state whenever the app comes back */
function syncNative() {
  const B = NB();
  if (!B) return;
  let s = null;
  try {
    s = JSON.parse(B.timerState() || "null");
  } catch (e) {
    return;
  }
  if (!s) {
    if (ps.running) {
      ps.running = false;
      ps.remain = PM[ps.mode] * 60;
      save();
      emit();
    }
    return;
  }
  if (s.done) {
    if (ps.running) {
      ps.endAt = Date.now() - 1;
      finish();
    } else {
      try {
        B.timerClear();
      } catch (e) {
        warn("android timer", e);
      }
    }
    return;
  }
  if (s.running) {
    if (!ps.running || ps.endAt !== s.endAt) {
      ps.mode = s.mode || ps.mode;
      ps.endAt = s.endAt;
      ps.running = true;
      save();
      emit();
    }
  } else if (ps.running || ps.remain !== s.remain) {
    ps.mode = s.mode || ps.mode;
    ps.running = false;
    ps.remain = s.remain;
    save();
    emit();
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncNative();
});
addEventListener("focus", syncNative);
setTimeout(syncNative, 800);
const baseTitle = document.title;
setInterval(() => {
  if (ps.running && remain() <= 0) {
    finish();
    return;
  }
  document.title = ps.running ? mmss(remain()) + " · " + baseTitle : baseTitle;
  emit();
}, 500);
export const useTimer = () => {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return ps;
};

function Timer() {
  useCols("pomos");
  useTimer();
  const n = D.pomos.filter(p => dkey(new Date(p.at)) === today());
  return html`<${Tabs} items=${[
    ["focus", "Focus"],
    ["short", "Short break"],
    ["long", "Long break"],
  ]} cur=${ps.mode} onChange=${setMode}/>
    <${Panel}><div class="pm"><div class="lcd">${mmss(remain())}</div>
      <${Field} placeholder="What are you working on?" maxlength="60" aria-label="Label" value=${ps.label} onInput=${e => setLabel(e.target.value)}/>
      <${Seg}><${Btn} go wide=${90} icon=${ps.running ? "pause" : "play"} onClick=${() => (ps.running ? pause() : start())}>${ps.running ? "Pause" : "Start"}<//><${Btn} icon="undo" onClick=${() => setMode(ps.mode)}>Reset<//><//>
    </div><//>
    <${StatusBar} keep items=${[plural(n.length, "session") + " today", n.reduce((a, p) => a + (p.mins || 25), 0) + " min"]}/>`;
}
export default {
  id: "pomodoro",
  name: "Timer",
  title: "timer",
  Comp: Timer,
  cmd: v =>
    ["pomo", "timer", "focus"].includes(v)
      ? [
          {
            icon: "pomodoro",
            l: ps.running ? "Pause timer" : "Start timer",
            r: () => {
              openMod("pomodoro", true);
              ps.running ? pause() : start();
            },
          },
        ]
      : [],
};
