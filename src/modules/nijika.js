/* nijika: control the home server from the OS. Terminal | Files | Services, talking to server/admin.py over the tailnet. */
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { html, openExternal } from "../core/lib.js";
import { ls, usePref } from "../core/pref.js";
import { toast } from "../core/bus.js";
import { native } from "../core/sync.js";
import {
  api,
  qs,
  wsUrl,
  rawUrl,
  useAdmin,
  setAdmin,
  connectAdmin,
  claimPair,
  loadXterm,
  ADMIN_URL,
  adminCfg,
} from "../core/admin.js";
import { Tools, Panel, StatusBar, Field, Btn, Group, Empty, Icon, Select } from "../ui/index.js";
import { actionSheet, askText, openSheet, longPress } from "../ui/sheet.js";
import { openMod } from "../shell/os.js";
import { on as featOn } from "../core/features.js";

const open = u => openExternal(u);
const size = n =>
  n < 1024
    ? n + " B"
    : n < 1048576
      ? (n / 1024).toFixed(0) + " KB"
      : n < 1073741824
        ? (n / 1048576).toFixed(1) + " MB"
        : (n / 1073741824).toFixed(1) + " GB";
const when = s => {
  const d = new Date(s * 1000),
    n = new Date();
  return d.toDateString() === n.toDateString() ? d.toTimeString().slice(0, 5) : d.toISOString().slice(0, 10);
};
const join = (a, b) => (a.replace(/\/+$/, "") || "") + "/" + b;
const dirname = p => p.replace(/\/[^/]*$/, "") || "/";

/* ---------------- connect ---------------- */
function Connect() {
  const c = adminCfg();
  const [url, setUrl] = useState(c.url || ADMIN_URL),
    [tok, setTok] = useState(""),
    [code, setCode] = useState(""),
    [msg, setMsg] = useState("");
  const go = async () => {
    setMsg("Connecting…");
    setMsg(await connectAdmin(url.trim(), tok.trim()));
  };
  const pair = async () => {
    setMsg("Pairing…");
    setMsg(await claimPair(url.trim(), code.trim()));
  };
  return html`<${Tools}><${Field} w="w" aria-label="Admin address" placeholder=${ADMIN_URL} value=${url} onInput=${e => setUrl(e.target.value)}/><//>
    <${Panel}><div class="ll nj-con">
      <${Group} title="Pairing code"/>
      <div class="lr"><${Field} w="w" aria-label="Pairing code" placeholder="From a device that's already connected" autocapitalize="characters" autocomplete="off" value=${code} onInput=${e => setCode(e.target.value)} onEnter=${pair}/><${Btn} go onClick=${pair}>Pair<//></div>
      <${Group} title="Or admin token"/>
      <div class="lr"><${Field} w="w" type="password" aria-label="Admin token" placeholder="admin_token.txt on the server" autocomplete="off" value=${tok} onInput=${e => setTok(e.target.value)} onEnter=${go}/><${Btn} go onClick=${go}>Connect<//></div>
      ${msg ? html`<div class="lr late"><span class="tt">${msg}</span></div>` : null}
      <div class="emp">Tailnet only: Tailscale has to be on for this device.</div>
    </div><//>`;
}

/* ---------------- terminal ---------------- */
const KEYS = [
  ["Esc", "\x1b"],
  ["Tab", "\t"],
  ["Ctrl", null],
  ["↑", "\x1b[A"],
  ["↓", "\x1b[B"],
  ["←", "\x1b[D"],
  ["→", "\x1b[C"],
  ["|", "|"],
  ["~", "~"],
  ["/", "/"],
  ["-", "-"],
];
function TermView({ tab, on, onId }) {
  const tabR = useRef(tab);
  tabR.current = tab;
  const box = useRef(),
    T = useRef({});
  const [state, setState] = useState("Connecting…"),
    [ctrl, setCtrl] = useState(false);
  const ctrlR = useRef(false);
  useEffect(() => {
    let dead = false,
      ended = false,
      ws = null,
      retry = 0,
      timer = 0,
      term = null,
      fit = null,
      ro = null;
    const t = T.current;
    const send = o => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
    };
    t.send = d => send({ i: d });
    t.fit = () => {
      try {
        fit && fit.fit();
      } catch {
        // the terminal isn't visible yet
      }
    };
    async function attach() {
      if (dead) return;
      try {
        let r;
        try {
          r = await api("/api/term/ticket", { id: tabR.current.id });
        } catch (e) {
          if (e.status !== 404) throw e;
          r = await api("/api/term/new", { kind: tabR.current.kind, cols: term.cols, rows: term.rows });
          onId(r.id);
        }
        if (dead) return;
        ws = new WebSocket(wsUrl(r.q));
        ws.binaryType = "arraybuffer";
        ws.onopen = () => {
          retry = 0;
          setState("");
          send({ r: [term.cols, term.rows] });
        };
        ws.onmessage = e => {
          if (typeof e.data !== "string") {
            term.write(new Uint8Array(e.data));
            return;
          }
          const m = JSON.parse(e.data);
          if (m.hello) term.reset();
          if (m.exit != null) {
            ended = true;
            setState("Exited (" + m.exit + ")");
          }
        };
        ws.onclose = () => {
          if (dead || ended) return;
          setState("Reconnecting…");
          again();
        };
      } catch (e) {
        setState(e.message);
        again();
      }
    }
    const again = () => {
      clearTimeout(timer);
      if (!dead && !ended) timer = setTimeout(attach, Math.min(15000, 800 * 2 ** retry++));
    };
    const wake = () => {
      if (!document.hidden && (!ws || ws.readyState > 1)) {
        retry = 0;
        clearTimeout(timer);
        attach();
      }
    };
    loadXterm().then(
      ({ Terminal, FitAddon }) => {
        if (dead) return;
        term = new Terminal({
          fontFamily: "ui-monospace,Consolas,'DejaVu Sans Mono',monospace",
          fontSize: matchMedia("(max-width:860px)").matches ? 12 : 13,
          cursorBlink: true,
          scrollback: 5000,
          allowProposedApi: true,
          theme: {
            background: "#101010",
            foreground: "#d8d8d8",
            cursor: "#d8d8d8",
            selectionBackground: "#5a5a5a",
          },
        });
        fit = new FitAddon();
        term.loadAddon(fit);
        term.open(box.current);
        t.term = term;
        t.fit();
        term.onData(d => {
          if (ctrlR.current && d.length === 1) {
            const c = d.toUpperCase().charCodeAt(0);
            if (c >= 64 && c < 96) d = String.fromCharCode(c - 64);
            ctrlR.current = false;
            setCtrl(false);
          }
          send({ i: d });
        });
        term.onResize(({ cols, rows }) => send({ r: [cols, rows] }));
        term.attachCustomKeyEventHandler(e => {
          if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
          if (e.code === "KeyC") {
            const s = term.getSelection();
            if (s) navigator.clipboard.writeText(s);
            return false;
          }
          if (e.code === "KeyV") {
            navigator.clipboard
              .readText()
              .then(x => x && send({ i: x }))
              .catch(() => {});
            return false;
          }
          return true;
        });
        ro = new ResizeObserver(() => t.fit());
        ro.observe(box.current);
        attach();
      },
      e => setState(e.message),
    );
    addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      dead = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      if (ro) ro.disconnect();
      if (term) term.dispose();
      removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  useEffect(() => {
    if (on) {
      const t = T.current;
      setTimeout(() => {
        t.fit && t.fit();
        t.term && t.term.focus();
      }, 30);
    }
  }, [on]);
  const key = k => {
    const t = T.current;
    if (k[1] == null) {
      ctrlR.current = !ctrlR.current;
      setCtrl(ctrlR.current);
    } else t.send && t.send(k[1]);
    t.term && t.term.focus();
  };
  return html`<div class="nj-tv" hidden=${!on} data-tab=${tab.id}>
    <div class="nj-xt" ref=${box}/>
    ${state ? html`<div class="nj-st">${state}</div>` : null}
    <div class="nj-keys">${KEYS.map(k => html`<button type="button" class=${"btn" + (k[1] == null && ctrl ? " on" : "")} onPointerDown=${e => e.preventDefault()} onClick=${() => key(k)}>${k[0]}</button>`)}
      <button type="button" class="btn" onPointerDown=${e => e.preventDefault()} onClick=${() => {
        const s = T.current.term && T.current.term.getSelection();
        if (s) {
          navigator.clipboard.writeText(s);
          toast("Copied");
        }
      }}>Copy</button>
      <button type="button" class="btn" onPointerDown=${e => e.preventDefault()} onClick=${() =>
        navigator.clipboard
          .readText()
          .then(x => x && T.current.send(x))
          .catch(() => toast("Clipboard blocked: use Ctrl+Shift+V"))}>Paste</button></div>
  </div>`;
}
let tabSeq = 0;
export const newTab = kind => {
  const id = "new-" + Date.now().toString(36) + tabSeq++;
  return { id, k: id, kind, l: kind };
};
function Terminal() {
  const [tabs, setTabs] = usePref("os-nj-tabs", []),
    [cur, setCur] = usePref("os-nj-cur", "");
  const add = kind => {
    const t = newTab(kind);
    setTabs([...ls.get("os-nj-tabs", []), t]);
    setCur(t.id);
  };
  useEffect(() => {
    if (!tabs.length) add("shell");
  }, []);
  const upd = (id, o) => {
    const n = ls.get("os-nj-tabs", []).map(t => (t.id === id ? { ...t, ...o } : t));
    setTabs(n);
    if (o.id && ls.get("os-nj-cur", "") === id) setCur(o.id);
  };
  const close = t => {
    if (!t.id.startsWith("new-")) api("/api/term/close", { id: t.id }).catch(() => {});
    const n = ls.get("os-nj-tabs", []).filter(x => x.id !== t.id);
    setTabs(n);
    if (cur === t.id) setCur(n.length ? n[n.length - 1].id : "");
  };
  const c = tabs.find(t => t.id === cur) || tabs[0];
  return html`<div class="nj-term">
    <div class="nj-tabs" role="tablist">${tabs.map(
      t =>
        html`<span class="nj-tab" role="tab" key=${t.id} aria-selected=${String(c && t.id === c.id)} onClick=${() => setCur(t.id)}><${Icon} n=${t.kind === "hermes" ? "buddy" : "term"}/><b>${t.l}</b><button class="x1" aria-label="Close terminal" onClick=${e => {
          e.stopPropagation();
          close(t);
        }}>×</button></span>`,
    )}
      <${Btn} icon="plus" aria-label="New shell" title="New shell" onClick=${() => add("shell")}/>${featOn("hermes") ? html`<${Btn} onClick=${() => add("hermes")}>Hermes<//>` : null}</div>
    ${tabs.map(t => html`<${TermView} key=${t.k || t.id} tab=${t} on=${c && t.id === c.id} onId=${id => upd(t.id, { id })}/>`)}
    ${tabs.length ? null : html`<${Empty}>No terminals. <${Btn} onClick=${() => add("shell")}>New shell<//><//>`}
  </div>`;
}

/* ---------------- files ---------------- */
const TXT =
  /\.(txt|md|markdown|ya?ml|json|js|mjs|ts|css|html?|xml|py|sh|bash|conf|cfg|ini|toml|env|log|csv|service|rs|go|c|h|cpp|java|kt|sql|lua|rb|php|gitignore|dockerfile)$/i;
const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i,
  VID = /\.(mp4|webm|mkv|mov|m4v)$/i,
  AUD = /\.(mp3|flac|ogg|opus|m4a|wav|aac)$/i,
  PDF = /\.pdf$/i;
function Editor({ p, onClose }) {
  const [doc, setDoc] = useState(null),
    [txt, setTxt] = useState(""),
    [err, setErr] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    api("/api/fs/read?" + qs({ p })).then(
      d => {
        setDoc(d);
        setTxt(d.text);
      },
      e => setErr(e.message),
    );
  }, [p]);
  const save = async () => {
    try {
      const r = await api("/api/fs/write", { p, text: txt, m: doc.m });
      setDoc({ ...doc, m: r.m });
      setDirty(false);
      toast("Saved");
    } catch (e) {
      toast(e.message);
    }
  };
  return html`<div class="nj-ed">
    <${Tools}><span class="nj-fn selectable" title=${p}>${p.split("/").pop()}${dirty ? " •" : ""}</span><${Btn} go disabled=${!doc} onClick=${save}>Save<//><${Btn} onClick=${() => {
      if (!dirty || confirmLeave()) onClose();
    }}>Close<//><//>
    ${
      err
        ? html`<${Empty} pad>${err}<//>`
        : doc
          ? html`<textarea class="nj-ta field" spellcheck="false" autocapitalize="off" aria-label="File text" value=${txt}
      onInput=${e => {
        setTxt(e.target.value);
        setDirty(true);
      }} onKeyDown=${e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
          e.preventDefault();
          save();
        } else if (e.key === "Tab") {
          e.preventDefault();
          const a = e.target,
            s = a.selectionStart;
          a.setRangeText("  ", s, a.selectionEnd, "end");
          setTxt(a.value);
          setDirty(true);
        }
      }}/>`
          : html`<${Empty} pad>Loading…<//>`
    }
  </div>`;
}
let leaveWarned = 0;
/* no confirm(): the first Close on unsaved text only warns, a second one within 4 s discards */
const confirmLeave = () => {
  if (Date.now() - leaveWarned < 4000) return true;
  leaveWarned = Date.now();
  toast("Unsaved changes. Close again to discard");
  return false;
};
function Preview({ p, onClose }) {
  const [u, setU] = useState("");
  useEffect(() => {
    rawUrl(p).then(setU, e => toast(e.message));
  }, [p]);
  const n = p.split("/").pop();
  return html`<div class="nj-pv"><${Tools}><span class="nj-fn selectable">${n}</span><${Btn} icon="export" onClick=${async () => open(await rawUrl(p, 1))}>Download<//><${Btn} onClick=${onClose}>Close<//><//>
    <div class="nj-pvb">${!u ? null : IMG.test(n) ? html`<img src=${u} alt=${n}/>` : VID.test(n) ? html`<video src=${u} controls playsinline/>` : AUD.test(n) ? html`<audio src=${u} controls/>` : PDF.test(n) ? html`<iframe src=${u} title=${n}/>` : null}</div></div>`;
}
function Files() {
  const [path, setPath] = usePref("os-nj-path", ""),
    [d, setD] = useState(null),
    [err, setErr] = useState(""),
    [view, setView] = useState(null),
    [edit, setEdit] = useState("");
  const up = useRef();
  const load = useCallback(
    (p = path) => {
      setErr("");
      api("/api/fs/ls?" + qs({ p: p || "~" })).then(
        r => {
          setD(r);
          setEdit(r.p);
          if (r.p !== path) setPath(r.p);
        },
        e => setErr(e.message),
      );
    },
    [path],
  );
  useEffect(() => {
    load(path);
  }, [path]);
  const go = p => {
    setView(null);
    setPath(p);
  };
  const openItem = it => {
    const p = join(d.p, it.n);
    if (it.d) return go(p);
    if (IMG.test(it.n) || VID.test(it.n) || AUD.test(it.n) || PDF.test(it.n)) setView({ k: "pv", p });
    else if (TXT.test(it.n) || it.s < 262144) setView({ k: "ed", p });
    else rawUrl(p, 1).then(open);
  };
  const nu = async kind => {
    const n = await askText({
      title: kind === "d" ? "New folder" : "New file",
      placeholder: "name",
      ok: "Create",
    });
    if (!n) return;
    const p = join(d.p, n.trim());
    try {
      if (kind === "d") await api("/api/fs/mkdir", { p });
      else {
        await api("/api/fs/write", { p, text: "", new: 1 });
        setView({ k: "ed", p });
      }
      load();
    } catch (e) {
      toast(e.message);
    }
  };
  const ren = async it => {
    const n = await askText({ title: "Rename", value: it.n, ok: "Rename" });
    if (!n || n === it.n) return;
    try {
      await api("/api/fs/move", { p: join(d.p, it.n), to: join(d.p, n.trim()) });
      load();
    } catch (e) {
      toast(e.message);
    }
  };
  const mv = async it => {
    const to = await askText({ title: "Move to folder", value: d.p, ok: "Move" });
    if (!to) return;
    try {
      await api("/api/fs/move", { p: join(d.p, it.n), to: join(to.trim(), it.n) });
      load();
      toast("Moved to " + to);
    } catch (e) {
      toast(e.message);
    }
  };
  const del = async it => {
    try {
      const r = await api("/api/fs/trash", { p: join(d.p, it.n) });
      load();
      toast("Moved " + it.n + " to trash", {
        label: "Undo",
        run: () =>
          api("/api/fs/restore", { id: r.id }).then(
            () => load(),
            e => toast(e.message),
          ),
      });
    } catch (e) {
      toast(e.message);
    }
  };
  const menu = (it, at) =>
    actionSheet(
      it.n,
      [
        [it.d ? "folder" : "open", "Open", () => openItem(it)],
        !it.d && ["edit", "Edit as text", () => setView({ k: "ed", p: join(d.p, it.n) })],
        !it.d && ["export", "Download", async () => open(await rawUrl(join(d.p, it.n), 1))],
        ["edit", "Rename", () => ren(it)],
        ["up", "Move", () => mv(it)],
        "-",
        ["trash", "Delete", () => del(it), { danger: 1 }],
      ],
      at,
    );
  const upload = async e => {
    const fs = [...e.target.files];
    e.target.value = "";
    for (const f of fs) {
      toast("Uploading " + f.name + "…");
      try {
        await api("/api/fs/upload?" + qs({ p: join(d.p, f.name) }), undefined, { method: "PUT", raw: f });
      } catch (x) {
        toast(f.name + ": " + x.message);
        return;
      }
    }
    load();
    if (fs.length) toast("Uploaded " + fs.length + " file" + (fs.length > 1 ? "s" : ""));
  };
  if (view)
    return view.k === "ed"
      ? html`<${Editor} p=${view.p} onClose=${() => {
          setView(null);
          load();
        }}/>`
      : html`<${Preview} p=${view.p} onClose=${() => setView(null)}/>`;
  const places = d ? d.places : [];
  return html`<${Tools} cls="nj-ft">
      <${Btn} icon="up" aria-label="Up a folder" title="Up" onClick=${() => d && go(dirname(d.p))}/>
      ${places.length ? html`<${Select} opts=${[["", "Places"], ...places.map(([l, p]) => [p, l])]} value="" onChange=${p => p && go(p)}/>` : null}
      <${Field} w="w" cls="nj-path" aria-label="Path" value=${edit} onInput=${e => setEdit(e.target.value)} onEnter=${() => go(edit.trim())}/>
      <${Btn} icon="plus" onClick=${e =>
        actionSheet(
          "New",
          [
            ["file", "File", () => nu("f")],
            ["folder", "Folder", () => nu("d")],
            ["import", "Upload", () => up.current.click()],
          ],
          e.currentTarget,
        )}>New<//>
      <${Btn} icon="reset" aria-label="Refresh" title="Refresh" onClick=${() => load()}/>
      <input ref=${up} type="file" multiple hidden onChange=${upload}/>
    <//>
    <${Panel}>${
      err
        ? html`<${Empty} pad>${err}<//>`
        : !d
          ? html`<${Empty} pad>Loading…<//>`
          : !d.items.length
            ? html`<${Empty} pad>Empty folder.<//>`
            : html`<div class="ll nj-files">${d.items.map(
                it => html`<div class="lr nj-f" key=${it.n} onClick=${() => openItem(it)} ...${longPress(t => menu(it, t))}>
        <${Icon} n=${it.d ? "folder" : "file"}/><span class="tt">${it.n}${it.l ? " ↗" : ""}</span><span class="when">${it.d ? "" : size(it.s)}</span><span class="when nj-m">${when(it.m)}</span>
        <button class="x1 nj-more" aria-label=${"More for " + it.n} onClick=${e => {
          e.stopPropagation();
          menu(it, e.currentTarget);
        }}><${Icon} n="more"/></button></div>`,
              )}</div>`
    }<//>
    <${StatusBar} keep items=${d ? [d.items.length + " items", size(d.free) + " free"] : []}/>`;
}

/* ---------------- services ---------------- */
function Logs({ kind, name }) {
  const [t, setT] = useState("Loading…");
  const pre = useRef();
  const load = () =>
    api("/api/svc/logs?" + qs({ kind, name, n: 300 })).then(
      r => {
        setT(r.text || "(no output)");
        setTimeout(() => {
          if (pre.current) pre.current.scrollTop = 1e9;
        }, 20);
      },
      e => setT(e.message),
    );
  useEffect(() => {
    load();
  }, []);
  return html`<div class="nj-logs"><div class="nj-lt"><${Btn} icon="reset" onClick=${load}>Refresh<//></div><pre ref=${pre} class="selectable">${t}</pre></div>`;
}
const showLogs = (kind, name) => openSheet({ title: name + " logs", Body: Logs, props: { kind, name } });
function Row({ kind, s, can = true, busy, act }) {
  const up = kind === "docker" ? s.state === "running" : s.state === "active";
  return html`<div class="lr nj-s" data-name=${s.name}>
    <i class=${"nj-dot" + (up ? " up" : s.state === "failed" || s.state === "exited" ? " bad" : "")}/>
    <span class="tt">${s.name}<em>${kind === "docker" ? s.status : s.sub || s.state}</em></span>
    ${
      busy
        ? html`<span class="when">…</span>`
        : can
          ? html`
      ${up ? html`<${Btn} onClick=${() => act(kind, s.name, "restart")}>Restart<//>` : html`<${Btn} go onClick=${() => act(kind, s.name, "start")}>Start<//>`}
      ${up && s.name !== "sos-admin" ? html`<${Btn} onClick=${() => act(kind, s.name, "stop")}>Stop<//>` : null}`
          : null
    }
    <${Btn} onClick=${() => showLogs(kind, s.name)}>Logs<//>
  </div>`;
}
function Services({ toTerm }) {
  const [d, setD] = useState(null),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState("");
  const load = () =>
    api("/api/svc").then(
      r => {
        setD(r);
        setErr("");
      },
      e => setErr(e.message),
    );
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  const act = async (kind, name, a) => {
    setBusy(kind + name);
    try {
      await api("/api/svc/act", { kind, name, act: a });
      toast(name + ": " + a + " done");
    } catch (e) {
      toast(e.message);
    }
    setBusy("");
    load();
  };
  if (err && !d) return html`<${Panel}><${Empty} pad>${err}<//><//>`;
  if (!d) return html`<${Panel}><${Empty} pad>Loading…<//><//>`;
  const hm = featOn("hermes"),
    herm = hm ? d.user.filter(u => u.name.startsWith("hermes")) : [],
    usr = d.user.filter(u => !hm || !u.name.startsWith("hermes"));
  const dash = d.links.find(l => l.name === "hermes");
  const rows = (kind, list, can) =>
    list.map(
      s =>
        html`<${Row} key=${s.name} kind=${kind} s=${s} can=${can} busy=${busy === kind + s.name} act=${act}/>`,
    );
  return html`<${Panel}><div class="ll nj-svc">
      ${
        hm
          ? html`<${Group} title="Hermes" meta=${html`<${Btn} icon="term" onClick=${() => toTerm("hermes")}>Terminal<//>${dash ? html`<${Btn} icon="open" onClick=${() => open(dash.url)}>Dashboard<//>` : null}`}/>
      ${rows("user", herm, true)}`
          : null
      }
      <${Group} title="Web apps"/>
      <div class="nj-links">${d.links.map(l => html`<a class="btn" key=${l.name} href=${l.url} target="_blank" rel="noopener">${l.name}</a>`)}</div>
      <${Group} title="Containers" meta=${d.docker.filter(x => x.state === "running").length + "/" + d.docker.length + " up"}/>
      ${d.docker_err ? html`<div class="lr late"><span class="tt">${d.docker_err}</span></div>` : rows("docker", d.docker, true)}
      <${Group} title="User services"/>
      ${rows("user", usr, true)}
      <${Group} title="System services" meta=${d.sudo ? "" : "needs sudo: control from the terminal"}/>
      ${rows("system", d.system, d.sudo)}
    </div><//>
    <${StatusBar} keep items=${[err || "Live", native ? "" : "tailnet only"]}/>`;
}

/* ---------------- window ---------------- */
const PARTS = [
  ["term", "Terminal", "term"],
  ["files", "Files", "folder"],
  ["svc", "Services", "svc"],
];
function Nijika() {
  const c = useAdmin();
  const [sub, setSub] = usePref("os-sub-nijika", "term");
  if (!c.token) return html`<${Connect}/>`;
  const toTerm = kind => {
    const t = newTab(kind);
    ls.set("os-nj-tabs", [...ls.get("os-nj-tabs", []), t]);
    ls.set("os-nj-cur", t.id);
    setSub("term");
  };
  const more = e =>
    actionSheet(
      "Home server",
      [
        [
          "links",
          "Pair another device",
          async () => {
            try {
              const r = await api("/api/pair/new", {});
              openSheet({
                title: "Pairing code",
                Body: () =>
                  html`<div class="nj-pair"><b class="selectable">${r.code}</b><span>Type it into the nijika window on the other device within 5 minutes. Works once.</span></div>`,
              });
            } catch (x) {
              toast(x.message);
            }
          },
        ],
        [
          "skip",
          "Forget admin token",
          () => {
            setAdmin({ url: c.url, token: "" });
            toast("Disconnected from the home server");
          },
          { danger: 1 },
        ],
      ],
      e.currentTarget,
    );
  return html`<div class="hubtabs" role="tablist">${PARTS.map(([k, l, ic]) => html`<button class="ht" role="tab" key=${k} aria-selected=${String(k === sub)} onClick=${() => setSub(k)}><${Icon} n=${ic}/><span>${l}</span></button>`)}
      <button class="ht nj-mo" aria-label="Home server settings" onClick=${more}><${Icon} n="gear"/></button></div>
    <div class="nj-body">
      <div class="nj-part" hidden=${sub !== "term"}><${Terminal}/></div>
      ${sub === "files" ? html`<${Files}/>` : sub === "svc" ? html`<${Services} toTerm=${toTerm}/>` : null}
    </div>`;
}
export default {
  id: "nijika",
  opt: "nijika",
  name: "Home server",
  title: "home server",
  Comp: Nijika,
  cmd: v =>
    ["nijika", "server", "ssh", "term", "terminal"].includes(v)
      ? [{ icon: "nijika", l: "Open nijika", r: () => openMod("nijika", true) }]
      : [],
};
