/* Page attachments (images, pdfs). Local-first like everything else:
   saved to IndexedDB on this device, uploaded to the laptop server (PUT /api/file/<id>) when sync is on,
   and fetched from the server on other devices. Pages reference them as ![alt](sos:<id>). */
import { warn } from "./bus.js";
import { syncConfig } from "./sync.js";

const DBN = "sos-files",
  ST = "f";
let dbp = null;
const db = () =>
  dbp ||
  (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
const tx = async (mode, f) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(ST, mode),
      s = t.objectStore(ST),
      q = f(s);
    t.oncomplete = () => res(q && q.result);
    t.onerror = () => rej(t.error);
  });
};
const getRec = id => tx("readonly", s => s.get(id)).catch(() => null);
const putRec = r => tx("readwrite", s => s.put(r));
const allRecs = () => tx("readonly", s => s.getAll()).catch(() => []);

const newId = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return (
    Array.from(a, b => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[b & 63]).join("") +
    Date.now().toString(36)
  );
};
const base = () => {
  const c = syncConfig();
  return c.on && c.url ? c.url.replace(/\/+$/, "") : "";
};

/* big photos get shrunk before they're stored: 1800px long side, webp */
async function shrink(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 350e3) return file;
  try {
    const bmp = await createImageBitmap(file),
      k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise(r => c.toBlob(r, "image/webp", 0.86));
    return b && b.size < file.size ? b : file;
  } catch (e) {
    return file;
  }
}

/** store a File/Blob, returns its id. Uploads in the background if sync is on. */
export async function saveFile(file, name) {
  const blob = await shrink(file),
    id = newId();
  await putRec({
    id,
    blob,
    type: blob.type || file.type,
    name: name || file.name || "",
    up: 0,
    at: Date.now(),
  });
  uploadPending();
  return id;
}

const urls = new Map();
/** a src for <img>/<a>: local copy first, then the server; null if neither has it */
export async function fileUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const r = await getRec(id);
  if (r && r.blob) {
    const u = URL.createObjectURL(r.blob);
    urls.set(id, u);
    return u;
  }
  const b = base();
  if (!b) return null;
  const u = b + "/api/file/" + encodeURIComponent(id);
  /* keep a copy so it works offline next time */
  fetch(u)
    .then(x => (x.ok ? x.blob() : null))
    .then(bl => {
      if (bl) putRec({ id, blob: bl, type: bl.type, name: "", up: 1, at: Date.now() });
    })
    .catch(() => {});
  return u;
}

let busy = false;
export async function uploadPending() {
  const c = syncConfig(),
    b = base();
  if (busy || !b || !c.token || !navigator.onLine) return;
  busy = true;
  try {
    for (const r of await allRecs()) {
      if (r.up) continue;
      const res = await fetch(b + "/api/file/" + encodeURIComponent(r.id), {
        method: "PUT",
        headers: { Authorization: "Bearer " + c.token, "Content-Type": r.type || "application/octet-stream" },
        body: r.blob,
      });
      if (res.ok || res.status === 415 || res.status === 413) await putRec({ ...r, up: 1, bad: !res.ok });
      else break;
    }
  } catch (e) {
    warn("file upload", e);
  }
  busy = false;
}
