/* Theme editor tabs that change the pack itself (core/look.js): Art & mascot, Badges, Assistant.
   Every edit is saved to config/look straight away (the assistant on Save) and shows live. */
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { useCols } from "../core/store.js";
import { useBrand } from "../brand.js";
import { pack, BASE, ART, AI } from "../core/pack.js";
import { fileUrl } from "../core/files.js";
import {
  SLOTS,
  MAX,
  look,
  setLook,
  storePic,
  setSlot,
  resetSlot,
  slotSet,
  slotUrl,
  picRefs,
  sayLines,
  badgeRefs,
  cleanBadge,
  cleanAI,
  useLook,
} from "../core/look.js";
import { Tools, Btn, Group, Field, Select, Check, Icon } from "../ui/index.js";
import { actionSheet, askText } from "../ui/sheet.js";
import { Badge } from "../shell/chrome.js";
import { Badge2, fromClassic, blankB2 } from "../shell/badge2.js";
import { Designer } from "./badgedesign.js";

/* a hidden file input behind a button */
function Pick({ label = "Upload…", max, onRef, icon, cls }) {
  const fi = useRef();
  return html`<${Btn} icon=${icon} cls=${cls} onClick=${() => fi.current.click()}>${label}<//>
    <input ref=${fi} type="file" accept="image/*" hidden onChange=${async e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        onRef(await storePic(f, max));
      } catch (err) {
        toast(err.message);
      }
    }}/>`;
}
/* a ref -> a url for previews */
function useRefUrl(r) {
  const [u, setU] = useState(null);
  useEffect(() => {
    let live = true;
    const f = !r
      ? Promise.resolve(null)
      : r.startsWith("sos:")
        ? fileUrl(r.slice(4))
        : r.startsWith("pic:")
          ? Promise.resolve(BASE.mascot && BASE.mascot.pics[+r.slice(4)]?.src)
          : r.startsWith("badge:")
            ? Promise.resolve(BASE.badges && BASE.badges[+r.slice(6)]?.art)
            : r.startsWith("slot:")
              ? Promise.resolve(slotUrl(r.slice(5)))
              : Promise.resolve(null);
    f.then(
      x => {
        if (live) setU(x || null);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [r]);
  return u;
}
const undoLook = (old, msg) => toast(msg, { label: "Undo", run: () => setLook(old) });

/* ---------------- Art & mascot ---------------- */
function Slot({ s }) {
  const [k, l, where, max] = s,
    src = slotUrl(k),
    ed = slotSet(k),
    old = look();
  const hide = () => {
      setSlot(k, "");
      undoLook(old, l + " hidden");
    },
    reset = () => {
      resetSlot(k);
      undoLook(old, l + ": back to the pack's");
    };
  return html`<div class=${"lkslot" + (ed ? " ch" : "") + (src ? "" : " off")} data-slot=${k} title=${where}>
    <div class="lkpv">${src ? html`<img src=${src} alt=""/>` : html`<span>hidden</span>`}</div>
    <b>${l}</b><small>${where}</small>
    <div class="lkb"><${Pick} label=${src ? "Change…" : "Upload…"} max=${max} onRef=${r => {
      setSlot(k, r);
      undoLook(old, l + " changed");
    }}/>
      ${src ? html`<${Btn} onClick=${hide}>Hide<//>` : null}
      ${ed ? html`<${Btn} icon="reset" title="Back to the pack's picture" onClick=${reset}>${src ? "Reset" : "Show"}<//>` : null}</div>
  </div>`;
}
function Pic({ p, i, list }) {
  const u = useRefUrl(p.src);
  const save = n => setLook({ pics: n });
  const menu = e =>
    actionSheet(
      p.name,
      [
        [
          "edit",
          "Rename…",
          () =>
            askText({ title: "Picture name", value: p.name, ok: "Rename" }).then(v => {
              if (v && v.trim())
                save(list.map((x, j) => (j === i ? { ...x, name: v.trim().slice(0, 40) } : x)));
            }),
        ],
        i
          ? [
              "back",
              "Move earlier",
              () => {
                const n = [...list];
                [n[i - 1], n[i]] = [n[i], n[i - 1]];
                save(n);
              },
            ]
          : null,
        [
          "trash",
          "Remove",
          () => {
            const old = look();
            save(list.filter((x, j) => j !== i));
            undoLook(old, "Picture removed");
          },
          { danger: true },
        ],
      ],
      e.currentTarget,
    );
  return html`<button class="lkpic" onClick=${menu} title=${p.name}><span class="lkpv">${u ? html`<img src=${u} alt=""/>` : null}</span><small>${p.name}</small></button>`;
}
export function ArtTab() {
  useCols("config");
  useLook();
  const pics = picRefs(),
    [say, setSay] = useState(sayLines().join("\n"));
  const lines = v =>
    v
      .split("\n")
      .map(x => x.trim())
      .filter(Boolean)
      .slice(0, MAX.say)
      .map(x => x.slice(0, 120));
  return html`
    <div class="thg"><${Group} title="Art" meta=${html`<span class="lkn">Banner and wallpaper: Colours</span>`}/>
      <div class="lkslots">${SLOTS.filter(s => s[0] !== "banner").map(s => html`<${Slot} key=${s[0]} s=${s}/>`)}</div></div>
    <div class="thg"><${Group} title="Mascot" meta=${html`<${Check} on=${pack.widgets.mascot !== false && !!pack.mascot} label="Show the mascot window" onClick=${() => {
      const on = pack.widgets.mascot !== false && !!pack.mascot;
      setLook({ mascot: !on });
      if (!on && !pics.length) toast("Add a picture to show the mascot");
    }}/>`}/>
      <div class="lkpics">${pics.map((p, i) => html`<${Pic} key=${p.src + i} p=${p} i=${i} list=${pics}/>`)}
        ${pics.length < MAX.pics ? html`<${Pick} cls="lkadd" label="Add" icon="plus" max=${700} onRef=${r => setLook({ pics: [...pics, { src: r, name: "picture.png", bg: "" }] })}/>` : null}</div>
      <label class="lksay"><span class="thsub">Poke lines</span>
        <textarea class="field" rows="4" value=${say} onInput=${e => setSay(e.target.value)} onBlur=${() => setLook({ say: lines(say) })}/></label>
    </div>`;
}

/* ---------------- Badges ---------------- */
/* one tile per badge, drawn at 2x as the desktop draws it; the tile opens the designer, ⋯ = order / copy / delete */
function BadgeTile({ b, i, list, name, design }) {
  const u = useRefUrl(b.v === 2 ? "" : b.art),
    drawn = (pack.badges || [])[i];
  const swap = j => {
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    setLook({ badges: n });
  };
  const menu = e => {
    e.stopPropagation();
    actionSheet(
      "Badge",
      [
        ["edit", "Design…", () => design(i)],
        i ? ["up", "Move earlier", () => swap(i - 1)] : null,
        i < list.length - 1 ? ["down", "Move later", () => swap(i + 1)] : null,
        list.length < MAX.badges
          ? [
              "copy",
              "Duplicate",
              () => setLook({ badges: [...list.slice(0, i + 1), list[i], ...list.slice(i + 1)] }),
            ]
          : null,
        "-",
        [
          "trash",
          "Delete",
          () => {
            const old = look();
            setLook({ badges: list.filter((x, j) => j !== i) });
            undoLook(old, "Badge deleted");
          },
          { danger: true },
        ],
      ],
      e.currentTarget,
    );
  };
  return html`<div class="lkbt">
    <button type="button" class="lkbtp" aria-label=${"Design badge " + (i + 1)} onClick=${() => design(i)}><span class="lkbtz">
      ${b.v === 2 ? (drawn && drawn.v === 2 ? html`<${Badge2} b=${drawn} name=${name}/>` : null) : html`<${Badge} b=${{ ...b, art: u }} name=${name}/>`}</span></button>
    <${Btn} icon="more" cls="lkbtm" aria-label="Badge options" onClick=${menu}/>
  </div>`;
}
export function BadgeTab() {
  useCols("config");
  useLook();
  const [name] = useBrand();
  const list = badgeRefs(),
    [des, setDes] = useState(null); // des = index being designed, or "new"
  if (des !== null) {
    const start = des === "new" ? blankB2() : list[des].v === 2 ? list[des] : fromClassic(list[des], name);
    return html`<${Designer} key=${String(des)} start=${start} name=${name} onCancel=${() => setDes(null)}
      onSave=${b => {
        const old = look(),
          n = des === "new" ? [...list, b] : list.map((x, j) => (j === des ? b : x));
        setLook({ badges: n.map(cleanBadge) });
        setDes(null);
        undoLook(old, "Badge saved");
      }}/>`;
  }
  return html`
    <div class="thg"><${Group} title="Badges" meta=${html`<span class="lkn">${list.length} of ${MAX.badges}</span>`}/>
      <div class="lkbts">${list.map((b, i) => html`<${BadgeTile} key=${i + ":" + (b.art || "") + (b.v || "")} b=${b} i=${i} list=${list} name=${name} design=${setDes}/>`)}
        ${list.length < MAX.badges ? html`<button type="button" class="lkbtn" onClick=${() => setDes("new")}><${Icon} n="plus"/>New badge</button>` : null}</div></div>
`;
}

/* ---------------- Assistant ---------------- */
const HER = [
  ["her", "she/her"],
  ["his", "he/him"],
  ["their", "they/them"],
  ["", "none"],
];
export function AssistantTab() {
  useCols("config");
  useLook();
  const [f, setF] = useState(() => ({
    name: AI.name,
    full: AI.full || "",
    her: AI.her || "",
    intro: AI.intro || "",
    persona: AI.persona || "",
  }));
  const set = k => e => {
    const v = e && e.target ? e.target.value : e;
    setF(o => ({ ...o, [k]: v }));
  };
  const edited = !!(look().ai && Object.keys(look().ai).length);
  const save = () => {
    if (!f.name.trim()) {
      toast("Give the assistant a name");
      return;
    }
    const old = look();
    /* only what differs from the pack is saved, so a pack update still reaches untouched fields */
    const o = {};
    for (const k of ["name", "full", "her", "intro", "persona"])
      if ((f[k] || "") !== (BASE.ai[k] || "")) o[k] = k === "name" ? f[k].trim() : f[k];
    setLook({ ai: cleanAI(o) });
    undoLook(old, "Assistant saved");
  };
  const reset = () => {
    const old = look();
    setLook({ ai: {} });
    setF({
      name: BASE.ai.name,
      full: BASE.ai.full || "",
      her: BASE.ai.her || "",
      intro: BASE.ai.intro || "",
      persona: BASE.ai.persona || "",
    });
    undoLook(old, "Back to the pack's assistant");
  };
  const row = (l, el, hint) =>
    html`<label class="pfr"><span class="pfl">${l}</span><span class="pff">${el}${hint ? html`<small>${hint}</small>` : null}</span></label>`;
  return html`<div class="pfg lkai">
      ${row("Name", html`<${Field} value=${f.name} maxlength="24" onInput=${set("name")}/>`)}
      ${row("Full name", html`<${Field} value=${f.full} maxlength="40" placeholder="optional" onInput=${set("full")}/>`)}
      ${row("Pronouns", html`<${Select} opts=${HER} value=${f.her} onChange=${set("her")}/>`)}
      ${row("Empty chat", html`<textarea class="field" rows="2" maxlength="300" value=${f.intro} onInput=${set("intro")}/>`)}
      ${row("Voice", html`<textarea class="field lkper" rows="12" maxlength="12000" value=${f.persona} onInput=${set("persona")}/>`)}
    </div>
    <${Tools} cls="foot"><${Btn} go onClick=${save}>Save<//>${edited ? html`<${Btn} icon="reset" onClick=${reset}>Use the pack's<//>` : null}<//>`;
}
