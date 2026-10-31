/* toast + tiny event bus. toast(msg) or toast(msg,{label:"Undo",run}) for a snackbar with an action */
import { useState, useEffect } from "preact/hooks";
const subs = new Set();
let cur = null,
  t = 0;
const set = v => {
  cur = v;
  subs.forEach(f => f(v));
};
/* for failures that shouldn't interrupt you but should leave a trace in the console */
export const warn = (where, e) => console.warn("[" + where + "]", e);
export const toast = (m, act) => {
  set(m ? { m, act, k: Date.now() } : null);
  clearTimeout(t);
  t = setTimeout(() => set(null), act ? 5000 : 2200);
};
/* text to start the command bar with (right-click > Search for …); the bar takes it once */
export const cmdSeed = { q: "" };
export const openCmd = (q = "") => {
  cmdSeed.q = q;
  dispatchEvent(new Event("os-cmd"));
};
export const hideToast = () => {
  clearTimeout(t);
  set(null);
};
export const useToast = () => {
  const [m, s] = useState(cur);
  useEffect(() => {
    subs.add(s);
    return () => subs.delete(s);
  }, []);
  return m;
};
