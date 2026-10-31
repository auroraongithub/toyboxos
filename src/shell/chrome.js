/* shell pieces: banner, side widgets, taskbar, start menu, tab bar, command bar */
import { useState, useEffect, useRef } from "preact/hooks";
import { html, TZ } from "../core/lib.js";
import { ls, usePref, useMedia } from "../core/pref.js";
import { useCols, D, getAdapter, meta } from "../core/store.js";
import { toast, useToast, hideToast, cmdSeed } from "../core/bus.js";
import { SyncDot } from "./syncdot.js";
import { UpdTray, UpdRow } from "./updlight.js";
import { grid as appGrid } from "../ui/appicons.js";
import {
  Icon,
  AppIcon,
  Window,
  resetWindowPositions,
  Btn,
  Field,
  StatusBar,
  Panel,
  tileWindows,
} from "../ui/index.js";
import { liveModules, liveWindows, liveHubs } from "../modules/index.js";
import { useMods, on as featOn } from "../core/features.js";
import { openMod, closeMod, toggleMin, setView, resetWindows } from "./os.js";
import { route } from "./route.js";
import { dragClose } from "../ui/sheet.js";
import { SKINS, applySkin } from "./skins.js";
import { useBrand, DEFAULT_NAME } from "../brand.js";
import { Mascot, flush, rename } from "./fun.js";
import { pack, ART } from "../core/pack.js";
import { tzLabel } from "../core/profile.js";
import { Piece } from "./piece.js";
import { openPhoneList } from "./phonelist.js";
import { openSetup } from "../modules/setup.js";
import { phone, useLayout } from "../core/layout.js";
import { Badge2 } from "./badge2.js";
import { PhoneStickers } from "./stickers.js";
import { setEditing } from "../core/layout.js";
export { ART };

/* 88x31 webring buttons from the pack: each crops a bit of its art via --a/--as/--ap (see .b88 .art in styles/polish.css) */
const lines = t => t.split("\n").flatMap((l, i) => (i ? [html`<br/>`, l] : [l]));
export const Badge = ({ b, name }) =>
  b.v === 2
    ? html`<${Badge2} b=${b} name=${name}/>`
    : html`<span class=${"b88 " + (b.style || "a") + (b.art ? "" : " noart")}>${b.art ? html`<i class="art" style=${"--a:url(" + b.art + ")" + (b.crop && b.crop[0] ? ";--as:" + b.crop[0] : "") + (b.crop && b.crop[1] ? ";--ap:" + b.crop[1] : "")}/>` : null}<span>${lines(b.text.replace("{name}", name))}</span></span>`;
const Badges = ({ name }) =>
  pack.badges && pack.badges.length
    ? html`<div class="badges">${pack.badges.map((b, i) => html`<${Piece} key=${i} id=${"badge:" + i}><${Badge} b=${b} name=${name}/><//>`)}</div>`
    : null;

export const Stand = () =>
  ART.stand
    ? html`<${Piece} id="stand" out><img class="stand" src=${ART.stand} alt="" aria-hidden="true"/><//>`
    : null;
export const Toast = () => {
  const t = useToast();
  return html`<div class=${"toast" + (t ? " on" : "")} id="toast" role="status">${t ? t.m : ""}${
    t && t.act
      ? html`<button class="tact" onClick=${() => {
          hideToast();
          t.act.run();
        }}>${t.act.label || "Undo"}</button>`
      : null
  }</div>`;
};

/* ---- clock (shared by taskbar + side widget) ---- */
const is12 = () => ls.get("os-12h", true) !== false;
export function useClock() {
  const [, t] = useState(0);
  usePref("os-12h", true);
  useEffect(() => {
    const i = setInterval(() => t(n => n + 1), 15000);
    return () => clearInterval(i);
  }, []);
  const n = new Date();
  return {
    time: new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
      hour12: is12(),
    }).format(n),
    date:
      n.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }) +
      (tzLabel() ? " · " + tzLabel() : ""),
    day: n.toLocaleDateString("en-US", { timeZone: TZ, month: "numeric", day: "numeric", year: "numeric" }),
    toggle: () => ls.set("os-12h", !is12()),
  };
}

/* ---- sidebar ---- */
export function Side() {
  useMods();
  const W_ = pack.widgets || {},
    cn = W_.counter && featOn(W_.counter.col) ? W_.counter : null;
  useCols(...(cn ? [cn.col] : []));
  const c = useClock();
  const [name] = useBrand();
  const [clock, setClock] = usePref("os-side-clock", true);
  const mobile = useMedia("(max-width:860px)");
  useLayout();
  /* phones stack these under Today in the order (and with the ones shown) from the phone list */
  const P = mobile ? phone() : { order: ["badges", "clock", "mascot"], hide: {} };
  const part = {
    badges: html`<div class="loose" key="badges">
      <${Badges} name=${name}/>
    </div>`,
    clock:
      clock && W_.clock !== false
        ? html`<${Piece} id="clock"><${Window} id="side0" mod=${false} cls="clock-win" title="clock" onClose=${() => {
            setClock(false);
            toast("Clock hidden (the taskbar has one)", { label: "Undo", run: () => setClock(true) });
          }}>
      ${ART.clockPeek ? html`<img class="pop sit" src=${ART.clockPeek} alt=""/>` : null}
      <div class="body wid"><div class="lcd" style="cursor:pointer" title="Click to switch 12h / 24h" onClick=${c.toggle} aria-label=${"Time in " + TZ.split("/").pop().replace(/_/g, " ")}>${c.time}</div><div class="lcd-s">${c.date}</div>
        ${cn ? html`<div class="cnt"><span>${cn.label}</span><b>${String((D[cn.col] || []).length).padStart(6, "0")}</b></div>` : null}</div>
    <//><//>`
        : null,
    mascot: W_.mascot !== false && pack.mascot ? html`<${Piece} id="mascot"><${Mascot}/><//>` : null,
    stickers: mobile ? html`<${PhoneStickers} key="stickers" hide=${P.hide}/>` : null,
  };
  return html`<aside class="side">${P.order.filter(k => !P.hide[k]).map(k => part[k])}</aside>`;
}

/* ---- taskbar / start menu / tab bar ---- */
export function Taskbar({ openList, minList, onMenu, onCmd }) {
  const c = useClock();
  const [name] = useBrand();
  useMods();
  return html`<nav class="taskbar" aria-label="Taskbar">
    <button class="tbtn start" aria-haspopup="true" aria-label=${"Start: " + name} title=${name} onClick=${e => {
      e.stopPropagation();
      onMenu();
    }}>${ART.logo ? html`<img class="slogo" src=${ART.logo} alt=""/>` : null}</button>
    <div class=${"tasks" + (openList.length > 4 ? " compact" : "")}>${liveWindows()
      .filter(m => openList.includes(m.id))
      .map(
        m =>
          html`<button class="tbtn" key=${m.id} data-win=${m.id} title=${m.name} onClick=${() => {
            if (minList.includes(m.id)) toggleMin(m.id);
            dispatchEvent(new CustomEvent("os-front", { detail: m.id }));
          }}><${AppIcon} id=${m.id} n=${MIC[m.id] || m.id}/><span>${m.name}</span></button>`,
      )}</div>
    <div class="tray"><${UpdTray}/><${SyncDot} onClick=${() => openMod("sync", true)}/><button class="tbtn" onClick=${onCmd} aria-label="Command bar" title="Command bar (Ctrl K)"><${Icon} n="cmd"/></button>
      <button class="clk" title="Switch 12h / 24h" onClick=${c.toggle}><span>${c.time}</span><span>${c.day}</span></button></div>
  </nav>`;
}
/* Osage lives on the banner's bubble button on phones, so the bar keeps five tabs */
export function TabBar({ view, mobile }) {
  useMods();
  return html`<nav class="tabbar" aria-label="Main">
    ${liveHubs()
      .filter(m => m.id !== "buddy")
      .map(
        m =>
          html`<button class="tab-i" key=${m.id} aria-current=${String(mobile && view === m.id)} onClick=${() => openMod(m.id, true)}><${AppIcon} id=${m.id} n=${m.id}/><span>${m.name}</span></button>`,
      )}
  </nav>`;
}
export function StartMenu({ open, close, openList, minList, view, mobile, onCmd }) {
  const [skin] = usePref("os-skin", "gray");
  const [name] = useBrand();
  useMods();
  const bk = () => {
    const a = getAdapter();
    if (!a || !a.exportJSON) {
      toast("Backup is for local data");
      return;
    }
    const b = new Blob([a.exportJSON()], { type: "application/json" }),
      u = URL.createObjectURL(b),
      l = document.createElement("a");
    l.href = u;
    l.download = "toybox-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    l.click();
    URL.revokeObjectURL(u);
  };
  const on = m => (mobile ? view === m.id : openList.includes(m.id) && !minList.includes(m.id));
  const go = f => () => {
    close();
    f();
  };
  /* the right column stays short: the everyday windows, then two flyouts (inline on phones) */
  const groups = {
    look: [
      "Appearance",
      "theme",
      [
        ["theme", "Theme editor", () => openMod("theme", true)],
        mobile
          ? ["layout", "Phone layout", openPhoneList]
          : ["layout", "Edit layout", () => setEditing(true)],
        mobile ? null : ["tile", "Tile windows", tileWindows],
        mobile
          ? null
          : [
              "reset",
              "Reset layout",
              () => {
                resetWindows();
                toast("Layout reset");
              },
            ],
        ["rename", "Rename", rename],
      ],
    ],
    set: [
      "Settings",
      "profile",
      [
        ["profile", "Profile", () => openMod("profile", true)],
        featOn("ai") ? ["models", "Models and keys", () => openMod("models", true)] : null,
        ["reset", "Setup…", openSetup],
        ["export", "Backup", bk],
        ["import", "Restore", () => document.getElementById("restore-in").click()],
      ],
    ],
  };
  const sys = [
    ["cmd", "Command", onCmd],
    ["sync", "Sync", () => openMod("sync", true)],
    featOn("nijika") ? ["nijika", "Home server", () => openMod("nijika", true)] : null,
    featOn("moodle") ? ["moodle", "Moodle", () => openMod("moodle", true)] : null,
  ].filter(Boolean);
  const [fly, setFly] = useState(null); // {k, top} = the open flyout
  useEffect(() => {
    if (!open) setFly(null);
  }, [open]);
  const opener = k => e => {
    const m = e.currentTarget.closest(".startmenu").getBoundingClientRect(),
      r = e.currentTarget.getBoundingClientRect();
    setFly(f => (f && f.k === k && e.type === "click" ? null : { k, top: Math.round(r.top - m.top) }));
  };
  const item = ([i, l, f]) =>
    html`<button class="mi" key=${l} role="menuitem" onClick=${go(f)}><${AppIcon} id=${i} n=${i}/>${l}</button>`;
  const restore = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const n = getAdapter().mergeJSON(await f.text());
      close();
      toast(n ? "Restored " + n + " items from " + f.name : "Nothing new in that backup");
    } catch (err) {
      toast("That file isn't a toybox backup");
    }
  };
  const cur = SKINS.find(x => x[0] === skin) || SKINS[0];
  return html`<div class="smscrim" hidden=${!open} aria-hidden="true"/><div class="startmenu" role="menu" hidden=${!open} onClick=${e => e.stopPropagation()}>
    <div class="grab" aria-hidden="true" ...${dragClose(close)}><i/></div>
    <div class="hd" ...${dragClose(close)}>${ART.avatar ? html`<img class="av" src=${ART.avatar} alt=""/>` : null}${name === DEFAULT_NAME && ART.wordmark ? html`<img class="smwm" src=${ART.wordmark} alt=${name}/>` : html`<b>${name}</b>`}</div>
    <${UpdRow} close=${close}/>
    <div class="sm">
      <div class="apps">${liveHubs().map(m => html`<button class=${"mi" + (on(m) ? " on" : "")} key=${m.id} role="menuitem" onClick=${go(() => openMod(m.id, true))}><${AppIcon} id=${m.id} n=${m.id}/>${m.name}</button>`)}</div>
      <div class="sys" onMouseOver=${e => {
        if (!mobile && !e.target.closest(".smg")) setFly(null);
      }}>${sys.map(item)}<div class="sep"/>
        ${Object.entries(groups).map(
          ([
            k,
            [l, i, its],
          ]) => html`<button key=${k} class=${"mi smg" + (fly && fly.k === k ? " on" : "")} role="menuitem" aria-haspopup="true" aria-expanded=${String(!!fly && fly.k === k)}
            onClick=${opener(k)} onMouseEnter=${mobile ? null : opener(k)}><${AppIcon} id=${i} n=${i}/>${l}<span class="smar">${mobile ? (fly && fly.k === k ? "▴" : "▾") : "▸"}</span></button>
          ${mobile && fly && fly.k === k ? html`<div class="smin">${its.filter(Boolean).map(item)}</div>` : null}`,
        )}
        ${ART.startArt ? html`<img class="smart" src=${ART.startArt} alt=""/>` : null}</div>
    </div>
    ${
      !mobile && fly
        ? html`<div class="smfly" role="menu" style=${"top:" + fly.top + "px"} onMouseLeave=${e => {
            if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".smg"))
              setFly(null);
          }}>${groups[fly.k][2].filter(Boolean).map(item)}</div>`
        : null
    }
    <input id="restore-in" type="file" accept=".json,application/json" hidden onChange=${restore}/>
    <div class="ft"><span class="thl">Theme <b>${cur[1]}</b></span><div class="sws">${SKINS.map(([k, l, c]) => html`<button class="swb" key=${k} aria-pressed=${String(skin === k)} title=${l} aria-label=${l + " theme"} onClick=${() => applySkin(k)}><i style=${"background:" + c}/></button>`)}</div></div>
  </div>`;
}

/* ---- command bar: every module contributes its own verbs via def.cmd ---- */
function buildActs(q) {
  const m = q.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const open = m => ({
    icon: appGrid(m.id) ? m.id : MIC[m.id] || m.id,
    l: "Open " + m.name,
    r: () => openMod(m.id, true),
  });
  const MODULES = liveModules();
  if (!m) return MODULES.map(open);
  const v = m[1].toLowerCase(),
    arg = (m[2] || "").trim(),
    ql = q.trim().toLowerCase();
  const out = route(q);
  if (v === "skin" || SKINS.some(s => s[0].startsWith(v) || s[1].toLowerCase().startsWith(v)))
    SKINS.filter(s =>
      v === "skin"
        ? !arg || s[0].startsWith(arg.toLowerCase())
        : s[0].startsWith(v) || s[1].toLowerCase().startsWith(v),
    ).forEach(s => out.push({ icon: "more", l: "Skin: " + s[1], r: () => applySkin(s[0]) }));
  MODULES.filter(
    mod => mod.name.toLowerCase().includes(ql) || mod.title.includes(ql) || mod.id.includes(ql),
  ).forEach(mod => out.push(open(mod)));
  const egg = pack.eggs && pack.eggs.flush;
  if (egg && (egg.words || []).includes(v)) out.push({ icon: "more", l: egg.text || "flush.", r: flush });
  if (v === "rename") out.push({ icon: "more", l: "Rename this OS", r: rename });
  if (["layout", "arrange", "desktop", "stickers"].includes(v))
    out.push(
      innerWidth > 860
        ? { icon: "layout", l: "Edit layout", r: () => setEditing(true) }
        : { icon: "edit", l: "Phone layout", r: openPhoneList },
    );
  if (v === "setup" || v === "welcome") out.push({ icon: "reset", l: "Setup", r: openSetup });
  if (v === "phone") out.push({ icon: "edit", l: "Phone layout", r: openPhoneList });
  if (innerWidth > 860 && ["tile", "tiles", "arrange"].includes(v))
    out.push({ icon: "tile", l: "Tile windows", r: tileWindows });
  if (ql.length >= 2)
    MODULES.forEach(mod => {
      if (mod.search) out.push(...mod.search(ql));
    });
  return out.slice(0, 10);
}
/* modules whose id isn't an icon name */
const MIC = {
  reminders: "bell",
  timer: "pomodoro",
  gcalc: "calc",
  theme: "edit",
  models: "key",
  profile: "person",
};
export function CmdBar({ open, close }) {
  const [q, setQ] = useState(""),
    [sel, setSel] = useState(0),
    [help, setHelp] = useState(false);
  const inp = useRef();
  useEffect(() => {
    if (open) {
      setQ(cmdSeed.q);
      cmdSeed.q = "";
      setSel(0);
      setHelp(false);
      setTimeout(() => inp.current && inp.current.focus(), 10);
    }
  }, [open]);
  /* the last few things you searched or ran: shown while the box is empty, a tap puts it back in the box */
  const [rec, setRec] = usePref("os-cmd-recent", []);
  const acts = q.trim()
    ? buildActs(q)
    : [...rec.map(t => ({ icon: "clock", l: t, fill: t })), ...buildActs(q)];
  const run = i => {
    const a = acts[i];
    if (!a || a.hint) return;
    if (a.fill) {
      setQ(a.fill);
      setSel(0);
      inp.current && inp.current.focus();
      return;
    }
    const t = q.trim();
    if (t) setRec([t, ...rec.filter(x => x !== t)].slice(0, 6));
    close();
    a.r();
  };
  const key = e => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel(Math.min(acts.length - 1, sel + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel(Math.max(0, sel - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(sel);
    }
  };
  return html`<div class=${"cmd" + (open ? " on" : "")} onClick=${e => {
    if (e.target === e.currentTarget) close();
  }}>
    <section class="win cmdwin" aria-label="Command bar">
      <div class="tb"><span class="t">command</span>
        <span class="cap" role="button" tabindex="0" aria-label="Show examples" title="Examples" style="font:700 13px Georgia,serif;color:#fff" onClick=${() => setHelp(!help)}>i</span>
        <span class="cap x" role="button" tabindex="0" aria-label="Close" onClick=${close}><i/></span></div>
      <div class="tools"><input ref=${inp} class="field cmdin" placeholder="Search everything, or type a command" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command" value=${q} onInput=${e => {
        setQ(e.target.value);
        setSel(0);
      }} onKeyDown=${key}/></div>
      <div class=${"cmdhelp" + (help ? " on" : "")}>${["alarm 1030pm tmrw gym", "remind me to call mom at 5", "note buy milk", "todo fix bug #kira", "spent 250 lunch · earned 5000 ($ for USD)", "event quiz fri 3pm · due report 11-02", "sub netflix 549 · wish keyboard 3500", "pomo · skin teal · any window name"].map(t => html`<div>${t}</div>`)}</div>
      <div class="panel"><div class="ll cmdres" role="listbox">${acts.map(
        (a, i) =>
          html`<button class=${"cr" + (a.hint ? " hint" : "")} role="option" aria-selected=${String(i === sel && !a.hint)} onClick=${() => run(i)} onMouseEnter=${() => {
            if (!a.hint) setSel(i);
          }}>${a.icon ? html`<${AppIcon} id=${a.icon} n=${a.icon}/>` : html`<span class="ic"/>`}${a.l}</button>`,
      )}</div></div>
      <${StatusBar} items=${["↑↓ choose", "Enter run", "Alt+1–6 windows", "Alt+T tile", "Alt+W close"]}/>
    </section></div>`;
}
