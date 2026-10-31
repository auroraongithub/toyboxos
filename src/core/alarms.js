/* Reminders, alarms and event alerts.
   Data: `reminders` {title, at ISO, loud, repeat:""|daily|weekly|weekdays, done}; events may carry `remind` (minutes before).
   Every device schedules from the same synced data:
   - Android: the whole upcoming list is handed to the native shell (AlarmManager), so alarms ring with the app closed.
   - Desktop / web: a 5 s check while the app is open (in-app alarm screen + system notification).
   Anything that came due while a device was away shows up as "missed" instead of ringing late. */
import { useState, useEffect } from "preact/hooks";
import { html, dkey, today, dAt, addDays, hm, timeLabel, dayLabel, money } from "./lib.js";
import { ls } from "./pref.js";
import { D, W, onChange } from "./store.js";
import { toast, warn } from "./bus.js";
import { when as nlpWhen, remindAt } from "./nlp.js";
import { play, soundOf, nativeSound } from "./sounds.js";

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const UNIT = {
  s: 1e3,
  sec: 1e3,
  secs: 1e3,
  m: 6e4,
  min: 6e4,
  mins: 6e4,
  minute: 6e4,
  minutes: 6e4,
  h: 36e5,
  hr: 36e5,
  hrs: 36e5,
  hour: 36e5,
  hours: 36e5,
  d: 864e5,
  day: 864e5,
  days: 864e5,
};
const bridge = () => window.AndroidBridge || null;
export const isAndroid = () => !!bridge();
const pad = n => String(n).padStart(2, "0");

/* "5pm call mom", "1030pm tmrw gym", "in 20m stretch", "every monday 8am standup" -> {at, title, repeat} or null when no time is given */
export function parseRemind(s, now = Date.now()) {
  const p = nlpWhen(s, { now, loose: true }),
    at = remindAt(p, now);
  return at == null ? null : { at, title: p.title, repeat: p.repeat, rel: !!p.rel && !p.date && !p.time };
}

export function nextAt(at, repeat) {
  let k = dkey(new Date(at));
  const t = hm(at);
  for (let i = 0; i < 9; i++) {
    k = addDays(k, repeat === "weekly" ? 7 : 1);
    if (repeat === "weekdays") {
      const d = dAt(k).getUTCDay();
      if (d === 0 || d === 6) continue;
    }
    break;
  }
  return dAt(k, t).getTime();
}

export const when = at => {
  const k = dkey(new Date(at));
  return dayLabel(k) + " " + timeLabel(at);
};

/* what is coming up, from reminders and events with an alert */
export const DEFAULT_AHEAD = [3, 1]; // days before: a reminder far enough away also nudges you 3 days and 1 day ahead
const dayWord = d => (d === 1 ? "Tomorrow" : "In " + d + " days");
/* the days-before nudges of something due at `at` (ms): quiet, and only while they are still about to happen (a snooze or a late edit never replays old ones) */
const leads = (id, at, days, title, body, ref, now) =>
  (days || [])
    .map(d => ({
      id: id + "@" + d,
      at: at - d * 864e5,
      title: dayWord(d) + ": " + title,
      body: body || when(at),
      loud: false,
      ref,
      lead: d,
    }))
    .filter(a => a.at > now - 18e4);
export function alerts() {
  const out = [],
    now = Date.now();
  D.reminders.forEach(r => {
    if (r.done) return;
    const at = Date.parse(r.at);
    if (!isFinite(at)) return;
    out.push({
      id: "r:" + r._id,
      at,
      title: r.title || "Reminder",
      body: "",
      loud: !!r.loud,
      ref: ["reminders", r._id],
      r,
    });
    out.push(...leads("r:" + r._id, at, r.ahead, r.title || "Reminder", "", ["reminders", r._id], now));
  });
  (D.loans || []).forEach(l => {
    if (l.paid || !l.due) return;
    const at = dAt(l.due, "09:00").getTime();
    if (!isFinite(at)) return;
    const what = (l.dir === "owed" ? "Collect " : "Pay ") + (l.name || "loan") + " · " + money(l.amt, l.cur),
      days = Array.isArray(l.ahead) ? l.ahead : DEFAULT_AHEAD;
    out.push(
      { id: "l:" + l._id, at, title: what, body: "Due today", loud: false, ref: ["loans", l._id] },
      ...leads("l:" + l._id, at, days, what, "Due " + when(at), ["loans", l._id], now),
    );
  });
  D.events.forEach(e => {
    if (!e.remind || e.done) return;
    const st = Date.parse(e.start);
    if (!isFinite(st)) return;
    out.push({
      id: "e:" + e._id,
      at: e.allDay ? dAt(dkey(new Date(st)), "09:00").getTime() : st - e.remind * 6e4,
      title: e.title || "Event",
      body: e.allDay ? "Today" : "Starts " + timeLabel(st),
      loud: false,
      ref: ["events", e._id],
    });
  });
  return out.sort((a, b) => a.at - b.at);
}

/* ---- ringing ---- */
const tauri = () => window.__TAURI_INTERNALS__;
export function askPermission() {
  const B = bridge();
  if (B) {
    try {
      B.askNotifications();
    } catch {
      // older Android builds lack this bridge call
    }
    return;
  }
  try {
    if (window.Notification && Notification.permission === "default") Notification.requestPermission();
  } catch {
    // the browser may refuse to ask
  }
}
function sysNotify(title, body) {
  if (tauri() && tauri().invoke) {
    tauri()
      .invoke("plugin:notification|notify", { options: { title, body: body || "toybox.os" } })
      .catch(() => webNotify(title, body));
    return;
  }
  webNotify(title, body);
}
function webNotify(title, body) {
  try {
    if (window.Notification && Notification.permission === "granted") {
      const o = { body: body || "toybox.os", tag: "sos-" + title, renotify: true };
      if (navigator.serviceWorker && navigator.serviceWorker.controller)
        navigator.serviceWorker.ready.then(r => r.showNotification(title, o));
      else new Notification(title, o);
    }
  } catch (e) {
    warn("notification", e);
  }
}
const AL = { cur: null, q: [] };
const alSubs = new Set();
const alEmit = () => alSubs.forEach(f => f());
let stopRing = () => {};
function startRing() {
  stopRing();
  if (isAndroid()) return;
  stopRing = play(soundOf(AL.cur && AL.cur.r), true);
}
export function dismissAlarm() {
  stopRing();
  AL.cur = AL.q.shift() || null;
  if (AL.cur) startRing();
  alEmit();
}
export function snoozeAlarm(min = 10) {
  const a = AL.cur;
  if (a)
    W.add("reminders", {
      title: a.title,
      at: new Date(Date.now() + min * 6e4).toISOString(),
      loud: a.loud,
      repeat: "",
      done: false,
      ...(a.r && a.r.sound ? { sound: a.r.sound } : {}),
    });
  toast("Snoozed " + min + " min");
  dismissAlarm();
}
function ring(a) {
  if (a.loud) {
    if (AL.cur) AL.q.push(a);
    else {
      AL.cur = a;
      startRing();
    }
    alEmit();
  } else {
    toast("🔔 " + a.title);
    if (!isAndroid()) play("beep"); // a quiet reminder: one short beep
  }
  if (!isAndroid()) sysNotify(a.title, a.body);
}
export function AlarmHost() {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    alSubs.add(f);
    return () => alSubs.delete(f);
  }, []);
  const a = AL.cur;
  if (!a) return null;
  return html`<div class="rv alm" role="alertdialog" aria-label="Alarm"><section class="win rvw">
    <div class="tb"><span class="t">alarm</span></div>
    <div class="rvb rvdone"><b class="almt">${a.title}</b><p>${a.body || when(a.at)}</p></div>
    <div class="rvf"><button class="btn" onClick=${() => snoozeAlarm(10)}>Snooze 10 min</button><button class="btn go" autofocus onClick=${dismissAlarm}>Dismiss</button></div>
  </section></div>`;
}

/* ---- the 5 s check (desktop/web, and in-app on Android) ---- */
const fired = ls.get("os-fired", {});
function tick() {
  if (!D.reminders || !D.events) return;
  const now = Date.now(),
    missed = [];
  let dirty = false;
  alerts().forEach(a => {
    if (a.at > now || fired[a.id] === a.at) return;
    fired[a.id] = a.at;
    dirty = true;
    if (a.ref[0] === "reminders" && !a.lead) {
      const r = a.r;
      if (r.repeat) {
        let n = nextAt(a.at, r.repeat);
        while (n <= now) n = nextAt(n, r.repeat);
        W.upd("reminders", r._id, { at: new Date(n).toISOString() });
      } else W.upd("reminders", r._id, { done: true });
    }
    // on Android the native side already rang anything that came due while the app was in the background
    if (isAndroid() && (document.hidden || now - a.at > 15000)) return;
    if (now - a.at > 3 * 60 * 1000) missed.push(a);
    else ring(a);
  });
  if (dirty) {
    const keys = Object.keys(fired);
    if (keys.length > 300) keys.slice(0, 100).forEach(k => delete fired[k]);
    ls.set("os-fired", fired);
  }
  if (missed.length)
    toast(
      "Passed while you were away: " +
        missed
          .slice(0, 3)
          .map(a => a.title)
          .join(", ") +
        (missed.length > 3 ? " +" + (missed.length - 3) : ""),
    );
}

/* ---- hand the upcoming list to Android ---- */
let st = 0;
export function syncNative() {
  clearTimeout(st);
  st = setTimeout(() => {
    const B = bridge();
    if (!B) return;
    const now = Date.now(),
      list = [];
    alerts().forEach(a => {
      if (a.ref[0] === "reminders" && a.r.repeat) {
        let at = a.at,
          n = 0;
        while (at < now && n++ < 400) at = nextAt(at, a.r.repeat);
        for (let i = 0; i < 10 && at < now + 21 * 864e5; i++) {
          list.push({ id: a.id + "#" + at, at, title: a.title, body: a.body, loud: a.loud, sound: soundOf(a.r) });
          at = nextAt(at, a.r.repeat);
        }
      } else if (a.at > now && a.at < now + 60 * 864e5)
        list.push({ id: a.id, at: a.at, title: a.title, body: a.body, loud: a.loud, sound: soundOf(a.r) });
    });
    list.sort((x, y) => x.at - y.at);
    new Set(list.map(x => x.sound)).forEach(k => nativeSound(B, k)); // your own sounds: copied to the phone once
    try {
      B.alarmSync(JSON.stringify(list.slice(0, 64)));
    } catch (e) {
      warn("android alarms", e);
    }
  }, 500);
}

/* days before that still make sense for a reminder at `at`: it has to be comfortably further away than the nudge itself */
export const aheadFor = (at, days = DEFAULT_AHEAD, now = Date.now()) =>
  days.filter(d => at - now > (d + 0.5) * 864e5);
export function addReminder({ title, at, loud = false, repeat = "", ahead }) {
  askPermission();
  const a = ahead || (repeat ? [] : aheadFor(at));
  return W.add("reminders", {
    title: title || "Reminder",
    at: new Date(at).toISOString(),
    loud,
    repeat,
    done: false,
    ...(a.length ? { ahead: a } : {}),
  });
}
/* "3,1" -> [3,1]; "none" -> [] */
export const parseAhead = s =>
  [...new Set((String(s).match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= 60))].sort(
    (a, b) => b - a,
  );

export function initAlarms() {
  setInterval(tick, 5000);
  setTimeout(tick, 1500);
  onChange(c => {
    if (c === "reminders" || c === "events" || c === "loans" || c === "config" || c === "*") syncNative();
  });
  setTimeout(syncNative, 2000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      tick();
      syncNative();
    }
  });
}
