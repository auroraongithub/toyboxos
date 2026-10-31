/* Edit layout (desktop): every piece gets a box. Drag the box = move, corner = size, the knob on top = rotate
   (snaps to 0 and, with Shift, to 15° steps), ⋯ = forward/back, straighten, normal size, back to its place, hide.
   Arrow keys nudge the selected piece (Shift = 10px), Delete hides it, Ctrl+Z undoes, Enter/Esc = Done.
   Changes live in a draft until Done (core/layout.js). Windows are faded and out of the way meanwhile.
   The bar itself drags by its title (pref os-led-bar) and steps to the other half of the screen while it covers the selected piece. */
import { useState, useEffect, useRef } from "preact/hooks";
import { html } from "../core/lib.js";
import { toast } from "../core/bus.js";
import {
  useLayout,
  layout,
  edit,
  editAll,
  undoEdit,
  doneEditing,
  setEditing,
  anchorFor,
  anchorIn,
  baseXY,
  mine,
  setMine,
  bounds,
  newStickerId,
} from "../core/layout.js";
import { storePic } from "../core/look.js";
import { fileUrl } from "../core/files.js";
import { FONTS } from "./theme.js";
import { reg } from "./os.js";
import { pickWinLook } from "./winlook.js";
import { openPhoneList } from "./phonelist.js";
import { pieceLabel } from "./piece.js";
import { actionSheet, openSheet, sheetOpen } from "../ui/sheet.js";
import { Btn, Icon, Check, Select } from "../ui/index.js";
import { usePref } from "../core/pref.js";

/* the drawn box of a piece: a moved piece is its own box; one in its normal place is its first child's */
const boxOf = el => {
  const t = el.classList.contains("free") ? el : el.firstElementChild;
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return r.width && r.height ? r : null;
};
const els = () => [...document.querySelectorAll(".piece[data-piece]")];
/* make a piece free (fixed where it is now) so it can move; returns its entry */
function loosen(id) {
  const el = document.querySelector(`.piece[data-piece="${CSS.escape(id)}"]`),
    cur = layout().p[id];
  if (cur && cur.at) return cur;
  const t = el && el.firstElementChild;
  if (!t) return null;
  const r = t.getBoundingClientRect();
  const o = { ...anchorFor(r.left, r.top, r.width, r.height), w: Math.round(t.offsetWidth), s: 1, r: 0 };
  edit(id, o, true);
  return { ...(cur || {}), ...o };
}
const snap = (v, on) => (on ? Math.round(v / 4) * 4 : Math.round(v));
const elOf = id => document.querySelector(`.piece[data-piece="${CSS.escape(id)}"]`);
const pickFile = f => {
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

/* ---- stickers ---- */
function TextEd({ p, done, close }) {
  const [f, setF] = useState({
    text: p.text || "",
    font: p.font || "",
    size: p.size || 24,
    color: p.color || "#000000",
  });
  const set = k => v => setF(o => ({ ...o, [k]: v && v.target ? v.target.value : v }));
  const ta = useRef();
  useEffect(() => {
    setTimeout(() => ta.current && ta.current.focus(), 60);
  }, []);
  return html`<form class="stk-ed" onSubmit=${e => {
    e.preventDefault();
    if (!f.text.trim()) return;
    close();
    done({ ...f, size: +f.size });
  }}>
    <textarea ref=${ta} class="field" rows="3" maxlength="200" placeholder="Text" value=${f.text} onInput=${set("text")}/>
    <div class="stk-row"><${Select} opts=${FONTS} value=${f.font} onChange=${set("font")}/>
      <label class="stk-sz">Size <input type="range" min="10" max="96" value=${f.size} onInput=${set("size")}/></label>
      <input type="color" value=${f.color} onInput=${set("color")} aria-label="Colour"/></div>
    <div class="stk-pv" style=${`font-family:${f.font || "inherit"};font-size:${Math.min(48, f.size)}px;color:${f.color}`}>${f.text || "Preview"}</div>
    <div class="askb"><span/><button type="button" class="btn" onClick=${close}>Cancel</button><button class="btn go">Done</button></div></form>`;
}
const editText = (p, done) => openSheet({ title: "Text sticker", Body: TextEd, props: { p, done } });
const picSize = ref =>
  fileUrl(ref.slice(4)).then(
    u =>
      new Promise(r => {
        const i = new Image();
        i.onload = () => r([i.naturalWidth, i.naturalHeight]);
        i.onerror = () => r([200, 200]);
        i.src = u;
      }),
  );
async function addPicture(file) {
  try {
    const src = await storePic(file, 900),
      [nw, nh] = await picSize(src),
      w = Math.min(nw, 260),
      h = Math.round((w * nh) / nw);
    edit(newStickerId(), {
      k: "img",
      src,
      at: "c",
      x: -Math.round(w / 2),
      y: -Math.round(h / 2),
      w,
      s: 1,
      r: 0,
      z: 0,
    });
  } catch (e) {
    toast(e.message);
  }
}
const addText = () =>
  editText({}, o => edit(newStickerId(), { k: "text", ...o, at: "c", x: -80, y: -20, s: 1, r: 0, z: 0 }));
/* a sticker onto a window (kept where it is on screen) and back off it */
function stick(id, win) {
  const el = elOf(id),
    sec = document.querySelector(`#mcol > .win[data-win="${CSS.escape(win)}"]`),
    p = layout().p[id];
  if (!el || !sec || !p) return;
  const R = sec.getBoundingClientRect(),
    [bx, by] = baseXY(p);
  edit(id, { win, ...anchorIn(bx - R.left, by - R.top, el.offsetWidth, el.offsetHeight, R.width, R.height) });
}
function unstick(id) {
  const el = elOf(id),
    sec = el && el.offsetParent,
    p = layout().p[id];
  if (!el || !sec || !p) return;
  const R = sec.getBoundingClientRect(),
    o = anchorFor(R.left + el.offsetLeft, R.top + el.offsetTop, el.offsetWidth, el.offsetHeight);
  edit(id, { ...o, win: null });
}

export function LayoutEditor() {
  const L = useLayout(),
    [, tick] = useState(0),
    [sel, setSel] = useState(null),
    [hideWins, setHideWins] = useState(false);
  const [bp, setBp] = usePref("os-led-bar", null),
    bar = useRef(),
    [drag, setDrag] = useState(null);
  useEffect(() => {
    document.body.toggleAttribute("data-ledhide", hideWins);
    return () => document.body.removeAttribute("data-ledhide");
  }, [hideWins]);
  /* boxes follow the pieces (they can move under us: fit-on-screen, fonts, the clock ticking) */
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 250);
    addEventListener("resize", () => tick(n => n + 1));
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const k = e => {
      if ((e.target.closest && e.target.closest("input,textarea")) || sheetOpen()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!undoEdit()) toast("Nothing to undo");
        return;
      }
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        doneEditing();
        toast("Layout saved");
        return;
      }
      if (!sel) return;
      const d = e.shiftKey ? 10 : 1,
        mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      if (mv) {
        e.preventDefault();
        const p = loosen(sel);
        if (p) edit(sel, { x: (p.x || 0) + mv[0], y: (p.y || 0) + mv[1] });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        edit(sel, sel.startsWith("st:") ? null : { hide: true });
        setSel(null);
      }
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [sel]);

  const gesture = (e, id, kind) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSel(id);
    const box = e.currentTarget.closest(".led-box").getBoundingClientRect(),
      cx = box.left + box.width / 2,
      cy = box.top + box.height / 2;
    const p0 = loosen(id);
    if (!p0) return;
    const sx = e.clientX,
      sy = e.clientY,
      el = document.querySelector(`.piece[data-piece="${CSS.escape(id)}"]`);
    let first = true;
    const step = o => {
      edit(id, o, first);
      first = false;
    }; // one undo step per gesture
    const a0 = Math.atan2(sy - cy, sx - cx),
      d0 = Math.hypot(sx - cx, sy - cy) || 1;
    const mv = ev => {
      if (kind === "move")
        step({ x: snap(p0.x + ev.clientX - sx, !ev.altKey), y: snap(p0.y + ev.clientY - sy, !ev.altKey) });
      else if (kind === "size")
        step({
          s: Math.max(
            0.3,
            Math.min(
              4,
              Math.round((((p0.s || 1) * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0) * 100) / 100,
            ),
          ),
        });
      else {
        let r = (p0.r || 0) + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
        r = ((r + 540) % 360) - 180;
        r = ev.shiftKey ? Math.round(r / 15) * 15 : Math.abs(r) < 4 ? 0 : Math.round(r);
        step({ r });
      }
    };
    const up = () => {
      removeEventListener("pointermove", mv);
      removeEventListener("pointerup", up);
      document.body.classList.remove("led-drag");
      /* settle on the anchor nearest where it ended up, so it stays near that edge/corner on other screen sizes */
      if (kind === "move" && el) {
        const p = layout().p[id];
        if (p && p.at) {
          if (p.win) {
            const sec = el.offsetParent;
            if (sec)
              edit(
                id,
                anchorIn(
                  el.offsetLeft,
                  el.offsetTop,
                  el.offsetWidth,
                  el.offsetHeight,
                  sec.clientWidth,
                  sec.clientHeight,
                ),
                false,
              );
          } else {
            const [x, y] = baseXY(p),
              w = el.offsetWidth,
              h = el.offsetHeight;
            edit(id, anchorFor(x, y, w, h), false);
          }
        }
      }
    };
    document.body.classList.add("led-drag");
    addEventListener("pointermove", mv);
    addEventListener("pointerup", up);
  };
  const menu = (e, id) => {
    e.stopPropagation();
    const p = layout().p[id] || {},
      st = id.startsWith("st:"),
      at = { x: e.clientX, y: e.clientY };
    const wins = [...document.querySelectorAll("#mcol > .win.fl:not(.min)")].map(w => w.dataset.win);
    actionSheet(
      st ? (p.k === "text" ? "Text sticker" : "Picture sticker") : pieceLabel(id),
      [
        st && p.k === "text" ? ["edit", "Edit text…", () => editText(p, o => edit(id, o))] : null,
        st && p.k !== "text"
          ? [
              "image",
              "Replace picture…",
              () =>
                pickFile(async f => {
                  try {
                    edit(id, { src: await storePic(f, 900) });
                  } catch (err) {
                    toast(err.message);
                  }
                }),
            ]
          : null,
        st && !p.win && wins.length
          ? [
              "grid",
              "Stick to a window…",
              () =>
                actionSheet(
                  "Stick to",
                  wins.map(w => ["grid", reg.names[w] || w, () => stick(id, w)]),
                  at,
                ),
            ]
          : null,
        st && p.win ? ["back", "Unstick from " + (reg.names[p.win] || p.win), () => unstick(id)] : null,
        st ? "-" : null,
        [
          (layout().p[id] || {}).z > 0 ? "applied" : "",
          "Over the windows",
          () => {
            loosen(id);
            edit(id, { z: (layout().p[id].z || 0) > 0 ? 0 : 1 });
          },
        ],
        [
          "up",
          "Bring forward",
          () => {
            loosen(id);
            edit(id, { z: Math.min(9, (layout().p[id].z || 0) + 1) });
          },
        ],
        [
          "down",
          "Send back",
          () => {
            loosen(id);
            edit(id, { z: Math.max(-1, (layout().p[id].z || 0) - 1) });
          },
        ],
        p.r ? ["reset", "Straighten", () => edit(id, { r: 0 })] : null,
        p.s && p.s !== 1 ? ["reset", "Normal size", () => edit(id, { s: 1 })] : null,
        p.at && !st ? ["back", "Back to its place", () => edit(id, null)] : null,
        "-",
        st
          ? [
              "trash",
              "Delete",
              () => {
                edit(id, null);
                setSel(null);
              },
              { danger: true },
            ]
          : [
              "trash",
              "Hide",
              () => {
                edit(id, { hide: true });
                setSel(null);
              },
            ],
      ],
      at,
    );
  };

  /* the bar: where it was put (kept on screen), or flipped to the other half while it covers the selected piece */
  const moveBar = e => {
    if (e.button !== 0 || e.target.closest("button,label")) return;
    e.preventDefault();
    const r = bar.current.getBoundingClientRect(),
      dx = e.clientX - r.left,
      dy = e.clientY - r.top;
    const mv = ev => setDrag({ x: ev.clientX - dx, y: ev.clientY - dy });
    const up = ev => {
      removeEventListener("pointermove", mv);
      removeEventListener("pointerup", up);
      setDrag(null);
      setBp({ x: Math.round(ev.clientX - dx), y: Math.round(ev.clientY - dy) });
    };
    addEventListener("pointermove", mv);
    addEventListener("pointerup", up);
  };
  const br = bar.current && bar.current.getBoundingClientRect(),
    bw = br ? br.width : 600,
    bh = br ? br.height : 36;
  const keep = (x, y) => [
    Math.max(4, Math.min(innerWidth - bw - 4, x)),
    Math.max(4, Math.min(innerHeight - bh - 42, y)),
  ];
  let [bx, by] = drag
    ? keep(drag.x, drag.y)
    : bp
      ? keep(bp.x, bp.y)
      : [(innerWidth - bw) / 2, document.documentElement.classList.contains("ndesk") ? 38 : 10];
  const sb =
    !drag &&
    sel &&
    (() => {
      const el = elOf(sel);
      return el && boxOf(el);
    })();
  if (sb && sb.left < bx + bw && sb.right > bx && sb.top < by + bh && sb.bottom > by)
    by = by + bh / 2 < innerHeight / 2 ? innerHeight - bh - 48 : 10;
  const B = bounds(),
    hidden = Object.keys(L.p).filter(id => L.p[id].hide);
  const boxes = els()
    .filter(el => !el.dataset.hidden)
    .map(el => {
      const id = el.dataset.piece,
        r = boxOf(el);
      return r && { id, r };
    })
    .filter(Boolean)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height); // big ones first, so small pieces on top of them stay grabbable
  return html`<div class="led" onPointerDown=${e => {
    if (e.target.classList.contains("led")) setSel(null);
  }}>
    ${boxes.map(
      ({ id, r }) => html`<div key=${id} class=${"led-box" + (sel === id ? " on" : "")} data-for=${id}
        style=${`left:${Math.round(r.left)}px;top:${Math.round(r.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px`}
        onPointerDown=${e => gesture(e, id, "move")}>
      <b class="led-l">${pieceLabel(id)}</b>
      <i class="led-rot" title="Rotate (Shift = 15° steps)" onPointerDown=${e => gesture(e, id, "rot")}/>
      <i class="led-sz" title="Size" onPointerDown=${e => gesture(e, id, "size")}/>
      <button class="led-m" aria-label=${pieceLabel(id) + " options"} onPointerDown=${e => e.stopPropagation()} onClick=${e => menu(e, id)}><${Icon} n="more"/></button>
    </div>`,
    )}
    <div class="led-bar" ref=${bar} role="toolbar" aria-label="Edit layout" style=${`left:${Math.round(bx)}px;top:${Math.round(by)}px`}
        onPointerDown=${e => {
          e.stopPropagation();
          moveBar(e);
        }} onDblClick=${e => {
          if (!e.target.closest("button,label")) setBp(null);
        }}>
      <b class="led-grip" title="Drag to move the bar (double-click: back to the top)">Edit layout</b>
      <${Btn} icon="image" onClick=${() => pickFile(addPicture)}>Picture<//>
      <${Btn} icon="edit" onClick=${addText}>Text<//>
      ${
        hidden.length
          ? html`<${Btn} icon="plus" onClick=${e =>
              actionSheet(
                "Show again",
                hidden.map(id => ["plus", pieceLabel(id), () => edit(id, { hide: false })]),
                e.currentTarget,
              )}>Hidden (${hidden.length})<//>`
          : null
      }
      <label class="led-mine"><${Check} on=${hideWins} label="Hide windows" onClick=${() => setHideWins(!hideWins)}/>Hide windows</label>
      <${Btn} icon="more" aria-label="More layout options" onClick=${e =>
        actionSheet(
          "Layout",
          [
            ["grid", "Window look…", () => pickWinLook(e.currentTarget)],
            ["today", "Phone layout…", openPhoneList],
            [mine() ? "applied" : "", "This device only", () => setMine(!mine())],
            "-",
            [
              "reset",
              "Reset everything",
              () => {
                editAll({});
                toast("Everything back in its place (Ctrl+Z to undo)");
              },
            ],
          ],
          e.currentTarget,
        )}/>
      <span class="led-sp"/>
      <${Btn} onClick=${() => {
        if (!undoEdit()) toast("Nothing to undo");
      }}>Undo<//>
      <${Btn} onClick=${() => setEditing(false)}>Cancel<//>
      <${Btn} go onClick=${() => {
        doneEditing();
        toast("Layout saved");
      }}>Done<//>
    </div>
  </div>`;
}
