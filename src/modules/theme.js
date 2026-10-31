/* Theme editor (extra window, Start > Theme editor / command "theme"): colours, fonts, wallpaper, banner art,
   export/import as JSON. Edits apply live through shell/theme.js. */
import { useState, useRef, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { usePref, ls } from "../core/pref.js";
import { toast } from "../core/bus.js";
import { Tools, Panel, Btn, Select, Group, Seg, Tabs } from "../ui/index.js";
import { ArtTab, BadgeTab, AssistantTab } from "./lookedit.js";
import { IconTab } from "./iconedit.js";
import { PacksTab, keepPack } from "./packs.js";
import { exportPack, importPack, look, setLook } from "../core/look.js";
import { FEATURES, wanted, setWanted, on as featOn } from "../core/features.js";
import { actionSheet, askText } from "../ui/sheet.js";
import { SKINS, applySkin } from "../shell/skins.js";
import { openMod } from "../shell/os.js";
import {
  TOKENS,
  G,
  GROUPS,
  FONTS,
  FITS,
  blank,
  clean,
  setTheme,
  applyTheme,
  toHex,
  shrink,
  randomize,
  fromColour,
  STRENGTH,
  SEEDS,
  contrast,
  PAIRS,
  shade,
  lum,
} from "../shell/theme.js";

/* a pack file: look (core/look.js) + theme + module defaults; also used by Setup. Returns the pack's fields and an undo */
export async function applyPack(o) {
  const old = look(),
    oldT = ls.get("os-theme", null),
    r = await importPack(o);
  if (r.theme) {
    const th = clean(r.theme);
    setTheme(() => th);
    applySkin(th.base, true);
    applyTheme();
  }
  if (r.modules)
    for (const f of FEATURES)
      if (typeof r.modules[f.id] === "boolean") await setWanted(f.id, r.modules[f.id]);
  return {
    r,
    undo: () => {
      setLook(old);
      setTheme(() => oldT || { ...blank(), on: false });
      applyTheme();
    },
  };
}
/* the value the base skin gives a token right now (custom layer switched off for the read) */
function skinValues(base) {
  const r = document.documentElement,
    had = "custom" in r.dataset,
    sk = r.dataset.skin;
  delete r.dataset.custom;
  r.dataset.skin = base;
  const cs = getComputedStyle(r),
    out = {};
  for (const [k] of TOKENS) out[k] = toHex(cs.getPropertyValue(k));
  out.btn = toHex(cs.getPropertyValue("--btn"));
  out.cap = toHex(cs.getPropertyValue("--cap"));
  out.tbg = toHex(cs.getPropertyValue("--tbg"));
  out.on = toHex(cs.getPropertyValue("--btn-on"));
  r.dataset.skin = sk;
  if (had) r.dataset.custom = "";
  return out;
}

/* where each colour shows up (row tooltip + the faint second line in Every colour) */
const HINT = {
  "--desk": "Behind the windows",
  "--face": "Window frames, toolbars",
  "--face-2": "Toolbar and header strips",
  "--paper": "Lists, pages, inputs",
  "--alt": "Every other list row",
  "--hover": "Rows under the pointer",
  "--code": "Code blocks, inline code",
  "--ink": "Main text",
  "--ink-2": "Secondary text, labels",
  "--ink-3": "Hints, dates, placeholders",
  "--on-dark": "Text on title bars and selections",
  "--frame": "Outer window and button outlines",
  "--edge": "Dark bevel side",
  "--edge-2": "Input and panel borders",
  "--line": "Row dividers",
  "--line-2": "Table and grid lines",
  "--hi": "Light bevel side",
  "--sel": "Selected rows, open items",
  "--dark": "Dark strips and badges",
  "--mark": "Highlighted text",
  "--danger": "Delete, errors, overdue",
  "--pink": "Small decorations",
  tbg: "Bottom bar",
  cap: "Window title bars",
  btn: "Button face",
  on: "Pressed buttons, active tabs",
};

function Swatch({ label, value, set, changed, reset, hint, warn }) {
  return html`<label class=${"thr" + (changed ? " ch" : "") + (warn ? " bad" : "")} title=${warn || hint || ""}>
    <input type="color" value=${value} onInput=${e => set(e.target.value)} aria-label=${label}/>
    <span class="thl2">${label}${warn ? html`<b class="thw">${warn}</b>` : hint ? html`<small>${hint}</small>` : null}</span>
    <input class="field thx" value=${value} maxlength="7" spellcheck="false" aria-label=${label + " hex"}
      onChange=${e => {
        const v = e.target.value.trim();
        if (/^#?[0-9a-f]{6}$/i.test(v)) set((v[0] === "#" ? v : "#" + v).toLowerCase());
        else e.target.value = value;
      }}/>
    ${
      changed
        ? html`<button class="thz" title="Back to the skin's colour" aria-label=${"Reset " + label} onClick=${e => {
            e.preventDefault();
            reset();
          }}>×</button>`
        : html`<i class="thz"/>`
    }
  </label>`;
}

function Img({ label, src, onPick, onClear, children }) {
  const fi = useRef();
  return html`<div class="thimg">
    <span class="thsub">${label}</span>
    <div class="thpv">${src ? html`<img src=${src} alt=""/>` : html`<span>${label === "Wallpaper" ? "Skin pattern" : "Default art"}</span>`}</div>
    <div class="thib">
      <${Btn} onClick=${() => fi.current.click()}>Choose image…<//>
      ${src ? html`<${Btn} onClick=${onClear}>Remove<//>` : null}
      ${children}
      <input ref=${fi} type="file" accept="image/*" hidden onChange=${async e => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f)
          try {
            await onPick(f);
          } catch (err) {
            toast(err.message);
          }
      }}/>
    </div>
  </div>`;
}

export function shuffle(setBase) {
  const old = randomize();
  setBase && setBase(ls.get("os-theme", null).base);
  toast("Random theme", {
    label: "Undo",
    run: () => {
      setTheme(() => old || { ...blank(), on: false });
      applyTheme();
      setBase && setBase((old || blank()).base);
    },
  });
}

/* text that fails PAIRS: nudge the text toward black/white (for white-on-colour, the background away from white) */
function fixPair([fg, bg, min], val) {
  const a = val(fg),
    b = val(bg),
    onDark = fg === "--on-dark",
    move = onDark ? b : a,
    dir = lum(onDark ? a : b) > 0.5 ? -1 : 1;
  for (let f = 0.08; f <= 1; f += 0.08) {
    const c = shade(move, dir * f);
    if (contrast(onDark ? a : c, onDark ? c : b) >= min) return [onDark ? bg : fg, c];
  }
  return [onDark ? bg : fg, dir < 0 ? "#000000" : "#ffffff"];
}

function Theme() {
  const [t0] = usePref("os-theme", null);
  const t = t0 || blank();
  const BPOS = { x: 50, y: 30, z: 1 },
    bpos = { ...BPOS, ...t.bpos };
  const fi = useRef();
  const [foc, setFoc] = usePref("os-theme-focus", "");
  useEffect(() => {
    if (foc !== "pics") return;
    setFoc("");
    for (const ms of [120, 400]) {
      setTimeout(() => {
        const p = document.querySelector(".thpics");
        if (p) p.scrollIntoView({ block: "center" });
      }, ms);
    }
  }, [foc]);
  const [m0, setMode] = usePref("os-theme-mode", "simple");
  const mode = m0 === "advanced" ? "advanced" : "simple";
  const [base, setBase] = useState(t.base);
  const [tab, setTab] = usePref("os-theme-tab", "colours");
  const sv = skinValues(t.base);
  const val = k => t.vars[k] || sv[k];
  const up = f => setTheme(x => ({ ...x, on: true, ...f(x) }));
  const setVar = (k, v) => up(x => ({ vars: { ...x.vars, [k]: v } })),
    unVar = k =>
      up(x => {
        const v = { ...x.vars };
        delete v[k];
        return { vars: v };
      });
  const setG = (k, v) => up(x => ({ g: { ...x.g, [k]: v } })),
    unG = k =>
      up(x => {
        const g = { ...x.g };
        delete g[k];
        return { g };
      });
  const n =
    Object.keys(t.vars).length +
    Object.keys(t.g).length +
    ["font", "title", "bfont", "banner"].filter(k => t[k]).length +
    (t.wall ? 1 : 0);
  const undoTo = (old, msg) =>
    toast(msg, {
      label: "Undo",
      run: () => {
        setTheme(() => old || { ...blank(), on: false });
        applyTheme();
        setBase((old || blank()).base);
      },
    });

  /* easy mode: one colour (+ light/dark, strength) writes every token; highlighter/danger/pink set by hand survive */
  const seed = t.seed || {
    c: (SKINS.find(s => s[0] === t.base) || SKINS[0])[2],
    dark: t.base === "night",
    k: "normal",
  };
  const gen = s => {
    const o = fromColour(s.c, s.dark, s.k);
    up(x => {
      const keep = {};
      for (const k of ["--mark", "--danger", "--pink"]) if (x.vars[k]) keep[k] = x.vars[k];
      return { base: o.base, vars: { ...keep, ...o.vars }, g: o.g, seed: s };
    });
    setBase(o.base);
  };
  const skin = k => {
    const old = t0;
    up(() => ({ base: k, vars: {}, g: {}, seed: null }));
    setBase(k);
    undoTo(old, "Skin: " + SKINS.find(s => s[0] === k)[1]);
  };
  const plain = !Object.keys(t.vars).length && !Object.keys(t.g).length;

  const exp = () => {
    const s = JSON.stringify({ toybox_theme: 1, ...t }, null, 1),
      b = new Blob([s], { type: "application/json" }),
      u = URL.createObjectURL(b),
      l = document.createElement("a");
    l.href = u;
    l.download = "toybox-theme.json";
    l.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  const copy = () =>
    navigator.clipboard.writeText(JSON.stringify({ toybox_theme: 1, ...t })).then(
      () => toast("Theme copied"),
      () => toast("Couldn't copy"),
    );
  /* one pack file: theme + art + badges + assistant + module defaults (core/look.js) */
  const save = (s, n) => {
    const b = new Blob([s], { type: "application/json" }),
      u = URL.createObjectURL(b),
      l = document.createElement("a");
    l.href = u;
    l.download = n;
    l.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  const expPack = async () => {
    toast("Packing…");
    const mods = {};
    for (const f of FEATURES) mods[f.id] = wanted(f.id);
    save(JSON.stringify(await exportPack({ theme: t0, modules: mods })), "toybox-pack.json");
  };
  const loadPack = async o => {
    const oldT = t0;
    try {
      const { r, undo } = await applyPack(o);
      if (r.theme) setBase(clean(r.theme).base);
      keepPack(o, r.name)
        .then(id => setLook({ pack: id }))
        .catch(() => {});
      toast("Pack loaded", {
        label: "Undo",
        run: () => {
          undo();
          setBase((oldT || blank()).base);
        },
      });
    } catch (e) {
      toast(e.message || "That isn't a toybox pack file");
    }
  };
  const load = s => {
    let j;
    try {
      j = JSON.parse(s);
    } catch (e) {
      toast("That isn't a toybox file");
      return;
    }
    if (j && j.toybox_pack) return loadPack(j);
    try {
      const o = clean(j);
      const old = t0;
      setTheme(() => o);
      setBase(o.base);
      applySkin(o.base, true);
      applyTheme();
      undoTo(old, "Theme loaded");
    } catch (e) {
      toast("That isn't a toybox theme");
    }
  };
  const reset = () => {
    const old = t0;
    setTheme(() => ({ ...blank(), base: t.base }));
    undoTo(old, "Theme reset to " + ((SKINS.find(s => s[0] === t.base) || [])[1] || "the skin"));
  };
  const more = e =>
    actionSheet(
      "Theme",
      [
        ["export", "Export pack (everything)", expPack],
        ["export", "Export theme only", exp],
        ["edit", "Copy theme as text", copy],
        "-",
        ["plus", "Import pack or theme…", () => fi.current.click()],
        [
          "edit",
          "Paste theme text…",
          () =>
            askText({ title: "Paste a theme", multi: true, value: "", ok: "Load" }).then(s => s && load(s)),
        ],
        "-",
        [
          t.on ? "applied" : "",
          t.on ? "Custom theme: on" : "Custom theme: off",
          () => {
            setTheme(x => ({ ...x, on: !x.on }));
          },
        ],
        ["reset", "Reset to the skin", reset],
      ],
      e.currentTarget,
    );

  /* readability check over the current values, shown in both modes */
  const bad = t.on ? PAIRS.filter(([a, b, m]) => contrast(val(a), val(b)) < m) : [];
  const warnOf = k => {
    const p = bad.find(x => x[0] === k) || bad.find(x => x[0] === "--on-dark" && x[1] === k);
    return p
      ? "Hard to read " +
          (p[0] === k ? p[3] : "under white text") +
          " (" +
          contrast(val(p[0]), val(p[1])).toFixed(1) +
          ":1)"
      : "";
  };
  const fixAll = () => {
    const old = t0,
      vars = { ...t.vars },
      v = k => vars[k] || sv[k];
    for (const p of PAIRS)
      if (contrast(v(p[0]), v(p[1])) < p[2]) {
        const [k, c] = fixPair(p, v);
        vars[k] = c;
      }
    up(() => ({ vars }));
    undoTo(old, "Text made readable");
  };

  const adv = mode === "advanced";
  const row = (k, l) =>
    html`<${Swatch} key=${k} label=${l} value=${val(k)} changed=${!!t.vars[k]} hint=${adv && HINT[k]} warn=${warnOf(k)} set=${v => setVar(k, v)} reset=${() => unVar(k)}/>`;
  const grow = (k, l) =>
    html`<${Swatch} key=${k} label=${l} value=${t.g[k] || sv[k]} changed=${!!t.g[k]} hint=${adv && HINT[k]} set=${v => setG(k, v)} reset=${() => unG(k)}/>`;
  const fonts = html`<div class="thg"><${Group} title="Fonts"/>
    <div class="thfonts">
      ${[
        ["font", "Text"],
        ["title", "Title bars"],
        ["bfont", "Banner name"],
      ].map(
        ([k, l]) => html`<div key=${k}><span class="thsub">${l}</span>
        <${Select} opts=${FONTS} value=${t[k] || ""} onChange=${v => up(() => ({ [k]: v }))}/></div>`,
      )}
    </div></div>`;
  const pics = html`<div class="thg"><${Group} title="Pictures"/>
    <div class="thpics">
      <${Img} label="Wallpaper" src=${t.wall && t.wall.img} onPick=${async f => {
        const img = await shrink(f, 1920);
        up(x => ({ wall: { ...x.wall, img, fit: (x.wall && x.wall.fit) || "cover" } }));
      }} onClear=${() => up(() => ({ wall: null }))}>
        ${t.wall ? html`<${Select} opts=${FITS} value=${t.wall.fit} onChange=${fit => up(x => ({ wall: { ...x.wall, fit } }))}/>
          <div class="thbp">${[
            ["x", "Left / right"],
            ["y", "Up / down"],
          ].map(([k, l]) => html`<label key=${k}><span>${l}</span><input type="range" min="0" max="100" step="1" value=${t.wall[k] == null ? 50 : t.wall[k]} aria-label=${"Wallpaper " + l} onInput=${e => up(x => ({ wall: { ...x.wall, [k]: +e.target.value } }))}/></label>`)}
            <${Btn} onClick=${() => up(x => ({ wall: { ...x.wall, x: 50, y: 50 } }))}>Centre<//></div>` : null}
      <//>
      <${Img} label="Banner" src=${t.banner} onPick=${async f => {
        const banner = await shrink(f, 1400);
        up(() => ({ banner }));
      }} onClear=${() => up(() => ({ banner: "", bpos: undefined }))}>
        ${t.banner ? html`<div class="thbp">${[
          ["z", "Zoom", 1, 4, 0.1],
          ["x", "Left / right", 0, 100, 1],
          ["y", "Up / down", 0, 100, 1],
        ].map(([k, l, lo, hi, st]) => html`<label key=${k}><span>${l}</span><input type="range" min=${lo} max=${hi} step=${st} value=${bpos[k]} aria-label=${"Banner " + l} onInput=${e => up(x => ({ bpos: { ...BPOS, ...x.bpos, [k]: +e.target.value } }))}/></label>`)}
          <${Btn} onClick=${() => up(() => ({ bpos: undefined }))}>Reset framing<//></div>` : null}
      <//>
    </div></div>`;
  const warnBar = bad.length
    ? html`<div class="thbad"><span>${bad.length === 1 ? "Some text is" : bad.length + " text colours are"} hard to read</span><${Btn} onClick=${fixAll}>Fix<//></div>`
    : null;

  /* the picker reads like XP's colour dialog: a big custom swatch beside a grid of basic colours */
  const simple = html`
    <div class="thg"><${Group} title="Colour"/>
      <div class="thpick">
        <div class="thcur">
          <label class="thbig" title="Pick any colour"><input type="color" value=${seed.c} onInput=${e => gen({ ...seed, c: e.target.value })} aria-label="Main colour"/></label>
          <span class="thsub">Custom…</span>
        </div>
        <div class="thbasic">${SEEDS.map(c => html`<button key=${c} style=${"background:" + c} title=${c} aria-label=${"Use " + c} aria-pressed=${String(!!t.seed && t.seed.c === c)} onClick=${() => gen({ ...seed, c })}/>`)}</div>
        <div class="thopt">
          <${Seg}>${[
            [false, "Light"],
            [true, "Dark"],
          ].map(
            ([d, l]) =>
              html`<${Btn} key=${l} aria-pressed=${String(!!t.seed && seed.dark === d)} onClick=${() => gen({ ...seed, dark: d })}>${l}<//>`,
          )}<//>
          <${Seg}>${STRENGTH.map(([k, l]) => html`<${Btn} key=${k} aria-pressed=${String(!!t.seed && seed.k === k)} onClick=${() => gen({ ...seed, k })}>${l}<//>`)}<//>
        </div>
      </div></div>
    <div class="thg"><${Group} title="Skins"/>
      <div class="thsk">${SKINS.map(([k, l, c]) => html`<button key=${k} class="thskin" aria-pressed=${String(t.on && plain && t.base === k)} onClick=${() => skin(k)}><i style=${"background:" + c}/>${l}</button>`)}</div></div>
    <div class="thg"><${Group} title="Adjust" meta=${html`<button class="thmore" onClick=${() => setMode("advanced")}>All colours ›</button>`}/>
      <div class="thgrid thadj">${row("--desk", "Desktop")}${grow("cap", "Title bars")}${grow("tbg", "Taskbar")}${grow("btn", "Buttons")}${row("--sel", "Selection")}${row("--paper", "Content")}</div></div>
    ${fonts}${pics}`;

  const all = html`
    <div class="thr thbase"><span class="thl2">Start from</span>
      <${Select} opts=${SKINS.map(s => [s[0], s[1]])} value=${base} onChange=${k => {
        setBase(k);
        up(() => ({ base: k }));
      }}/></div>
    ${GROUPS.map(
      g => html`<div class="thg" key=${g}><${Group} title=${g}/>
      <div class="thgrid">${TOKENS.filter(x => x[2] === g).map(([k, l]) => row(k, l))}${G.filter(x => x[2] === g).map(([k, l]) => grow(k, l))}</div></div>`,
    )}
    ${fonts}${pics}`;

  const moreBtn = html`<${Btn} icon="more" aria-label="Import, export and reset" title="Import, export, reset" onClick=${more}/>
      <input ref=${fi} type="file" accept=".json,application/json" hidden onChange=${async e => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) load(await f.text());
      }}/>`;
  const tabs = html`<div class="thtabs"><${Tabs} items=${[["packs", "Packs"], ["colours", "Colours"], ["art", "Art & mascot"], ["badges", "Badges"], ["icons", "Icons"], featOn("ai") ? ["assistant", "Assistant"] : null].filter(Boolean)} cur=${tab} onChange=${setTab}/>${moreBtn}</div>`;
  if (tab !== "colours" && (tab !== "assistant" || featOn("ai")))
    return html`${tabs}
    <${Panel} cls="thp lkp">${tab === "packs" ? html`<${PacksTab}/>` : tab === "art" ? html`<${ArtTab}/>` : tab === "badges" ? html`<${BadgeTab}/>` : tab === "icons" ? html`<${IconTab}/>` : html`<${AssistantTab}/>`}<//>`;
  return html`${tabs}<${Tools}>
      <${Seg}>${[
        ["simple", "Simple"],
        ["advanced", "Advanced"],
      ].map(
        ([k, l]) =>
          html`<${Btn} key=${k} aria-pressed=${String(mode === k)} onClick=${() => setMode(k)}>${l}<//>`,
      )}<//>
      <span class="thn">${t.on && n ? n + " change" + (n > 1 ? "s" : "") : ""}</span>
      ${t.on ? null : html`<${Btn} onClick=${() => setTheme(x => ({ ...x, on: true }))}>Turn on<//>`}
      <${Btn} onClick=${() => shuffle(setBase)}>Randomize<//>
    <//>
    <${Panel} cls=${"thp" + (adv ? " thadv" : "")}>${warnBar}${adv ? all : simple}<//>`;
}

export default {
  id: "theme",
  name: "Theme",
  title: "theme editor",
  Comp: Theme,
  cmd: v =>
    /^(art|mascot|badges?|persona|assistant|pack)$/.test(v)
      ? [
          {
            icon: "edit",
            l:
              "Theme editor: " +
              ({
                art: "Art & mascot",
                mascot: "Art & mascot",
                badge: "Badges",
                badges: "Badges",
                pack: "Art & mascot",
              }[v] || "Assistant"),
            r: () => {
              ls.set(
                "os-theme-tab",
                { badge: "badges", badges: "badges", persona: "assistant", assistant: "assistant" }[v] ||
                  "art",
              );
              openMod("theme", true);
            },
          },
        ]
      : /^(theme|themes|colou?rs?|customi[sz]e|wallpaper)$/.test(v)
        ? [
            { icon: "edit", l: "Theme editor", r: () => openMod("theme", true) },
            { icon: "edit", l: "Random theme", r: () => shuffle() },
          ]
        : /^(random|randomi[sz]e|shuffle|surprise)$/.test(v)
          ? [{ icon: "edit", l: "Random theme", r: () => shuffle() }]
          : [],
};
