/* Sync manager: local-first. The app always writes to this device; this pushes/pulls to the laptop server when online. */
import { useState, useEffect } from "preact/hooks";
import { ls } from "./pref.js";
import { uploadPending } from "./files.js";
import { pack } from "./pack.js";

const st = { state: "off", last: 0, err: "", pending: 0 };
const subs = new Set();
const emit = () => subs.forEach(f => f());
export const useSync = () => {
  const [, t] = useState(0);
  useEffect(() => {
    const f = () => t(n => n + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return st;
};
export const syncState = () => st;
export const syncConfig = () => ls.get("os-sync", { url: "", token: "", on: false });
/* Tauri (desktop/Android) build: page is served from tauri.localhost, so the server can't be inferred from the origin */
export const native = !!window.__TAURI_INTERNALS__;
/* the pack's own server (set by the pack); empty = a first run asks for one */
export const HOME_SERVER = (pack.servers && pack.servers.sync) || "";
let ad = null,
  timer = 0,
  busy = false,
  debounce = 0;
const api = (cfg, path, opt) =>
  fetch(
    cfg.url.replace(/\/+$/, "") + path,
    Object.assign(
      { headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" } },
      opt,
    ),
  );

export async function testConnection(cfg) {
  try {
    const r = await api(cfg, "/api/ping");
    if (r.status === 401) return "Wrong token.";
    if (!r.ok) return "Server answered " + r.status + ".";
    return "";
  } catch (e) {
    return "Can't reach that address.";
  }
}
/* a pairing code (XXXX-XXXX, from `server.py pair` or another device) instead of the token: the server trades it once */
export const isPairCode = s => /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test((s || "").trim());
export async function claimPair(url, code) {
  try {
    const r = await fetch(url.replace(/\/+$/, "") + "/api/pair/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.token) return { token: j.token };
    return {
      err:
        j.error ||
        (r.status === 404
          ? "This server is too old for pairing codes, so use its token."
          : "Server answered " + r.status + "."),
    };
  } catch (e) {
    return { err: "Can't reach that address." };
  }
}
/* a pairing link (the QR in Pair a device): <server>/#pair=ABCD-2345. Read once, then dropped from the address bar. */
export const hashPair = () => {
  const m = /[#&]pair=([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})/.exec(location.hash || "");
  return m ? m[1] : "";
};
export const dropHashPair = () => {
  try {
    history.replaceState(history.state, "", location.pathname + location.search);
  } catch {
    // history is unavailable in some webviews
  }
};
/* connect with either a token or a pairing code; "" = connected, else the problem */
export async function connectWith(url, secret) {
  if (isPairCode(secret)) {
    const r = await claimPair(url, secret);
    if (r.err) return r.err;
    secret = r.token;
  }
  return connect({ url, token: secret.trim() });
}
/* a code for another device, made by this (connected) one */
export async function newPairCode() {
  const r = await api(syncConfig(), "/api/pair/new", { method: "POST", body: "{}" });
  if (!r.ok)
    throw new Error(
      r.status === 404 ? "This server is too old for pairing codes." : "Server answered " + r.status + ".",
    );
  return r.json();
}
export async function syncNow() {
  const cfg = syncConfig();
  if (!ad || !cfg.on || !cfg.url || !cfg.token || busy) return;
  if (!navigator.onLine) {
    st.state = "offline";
    emit();
    return;
  }
  busy = true;
  /* most syncs take a fraction of a second: only say "Syncing…" (status text, turning tray icon) when one runs long,
     otherwise every 20 s background round trip made "Up to date" flicker */
  const slow = setTimeout(() => {
    st.state = "syncing";
    emit();
  }, 700);
  try {
    const sent = ad.pending();
    const r = await api(cfg, "/api/sync", {
      method: "POST",
      body: JSON.stringify({ since: ls.get("os-seq", 0), docs: sent }),
    });
    if (r.status === 401) throw new Error("Wrong token");
    if (!r.ok) throw new Error("Server " + r.status);
    const out = await r.json();
    ad.ack(sent);
    ad.apply(out.docs);
    ls.set("os-seq", out.seq);
    st.state = "ok";
    st.err = "";
    st.last = Date.now();
    st.pending = ad.pending().length;
    uploadPending();
  } catch (e) {
    st.state = navigator.onLine ? "error" : "offline";
    st.err = String(e.message || e);
  }
  clearTimeout(slow);
  busy = false;
  emit();
}
export function startSync(adapter) {
  ad = adapter;
  if (!ad || !ad.pending) return;
  ad.onWrite = () => {
    st.pending = ad.pending().length;
    emit();
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, 1500);
  };
  clearInterval(timer);
  timer = setInterval(syncNow, 20000);
  addEventListener("online", syncNow);
  addEventListener("focus", syncNow);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncNow();
  });
  st.pending = ad.pending().length;
  if (syncConfig().on) syncNow();
}
export async function connect(cfg) {
  const e = await testConnection(cfg);
  if (e) return e;
  ls.set("os-sync", { ...cfg, on: true });
  ls.set("os-seq", 0);
  ad.markAll();
  await syncNow();
  dispatchEvent(new Event("os-sync-cfg"));
  return "";
}
export const disconnect = () => {
  ls.set("os-sync", { ...syncConfig(), on: false });
  st.state = "off";
  emit();
  dispatchEvent(new Event("os-sync-cfg"));
};
