/* windows torn out of the desk into their own OS window (a second monitor: Notes on one, Draw on the other).
   The page is the same app opened at index.html#win=<id>; it shows only that window, shares this device's
   localStorage (data + prefs follow live through storage events) and leaves syncing/alarms to the main window.
   os-torn = ids living in their own window right now; closing one docks it back onto the desk. */
import { ls } from "../core/pref.js";
import { toast, warn } from "../core/bus.js";

export const TORN = (/[#&]win=([\w-]+)/.exec(location.hash || "") || [])[1] || "";
const T = () => window.__TAURI_INTERNALS__;
const native = () => !!(T() && T().invoke) && !/Android/i.test(navigator.userAgent);
const label = id => "win-" + id.replace(/[^\w-]/g, "");
const opened = {};
/* the torn window's own title bar caps (app-drawn, like the desk's); a browser popup can only close */
export const tornNative = () => native();
export const tornCmd = cmd => {
  if (!native()) return cmd === "close" && window.close();
  T()
    .invoke("plugin:window|" + cmd, { label: T().metadata.currentWindow.label })
    .catch(() => cmd === "close" && window.close());
};
const tornList = () => ls.get("os-torn", []);
export const isTorn = id => tornList().includes(id);
const forget = id =>
  ls.set(
    "os-torn",
    tornList().filter(x => x !== id),
  );

/* b = where it goes in screen px {x,y,w,h} (defaults to beside the current window) */
export async function tearOff(id, title, b) {
  const w = Math.round(b && b.w ? b.w : 900),
    h = Math.round(b && b.h ? b.h : 680),
    x = Math.round(b && b.x != null ? b.x : (screenX || 0) + 60),
    y = Math.round(b && b.y != null ? b.y : (screenY || 0) + 60),
    url = "index.html#win=" + encodeURIComponent(id);
  let ok = false;
  if (native())
    ok = await T()
      .invoke("plugin:webview|create_webview_window", {
        options: {
          label: label(id),
          url,
          title: title + " · toybox.os",
          x,
          y,
          width: w,
          height: h,
          minWidth: 320,
          minHeight: 240,
          focus: true,
          decorations: false,
          shadow: true,
        },
      })
      .then(() => true)
      .catch(e => {
        warn("tear", e);
        return false;
      });
  /* the desktop app's webview opens nothing for window.open, so an installer without the window permission just says so */ else
    ok = !!(opened[id] = window.open(url, label(id), `popup,width=${w},height=${h},left=${x},top=${y}`));
  if (!ok)
    toast(
      native()
        ? "Popping windows out needs the newest installer"
        : "Allow pop-ups for this site to pop windows out",
    );
  if (ok) ls.set("os-torn", [...new Set([...tornList(), id])]);
  return ok;
}
/* openMod on a torn id brings its own window forward instead of opening a second copy */
export function focusTorn(id) {
  if (!isTorn(id)) return Promise.resolve(false);
  if (native())
    return T()
      .invoke("plugin:window|set_focus", { label: label(id) })
      .then(() => true)
      .catch(() => {
        forget(id);
        return false;
      });
  const w = opened[id];
  if (w && !w.closed) {
    w.focus();
    return Promise.resolve(true);
  }
  /* opened before a reload: the same name finds that window again (and reloads it) */
  return Promise.resolve(!!window.open("index.html#win=" + encodeURIComponent(id), label(id)));
}
/* in the torn window: say we're here, and dock back onto the desk when closed */
export function tornLife() {
  ls.set("os-torn", [...new Set([...tornList(), TORN])]);
  addEventListener("pagehide", () => {
    forget(TORN);
    ls.set("os-open", [...new Set([...ls.get("os-open", []), TORN])]);
    ls.set(
      "os-min",
      ls.get("os-min", []).filter(x => x !== TORN),
    );
  });
}
/* on the desk: a torn window that closed comes back on top */
export function dockWatch() {
  const f = e => {
    if (e.key !== "os-torn") return;
    let was = [];
    try {
      was = JSON.parse(e.oldValue || "[]");
    } catch (er) {}
    const now = tornList();
    was
      .filter(x => !now.includes(x))
      .forEach(id => setTimeout(() => dispatchEvent(new CustomEvent("os-front", { detail: id })), 60));
  };
  addEventListener("storage", f);
  return () => removeEventListener("storage", f);
}
