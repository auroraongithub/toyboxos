/* Phones: the Android back button (the webview goes back in history) and browser back walk back through
   what you opened: a sheet / menu / review closes, a page or Habits goes back, another tab returns to
   Today, and only then does the app exit. Each opening pushes a history entry with what undoes it;
   closing something from the UI drops its entry so the two never drift apart. */
import { isMobile } from "./pref.js";

const stack = [];
let skip = 0,
  pend = 0,
  backAt = 0;
const push = () => {
  try {
    history.pushState({ sos: stack.length }, "");
  } catch {
    // history is unavailable in some webviews
  }
};

export function pushBack(key, fn) {
  if (!isMobile()) return;
  stack.push({ key, fn });
  if (skip > 0) pend++;
  else push();
}
/* the thing closed itself: forget its entry (all = every entry with that key, e.g. tab -> Today) */
export function dropBack(key, all) {
  let n = 0;
  if (all) {
    while (stack.length && stack.some(s => s.key === key)) {
      stack.pop();
      n++;
    }
  } else {
    const i = stack.map(s => s.key).lastIndexOf(key);
    if (i < 0) return;
    n = stack.length - i;
    stack.splice(i);
  }
  if (!n) return;
  skip++;
  history.go(-n);
}
/* a UI back button: same as the system back when its entry is on top */
export function goBack(key, fallback) {
  const t = stack[stack.length - 1];
  if (t && t.key === key) history.back();
  else fallback && fallback();
}
/* true right after a back press, so the state change it caused doesn't push a new entry */
export const fromBack = () => Date.now() - backAt < 400;
export const topBack = () => (stack.length ? stack[stack.length - 1].key : "");

addEventListener("popstate", () => {
  if (skip > 0) {
    skip--;
    while (pend > 0) {
      pend--;
      push();
    }
    return;
  }
  const s = stack.pop();
  if (!s) return;
  backAt = Date.now();
  s.fn();
});
