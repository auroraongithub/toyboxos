/* window manager state. Components read via usePref, actions live here. */
import { ls } from "../core/pref.js";
import { isMobile } from "../core/pref.js";
export const reg = { ids: [], alias: {}, names: {} };
/* windows = hubs (+ sync); a hub's part ids (calendar, board, graph...) open the hub on that part */
export const setModules = l => {
  reg.ids = l.map(m => m.id);
  reg.mods = Object.fromEntries(l.map(m => [m.id, m]));
  l.forEach(m => {
    reg.names[m.id] = m.name;
    (m.parts || []).forEach(p => {
      reg.alias[p[0]] = m.id;
      reg.names[p[0]] = p[1];
    });
  });
};
export const hubOf = id => reg.alias[id] || id;
/* optional modules that are off (core/features.js sets this) can't be opened */
let gate = () => true;
export const setGate = f => {
  gate = f;
};
export const DEFAULT_OPEN = ["today", "jobs"];
const openList = () =>
  [...new Set(ls.get("os-open", DEFAULT_OPEN).map(hubOf))].filter(id => reg.ids.includes(id));
const minList = () => ls.get("os-min", []);

export function openMod(id, focus) {
  const h = hubOf(id);
  if (h !== id) {
    ls.set("os-sub-" + h, id);
    id = h;
  }
  if (!reg.ids.includes(id) || !gate(reg.mods[id])) return;
  ls.set("os-open", [...new Set([...openList(), id])]);
  ls.set(
    "os-min",
    minList().filter(x => x !== id),
  );
  if (isMobile()) setView(id);
  else setTimeout(() => dispatchEvent(new CustomEvent("os-front", { detail: id })), 30);
}
export const closeMod = id =>
  ls.set(
    "os-open",
    openList().filter(x => x !== id),
  );
export const toggleMin = id => {
  const m = minList();
  ls.set("os-min", m.includes(id) ? m.filter(x => x !== id) : [...m, id]);
};
export const setView = id => ls.set("os-view", id); /* scroll is restored per tab (ui/gestures.js) */
/* back to the default layout: default windows only, nothing minimised, positions cleared */
export function resetWindows() {
  ls.set("os-open", DEFAULT_OPEN);
  ls.set("os-min", []);
  ls.set("os-pos", {});
  setTimeout(() => dispatchEvent(new Event("os-layout")), 30);
}
