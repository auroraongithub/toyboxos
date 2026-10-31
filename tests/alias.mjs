// node --import ./tests/alias.mjs: the module aliases build.mjs gives esbuild, plus the few browser globals app modules
// touch while loading, so tests can import app code that reaches the pack, prefs and sync
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
const mem = new Map(),
  noop = () => {},
  el = () => ({
    style: { setProperty: noop },
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop,
    setAttribute: noop,
    toggleAttribute: noop,
    removeAttribute: noop,
    addEventListener: noop,
  });
globalThis.window = globalThis;
globalThis.localStorage ??= {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
};
for (const k of ["addEventListener", "removeEventListener"]) globalThis[k] ??= noop;
globalThis.dispatchEvent ??= () => true;
globalThis.matchMedia ??= () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
globalThis.document ??= {
  documentElement: el(),
  body: el(),
  head: el(),
  createElement: el,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  hidden: false,
};
globalThis.location ??= {
  protocol: "http:",
  origin: "http://localhost",
  hash: "",
  pathname: "/",
  search: "",
  href: "http://localhost/",
};
globalThis.innerWidth ??= 1280;
globalThis.innerHeight ??= 820;
