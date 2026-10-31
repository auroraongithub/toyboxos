import { warn } from "./bus.js";
/* Storage adapters. Same tiny interface so the app never cares where data lives:
   { name, canWrite, init(), watch(col,cb)->unsub, add(col,obj), update(col,id,patch), set(col,id,obj), del(col,id) }
   - local  : this device only (localStorage), works fully offline  */

export function localAdapter(key = "sos-db") {
  const a = { name: "local", canWrite: true };
  let data = {},
    dirty = new Set();
  const subs = {};
  const load = () => {
    try {
      data = JSON.parse(localStorage.getItem(key) || "{}");
    } catch (e) {
      data = {};
    }
    try {
      dirty = new Set(JSON.parse(localStorage.getItem(key + "-dirty") || "[]"));
    } catch (e) {
      dirty = new Set();
    }
  };
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      warn("storage", e);
    }
  };
  const saveDirty = () => {
    try {
      localStorage.setItem(key + "-dirty", JSON.stringify([...dirty]));
    } catch (e) {
      warn("storage", e);
    }
  };
  const clean = o => {
    const r = Object.assign({}, o);
    delete r._u;
    delete r._d;
    return r;
  };
  const rows = c =>
    Object.entries(data[c] || {})
      .filter(([, v]) => !v._d)
      .map(([id, v]) => Object.assign({ _id: id }, clean(v)));
  const fire = c => (subs[c] || []).forEach(f => f(rows(c)));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const live = (c, id) => {
    const v = (data[c] || {})[id];
    return v && !v._d ? v : {};
  };
  a.onWrite = null;
  a.init = async () => {
    load();
    window.addEventListener("storage", e => {
      if (e.key === key) {
        load();
        Object.keys(subs).forEach(fire);
      }
    });
  };
  a.watch = (c, cb) => {
    (subs[c] = subs[c] || []).push(cb);
    setTimeout(() => cb(rows(c)), 0);
    return () => {
      subs[c] = subs[c].filter(f => f !== cb);
    };
  };
  const put = (c, id, o) => {
    (data[c] = data[c] || {})[id] = o;
    dirty.add(c + "/" + id);
    save();
    saveDirty();
    fire(c);
    if (a.onWrite) a.onWrite();
  };
  a.add = async (c, o) => put(c, uid(), Object.assign({}, o, { _u: Date.now() }));
  a.update = async (c, id, o) => put(c, id, Object.assign({}, live(c, id), o, { _u: Date.now() }));
  a.set = async (c, id, o) => put(c, id, Object.assign({}, o, { _u: Date.now() }));
  a.del = async (c, id) => put(c, id, { _d: 1, _u: Date.now() });
  a.batch = async ops => {
    const u = Date.now(),
      ch = new Set();
    ops.forEach(([op, c, id, o]) => {
      (data[c] = data[c] || {})[id] = op === "del" ? { _d: 1, _u: u } : Object.assign({}, o, { _u: u });
      dirty.add(c + "/" + id);
      ch.add(c);
    });
    save();
    saveDirty();
    ch.forEach(fire);
    if (a.onWrite) a.onWrite();
  };
  /* --- sync hooks --- */
  a.pending = () =>
    [...dirty]
      .map(k => {
        const i = k.indexOf("/"),
          c = k.slice(0, i),
          id = k.slice(i + 1),
          v = (data[c] || {})[id];
        return v ? { c, id, u: v._u || 0, d: v._d ? 1 : 0, data: v._d ? {} : clean(v) } : null;
      })
      .filter(Boolean);
  a.ack = sent => {
    sent.forEach(s => {
      const v = (data[s.c] || {})[s.id];
      if (v && (v._u || 0) === s.u) dirty.delete(s.c + "/" + s.id);
    });
    saveDirty();
  };
  a.apply = docs => {
    const ch = new Set();
    docs.forEach(r => {
      const cur = (data[r.c] || {})[r.id];
      if (cur && (cur._u || 0) > r.u) return;
      (data[r.c] = data[r.c] || {})[r.id] = r.d ? { _d: 1, _u: r.u } : Object.assign({}, r.data, { _u: r.u });
      dirty.delete(r.c + "/" + r.id);
      ch.add(r.c);
    });
    save();
    saveDirty();
    ch.forEach(fire);
  };
  a.markAll = () => {
    Object.entries(data).forEach(([c, m]) =>
      Object.keys(m).forEach(id => {
        if (!m[id]._u) m[id]._u = 1;
        dirty.add(c + "/" + id);
      }),
    );
    save();
    saveDirty();
  };
  a.exportJSON = () => JSON.stringify(data);
  /* restore a backup file: add what is missing and anything newer than what we have; never deletes; synced like any edit */
  a.mergeJSON = t => {
    const inc = JSON.parse(t);
    if (!inc || typeof inc !== "object" || Array.isArray(inc)) throw new Error("not a backup");
    let n = 0;
    Object.entries(inc).forEach(([c, m]) => {
      if (!m || typeof m !== "object") return;
      Object.entries(m).forEach(([id, v]) => {
        if (!v || typeof v !== "object" || v._d) return;
        const cur = (data[c] || {})[id];
        if (cur && !cur._d && (cur._u || 0) >= (v._u || 1)) return;
        (data[c] = data[c] || {})[id] = Object.assign({}, v, { _u: v._u || 1 });
        dirty.add(c + "/" + id);
        n++;
      });
    });
    save();
    saveDirty();
    Object.keys(subs).forEach(fire);
    if (a.onWrite) a.onWrite();
    return n;
  };
  a.importJSON = t => {
    data = JSON.parse(t);
    a.markAll();
    Object.keys(subs).forEach(fire);
  };
  return a;
}
