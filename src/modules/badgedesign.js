/* Badge designer (Theme editor > Badges > Design…): an 88x31 badge shown 4x (3x on phones) next to its actual size,
   both drawn by the same Badge2 the desktop uses. Everything is a layer: text and pictures stack over the Background
   (colour, gradient, stripes or a picture; GIFs keep moving) and its border. Pick a layer in the list or on the big
   preview; drag it there to move it (a picture's "Drag moves" switch moves the image inside its frame instead). */
import { useState, useEffect } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import { useMedia } from "../core/pref.js";
import { fileUrl } from "../core/files.js";
import { BASE } from "../core/pack.js";
import { SLOTS, storePic, slotUrl } from "../core/look.js";
import { Badge2, BORDERS, BGS, cleanB2, BW, BH } from "../shell/badge2.js";
import { FONTS } from "../shell/theme.js";
import { Btn, Select, Icon } from "../ui/index.js";
import { actionSheet } from "../ui/sheet.js";

const pick = f => {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = "image/*";
  i.className = "led-file";
  i.onchange = () => {
    const x = i.files[0];
    i.remove();
    if (x) f(x);
  };
  document.body.appendChild(i);
  i.click();
};
const urlOf = r =>
  !r
    ? Promise.resolve(null)
    : r.startsWith("sos:")
      ? fileUrl(r.slice(4)).catch(() => null)
      : r.startsWith("slot:")
        ? Promise.resolve(slotUrl(r.slice(5)))
        : r.startsWith("badge:")
          ? Promise.resolve((BASE.badges || [])[+r.slice(6)]?.art || null)
          : Promise.resolve(null);
/* the badge with urls filled in, for drawing */
function useDrawn(b) {
  const key = JSON.stringify([b.bg.src, ...b.layers.map(l => l.src || "")]),
    [urls, setUrls] = useState({});
  useEffect(() => {
    let live = true;
    const refs = [b.bg.src, ...b.layers.map(l => l.src)].filter(Boolean);
    Promise.all(refs.map(r => urlOf(r).then(u => [r, u]))).then(p => {
      if (live) setUrls(Object.fromEntries(p));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return {
    ...b,
    bg: { ...b.bg, url: urls[b.bg.src] || null },
    layers: b.layers.map(l => (l.t === "pic" ? { ...l, url: urls[l.src] || null } : l)),
  };
}
/* a picture: upload one or take one from the pack's art */
const choosePic = (at, f, max = 300) =>
  actionSheet(
    "Picture",
    [
      [
        "import",
        "Upload…",
        () =>
          pick(async file => {
            try {
              f(await storePic(file, max));
            } catch (e) {
              toast(e.message);
            }
          }),
      ],
      ...SLOTS.filter(([k]) => slotUrl(k)).map(([k, l]) => ["image", l, () => f("slot:" + k)]),
    ],
    at,
  );
const label = l => (l.t === "pic" ? "Picture" : (l.text || "(empty)").replace(/\n/g, " "));

export function Designer({ start, name, onSave, onCancel }) {
  const [b, setB0] = useState(() => cleanB2(start)),
    [sel, setSel] = useState(() => cleanB2(start).layers.length - 1),
    [inside, setInside] = useState(false);
  const phone = useMedia("(max-width:860px)"),
    k = phone ? 3 : 4,
    drawn = useDrawn(b);
  const dirty = JSON.stringify(b) !== JSON.stringify(cleanB2(start));
  const setB = f => setB0(x => cleanB2(typeof f === "function" ? f(x) : f));
  const L = sel >= 0 ? b.layers[sel] : null,
    setL = o => setB(x => ({ ...x, layers: x.layers.map((l, i) => (i === sel ? { ...l, ...o } : l)) }));
  const setBg = o => setB(x => ({ ...x, bg: { ...x.bg, ...o } })),
    setBd = o => setB(x => ({ ...x, bd: { ...x.bd, ...o } }));
  const add = l => {
    if (b.layers.length >= 8) {
      toast("8 layers at most");
      return;
    }
    setB(x => ({ ...x, layers: [...x.layers, l] }));
    setSel(b.layers.length);
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= b.layers.length) return;
    setB(x => {
      const n = [...x.layers];
      [n[i], n[j]] = [n[j], n[i]];
      return { ...x, layers: n };
    });
    setSel(j);
  };
  const drop = i => {
    setB(x => ({ ...x, layers: x.layers.filter((_, j) => j !== i) }));
    setSel(Math.min(i, b.layers.length - 2));
  };
  const leave = e => {
    if (!dirty) return onCancel();
    actionSheet(
      "Leave without saving?",
      [
        ["trash", "Discard changes", onCancel, { danger: true }],
        ["edit", "Keep editing", () => {}],
      ],
      e && e.currentTarget,
    );
  };
  /* drag a layer on the big preview (badge pixels = screen pixels / k) */
  const drag = (e, i) => {
    e.preventDefault();
    e.stopPropagation();
    setSel(i);
    const l0 = b.layers[i],
      sx = e.clientX,
      sy = e.clientY,
      inner = l0.t === "pic" && (inside || e.altKey);
    const mv = ev => {
      const dx = Math.round((ev.clientX - sx) / k),
        dy = Math.round((ev.clientY - sy) / k);
      setB(x => ({
        ...x,
        layers: x.layers.map((l, j) =>
          j !== i
            ? l
            : inner
              ? { ...l, ix: l0.ix + dx, iy: l0.iy + dy }
              : { ...l, x: l0.x + dx, y: l0.y + dy },
        ),
      }));
    };
    const up = () => {
      removeEventListener("pointermove", mv);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", up);
  };
  useEffect(() => {
    const kd = e => {
      if (e.target.closest("input,textarea,select,.sheet")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        leave();
        return;
      }
      const m = L && { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (m) {
        e.preventDefault();
        setL({ x: L.x + m[0], y: L.y + m[1] });
      }
    };
    document.addEventListener("keydown", kd);
    return () => document.removeEventListener("keydown", kd);
  }, [L, sel, dirty]);

  const row = (l, el) => html`<label class="bd-r"><span>${l}</span>${el}</label>`;
  const colour = (v, f, l) =>
    html`<input type="color" class="bd-c" value=${v} onInput=${e => f(e.target.value)} aria-label=${l}/>`;
  const slider = (l, min, max, v, f, unit = "", step = 1) =>
    row(
      l,
      html`<span class="bd-sl"><input type="range" min=${min} max=${max} step=${step} value=${v} aria-label=${l} onInput=${e => f(+e.target.value)}/><b>${v}${unit}</b></span>`,
    );
  /* a row of buttons (a label would press the first one when its text is clicked) */
  const brow = (l, el) => html`<div class="bd-r"><span>${l}</span>${el}</div>`;
  const tog = (k, t, l, cls) =>
    html`<${Btn} cls=${"bd-fx " + cls} aria-pressed=${String(!!L[k])} title=${l} aria-label=${l} onClick=${() => setL({ [k]: !L[k] })}>${t}<//>`;
  const turn = l => slider("Rotate", -180, 180, l.r || 0, v => setL({ r: Math.abs(v) < 4 ? 0 : v }), "°");
  const bg = b.bg;
  const props = !L
    ? html`
      <div class="bd-h">Background</div>
      <div class="seg bd-seg">${BGS.map(([v, l]) => html`<${Btn} key=${v} aria-pressed=${String(bg.k === v)} onClick=${() => setBg({ k: v })}>${l}<//>`)}</div>
      ${
        bg.k === "pic"
          ? row(
              "Picture",
              html`<span class="lkb"><${Btn} icon="image" onClick=${e => choosePic(e.currentTarget, src => setBg({ src }), 500)}>${bg.src ? "Change…" : "Choose…"}<//>
          <${Select} opts=${[
            ["cover", "Fill"],
            ["contain", "Fit"],
            ["tile", "Tile"],
          ]} value=${bg.fit} onChange=${v => setBg({ fit: v })}/></span>`,
            )
          : null
      }
      ${row(bg.k === "pic" ? "Behind it" : bg.k === "color" ? "Colour" : "Colours", html`<span class="lkb">${colour(bg.c1, c => setBg({ c1: c }), "Background colour")}${bg.k === "grad" || bg.k === "stripes" ? colour(bg.c2, c => setBg({ c2: c }), "Second colour") : null}</span>`)}
      ${bg.k === "grad" || bg.k === "stripes" ? slider("Angle", 0, 359, bg.dir, v => setBg({ dir: v }), "°") : null}
      <div class="bd-h">Border</div>
      ${row("Style", html`<span class="lkb"><${Select} opts=${BORDERS} value=${b.bd.k} onChange=${v => setBd({ k: v })}/>${b.bd.k !== "none" ? colour(b.bd.c, c => setBd({ c }), "Border colour") : null}</span>`)}`
    : L.t === "text"
      ? html`
      <div class="bd-h">Text</div>
      <textarea class="field" rows="2" maxlength="60" value=${L.text} placeholder="Text. {name} = the OS name" onInput=${e => setL({ text: e.target.value })} aria-label="Layer text"/>
      ${row("Font", html`<span class="lkb"><${Select} opts=${FONTS.map(([v, l]) => [v, v ? l : "Verdana"])} value=${L.font} onChange=${v => setL({ font: v })}/>${colour(L.color, c => setL({ color: c }), "Text colour")}</span>`)}
      ${slider("Size", 5, 24, L.size, v => setL({ size: v }), "px")}
      ${brow(
        "Style",
        html`<span class="lkb"><span class="seg">${tog("bold", "B", "Bold", "fb")}${tog("it", "I", "Italic", "fi")}${tog("u", "U", "Underline", "fu")}${tog("st", "S", "Strikethrough", "fs")}</span>
          <span class="seg">${tog("up", "AA", "Uppercase", "fa")}${tog("sh", "S", "Shadow", "fh")}</span></span>`,
      )}
      ${brow(
        "Align",
        html`<span class="seg">${[
          ["l", "alignl", "Left"],
          ["c", "alignc", "Centre"],
          ["r", "alignr", "Right"],
          ["j", "alignj", "Justify"],
        ].map(
          ([v, ic, l]) =>
            html`<${Btn} key=${v} icon=${ic} aria-pressed=${String(L.al === v)} title=${l} aria-label=${"Align " + l} onClick=${() => setL({ al: v })}/>`,
        )}</span>`,
      )}
      ${slider("Spacing", -1, 4, L.ls || 0, v => setL({ ls: v }), "px", 0.5)}
      ${slider("Line height", 70, 180, L.lh || 105, v => setL({ lh: v }), "%", 5)}
      ${turn(L)}`
      : html`
      <div class="bd-h">Picture</div>
      <div class="lkb"><${Btn} icon="image" onClick=${e => choosePic(e.currentTarget, src => setL({ src }))}>Change…<//>
        <${Btn} onClick=${() => setL({ iw: L.w, ix: 0, iy: 0 })}>Fit the frame<//><${Btn} onClick=${() => setL({ x: 0, y: 0, w: BW, h: BH, r: 0 })}>Whole badge<//></div>
      ${row("Drag moves", html`<div class="seg bd-seg"><${Btn} aria-pressed=${String(!inside)} onClick=${() => setInside(false)}>Frame<//><${Btn} aria-pressed=${String(inside)} onClick=${() => setInside(true)}>Picture<//></div>`)}
      ${slider("Picture size", 8, 300, L.iw, v => setL({ iw: v }), "px")}
      ${slider("Frame width", 4, 88, L.w, v => setL({ w: v }), "px")}
      ${slider("Frame height", 4, 31, L.h, v => setL({ h: v }), "px")}
      ${turn(L)}`;
  const item = (l, i) => html`<div key=${i} class=${"bd-li" + (i === sel ? " on" : "")}>
      <button type="button" class="bd-pk" onClick=${() => setSel(i)}><${Icon} n=${l.t === "pic" ? "image" : "edit"}/><span>${label(l)}</span></button>
      ${
        i === sel
          ? html`<span class="bd-ops">
        <${Btn} icon="up" aria-label="Bring forward" title="Bring forward" disabled=${i === b.layers.length - 1} onClick=${() => move(i, 1)}/>
        <${Btn} icon="down" aria-label="Send back" title="Send back" disabled=${!i} onClick=${() => move(i, -1)}/>
        <${Btn} icon="copy" aria-label="Copy layer" title="Copy" onClick=${() => add({ ...l, x: l.x + 3, y: l.y + 3 })}/>
        <${Btn} icon="trash" aria-label="Delete layer" title="Delete" onClick=${() => drop(i)}/></span>`
          : null
      }</div>`;
  return html`<div class="bdz">
    <div class="bd-top"><${Btn} icon="back" onClick=${leave}>Badges<//><b>${dirty ? "Edited" : ""}</b><span/>
      <${Btn} go disabled=${!dirty && start.v === 2 && b.layers.length > 0} onClick=${() => onSave(b)}>Save badge<//></div>
    <div class="bd-stage" onPointerDown=${e => {
      if (e.target === e.currentTarget) setSel(-1);
    }}>
      <div class="bd-zoom" style=${`width:${BW * k}px;height:${BH * k}px`}><div style=${`transform:scale(${k});transform-origin:0 0;width:${BW}px;height:${BH}px`}>
        <${Badge2} b=${drawn} name=${name} sel=${sel} onLayer=${drag}/></div></div>
      <div class="bd-real"><${Badge2} b=${drawn} name=${name}/><small>actual size</small></div>
    </div>
    <div class="bd-main">
      <div class="bd-side">
        <div class="bd-layers" role="list">${b.layers.map(item).reverse()}
          <div class=${"bd-li" + (sel === -1 ? " on" : "")}><button type="button" class="bd-pk" onClick=${() => setSel(-1)}><${Icon} n="grid"/><span>Background</span></button></div></div>
        <div class="lkb"><${Btn} icon="plus" onClick=${() => add({ t: "text", text: "TEXT", font: "", size: 10, color: "#111111", bold: true, x: 4, y: 10 })}>Text<//>
          <${Btn} icon="plus" onClick=${e => choosePic(e.currentTarget, src => add({ t: "pic", src, x: 58, y: 0, w: 30, h: 31, iw: 30, ix: 0, iy: 0 }))}>Picture<//></div>
      </div>
      <div class="bd-props">${props}</div>
    </div>
  </div>`;
}
