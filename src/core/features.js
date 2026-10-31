/* Optional modules: the parts of the OS that only make sense for some people or some servers (the assistant, a job feed, a school
   Moodle, the home-server console, Hermes, app editing). Off unless the pack (pack.modules) or config/modules (synced,
   Profile > Modules) turns them on. The server-tied ones also need the sync server to list them in GET /api/caps. */
import { useState, useEffect } from "preact/hooks";
import { D, W, useCols } from "./store.js";
import { pack } from "./pack.js";
import { ls } from "./pref.js";
import { syncConfig } from "./sync.js";
import { setGate } from "../shell/os.js";

/* needs = a cap the sync server must report; under = only with that module on */
export const FEATURES = [
  { id: "ai", name: "Assistant", icon: "buddy", about: "AI chat" },
  { id: "jobs", name: "Jobs", icon: "jobs", about: "Job tracker" },
  { id: "moodle", name: "Moodle", icon: "moodle", about: "School courses and deadlines", needs: "moodle" },
  { id: "nijika", name: "Home server", icon: "nijika", about: "Server terminal and files", needs: "admin" },
  { id: "hermes", name: "Hermes", icon: "buddy", about: "Hermes agent", needs: "hermes", under: "nijika" },
  {
    id: "changes",
    name: "App editing",
    icon: "edit",
    about: "Let the assistant edit the app",
    needs: "changes",
  },
];
const BY = Object.fromEntries(FEATURES.map(f => [f.id, f]));

/* ---- what the sync server can do (pref os-caps {url, caps|null}; null = an older server that doesn't say) ---- */
const subs = new Set();
const emit = () => subs.forEach(f => f());
const base = () => {
  const c = syncConfig();
  return c.on && c.url && c.token ? c.url.replace(/\/+$/, "") : "";
};
export async function refreshCaps() {
  const b = base();
  if (!b) return;
  try {
    const r = await fetch(b + "/api/caps", {
      headers: { Authorization: "Bearer " + syncConfig().token },
      cache: "no-store",
    });
    if (r.status === 404) {
      ls.set("os-caps", { url: b, caps: null });
      emit();
      return;
    }
    if (!r.ok) return;
    const j = await r.json();
    ls.set("os-caps", { url: b, caps: Array.isArray(j.caps) ? j.caps : [] });
    emit();
  } catch {
    // offline: keep what we knew
  }
}
/* no sync server = nothing server-tied; a server we haven't heard from yet (or an old one) gets the benefit of the doubt */
export const hasCap = k => {
  const b = base();
  if (!b) return false;
  const c = ls.get("os-caps", null);
  return !c || c.url !== b || !c.caps ? true : c.caps.includes(k);
};

/* ---- on/off ---- */
const saved = () => (D.config || []).find(x => x._id === "modules") || {};
export const wanted = id => {
  const s = saved();
  return typeof s[id] === "boolean" ? s[id] : !!(pack.modules && pack.modules[id]);
};
export const on = id => {
  const f = BY[id];
  if (!f) return true;
  return wanted(id) && (!f.needs || hasCap(f.needs)) && (!f.under || on(f.under));
};
/* a module/window object: m.opt names the feature it belongs to */
export const modOn = m => !m || !m.opt || on(m.opt);
setGate(modOn);
export const setWanted = (id, v) => {
  const s = saved(),
    o = {};
  for (const f of FEATURES) if (typeof s[f.id] === "boolean") o[f.id] = s[f.id];
  return W.set("config", "modules", { ...o, [id]: !!v, upd: new Date().toISOString() });
};
/* listed in Profile > Modules: no server needed, or the server has it set up, or it's on already (so it can be turned off) */
export const listed = f => !f.needs || (base() && hasCap(f.needs)) || wanted(f.id);
/* why a wanted module still isn't showing */
export const blocked = id => {
  const f = BY[id];
  if (!f) return "";
  if (f.under && !on(f.under)) return "Needs " + BY[f.under].name + " on.";
  if (f.needs && !base()) return "Needs a sync server.";
  if (f.needs && !hasCap(f.needs)) return "Your sync server doesn't have this set up.";
  return "";
};
/* re-render on module or caps changes */
export const useMods = () => {
  useCols("config");
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
};
/* asked at start, when sync is switched on or off, and at most every 30 min when the app comes back */
let last = 0;
const maybe = () => {
  if (Date.now() - last > 30 * 60e3) {
    last = Date.now();
    refreshCaps();
  }
};
addEventListener("os-sync-cfg", () => {
  last = Date.now();
  emit();
  refreshCaps();
});
addEventListener("focus", maybe);
setTimeout(maybe, 1500);
