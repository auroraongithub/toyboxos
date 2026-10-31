/* The one data store. Components read with useCols(...), write with W.*  */
import { useState, useEffect } from "preact/hooks";
import { toast } from "./bus.js";
import { localAdapter } from "./adapters.js";
import { startSync } from "./sync.js";
import { dkey, addDays, curSym } from "./lib.js";
import { home, second } from "./profile.js";

export const COLS = [
  "jobs",
  "notes",
  "config",
  "projects",
  "tasks",
  "pomos",
  "tx",
  "subs",
  "wishes",
  "events",
  "classes",
  "ticks",
  "links",
  "habits",
  "pages",
  "rels",
  "cards",
  "jots",
  "reminders",
  "boards",
  "ink",
  "chats",
  "amsg",
  "sources",
  "graphs",
  "budgets",
  "timetable",
  "loans",
  "packs",
];
export const D = Object.fromEntries(COLS.map(c => [c, []]));
export const meta = { loaded: false, ro: true, adapter: "none" };
let adapter = null;
const subs = new Set();
const emit = c => subs.forEach(f => f(c));

export async function boot() {
  adapter = localAdapter();
  await adapter.init();
  meta.ro = !adapter.canWrite;
  meta.adapter = adapter.name;
  COLS.forEach(c =>
    adapter.watch(c, rows => {
      D[c] = rows;
      meta.loaded = true;
      emit(c);
    }),
  );
  meta.loaded = true;
  emit("*");
  if (adapter.name === "local") startSync(adapter);
  return adapter;
}
export const getAdapter = () => adapter;
/* listen to store changes outside components (c = collection name, or "*" after boot) */
export const onChange = f => {
  subs.add(f);
  return () => subs.delete(f);
};

/** re-render when any of these collections change */
export function useCols(...cols) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = c => {
      if (c === "*" || cols.includes(c)) tick(n => n + 1);
    };
    subs.add(f);
    tick(n => n + 1);
    return () => subs.delete(f);
  }, [cols.join()]);
  return D;
}

const guard = async f => {
  if (!adapter || meta.ro) {
    toast("Read-only right now");
    return false;
  }
  try {
    await f();
    return true;
  } catch (e) {
    if (e && e.code === "invalid_argument") meta.ro = true;
    toast("Couldn't save");
    return false;
  }
};
export const W = {
  add: (c, o) => guard(() => adapter.add(c, Object.assign({ at: new Date().toISOString() }, o))),
  upd: (c, id, o) => guard(() => adapter.update(c, id, o)),
  set: (c, id, o) => guard(() => adapter.set(c, id, o)),
  del: (c, id) => guard(() => adapter.del(c, id)),
  /* many writes, one save: ops = [["set",col,id,obj] | ["del",col,id]] */
  batch: ops =>
    guard(async () => {
      if (adapter.batch) return adapter.batch(ops);
      for (const [op, c, id, o] of ops) await (op === "del" ? adapter.del(c, id) : adapter.set(c, id, o));
    }),
};
/* delete with an Undo toast (swipe-to-delete makes deletes quick, so every row gets one) */
export const drop = (c, id, msg = "Deleted") => {
  const d = D[c].find(x => x._id === id);
  W.del(c, id);
  if (d) {
    const o = { ...d };
    delete o._id;
    toast(msg, { label: "Undo", run: () => W.set(c, id, o) });
  }
};

/* derived helpers shared by modules */
export const tickSet = () => new Set(D.ticks.filter(t => t.done).map(t => t._id));
export function calItems() {
  const ts = tickSet();
  const out = [];
  D.classes.forEach(c => {
    const t = Date.parse(c.start);
    if (!isFinite(t)) return;
    out.push({
      id: c._id,
      src: "moodle",
      title: c.title,
      t,
      e: t,
      code: c.code || "",
      kind: c.kind || "",
      done: ts.has(c._id),
    });
  });
  // events may span days: e = end instant (optional `end` ISO; old single-day events have none, so e = t)
  D.events.forEach(e => {
    const t = Date.parse(e.start);
    if (!isFinite(t)) return;
    const en = Math.max(t, Date.parse(e.end) || t);
    out.push({
      id: e._id,
      src: "own",
      title: e.title,
      t,
      e: en,
      multi: dkey(new Date(en)) > dkey(new Date(t)),
      code: e.tag || "",
      kind: "",
      allDay: !!e.allDay,
      done: !!e.done,
      remind: e.remind || 0,
    });
  });
  return out.sort((a, b) => a.t - b.t);
}
/* Manila day keys an item covers (one for most, every day of a spanning event, capped at a year) */
export function itemDays(x) {
  const a = dkey(new Date(x.t)),
    b = dkey(new Date(x.e || x.t)),
    o = [a];
  for (let k = a; k < b && o.length < 366; ) o.push((k = addDays(k, 1)));
  return o;
}
/* exchange rates (config/fx): rates = units per USD (server/pull_fx.py), usdphp kept for older data. Money totals are in the
   profile's home currency; anything else converts through these. */
const rates = () => {
  const c = D.config.find(x => x._id === "fx") || {},
    r = { ...(c.rates || {}) };
  if (c.usdphp) r.PHP = c.usdphp;
  r.USD = 1;
  return { r, at: c.at || null };
};
export const fx = () => {
  const c = D.config.find(x => x._id === "fx"),
    r = c && (c.usdphp || (c.rates && c.rates.PHP));
  return r ? { r, at: c.at, est: false } : { r: 58, at: null, est: true };
};
/* how many of `to` one `from` is; est = no real rate yet */
export const rate = (from, to = home()) => {
  if (!from || from === to) return { v: 1, est: false };
  const { r } = rates();
  if (r[from] && r[to] && D.config.some(x => x._id === "fx")) return { v: r[to] / r[from], est: false };
  return { v: from === "USD" && to === "PHP" ? 58 : from === "PHP" && to === "USD" ? 1 / 58 : 1, est: true };
};
export const toHome = (a, c) => a * rate(c).v;
export const toPHP = toHome; // older name: totals are in the home currency now
export const fxNote = () => {
  const h = home(),
    o = second() || (h === "USD" ? null : "USD");
  if (!o) return "";
  const f = rate(o, h);
  return curSym(o) + "1 = " + curSym(h) + f.v.toFixed(2) + (f.est ? " (est.)" : "");
};
