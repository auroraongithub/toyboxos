/* the playful layer: ticker, mascot window, click notes, easter eggs */
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { on as featOn } from "../core/features.js";
import { html, today, dkey, fmt, dayLabel, timeLabel, rangeLabel, money, TZ } from "../core/lib.js";
import { usePref } from "../core/pref.js";
import { useCols, D, calItems, toPHP, fxNote } from "../core/store.js";
import { Window, Icon, AppIcon } from "../ui/index.js";
import { SyncDot } from "./syncdot.js";
import { UpdDot } from "./updlight.js";
import { openMod } from "./os.js";
import { DEFAULT_NAME, useBrand } from "../brand.js";
import { pack, ART, AI } from "../core/pack.js";

import { home } from "../core/profile.js";
/* the pack's flush egg; with none, flush() does nothing and no trigger fires */
const EGG = pack.eggs && pack.eggs.flush;
export const flush = () => {
  if (EGG) window.dispatchEvent(new Event("os-flush"));
};
export const rename = () => window.dispatchEvent(new Event("os-rename"));

/* ---- ticker text, built from your own data ---- */
/* endless strip: the message is repeated until one half is wider than the banner, two identical halves slide by exactly one half, so the loop never shows a gap or a jump */
function Ticker({ txt }) {
  const box = useRef(),
    unit = useRef(),
    [n, setN] = useState(4),
    [dur, setDur] = useState(40);
  useLayoutEffect(() => {
    const f = () => {
      const b = box.current,
        u = unit.current;
      if (!b || !u) return;
      const w = u.getBoundingClientRect().width / Math.max(1, n);
      if (!w) return;
      const need = Math.max(2, Math.ceil((b.clientWidth + 40) / w));
      if (need !== n) setN(need);
      setDur(Math.max(12, Math.round((w * need) / 48)));
    };
    f();
    const ro = new ResizeObserver(f);
    ro.observe(box.current);
    document.fonts && document.fonts.ready && document.fonts.ready.then(f);
    return () => ro.disconnect();
  }, [txt, n]);
  const half = r =>
    html`<span class="tk" ref=${r}>${Array.from({ length: n }, () => txt + "   ◆   ").join("")}</span>`;
  return html`<div class="tick" ref=${box} aria-hidden="true"><div class="tkt" style=${"--tkd:" + dur + "s"}>${half(unit)}${half(null)}</div></div>`;
}
/* only things Today's page doesn't already show (it has next, jobs, habits, doing) */
function useTicker() {
  useCols("tx", "config");
  const h =
    +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()) %
    24;
  const hi = h < 5 ? "still up?" : h < 12 ? "good morning" : h < 18 ? "good afternoon" : "good evening";
  const out = [
    "★ " + hi + " ★",
    fmt(new Date(), { weekday: "long", month: "long", day: "numeric" }).toLowerCase(),
  ];
  const mk = today().slice(0, 7),
    spent = D.tx
      .filter(x => x.type === "out" && (x.date || "").slice(0, 7) === mk)
      .reduce((a, x) => a + toPHP(x.amt, x.cur), 0);
  if (spent) out.push(money(spent, home()) + " spent this month");
  out.push(fxNote());
  return out.join("   ◆   ");
}

/* ---- banner: name (double-click to rename), ticker, clickable face ---- */
export function Banner({ onMenu }) {
  const [th] = usePref("os-theme", null);
  const art = (th && th.on && th.banner) || ART.banner;
  const [name, setName] = useBrand();
  const [ed, setEd] = useState(false),
    [v, setV] = useState(name);
  const [notes, setNotes] = useState([]),
    clicks = useRef({ n: 0, t: 0 });
  const txt = useTicker();
  useEffect(() => {
    const f = () => {
      setV(name);
      setEd(true);
    };
    window.addEventListener("os-rename", f);
    return () => window.removeEventListener("os-rename", f);
  }, [name]);
  useEffect(() => {
    document.title = name;
  }, [name]);
  const save = () => {
    setEd(false);
    const t = v.trim().slice(0, 24);
    setName(t || DEFAULT_NAME);
  };
  const poke = e => {
    const r = e.currentTarget.getBoundingClientRect(),
      id = Date.now() + Math.random();
    setNotes(n => [
      ...n.slice(-6),
      {
        id,
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        c: ["♪", "♫", "★", "♬"][Math.floor(Math.random() * 4)],
      },
    ]);
    setTimeout(() => setNotes(n => n.filter(q => q.id !== id)), 1400);
    const c = clicks.current,
      now = Date.now();
    c.n = now - c.t < 900 ? c.n + 1 : 1;
    c.t = now;
    if (c.n >= 7) {
      c.n = 0;
      flush();
    }
  };
  return html`<header class=${"banner" + (art ? "" : " noart")}>${art ? html`<img src=${art} alt=""/>` : null}
    <div class="bn">${
      ed
        ? html`<input class="bnin" value=${v} maxlength="24" aria-label="Name" ref=${r => r && r.focus()} onInput=${e => setV(e.target.value)} onBlur=${save} onKeyDown=${e => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEd(false);
          }}/>`
        : html`<b title="Double-click to rename" onDblClick=${() => {
            setV(name);
            setEd(true);
          }}>${name}</b>`
    }</div>
    ${ART.bannerFace ? html`<img class="bn-face" src=${ART.bannerFace} alt="" onClick=${poke}/>` : null}
    ${notes.map(n => html`<span class="spark" key=${n.id} style=${"left:" + n.x + "px;top:" + n.y + "px"}>${n.c}</span>`)}
    <div class="bnr"><button class="bnai bns" aria-label="Search" title="Search or run a command" onClick=${e => {
      e.stopPropagation();
      dispatchEvent(new Event("os-cmd"));
    }}><${Icon} n="search"/></button>${
      featOn("ai")
        ? html`<button class="bnai" aria-label=${AI.name} title=${AI.name} onClick=${e => {
            e.stopPropagation();
            openMod("buddy", true);
          }}><${AppIcon} id="buddy" n="buddy"/></button>`
        : null
    }
    <button class="bnm" aria-label="Menu and settings" title="Menu" onClick=${e => {
      e.stopPropagation();
      onMenu && onMenu();
    }}>${ART.logo ? html`<img class="bnlogo" src=${ART.logo} alt=""/>` : null}<span>menu</span><${UpdDot}/><${SyncDot} cls="in" onClick=${e => {
      e.stopPropagation();
      openMod("sync", true);
    }}/></button></div>
    <${Ticker} txt=${txt}/>
  </header>`;
}

/* ---- mascot window: click for the next picture, she sometimes talks ---- */
export function Mascot() {
  const PICS = pack.mascot ? pack.mascot.pics : [],
    SAY = (pack.mascot && pack.mascot.say) || [];
  const [i, setI] = useState(0),
    [say, setSay] = useState(""),
    n = useRef(0);
  const t = useRef();
  const next = () => {
    n.current++;
    if (n.current % 9 === 0) {
      flush();
      return;
    }
    let j = 0;
    if (PICS.length > 1)
      do {
        j = Math.floor(Math.random() * PICS.length);
      } while (j === i);
    setI(j);
    if (SAY.length) setSay(SAY[Math.floor(Math.random() * SAY.length)]);
    clearTimeout(t.current);
    t.current = setTimeout(() => setSay(""), 2600);
  };
  const p = PICS[i] || PICS[0];
  if (!p) return null;
  return html`<${Window} id="side1" mod=${false} cls="wit-win" title=${p.name} onClose=${() => {}}>
    ${ART.mascotPeek ? html`<img class="pop out" src=${ART.mascotPeek} alt=""/>` : null}
    <div class="body"><button class="picbtn" onClick=${next} aria-label="Next picture" title="Poke"><img class="me pic" src=${p.src} alt=${pack.mascot.alt} style=${p.bg ? "background:" + p.bg : ""}/></button>
      ${say ? html`<div class="say">${say}</div>` : null}</div>
  <//>`;
}

/* ---- toilet easter egg: rises, flushes, leaves ---- */
export function Flusher() {
  const [st, setSt] = useState(0);
  useEffect(() => {
    let timers = [];
    const go = () => {
      timers.forEach(clearTimeout);
      setSt(1);
      timers = [setTimeout(() => setSt(2), 1500), setTimeout(() => setSt(0), 3000)];
    };
    const keys = [
      "ArrowUp",
      "ArrowUp",
      "ArrowDown",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
      "b",
      "a",
    ];
    let k = 0;
    const kd = e => {
      const w = keys[k];
      k = e.key === w || e.key.toLowerCase() === w ? k + 1 : e.key === keys[0] ? 1 : 0;
      if (k === keys.length) {
        k = 0;
        go();
      }
    };
    window.addEventListener("os-flush", go);
    window.addEventListener("keydown", kd);
    return () => {
      window.removeEventListener("os-flush", go);
      window.removeEventListener("keydown", kd);
      timers.forEach(clearTimeout);
    };
  }, []);
  if (!st) return null;
  return html`<div class=${"flush s" + st} aria-hidden="true">${ART.egg ? html`<img src=${ART.egg} alt=""/>` : null}<b>${st === 2 ? EGG.text || "flush." : "..."}</b></div>`;
}
