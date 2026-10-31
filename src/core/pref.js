/* tiny persisted-preferences store (localStorage, in-memory fallback) */
import { warn } from "./bus.js";
import { useState, useEffect } from "preact/hooks";
const mem = {};
const subs = new Set();
export const ls = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) return JSON.parse(v);
    } catch {
      // blocked storage or an old value: use the default
    }
    return k in mem ? mem[k] : d;
  },
  set(k, v) {
    mem[k] = v;
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      warn("storage", e);
    }
    subs.forEach(f => f(k));
  },
};
export function usePref(k, d) {
  const [v, set] = useState(() => ls.get(k, d));
  useEffect(() => {
    const f = key => {
      if (key === k) set(ls.get(k, d));
    };
    subs.add(f);
    return () => subs.delete(f);
  }, [k]);
  return [v, x => ls.set(k, typeof x === "function" ? x(ls.get(k, d)) : x)];
}
export function useMedia(q) {
  const [m, set] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => set(mq.matches);
    mq.addEventListener("change", f);
    f();
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return m;
}
export const isMobile = () => matchMedia("(max-width:860px)").matches;
