/* Pack store (extra window "store": Start > Appearance > Pack store, command "store"/"packs"). Lists the packs in every
   store source (core/packstore.js), shows one with its screenshots and what it would change (read from the actual file),
   installs it into the pack library (modules/packs.js) and switches to it, updates it, uninstalls it. Uninstalling the
   pack in use goes back to the build's own look; every step has Undo. How to share a pack: store/README.md. */
import { useState, useEffect, useRef } from "preact/hooks";
import { html, openExternal } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { D, W, useCols } from "../core/store.js";
import { usePref, ls } from "../core/pref.js";
import { pushBack, dropBack, fromBack } from "../core/back.js";
import { loadAll, picUrl, packFile, contents, dedupe, sources, extraSources, okSource, hostOf, HOME } from "../core/packstore.js";
import { applyPack } from "./theme.js";
import { keepPack, inUse, mark, snapshot, useBuiltIn } from "./packs.js";
import { Panel, Tools, Btn, Field, Seg, Empty, Icon, useWinWidth } from "../ui/index.js";
import { openSheet, actionSheet, askText } from "../ui/sheet.js";
import { openMod } from "../shell/os.js";

const REPO = "https://github.com/auroraongithub/toyboxos";
const kb = n => (n < 1e6 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB");
const installed = e => (D.packs || []).find(p => p.store && p.store.id === e.id && p.store.src === e.src);
const newer = (e, p) => p && String(p.store.v) !== String(e.v);

/* a picture from a store source (blob URL of sniffed bytes) */
function Pic({ e, path, alt = "" }) {
  const [u, setU] = useState("");
  useEffect(() => {
    let on = true;
    setU("");
    if (path) picUrl(e.src, path).then(x => on && setU(x));
    return () => (on = false);
  }, [e.src, path]);
  return u ? html`<img src=${u} alt=${alt} draggable="false"/>` : html`<span class="sto-ph"><${Icon} n="image"/></span>`;
}
const Swatches = ({ c }) => html`<span class="pkc">${(c || []).map((x, i) => html`<i key=${i} style=${"background:" + x}/>`)}</span>`;

/* ---- install / update / uninstall ---- */
async function install(e, quietUse) {
  const undo = snapshot();
  toast("Installing " + e.name + "…");
  try {
    const o = await packFile(e),
      old = installed(e),
      wasOn = old && inUse() === old._id;
    const use = !old || wasOn || !quietUse;
    if (use) await applyPack(JSON.parse(JSON.stringify(o)));
    const id = await keepPack(o, e.name, {
      store: { id: e.id, v: e.v, src: e.src, by: e.by, license: e.license },
    });
    if (old && old._id !== id) await W.del("packs", old._id);
    if (use) mark(id);
    toast(old ? e.name + " updated" : e.name + " is on", { label: "Undo", run: undo });
  } catch (err) {
    toast(err.message || "Couldn't install that pack");
  }
}
function uninstall(p) {
  const was = inUse() === p._id,
    back = was ? useBuiltIn(true) : null,
    keep = { ...p };
  delete keep._id;
  W.del("packs", p._id);
  toast(p.name + " uninstalled", {
    label: "Undo",
    run: async () => {
      await W.set("packs", p._id, keep);
      if (back) back();
    },
  });
}
async function useIt(e, p) {
  const undo = snapshot();
  try {
    await applyPack(JSON.parse(JSON.stringify(await packFile(e))));
    mark(p._id);
    toast(p.name + " is on", { label: "Undo", run: undo });
  } catch (err) {
    toast(err.message || "Couldn't switch to that pack");
  }
}

/* ---- the persona, readable before it's installed ---- */
const Voice = ({ text }) => html`<pre class="sto-voice selectable">${text}</pre>`;

/* ---- one pack ---- */
function Detail({ e, back }) {
  useCols("packs", "config");
  const [shot, setShot] = useState(0),
    [c, setC] = useState(null),
    [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    packFile(e).then(
      o => on && setC(contents(o)),
      x => on && setErr(x.message || "Couldn't open the pack file"),
    );
    return () => (on = false);
  }, [e.src, e.id, e.sha256]);
  const p = installed(e),
    on = p && inUse() === p._id,
    up = newer(e, p),
    shots = e.shots.length ? e.shots : e.thumb ? [e.thumb] : [];
  const h = e.has,
    rows = [
      h.theme || e.colours.length ? ["Colours", html`<${Swatches} c=${e.colours}/>${h.wall ? html`<span>wallpaper</span>` : null}`] : null,
      c && c.art.length
        ? ["Pictures", html`<span class="sto-art">${c.art.map(([k, v]) => html`<img key=${k} src=${v} alt=${k} title=${k}/>`)}</span>`]
        : h.art
          ? ["Pictures", h.art + " pieces of art"]
          : null,
      c && c.pics.length ? ["Mascot", html`<span class="sto-art">${c.pics.map((x, i) => html`<img key=${i} src=${x.src} alt=${x.name || ""}/>`)}</span>`] : null,
      c && c.say.length ? ["Lines", html`<span class="sto-say">${c.say.slice(0, 3).map(x => html`<q key=${x}>${x}</q>`)}${c.say.length > 3 ? html`<small>+${c.say.length - 3}</small>` : null}</span>`] : null,
      h.badges ? ["Badges", h.badges + ""] : null,
      h.icons ? ["Icons", h.icons + " redrawn"] : null,
      c && (c.ai.name || c.ai.persona)
        ? [
            "Assistant",
            html`<span>${c.ai.name || "unnamed"}</span>${c.ai.persona ? html`<${Btn} cls="sto-mini" onClick=${ev => openSheet({ title: (c.ai.name || "Assistant") + "'s voice", Body: Voice, props: { text: c.ai.persona }, at: ev.currentTarget })}>Read the voice<//>` : null}`,
          ]
        : null,
      h.layout ? ["Layout", "desktop pieces moved"] : null,
      ["License", e.license || "not stated"],
      e.credits ? ["Credits", e.credits] : null,
      ["From", hostOf(e.src)],
    ].filter(Boolean);
  return html`<div class="hubback sto-back"><button class="hbk" onClick=${back}><${Icon} n="back"/>Pack store</button><b>${e.name}</b></div>
    <div class="sto-d">
      <div class="sto-shots">
        <div class="sto-big">${shots.length ? html`<${Pic} e=${e} path=${shots[shot]} alt=${e.name + " screenshot"}/>` : html`<span class="sto-ph"><${Icon} n="image"/></span>`}</div>
        ${shots.length > 1 ? html`<div class="sto-strip">${shots.map((s, i) => html`<button key=${s} aria-pressed=${String(i === shot)} aria-label=${"Screenshot " + (i + 1)} onClick=${() => setShot(i)}><${Pic} e=${e} path=${s}/></button>`)}</div>` : null}
      </div>
      <div class="sto-info">
        <h3>${e.name}</h3>
        <div class="sto-by">${e.by ? "by " + e.by : ""}${e.tags.length ? html` · ${e.tags.join(", ")}` : null}</div>
        ${e.desc ? html`<p class="selectable">${e.desc}</p>` : null}
        <div class="sto-acts">
          ${
            !p
              ? html`<${Btn} go icon="import" disabled=${!!err} onClick=${() => install(e)}>Install<//><small>${kb(e.size)}</small>`
              : html`${up ? html`<${Btn} go icon="import" disabled=${!!err} onClick=${() => install(e, true)}>Update<//>` : null}
                ${on ? html`<span class="sto-on"><${Icon} n="applied"/>In use</span>` : html`<${Btn} go=${!up} icon="applied" disabled=${!!err} onClick=${() => useIt(e, p)}>Use<//>`}
                <${Btn} icon="trash" onClick=${() => uninstall(p)}>Uninstall<//>`
          }
        </div>
        ${err ? html`<div class="sto-err">${err}</div>` : null}
        <dl class="sto-facts">${rows.map(([k, v]) => html`<dt key=${k + "t"}>${k}</dt><dd key=${k}>${v}</dd>`)}</dl>
      </div>
    </div>`;
}

/* ---- the list ---- */
function Card({ e, open }) {
  const p = installed(e),
    on = p && inUse() === p._id;
  const state = on ? "In use" : p ? (newer(e, p) ? "Update" : "Installed") : "";
  return html`<button type="button" class=${"sto-c" + (on ? " on" : "")} onClick=${open} aria-label=${e.name + (state ? ", " + state : "")}>
    <span class="sto-t"><${Pic} e=${e} path=${e.thumb || e.shots[0]}/>${state ? html`<span class="sto-st">${state}</span>` : null}</span>
    <${Swatches} c=${e.colours}/>
    <b>${e.name}</b><small>${[e.by, e.license].filter(Boolean).join(" · ")}</small>
    ${e.desc ? html`<span class="sto-ds">${e.desc}</span>` : null}
  </button>`;
}

/* sources and sharing live in the ⋯ menu */
function share() {
  openSheet({
    title: "Share your pack",
    Body: () => html`<div class="sto-share selectable">
      <ol>
        <li>Theme editor › Packs › your pack › ⋯ › <b>Export file</b>.</li>
        <li>Open a pull request on the public repo that adds <code>store/packs/&lt;id&gt;/</code> with <code>pack.json</code>, <code>meta.json</code> and a screenshot, or attach the file to a new issue.</li>
        <li>Fan art is fine, never for sale. Credit the artist in <code>meta.json</code>.</li>
      </ol>
      <div class="sto-acts"><${Btn} go icon="links" onClick=${() => openExternal(REPO + "/blob/main/store/README.md")}>How it works<//>
        <${Btn} icon="plus" onClick=${() => openExternal(REPO + "/issues/new?template=pack.yml")}>New pack issue<//></div>
    </div>`,
  });
}
async function addSource(reload) {
  const v = await askText({ title: "Add a store", value: "https://", ok: "Add", label: "A folder with an index.json, like your own server's /store/." });
  if (!v || !v.trim()) return;
  let u = v.trim();
  if (!u.endsWith("/")) u += u.endsWith("index.json") ? "" : "/";
  u = u.replace(/index\.json$/, "");
  if (!okSource(u)) {
    toast("Use an https:// address");
    return;
  }
  ls.set("os-store-src", [...new Set([...extraSources(), u])]);
  reload();
}
function sourceMenu(at, reload) {
  actionSheet(
    "Stores",
    [
      ...sources().map(s => [s === HOME ? "applied" : "globe", hostOf(s), () => openExternal(s + "index.json")]),
      "-",
      ["plus", "Add a store…", () => addSource(reload)],
      ...extraSources().map(s => [
        "trash",
        "Remove " + hostOf(s),
        () => {
          ls.set("os-store-src", extraSources().filter(x => x !== s));
          reload();
        },
        { danger: true },
      ]),
    ],
    at,
  );
}

function Store() {
  useCols("packs", "config");
  const ref = useRef(),
    wb = useWinWidth(ref);
  const [st, setSt] = useState({ busy: true, packs: [], errs: [] }),
    [q, setQ] = useState(""),
    [show, setShow] = usePref("os-store-show", "all"),
    [cur, setCur] = useState(null);
  const load = () => {
    setSt(s => ({ ...s, busy: true }));
    loadAll().then(r => setSt({ busy: false, ...r }));
  };
  useEffect(load, []);
  const prev = useRef(cur);
  useEffect(() => {
    const p = prev.current;
    prev.current = cur;
    if (fromBack() || !!p === !!cur) return;
    if (cur) pushBack("store", () => setCur(null));
    else dropBack("store");
  }, [cur]);
  const all = dedupe(st.packs),
    ql = q.trim().toLowerCase(),
    list = all.filter(
      e =>
        (show !== "mine" || installed(e)) &&
        (!ql || [e.name, e.by, e.desc, ...e.tags].join(" ").toLowerCase().includes(ql)),
    );
  const sel = cur && all.find(e => e.id === cur);
  return html`<${Panel} cls="sto">
    <div ref=${ref} class="sto-w" data-w=${wb}>
    ${
      sel
        ? html`<${Detail} key=${sel.id} e=${sel} back=${() => setCur(null)}/>`
        : html`<${Tools}>
        <${Field} type="search" placeholder="Search packs" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search packs"/>
        <${Seg}>${[
          ["all", "All"],
          ["mine", "Installed"],
        ].map(([k, l]) => html`<${Btn} key=${k} aria-pressed=${String(show === k)} onClick=${() => setShow(k)}>${l}<//>`)}<//>
        <span class="sto-sp"/>
        <${Btn} icon="sync" aria-label="Reload" onClick=${load}/>
        <${Btn} icon="more" aria-label="Store options" onClick=${ev => {
          const at = ev.currentTarget;
          actionSheet(
            "Pack store",
            [
              ["export", "Share your pack…", share],
              ["globe", "Stores…", () => sourceMenu(at, load)],
              ["edit", "Your packs (Theme editor)", () => {
                ls.set("os-theme-tab", "packs");
                openMod("theme", true);
              }],
            ],
            at,
          );
        }}/>
      <//>
      ${st.offline ? html`<div class="sto-err">Can't reach the store${st.packs.length ? ", showing the last list" : ""}. <${Btn} cls="sto-mini" onClick=${load}>Retry<//></div>` : null}
      ${
        list.length
          ? html`<div class="sto-g">${list.map(e => html`<${Card} key=${e.src + e.id} e=${e} open=${() => setCur(e.id)}/>`)}</div>`
          : st.busy
            ? html`<${Empty} pad>Loading…<//>`
            : html`<${Empty} pad>${show === "mine" ? "Nothing from the store installed yet." : ql ? "No pack matches." : "No packs here yet."}<//>`
      }`
    }
    </div>
  <//>`;
}

export default {
  id: "store",
  name: "Pack store",
  title: "pack store",
  Comp: Store,
  cmd: v =>
    /^(store|packs?|pack ?store|shop|market|themes)$/.test(v)
      ? [{ icon: "store", l: "Pack store", r: () => openMod("store", true) }]
      : [],
  search: q => (/^(pack|store|shop)/i.test(q) ? [{ icon: "store", l: "Pack store", r: () => openMod("store", true) }] : []),
};
