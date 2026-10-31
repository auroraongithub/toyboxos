/* Live updates for the native apps (Windows / Android): fetch the newest app.js + app.css from your server, keep them in the
   Cache API, and the loader in index.html uses them on the next start. No reinstall for web-side changes.
   Safety: if a downloaded bundle fails to start, the loader throws it away and boots the version built into the app.
   Native changes (new Kotlin/Rust code) still need a new installer/APK: version.json's `api` says when that is.
   The update light (shell/updlight.js) follows one state: the home server building a pushed commit (GET /api/deploy,
   written by server/autodeploy.sh), this app downloading it (with progress), then ready to restart. */
import { useState, useEffect } from "preact/hooks";
import { ls } from "./pref.js";
import { toast } from "./bus.js";
import { native, syncConfig, HOME_SERVER } from "./sync.js";

export const BUILD = typeof __BUILD__ === "string" ? __BUILD__ : "dev";
const SHELL_API = 1;
const base = () => (syncConfig().url || HOME_SERVER).replace(/\/+$/, "");
/* where this copy's own files come from: the server for the native apps, the page's origin for the web/PWA build */
const files = () => (native ? base() : location.origin);
export const liveOk = () => {
  document.documentElement.dataset.build = BUILD;
  try {
    localStorage.setItem("os-live-ok", BUILD);
  } catch {
    // storage blocked: the update guard just doesn't persist
  }
}; // called once the app has started

/* phase: idle | building (server) | downloading | ready | native (needs a new installer/APK) | failed (server build) */
/* src: where the new build came from (version.json, written by build.mjs or server/app_changes.py): "upstream" = a new
   toybox.os version (commit + subject; kept = this server's own changes riding on top), "local" = a change made with
   Osage on this server (req = what was asked for), "" = an older server that doesn't say */
const U = { phase: "idle", pct: 0, commit: "", subject: "", started: "", src: "", req: "", kept: 0 };
export const UPSTREAM = "toybox.os";
export const fromLabel = u =>
  u.src === "local" ? "Your change" : u.src === "upstream" ? "Update from " + UPSTREAM : "Update";
export const readyLabel = u =>
  u.src === "local" ? "Your change is ready" : u.src === "upstream" ? "New " + UPSTREAM + " version" : "Update ready";
const subs = new Set();
const set = o => {
  Object.assign(U, o);
  subs.forEach(f => f());
};
export const updateState = () => U;
export const useUpdate = () => {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return U;
};
/* the web/PWA build serves from its service worker's cache: let the new worker take over first, then reload */
export const restartNow = () => {
  const sw = !native && navigator.serviceWorker;
  if (!sw || !sw.controller) return location.reload();
  let done = false;
  const go = () => {
    if (!done) (done = true), location.reload();
  };
  sw.addEventListener("controllerchange", go);
  sw.getRegistration()
    .then(r => r && r.update())
    .catch(() => {});
  setTimeout(go, 4000);
};

/* read a response body while counting bytes; total = every file's expected size */
async function readAll(r, done, total) {
  if (!r.body || !r.body.getReader) return { blob: await r.blob(), n: 0 };
  const rd = r.body.getReader(),
    parts = [];
  let n = 0;
  for (;;) {
    const { value, done: end } = await rd.read();
    if (end) break;
    parts.push(value);
    n += value.length;
    if (total) set({ pct: Math.min(99, Math.round(((done + n) / total) * 100)) });
  }
  return { blob: new Blob(parts), n };
}

export async function checkUpdate({ quiet = true } = {}) {
  if (!files() || window.__OSAGE_PREVIEW__) return "no server";
  try {
    const r = await fetch(files() + "/version.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const m = await r.json();
    if (m.build === BUILD) {
      if (U.phase !== "building") set({ phase: "idle", pct: 0 });
      return quiet ? "current" : (toast("You have the newest version"), "current");
    }
    const from = {
      src: m.src || "",
      commit: m.commit || "",
      subject: m.subject || "",
      req: m.req || "",
      kept: m.kept || 0,
    };
    /* the web/PWA build just needs a reload to pick up the new files */
    if (!native || !window.caches) {
      set({ phase: "ready", pct: 100, ...from });
      if (!quiet) toast(readyLabel(from), { label: "Reload", run: restartNow });
      return "ready";
    }
    /* already downloaded but this window still runs the old one: say so instead of "newest" */
    if (m.build === ls.get("os-live-pending", "")) {
      set({ phase: "ready", pct: 100, ...from });
      if (!quiet) toast(readyLabel(from), { label: "Restart", run: restartNow });
      return "ready";
    }
    if ((m.api || 1) > SHELL_API) {
      set({ phase: "native", pct: 0, ...from });
      if (!quiet) toast("Newer version needs a new installer/APK");
      return "needs-native";
    }
    set({ phase: "downloading", pct: 0, ...from });
    const [js, css] = await Promise.all([
      fetch(base() + "/app.js", { cache: "no-store" }),
      fetch(base() + "/app.css", { cache: "no-store" }),
    ]);
    if (!js.ok || !css.ok) throw new Error("download failed");
    const total = (+js.headers.get("content-length") || 0) + (+css.headers.get("content-length") || 0);
    const a = await readAll(js, 0, total),
      b = await readAll(css, a.n, total);
    const jt = a.blob,
      ct = await b.blob.text();
    if (jt.size < 100000) throw new Error("bundle looks wrong");
    const c = await caches.open("sos-live");
    await c.put("live-app.js", new Response(jt, { headers: { "Content-Type": "text/javascript" } }));
    await c.put("live-app.css", new Response(ct, { headers: { "Content-Type": "text/css" } }));
    await c.put(
      "live.json",
      new Response(JSON.stringify(m), { headers: { "Content-Type": "application/json" } }),
    );
    ls.set("os-live-pending", m.build);
    set({ phase: "ready", pct: 100 });
    toast(readyLabel(from), { label: "Restart", run: restartNow });
    return "ready";
  } catch (e) {
    if (U.phase === "downloading") set({ phase: "idle", pct: 0 });
    if (!quiet) toast("Couldn't check for updates (offline?)");
    return "error";
  }
}

/* the home server's own deploy run: building -> activating -> deployed (or failed). Needs the sync token. */
async function pollServer() {
  const cfg = syncConfig();
  if (!cfg.token || !base()) return null;
  try {
    const r = await fetch(base() + "/api/deploy", {
      cache: "no-store",
      headers: { Authorization: "Bearer " + cfg.token },
    });
    if (!r.ok) return null;
    const d = await r.json(),
      info = { commit: d.commit || "", subject: d.subject || "", started: d.started || "", src: "upstream", req: "", kept: 0 };
    const fresh = d.at && Date.now() - Date.parse(d.at) < 30 * 60 * 1000;
    if ((d.state === "building" || d.state === "activating") && fresh) {
      if (U.phase !== "ready" && U.phase !== "downloading") set({ phase: "building", pct: 0, ...info });
    } else if (d.state === "failed" && fresh && ls.get("os-deploy-seen", "") !== d.commit) {
      if (U.phase !== "ready" && U.phase !== "downloading") set({ phase: "failed", pct: 0, ...info });
    } else if (d.state === "deployed") {
      if (U.phase === "building" || U.phase === "failed") set({ phase: "idle", ...info });
      return "deployed";
    }
    return d.state;
  } catch {
    return null;
  }
}
/* a failed build stays on the light until it's been looked at once */
export const seenFailure = () => {
  ls.set("os-deploy-seen", U.commit);
  set({ phase: "idle" });
};

export function initUpdates() {
  let last = 0,
    timer = 0,
    was = "";
  const go = (force = false) => {
    if (!force && Date.now() - last < 10 * 60 * 1000) return;
    last = Date.now();
    checkUpdate();
  };
  /* watch the server: every 10 s while it's building, every minute otherwise, never while hidden */
  const tick = async () => {
    clearTimeout(timer);
    if (!document.hidden) {
      const s = await pollServer();
      if (s === "deployed" && (was === "building" || was === "activating")) go(true);
      was = s || was;
    }
    timer = setTimeout(tick, U.phase === "building" ? 10000 : 60000);
  };
  setTimeout(go, 6000);
  setTimeout(tick, 3000);
  setInterval(go, 30 * 60 * 1000);
  /* a downloaded update applies itself while the app is out of sight (closing to the tray never restarts the app) */
  document.addEventListener("visibilitychange", () => {
    const p = ls.get("os-live-pending", "");
    if (document.hidden) {
      if (native && p && p !== BUILD && ls.get("os-live-applied", "") !== p) {
        ls.set("os-live-applied", p);
        location.reload();
      }
      return;
    }
    go();
    tick();
  });
}
