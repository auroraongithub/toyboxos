import { h } from "preact";
import htm from "htm";
export const html = htm.bind(h);
export { h };

/* the user's timezone: cached in localStorage as os-tz by core/profile.js (profile > pack > this device); node tests pin Manila */
const tzOk = z => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch (e) {
    return false;
  }
};
const tzSaved = () => {
  try {
    return JSON.parse(localStorage.getItem("os-tz") || "null");
  } catch (e) {
    return null;
  }
};
export const TZ =
  typeof window === "undefined"
    ? "Asia/Manila"
    : [tzSaved(), Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC"].find(z => z && tzOk(z));
/* currency symbols; codes without one here use Intl's narrow symbol */
export const CUR = { PHP: "₱", USD: "$" };
export const curSym = c => {
  if (CUR[c]) return CUR[c];
  try {
    return (CUR[c] = new Intl.NumberFormat("en", {
      style: "currency",
      currency: c,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find(p => p.type === "currency").value);
  } catch (e) {
    return c ? c + " " : "";
  }
};
export const pad2 = n => String(n).padStart(2, "0");
export const fmt = (d, o) => new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, o)).format(d);
export const dkey = d => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
export const today = () => dkey(new Date());
/* UTC offset of TZ on a day ("+08:00"), so a day key + local time maps to the right instant */
const OFF = {};
export const tzOff = key =>
  OFF[key] ||
  (OFF[key] = (() => {
    const v = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
      .formatToParts(new Date(key + "T12:00:00Z"))
      .find(p => p.type === "timeZoneName").value;
    return v === "GMT" ? "+00:00" : v.slice(3);
  })());
export const dAt = (key, time) => new Date(key + "T" + (time || "12:00") + ":00" + tzOff(key));
export const addDays = (key, n) => {
  const d = dAt(key);
  d.setUTCDate(d.getUTCDate() + n);
  return dkey(d);
};
export const addMonths = (key, n) => {
  const [y, m, dd] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(dd, last));
  return t.toISOString().slice(0, 10);
};
export const dayLabel = key => {
  const t = today();
  if (key === t) return "Today";
  if (key === addDays(t, 1)) return "Tomorrow";
  return fmt(dAt(key), { weekday: "short", month: "short", day: "numeric" });
};
export const rangeLabel = (a, b) =>
  !b || b === a
    ? dayLabel(a)
    : a.slice(0, 7) === b.slice(0, 7) && a !== today()
      ? fmt(dAt(a), { weekday: "short", month: "short", day: "numeric" }) +
        " – " +
        fmt(dAt(b), { weekday: "short", day: "numeric" })
      : dayLabel(a) + " – " + dayLabel(b);
export const timeLabel = ms => fmt(new Date(ms), { hour: "numeric", minute: "2-digit" });
export const hm = ms => fmt(new Date(ms), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/* whole amounts stay whole (₱250); anything with centavos/cents shows both digits (₱378.60, not ₱378.6) */
export const money = (n, c) => {
  const v = Number(n || 0),
    f = Math.abs(v - Math.round(v)) >= 0.005 ? 2 : 0;
  return curSym(c) + v.toLocaleString("en-US", { minimumFractionDigits: f, maximumFractionDigits: f });
};
export const ago = key => {
  const n = Math.round((dAt(key) - dAt(today())) / 864e5);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? -n + "d ago" : "in " + n + "d";
};
export const mmss = s => pad2(Math.floor(s / 60)) + ":" + pad2(s % 60);
export const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
/* open a web link in the system browser: the native shell's open_url command when it has one, else a target=_blank click
   (window.open from a webview popup is dropped by some shells) */
export const openExternal = u => {
  if (!/^(https?|mailto):/i.test(u || "")) return;
  const T = typeof window !== "undefined" && window.__TAURI_INTERNALS__;
  const click = () => {
    const a = document.createElement("a");
    a.href = u;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  if (T && T.invoke) T.invoke("open_url", { url: u }).catch(click);
  else click();
};
