import { useState, useEffect } from "preact/hooks";
import { api } from "../core/ai.js";
import { openMod } from "../shell/os.js";
import { html, openExternal } from "../core/lib.js";
import { meta, useCols } from "../core/store.js";
import {
  useSync,
  syncConfig,
  connectWith,
  connect,
  disconnect,
  syncNow,
  native,
  HOME_SERVER,
  newPairCode,
  hashPair,
  dropHashPair,
} from "../core/sync.js";
import { openSheet } from "../ui/sheet.js";
import { toast, warn } from "../core/bus.js";
import { Tools, Panel, StatusBar, Field, Btn, Group, Select, Check } from "../ui/index.js";
import { qrSvg } from "../ui/qr.js";
import { BUILD, checkUpdate } from "../core/update.js";
import { UpdRow } from "../shell/updlight.js";
import { on as featOn, useMods } from "../core/features.js";
import { ls } from "../core/pref.js";

const ago = t => {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  return s < 10 ? "just now" : s < 90 ? s + "s ago" : Math.round(s / 60) + "m ago";
};
/* the server this copy came from: the pack's (native builds), else the page's own origin */
const ownServer = () => (native ? HOME_SERVER : /^https?:/.test(location.protocol) ? location.origin : "");
/* a one-time code for another device (server/server.py pair_new), with a QR of <address>/#pair=<code>: the phone's camera
   opens the app in its browser already paired. Several addresses (hosting from this PC) = pick which one the QR holds. */
const where = u =>
  /\.ts\.net/.test(u)
    ? "Tailscale, works anywhere"
    : /^https?:\/\/100\./.test(u)
      ? "Tailscale"
      : /^https?:\/\/(192\.168|10\.|172\.)/.test(u)
        ? "Same Wi-Fi"
        : "Server";
function PairCode({ code, urls }) {
  const [u, setU] = useState(urls[0]);
  const link = u.replace(/\/+$/, "") + "/#pair=" + code.replace("-", "");
  return html`<div class="pairc">
    ${urls.length > 1 ? html`<${Select} opts=${urls.map(x => [x, where(x) + " · " + x.replace(/^https?:\/\//, "")])} value=${u} onChange=${setU}/>` : null}
    <div class="qr" role="img" aria-label="QR code for the pairing link" dangerouslySetInnerHTML=${{ __html: qrSvg(link) }}/>
    <b class="selectable">${code}</b>
    <p>Scan it with the other device's camera. In the toybox app instead: Start > Sync, address <span class="selectable">${u}</span> and this code. Works once, for 10 minutes.</p>
    ${/^http:/.test(u) && !/\/\/(127\.|localhost)/.test(u) ? html`<p class="dim">The phone app needs an https address: use Tailscale's (This computer > Tailscale).</p>` : null}
  </div>`;
}
export const pairSheet = (code, urls) =>
  openSheet({ title: "Pair a device", Body: PairCode, props: { code, urls } });
const pairOther = async () => {
  try {
    const r = await newPairCode();
    pairSheet(r.code, [syncConfig().url]);
  } catch (e) {
    toast(e.message);
  }
};
function Sync() {
  useCols("config");
  useMods();
  const st = useSync(),
    cfg = syncConfig();
  const own = ownServer();
  const [url, setUrl] = useState(cfg.url || own),
    [tok, setTok] = useState(() => (cfg.on ? cfg.token : hashPair() || cfg.token)),
    [msg, setMsg] = useState("");
  useEffect(() => {
    if (hashPair()) dropHashPair();
    const f = () => {
      const c = syncConfig();
      if (c.on) {
        setUrl(c.url);
        setTok(c.token);
      }
    };
    addEventListener("os-sync-cfg", f);
    return () => removeEventListener("os-sync-cfg", f);
  }, []);
  const go = async () => {
    setMsg("Connecting…");
    setMsg((await connectWith(url.trim(), tok)) || "");
  };
  return html`<${Tools}>
      <${Field} w="w" placeholder="Server address (https://laptop.xxxx.ts.net)" aria-label="Server address" value=${url} onInput=${e => setUrl(e.target.value)}/>
      <${Field} w="w" type="password" placeholder="Pairing code or token" aria-label="Pairing code or token" autocomplete="off" value=${tok} onInput=${e => setTok(e.target.value)} onEnter=${go}/>
      ${cfg.on ? html`<${Btn} onClick=${disconnect}>Turn off<//><${Btn} onClick=${pairOther}>Pair another device<//><${Btn} go icon="reset" onClick=${syncNow}>Sync now<//>` : html`<${Btn} go onClick=${go}>Connect<//>`}
    <//>
    <${Panel}><div class="ll">
      <${Group} title="Status"/>
      <div class="lr"><span class="tt">${cfg.on ? { ok: "Up to date", syncing: "Syncing…", offline: "Offline: will sync when you're back online", error: "Problem: " + st.err, off: "Starting…" }[st.state] : "Sync is off. Data stays on this device."}</span></div>
      ${msg ? html`<div class="lr late"><span class="tt">${msg}</span></div>` : null}
      <div class="lr"><span class="when" style="min-width:90px">Last sync</span><span class="tt">${ago(st.last)}</span></div>
      <div class="lr"><span class="when" style="min-width:90px">Waiting to send</span><span class="tt">${st.pending}</span></div>
      <div class="lr"><span class="when" style="min-width:90px">App build</span><span class="tt">${BUILD}</span><${Btn} onClick=${() => checkUpdate({ quiet: false })}>Check for updates<//></div>
      <${UpdRow}/>
      <${Host}/>
      ${cfg.on ? html`<${Updates}/>` : null}
      ${cfg.on && featOn("moodle") ? html`<${Moodle}/>` : null}
    </div><//>
`;
}

/* the server's own updates (server/updates.py): hidden where the server is updated another way (a server that deploys from git) */
function Updates() {
  const [s, setS] = useState(null),
    [busy, setBusy] = useState(false);
  const load = () => api("/api/update/status", {}).then(setS, () => setS(null));
  useEffect(() => {
    load();
  }, []);
  if (!s || !s.enabled) return null;
  const call = async (path, body = {}) => {
    setBusy(true);
    try {
      setS(await api(path, body));
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };
  const install = async () => {
    setBusy(true);
    try {
      const r = await api("/api/update/apply", {});
      setS(r);
      if (r.state === "restarting") {
        for (let i = 0; i < 30; i++) {
          await new Promise(x => setTimeout(x, 1500));
          try {
            const q = await api("/api/update/status", {});
            if (q.state !== "restarting") {
              setS(q);
              break;
            }
          } catch {
            // the server is still restarting
          }
        }
      }
      if (!r.err) toast("The server is up to date");
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };
  const st =
    s.state === "downloading"
      ? "Downloading…"
      : s.state === "installing"
        ? "Installing…"
        : s.state === "restarting"
          ? "Restarting…"
          : s.newer
            ? "Update " + s.latest + " is ready"
            : s.latest
              ? "Up to date"
              : "Not checked yet";
  const row = (k, v, btn, cls = "") =>
    html`<div class=${"lr " + cls}><span class="when" style="min-width:90px">${k}</span><span class="tt">${v}</span>${btn || null}</div>`;
  const aside = s.set_aside || [];
  return html`${row("Server", html`${st}<small class="selectable">${s.build}</small>`, s.newer ? html`<${Btn} go disabled=${busy} onClick=${install}>Install now<//>` : html`<${Btn} icon="reset" disabled=${busy} onClick=${() => call("/api/update/check")}>Check<//>`, "hostsw")}
    <div class="lr hostsw"><${Check} on=${s.auto} label="Install server updates by themselves" onClick=${() => call("/api/update/set", { auto: !s.auto })}/><span class="tt">Install updates by themselves<small>Checked every 6 hours. Your own app changes are put back on top.</small></span></div>
    ${s.err ? row("", s.err, null, "late") : null}
    ${s.newer && !s.code_ok ? row("", "This update needs a newer server program for its server part; the app part still installs.", null, "late") : null}
    ${s.code_failed ? row("", "The server part of " + s.code_failed + " didn't start, so the previous one is still running.", html`<${Btn} onClick=${() => call("/api/update/set", { dismiss: true })}>OK<//>`, "late") : null}
    ${aside.length ? row("Set aside", html`Your changes that no longer fit the new version: ${aside.join(", ")}`, html`<${Btn} onClick=${() => import("./app-changes.js").then(m => m.openChanges())}>Open<//><${Btn} onClick=${() => call("/api/update/set", { dismiss: true })}>OK<//>`, "late") : null}`;
}

/* Host sync on this computer (desktop app): src-tauri/src/host.rs runs the bundled server; this shows where other devices
   reach it and pairs them. Hidden on phones, in browsers and in installs without the server. */
const T = () => window.__TAURI_INTERNALS__;
const hostCall = (c, a) =>
  T() && T().invoke && !/Android/i.test(navigator.userAgent)
    ? T().invoke(c, a)
    : Promise.reject(new Error("no host"));
const here = p => "http://127.0.0.1:" + p;
const hostApi = (h, path) =>
  fetch(here(h.port) + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + h.token, "Content-Type": "application/json" },
    body: "{}",
  }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Server answered " + r.status);
    return j;
  });
const up = async h => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(here(h.port) + "/api/ping");
      if (r.status === 401 || r.ok) return true;
    } catch {
      // no server on that port yet
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
};
const openLink = u => {
  try {
    openExternal(u);
  } catch (e) {
    warn("open link", e);
  }
};
const addrs = inf => {
  const t = inf.tailscale || {};
  return [t.https, t.ip, ...(inf.lan || [])].filter(Boolean);
};

function TsGuide({ h, inf, reload }) {
  const [t, setT] = useState((inf && inf.tailscale) || {});
  const again = async () => {
    const r = await reload();
    if (r) setT(r.tailscale || {});
  };
  const share = async () => {
    try {
      const r = await hostApi(h, "/api/host/share");
      if (r.enable) {
        openLink(r.enable);
        toast("Turn on HTTPS on that page, then tap this again");
      } else {
        toast("Phones can use " + r.https);
        again();
      }
    } catch (e) {
      toast(e.message);
    }
  };
  const step = (txt, btn, done) =>
    html`<li class=${done ? "done" : ""}><span>${txt}</span>${btn || null}</li>`;
  return html`<ol class="tsg">
    ${step("Install Tailscale on this computer and on your phone, and sign in with the same account on both. It's free for personal use.", html`<${Btn} icon="globe" onClick=${() => openLink("https://tailscale.com/download")}>Get Tailscale<//>`, t.running)}
    ${step(t.running ? "Tailscale is on: " + (t.name || t.ip || "").replace(/^https?:\/\//, "") : "Then come back here.", html`<${Btn} icon="reset" onClick=${again}>Check again<//>`, t.running)}
    ${step(t.https ? "https is on: " + t.https.replace(/^https:\/\//, "") : "Turn on https, so the phone app and the installed web app work wherever you are.", t.https ? null : html`<${Btn} go disabled=${!t.running} onClick=${share}>Turn on https<//>`, !!t.https)}
    ${step("If Windows asks whether toybox-server may use the network, allow it on private networks.", null, false)}
  </ol>`;
}

function Host() {
  const cfg = syncConfig();
  const [h, setH] = useState(null),
    [inf, setInf] = useState(null),
    [busy, setBusy] = useState(false);
  const info = s =>
    hostApi(s, "/api/host/info").then(
      r => {
        setInf(r);
        return r;
      },
      () => {
        setInf(null);
        return null;
      },
    );
  const load = () =>
    hostCall("host_status").then(
      async s => {
        setH(s);
        if (s.running && (await up(s))) info(s);
      },
      () => setH(false),
    );
  useEffect(() => {
    load();
  }, []);
  if (!h) return null;
  const mine = cfg.on && cfg.url === here(h.port);
  const useHere = async s => {
    const e = await connect({ url: here(s.port), token: s.token });
    toast(e || "This device syncs with this computer now");
  };
  const flip = async () => {
    setBusy(true);
    try {
      const s = await hostCall("host_set", { on: !h.on });
      setH(s);
      if (s.err) toast(s.err);
      else if (s.running) {
        if (!(await up(s))) toast("The server didn't start");
        else {
          await info(s);
          if (!syncConfig().on) await useHere(s);
        }
      } else setInf(null);
    } catch (e) {
      toast(e.message);
    }
    setBusy(false);
  };
  const pair = async () => {
    try {
      const r = await hostApi(h, "/api/pair/new");
      pairSheet(r.code, inf ? addrs(inf) : [here(h.port)]);
    } catch (e) {
      toast(e.message);
    }
  };
  const guide = () =>
    openSheet({ title: "Reach it from anywhere", Body: TsGuide, props: { h, inf, reload: () => info(h) } });
  const t = (inf && inf.tailscale) || {};
  const row = (k, v, btn) =>
    html`<div class="lr"><span class="when" style="min-width:90px">${k}</span><span class="tt selectable">${v}</span>${btn || null}</div>`;
  return html`<${Group} title="This computer" meta=${h.running ? "hosting" : ""}/>
    <div class="lr hostsw"><${Check} on=${h.on} label="Host sync on this computer" onClick=${busy || !h.available ? null : flip}/>
      <span class="tt">Host sync on this computer<small>${!h.available ? "This install has no server built in." : "Your other devices sync through this PC while the app is open or in the tray."}</small></span></div>
    ${h.err ? html`<div class="lr late"><span class="tt">${h.err}</span></div>` : null}
    ${
      h.running && inf
        ? html`
      ${inf.lan.length ? row("Same Wi-Fi", inf.lan[0].replace(/^http:\/\//, "")) : null}
      ${row(
        "Tailscale",
        t.https
          ? t.https.replace(/^https:\/\//, "")
          : t.ip
            ? t.ip.replace(/^http:\/\//, "") + " (no https yet)"
            : t.installed
              ? "installed, not signed in"
              : "not set up",
        html`<${Btn} onClick=${guide}>${t.https ? "Help" : "Set up"}<//>`,
      )}
      <div class="lr"><span class="when" style="min-width:90px"></span><${Btn} go icon="plus" onClick=${pair}>Pair a device<//>
        ${mine ? null : html`<${Btn} onClick=${() => useHere(h)}>Sync this device with it<//>`}</div>`
        : h.running
          ? row("Status", "Starting…")
          : null
    }`;
}

/* Moodle for the assistant: the sign-in happens only in a private terminal on the server, never in the app */
function Moodle() {
  const [s, setS] = useState(null);
  const check = () => {
    setS({ busy: 1 });
    api("/api/moodle", { action: "status" }).then(setS, e => setS({ err: e.message }));
  };
  useEffect(check, []);
  const row = (k, v, btn) =>
    html`<div class="lr"><span class="when" style="min-width:90px">${k}</span><span class="tt selectable">${v}</span>${btn || null}</div>`;
  return html`<${Group} title="Moodle"/>
    ${
      !s || s.busy
        ? row("Moodle", "Checking…")
        : s.err
          ? row("Moodle", "Problem: " + s.err, html`<${Btn} icon="reset" onClick=${check}>Check<//>`)
          : s.connected
            ? row(
                s.label || "Moodle",
                `Connected as ${s.name}${s.downloadfiles ? "" : " (file downloads off)"}`,
                html`<${Btn} icon="reset" onClick=${check}>Check<//>`,
              )
            : row(
                "Moodle",
                html`Not connected<small class="selectable">python3 moodle_setup.py</small>`,
                html`<${Btn} icon="nijika" onClick=${() => openMod("nijika", true)}>Terminal<//><${Btn} icon="reset" onClick=${check}>Check<//>`,
              )
    }`;
}
export default {
  id: "sync",
  name: "Sync",
  title: "sync",
  Comp: Sync,
  cmd: v => (v === "sync" ? [{ icon: "reset", l: "Sync now", r: syncNow }] : []),
};
