/* Client for the home server admin service (server/admin.py): tailnet only, its own token, kept in pref os-admin like the sync token. */
import { useState, useEffect } from "preact/hooks";
import { ls } from "./pref.js";
import { HOME_SERVER } from "./sync.js";
import { pack } from "./pack.js";

export const ADMIN_URL = (pack.servers && pack.servers.admin) || "";
export const adminCfg = () => ls.get("os-admin", { url: ADMIN_URL, token: "" });
const subs = new Set();
export const useAdmin = () => {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return adminCfg();
};
export const setAdmin = c => {
  ls.set("os-admin", c);
  subs.forEach(f => f());
};
const base = () => adminCfg().url.replace(/\/+$/, "");

/* JSON call; throws Error(message) with .status */
export async function api(path, body, o = {}) {
  const c = adminCfg();
  let r;
  try {
    r = await fetch(base() + path, {
      method: o.method || (body === undefined ? "GET" : "POST"),
      headers: {
        Authorization: "Bearer " + c.token,
        ...(o.raw ? {} : { "Content-Type": "application/json" }),
      },
      body: o.raw || (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (e) {
    const x = new Error("Can't reach the home server. Is Tailscale on?");
    x.status = 0;
    throw x;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const x = new Error(r.status === 401 ? "Wrong admin token" : j.error || "Server " + r.status);
    x.status = r.status;
    throw x;
  }
  return j;
}
export const qs = o => new URLSearchParams(o).toString();
export const wsUrl = q => base().replace(/^http/, "ws") + "/api/term/ws?" + q;
/* signed URL for <img>/<video>/downloads (no headers possible there) */
export const rawUrl = async (p, dl) =>
  base() + "/api/fs/raw?" + (await api("/api/fs/sign", { p })).q + (dl ? "&dl=1" : "");

export async function connectAdmin(url, token) {
  const prev = adminCfg();
  setAdmin({ url: url || ADMIN_URL, token });
  try {
    await api("/api/ping");
    return "";
  } catch (e) {
    setAdmin(prev);
    return e.message;
  }
}
/* a new device trades a one-time code (made on a paired device) for the token: the token itself never has to be typed or pasted */
export async function claimPair(url, code) {
  let r;
  try {
    r = await fetch((url || ADMIN_URL).replace(/\/+$/, "") + "/api/pair/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch (e) {
    return "Can't reach the home server. Is Tailscale on?";
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return j.error || "Server " + r.status;
  setAdmin({ url: url || ADMIN_URL, token: j.token });
  return "";
}

/* xterm.js is its own bundle, fetched the first time a terminal opens. Bundled next to app.js (PWA, new installers);
   the sync server's copy covers native installs that predate it. */
let xt = null;
const addScript = src =>
  new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => {
      s.remove();
      no();
    };
    document.head.appendChild(s);
  });
const addCss = href => {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
};
export function loadXterm() {
  if (window.XTermKit) return Promise.resolve(window.XTermKit);
  /* an old installer has no xterm.js, and its asset server may answer with something that "loads" but defines nothing */
  const local = () =>
    addScript("xterm.js").then(() => {
      if (!window.XTermKit) throw 0;
      addCss("xterm.css");
    });
  return (
    xt ||
    (xt = local()
      .catch(() =>
        HOME_SERVER
          ? addScript(HOME_SERVER + "/xterm.js").then(() => {
              if (!window.XTermKit) throw 0;
              addCss(HOME_SERVER + "/xterm.css");
            })
          : Promise.reject(0),
      )
      .then(
        () => window.XTermKit,
        e => {
          xt = null;
          throw new Error("Couldn't load the terminal");
        },
      ))
  );
}
