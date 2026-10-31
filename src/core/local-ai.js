/* Models running on this machine: llama-server (server/local-ai/local_ai.py starts one), Ollama or LM Studio. Osage talks to them
   directly from the app (OpenAI-compatible API on loopback), so no Sync is needed. A model is named "local:<id>".
   Pref os-local {urls:[...]} replaces the default addresses (a PC reachable over Tailscale, say). */
import { ls } from "./pref.js";

const DEFAULTS = [
  "http://127.0.0.1:8085/v1",
  "http://127.0.0.1:8080/v1",
  "http://127.0.0.1:11434/v1",
  "http://127.0.0.1:1234/v1",
]; // llama-server, Ollama, LM Studio
export const isLocal = m => typeof m === "string" && m.startsWith("local:");
let seen = null,
  at = 0,
  busy = null;

/* {models:["local:qwen3.5-9b",...], base:{id:url}}; remembered for a few seconds, `fresh` rechecks */
export function localModels(fresh) {
  if (!fresh && seen && Date.now() - at < 10000) return Promise.resolve(seen);
  if (busy) return busy;
  const urls = (ls.get("os-local", {}).urls || []).length ? ls.get("os-local", {}).urls : DEFAULTS;
  busy = Promise.all(
    urls.map(async u => {
      const base = u.replace(/\/+$/, "");
      try {
        const c = new AbortController(),
          t = setTimeout(() => c.abort(), 900);
        const r = await fetch(base + "/models", { signal: c.signal });
        clearTimeout(t);
        const j = await r.json();
        return (j.data || [])
          .map(m => m.id)
          .filter(id => id && !/embed/i.test(id))
          .map(id => [id, base]);
      } catch (e) {
        return [];
      }
    }),
  ).then(all => {
    const base = {};
    all.flat().forEach(([id, u]) => {
      if (!base[id]) base[id] = u;
    });
    seen = { models: Object.keys(base).map(id => "local:" + id), base };
    at = Date.now();
    busy = null;
    return seen;
  });
  return busy;
}
export const localBase = async m => (await localModels()).base[m.slice(6)] || "";
export const localName = m => (m || "").replace(/^local:/, "");

/* The helper from server/local-ai/local_ai.py also answers /status and /unload; Ollama and LM Studio don't, so these just return null */
const helper = async m => {
  const b = await localBase(m);
  return b ? b.replace(/\/v1$/, "") : "";
};
export async function localStatus(m) {
  // {loaded, loading, ram (MB), vram (MB, whole GPU), vision, canVision} from the helper, or null (Ollama, LM Studio, nothing running)
  try {
    const h = await helper(m);
    if (!h) return null;
    const j = await (await fetch(h + "/status")).json();
    return {
      loaded: j.loaded || null,
      loading: !!j.loading,
      ram: j.ram_mb || 0,
      vram: j.vram_mb || 0,
      vision: !!j.vision,
      canVision: !!j.can_vision,
    };
  } catch (e) {
    return null;
  }
}
export const localLoaded = async m => ((await localStatus(m)) || {}).loaded || null;
export async function localLoad(m) {
  const h = await helper(m);
  if (h)
    await fetch(h + "/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: localName(m) }),
    }).catch(() => {});
}
export async function localVision(m, on) {
  // the loaded model restarts with/without its vision projector on the next message
  const h = await helper(m);
  if (h)
    await fetch(h + "/vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on }),
    }).catch(() => {});
}
export async function localUnload(m) {
  const h = await helper(m);
  if (h) await fetch(h + "/unload", { method: "POST" }).catch(() => {});
}
