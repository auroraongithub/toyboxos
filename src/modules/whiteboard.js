/* whiteboard.exe: an endless canvas. Pen (pressure, coalesced events, ink outline), highlighter, eraser,
   select/move/resize, text boxes that do math (= at the end, $\frac{a}{b}$, units) and [[links]], sticky notes,
   shapes, and shape snapping (hold still at the end of a stroke, or the Snap toggle).
   Data: boards {title, at, upd}; every stroke/shape/text is its own doc in `ink` {b: board, t: type, ...},
   so two devices drawing at once never overwrite each other. Types: s stroke, h highlighter, r rect, e ellipse,
   l line, a arrow, x text, n note. Strokes keep a polyline-encoded point string (core/ink.js). */
import { useState, useEffect, useRef } from "preact/hooks";
import { html, plural } from "../core/lib.js";
import { ls, usePref, useMedia } from "../core/pref.js";
import { useCols, W, D } from "../core/store.js";
import { toast } from "../core/bus.js";
import { Tools, StatusBar, Btn, Icon } from "../ui/index.js";
import { openMod } from "../shell/os.js";
import { openSheet, askText } from "../ui/sheet.js";
import { encode, simplify, outline, centerline, recognize, pathLen } from "../core/ink.js";
import { TEXT_FONT } from "../core/mathtype.js";
import {
  H,
  HL,
  NOTE,
  NPAD,
  PEN,
  SZ,
  TOOLS,
  bbox,
  boards,
  commit,
  evs,
  exportPNG,
  geo,
  goLink,
  hit,
  itemsOf,
  linkAt,
  meets,
  moved,
  newBoard,
  now,
  openBoard,
  paint,
  r1,
  redo,
  scaled,
  strip,
  theme,
  uid,
  undo,
  union,
} from "./whiteboard-draw.js";

function BoardList({ cur, close }) {
  useCols("boards", "ink");
  const list = boards(),
    n = id => D.ink.filter(i => i.b === id).length;
  const ren = async () => {
    const b = D.boards.find(x => x._id === cur);
    if (!b) return;
    close();
    const t = await askText({ title: "Rename board", value: b.title, ok: "Rename" });
    if (t && t.trim()) W.upd("boards", cur, { title: t.trim(), upd: now() });
  };
  const add = async () => {
    close();
    const t = await askText({ title: "New board", value: "Board " + (D.boards.length + 1), ok: "Create" });
    if (t != null) newBoard(t.trim() || null);
  };
  const del = () => {
    close();
    const b = D.boards.find(x => x._id === cur);
    if (!b) return;
    const its = D.ink.filter(i => i.b === cur);
    W.batch([["del", "boards", cur], ...its.map(i => ["del", "ink", i._id])]);
    toast("Board deleted", {
      label: "Undo",
      run: () => {
        W.batch([["set", "boards", cur, strip(b)], ...its.map(i => ["set", "ink", i._id, strip(i)])]);
        ls.set("os-wb", cur);
      },
    });
  };
  return html`<div class="acts wbl">
    ${list.map(
      b =>
        html`<button class=${"mi" + (b._id === cur ? " on" : "")} onClick=${() => {
          ls.set("os-wb", b._id);
          close();
        }}><${Icon} n="whiteboard"/><span>${b.title || "Untitled"}</span><em>${n(b._id)}</em></button>`,
    )}
    ${list.length ? html`<div class="sep"/>` : null}
    <button class="mi" onClick=${add}><${Icon} n="plus"/><span>New board</span></button>
    ${cur ? html`<button class="mi" onClick=${ren}><${Icon} n="edit"/><span>Rename</span></button><button class="mi dgr" onClick=${del}><${Icon} n="trash"/><span>Delete board</span></button>` : null}</div>`;
}

function Whiteboard() {
  useCols("boards", "ink", "pages");
  const phone = useMedia("(max-width:860px)");
  const [bidP] = usePref("os-wb", ""),
    list = boards(),
    board = list.find(b => b._id === bidP) || list[0] || null,
    bid = board ? board._id : null;
  const [tool, setTool] = usePref("os-wb-tool", "pen"),
    [size, setSize] = usePref("os-wb-size", 0),
    [snap, setSnap] = usePref("os-wb-snap", false);
  const [pc, setPc] = usePref("os-wb-c", ""),
    [hc, setHc] = usePref("os-wb-hc", HL[0]),
    [nc, setNc] = usePref("os-wb-nc", NOTE[0]);
  const [pen, setPen] = usePref("os-wb-pen", false),
    [finger, setFinger] = usePref("os-wb-finger", false);
  const [sel, setSel] = useState([]),
    [edit, setEdit] = useState(null),
    [zoom, setZoom] = useState(100);
  const box = useRef(),
    cv = useRef(),
    top = useRef(),
    ta = useRef(),
    S = useRef(null);
  if (!S.current)
    S.current = {
      view: { x: 0, y: 0, k: 1 },
      pts: new Map(),
      mode: null,
      pinch: null,
      ov: new Map(),
      hide: new Set(),
      space: false,
      raf: 0,
      need: 0,
      hover: null,
      lastTap: { t: 0, id: null },
      lastLine: null,
    };
  const s = S.current;
  const items = bid ? itemsOf(bid) : [];
  const pal = tool === "hl" ? HL : tool === "note" ? NOTE : PEN,
    col = tool === "hl" ? hc : tool === "note" ? nc : pc;
  const cur = useRef({});
  cur.current = {
    items,
    bid,
    tool,
    size,
    snap,
    pen,
    finger,
    sel,
    edit,
    pc,
    hc,
    nc,
    phone,
    title: board && board.title,
  };
  const ensure = () => cur.current.bid || (cur.current.bid = newBoard());

  /* ---- drawing ---- */
  const dims = () => {
    const c = cv.current;
    return c
      ? { w: c.width / (devicePixelRatio || 1), h: c.height / (devicePixelRatio || 1) }
      : { w: 0, h: 0 };
  };
  const drawBase = () => {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext("2d"),
      dpr = devicePixelRatio || 1,
      { w, h } = dims(),
      v = s.view,
      C = theme(box.current);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = C.paper;
    g.fillRect(0, 0, w, h);
    /* dot grid, sparser as you zoom out */
    let st = 24;
    while (st * v.k < 14) st *= 4;
    const sp = st * v.k,
      ox = ((v.x % sp) + sp) % sp,
      oy = ((v.y % sp) + sp) % sp;
    g.fillStyle = C.mute;
    g.globalAlpha = 0.32;
    for (let x = ox; x < w; x += sp)
      for (let y = oy; y < h; y += sp) g.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    g.globalAlpha = 1;
    g.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    const vr = { x0: -v.x / v.k, y0: -v.y / v.k, x1: (w - v.x) / v.k, y1: (h - v.y) / v.k };
    for (const it0 of cur.current.items) {
      if (s.hide.has(it0._id)) continue;
      const it = s.ov.get(it0._id) || it0;
      if (!meets(bbox(it), vr)) continue;
      g.globalAlpha = 1;
      paint(g, it, C);
    }
    g.globalAlpha = 1;
  };
  const drawTop = () => {
    const c = top.current;
    if (!c) return;
    const g = c.getContext("2d"),
      dpr = devicePixelRatio || 1,
      { w, h } = dims(),
      v = s.view,
      C = theme(box.current),
      m = s.mode;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    if (m && m.k === "draw") {
      if (m.snapped) {
        paint(g, { ...m.snapped, l: SZ.shape[cur.current.size] || 2, c: m.c }, C);
      } else if (m.pts.length) {
        const P = m.pred ? m.pts.concat(m.pred) : m.pts;
        if (m.t === "hl") {
          g.globalAlpha = 0.4;
          g.strokeStyle = m.c || HL[0];
          g.lineWidth = m.l;
          g.lineCap = g.lineJoin = "round";
          g.stroke(centerline(P));
          g.globalAlpha = 1;
        } else {
          g.fillStyle = m.c || C.ink;
          g.fill(outline(P, m.l));
        }
      }
    }
    if (m && m.k === "shape" && m.it) paint(g, m.it, C);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = b => ({
      x: b.x0 * v.k + v.x,
      y: b.y0 * v.k + v.y,
      w: (b.x1 - b.x0) * v.k,
      h: (b.y1 - b.y0) * v.k,
    });
    if (m && m.k === "marq") {
      const r = sc({
        x0: Math.min(m.x0, m.x1),
        y0: Math.min(m.y0, m.y1),
        x1: Math.max(m.x0, m.x1),
        y1: Math.max(m.y0, m.y1),
      });
      g.fillStyle = C.sel;
      g.globalAlpha = 0.08;
      g.fillRect(r.x, r.y, r.w, r.h);
      g.globalAlpha = 1;
      g.strokeStyle = C.ink;
      g.setLineDash([4, 3]);
      g.lineWidth = 1;
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      g.setLineDash([]);
    }
    const S2 = selIts();
    if (S2.length && !(m && m.k === "draw")) {
      g.strokeStyle = C.ink;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      if (S2.length > 1)
        S2.forEach(it => {
          const r = sc(bbox(it));
          g.globalAlpha = 0.5;
          g.strokeRect(Math.round(r.x) - 2.5, Math.round(r.y) - 2.5, r.w + 5, r.h + 5);
        });
      g.globalAlpha = 1;
      const r = sc(union(S2.map(bbox)));
      g.strokeRect(Math.round(r.x) - 4.5, Math.round(r.y) - 4.5, Math.round(r.w) + 9, Math.round(r.h) + 9);
      g.setLineDash([]);
      handles(r).forEach(([x, y]) => {
        g.fillStyle = C.paper;
        g.fillRect(x - 4, y - 4, 8, 8);
        g.strokeStyle = C.ink;
        g.strokeRect(x - 3.5, y - 3.5, 7, 7);
      });
    }
    if (m && m.k === "erase" && m.at) {
      g.strokeStyle = C.mute;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(m.at[0], m.at[1], eraseR(), 0, Math.PI * 2);
      g.stroke();
    }
  };
  const handles = r => {
    const x0 = Math.round(r.x) - 4,
      y0 = Math.round(r.y) - 4,
      x1 = Math.round(r.x + r.w) + 5,
      y1 = Math.round(r.y + r.h) + 5;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  };
  const eraseR = () => (cur.current.phone ? 14 : 10);
  const selItems = () =>
    cur.current.sel
      .map(id => {
        const it = cur.current.items.find(i => i._id === id);
        return it && (s.ov.get(id) || it);
      })
      .filter(Boolean);
  const frame = () => {
    s.raf = 0;
    const n = s.need;
    s.need = 0;
    if (n & 1) drawBase();
    if (n & 2) drawTop();
  };
  const need = (n = 3) => {
    s.need |= n;
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  };

  /* ---- view ---- */
  const views = () => ls.get("os-wb-views", {});
  let vt = useRef(0);
  const saveView = () => {
    clearTimeout(vt.current);
    vt.current = setTimeout(() => {
      const b = cur.current.bid;
      if (b) {
        const V = views();
        V[b] = { x: Math.round(s.view.x), y: Math.round(s.view.y), k: Math.round(s.view.k * 1000) / 1000 };
        ls.set("os-wb-views", V);
      }
      setZoom(Math.round(s.view.k * 100));
    }, 160);
  };
  const zoomAt = (mx, my, k) => {
    const v = s.view;
    k = Math.min(8, Math.max(0.1, k));
    v.x = mx - ((mx - v.x) * k) / v.k;
    v.y = my - ((my - v.y) * k) / v.k;
    v.k = k;
    need();
    saveView();
  };
  const zoomBy = f => {
    const { w, h } = dims();
    zoomAt(w / 2, h / 2, s.view.k * f);
  };
  const fit = (its = cur.current.items) => {
    const { w, h } = dims();
    if (!its.length || !w) {
      s.view = { x: w / 2 || 0, y: h / 2 || 0, k: 1 };
      need();
      saveView();
      return;
    }
    const b = union(its.map(bbox)),
      k = Math.min(2, Math.max(0.1, Math.min((w - 60) / (b.x1 - b.x0 || 1), (h - 60) / (b.y1 - b.y0 || 1))));
    s.view = { k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: h / 2 - ((b.y0 + b.y1) / 2) * k };
    need();
    saveView();
  };
  const toW = (cx, cy) => {
    const r = cv.current.getBoundingClientRect(),
      v = s.view;
    return [(cx - r.left - v.x) / v.k, (cy - r.top - v.y) / v.k];
  };

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const b = box.current;
      if (!b) return;
      const dpr = devicePixelRatio || 1,
        r = b.getBoundingClientRect();
      [cv.current, top.current].forEach(c => {
        c.width = Math.max(10, Math.round(r.width * dpr));
        c.height = Math.max(10, Math.round(r.height * dpr));
        c.style.width = r.width + "px";
        c.style.height = r.height + "px";
      });
      if (!s.sized) {
        s.sized = true;
        if (!views()[cur.current.bid]) s.view = { x: r.width / 2, y: r.height / 2, k: 1 };
      }
      drawBase();
      drawTop();
    });
    ro.observe(box.current);
    const wheel = e => {
      e.preventDefault();
      if (cur.current.edit) finishEdit();
      const r = cv.current.getBoundingClientRect(),
        mx = e.clientX - r.left,
        my = e.clientY - r.top;
      const mouse =
        e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || (mouse && !e.shiftKey))
        zoomAt(
          mx,
          my,
          s.view.k * Math.exp(-e.deltaY * (mouse ? 0.0015 : 0.01) * (e.deltaMode === 1 ? 33 : 1)),
        );
      else {
        const sh = e.shiftKey && !e.deltaX;
        s.view.x -= sh ? e.deltaY : e.deltaX;
        s.view.y -= sh ? 0 : e.deltaY;
        need();
        saveView();
      }
    };
    const c = top.current;
    c.addEventListener("wheel", wheel, { passive: false });
    const ku = e => {
      if (e.key === " ") {
        s.space = false;
        if (top.current) top.current.style.cursor = "";
      }
    };
    addEventListener("keyup", ku);
    addEventListener("blur", ku);
    return () => {
      ro.disconnect();
      c.removeEventListener("wheel", wheel);
      removeEventListener("keyup", ku);
      removeEventListener("blur", ku);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, []);
  /* switching boards: its own view and history */
  useEffect(() => {
    const V = views()[bid],
      { w, h } = dims();
    s.view = V ? { ...V } : { x: w / 2, y: h / 2, k: 1 };
    setZoom(Math.round(s.view.k * 100));
    if (H.b !== bid) {
      // a new history per board, except when the first stroke just created this board
      if (H.b) {
        H.undo = [];
        H.redo = [];
      }
      H.b = bid;
    }
    setSel([]);
    need();
  }, [bid]);
  /* opened from search: centre on that item */
  useEffect(() => {
    const f = ls.get("os-wb-focus", null);
    if (!f) return;
    const it = items.find(i => i._id === f);
    if (!it) return;
    ls.set("os-wb-focus", null);
    const { w, h } = dims(),
      b = bbox(it),
      k = Math.max(s.view.k, 1);
    s.view = { k, x: w / 2 - ((b.x0 + b.x1) / 2) * k, y: h / 2 - ((b.y0 + b.y1) / 2) * k };
    setSel([f]);
    need();
    saveView();
  });
  useEffect(() => {
    need();
  });

  /* ---- text editing (a textarea laid over the item) ---- */
  const startEdit = (it, isNew) => {
    s.hide.add(it._id);
    setSel([]);
    setEdit({ it, isNew, v: it.s || "" });
  };
  const finishEdit = () => {
    const e = cur.current.edit;
    if (!e) return;
    cur.current.edit = null;
    const el = ta.current,
      v = el ? el.value : e.v;
    s.hide.delete(e.it._id);
    setEdit(null);
    const b = ensure(),
      orig = e.isNew ? null : cur.current.items.find(i => i._id === e.it._id);
    if (!v.trim() && e.it.t === "x") {
      if (orig) commit([[orig._id, orig, null]], b);
    } else if (e.isNew) commit([[e.it._id, null, { ...strip(e.it), b, s: v }]], b);
    else if (orig && orig.s !== v) commit([[orig._id, orig, { ...orig, s: v }]], b);
    need();
    box.current && box.current.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (edit && ta.current) {
      const t = ta.current;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
      fitTa();
    }
  }, [edit && edit.it._id]);
  const fitTa = () => {
    const t = ta.current,
      e = cur.current.edit;
    if (!t || !e) return;
    const k = s.view.k,
      f = (e.it.f || 16) * k;
    if (e.it.t === "x") {
      const g = document.createElement("canvas").getContext("2d");
      g.font = f + "px " + TEXT_FONT;
      const w = Math.max(...t.value.split("\n").map(l => g.measureText(l).width), f * 4);
      t.style.width = w + f * 1.5 + "px";
    }
    t.style.height = "auto";
    t.style.height = t.scrollHeight + "px";
  };

  /* ---- pointer input ---- */
  const tolW = () => (cur.current.phone ? 12 : 6) / s.view.k;
  const topAt = (x, y, inside = true) => {
    const its = cur.current.items;
    for (let i = its.length - 1; i >= 0; i--) {
      const it = s.ov.get(its[i]._id) || its[i];
      if (!s.hide.has(it._id) && hit(it, x, y, tolW(), inside)) return it;
    }
    return null;
  };
  const handleAt = (cx, cy) => {
    const S2 = selIts();
    if (!S2.length) return -1;
    const r = cv.current.getBoundingClientRect(),
      v = s.view,
      b = union(S2.map(bbox));
    const hs = handles({
        x: b.x0 * v.k + v.x,
        y: b.y0 * v.k + v.y,
        w: (b.x1 - b.x0) * v.k,
        h: (b.y1 - b.y0) * v.k,
      }),
      R = cur.current.phone ? 18 : 9;
    return hs.findIndex(([x, y]) => Math.abs(cx - r.left - x) <= R && Math.abs(cy - r.top - y) <= R);
  };
  const cancel = () => {
    const m = s.mode;
    if (m && m.k === "erase") m.gone.forEach(it => s.hide.delete(it._id));
    if (m && m.hold) clearTimeout(m.hold);
    s.mode = null;
    s.ov.clear();
    need();
  };

  const addPt = (m, ev) => {
    const [x, y] = toW(ev.clientX, ev.clientY),
      k = s.view.k,
      P = m.pts,
      last = P[P.length - 1];
    if (last) {
      const d = Math.hypot(x - last.x, y - last.y);
      if (d < 0.7 / k) return;
      const f = m.pen ? 0.7 : 0.55,
        nx = last.x + (x - last.x) * f,
        ny = last.y + (y - last.y) * f;
      /* pen: real pressure; mouse/finger: faster = thinner, like a felt tip */
      const want = m.pen
        ? Math.max(0.12, ev.pressure || 0.5)
        : Math.max(0.3, Math.min(1, 1.1 - (d * k) / 26));
      P.push({ x: nx, y: ny, p: last.p + (want - last.p) * (m.pen ? 0.5 : 0.22) });
    } else P.push({ x, y, p: m.pen ? Math.max(0.12, ev.pressure || 0.5) : 0.62 });
    m.raw = [x, y];
  };
  const trySnap = m => {
    if (s.mode !== m || m.t !== "pen") return;
    const sh = recognize(m.pts, true);
    if (sh) {
      m.snapped = sh;
      m.snapAt = [...m.scr];
      if (navigator.vibrate)
        try {
          navigator.vibrate(10);
        } catch {
          // vibration is optional
        }
      need(2);
    }
  };
  const finishStroke = m => {
    clearTimeout(m.hold);
    const c = cur.current,
      b = ensure(),
      o = Date.now();
    if (m.raw && m.pts.length > 1) {
      const L = m.pts[m.pts.length - 1];
      m.pts.push({ x: m.raw[0], y: m.raw[1], p: L.p });
    }
    let sh = m.snapped || (c.snap && m.t === "pen" ? recognize(m.pts, false) : null);
    /* Snap on: a short V right at the end of a fresh line turns that line into an arrow */
    if (!sh && c.snap && m.t === "pen" && s.lastLine && o - s.lastLine.at < 6000) {
      const ln = c.items.find(i => i._id === s.lastLine.id);
      if (ln && ln.t === "l") {
        const Lw = Math.hypot(ln.u - ln.x, ln.v - ln.y),
          bb = union(m.pts.map(p => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }))),
          cx = (bb.x0 + bb.x1) / 2,
          cy = (bb.y0 + bb.y1) / 2,
          pl = pathLen(m.pts);
        const near = (px, py) => Math.hypot(cx - px, cy - py) < Math.max(26 / s.view.k, Lw * 0.25);
        if (pl < Lw * 0.7 && (near(ln.u, ln.v) || near(ln.x, ln.y))) {
          const fl = near(ln.x, ln.y) && !near(ln.u, ln.v);
          commit(
            [[ln._id, ln, fl ? { ...ln, t: "a", x: ln.u, y: ln.v, u: ln.x, v: ln.y } : { ...ln, t: "a" }]],
            b,
          );
          s.lastLine = null;
          s.mode = null;
          need();
          return;
        }
      }
    }
    if (sh) {
      const id = uid(),
        it = { b, t: sh.t, o, c: c.pc, l: SZ.shape[c.size] || 2 };
      if (sh.t === "l" || sh.t === "a")
        Object.assign(it, { x: r1(sh.x), y: r1(sh.y), u: r1(sh.u), v: r1(sh.v) });
      else Object.assign(it, { x: r1(sh.x), y: r1(sh.y), w: r1(sh.w), h: r1(sh.h) });
      commit([[id, null, it]], b);
      if (sh.t === "l") s.lastLine = { id, at: o };
    } else if (m.pts.length) {
      const P = simplify(m.pts, 0.45 / s.view.k),
        ch = [];
      /* very long strokes are stored in chunks so no single doc gets big */
      for (let i = 0; i < P.length; i += 1199) {
        const part = P.slice(i, i + 1200);
        if (i && part.length < 2) break;
        const ox = Math.round(part[0].x),
          oy = Math.round(part[0].y),
          e = encode(part, ox, oy);
        const it = { b, t: m.t === "hl" ? "h" : "s", x: ox, y: oy, p: e.p, l: m.l, c: m.c, o: o + i };
        if (m.t !== "hl") it.q = e.q;
        ch.push([uid(), null, it]);
      }
      commit(ch, b);
    }
    s.mode = null;
    need();
  };

  const down = e => {
    const c = cur.current;
    if (c.edit) {
      finishEdit();
      if (c.tool === "text" || c.tool === "note" || c.tool === "select") return;
    }
    if (e.pointerType === "pen" && !c.pen) setPen(true);
    const touch = e.pointerType === "touch";
    /* palm rejection: while the stylus is down, fingers do nothing */
    if (touch && [...s.pts.values()].some(p => p.type === "pen")) return;
    if (box.current) box.current.focus({ preventScroll: true });
    try {
      top.current.setPointerCapture(e.pointerId);
    } catch {
      // the pointer already ended
    }
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (touch && s.pts.size >= 2) {
      cancel();
      const [a, b] = [...s.pts.values()];
      s.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        k: s.view.k,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
        vx: s.view.x,
        vy: s.view.y,
      };
      return;
    }
    if (s.mode || s.pinch) return;
    const [x, y] = toW(e.clientX, e.clientY),
      base = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: 0, touch };
    if (e.button === 1 || (e.button === 0 && s.space) || c.tool === "hand" || (touch && c.pen && !c.finger)) {
      s.mode = { ...base, k: "pan", vx: s.view.x, vy: s.view.y, x, y };
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const t = c.tool;
    if (t === "pen" || t === "hl") {
      const m = {
        ...base,
        k: "draw",
        t,
        pts: [],
        pen: e.pointerType === "pen",
        l: t === "hl" ? SZ.hl[c.size] : SZ.pen[c.size],
        c: t === "hl" ? c.hc : c.pc,
        scr: [e.clientX, e.clientY],
      };
      s.mode = m;
      addPt(m, e);
      m.hold = setTimeout(() => trySnap(m), 550);
      need(2);
      return;
    }
    if (t === "eraser") {
      s.mode = { ...base, k: "erase", gone: new Set() };
      eraseAt(e);
      return;
    }
    if (t === "select") {
      const hi = handleAt(e.clientX, e.clientY);
      if (hi >= 0) {
        const S2 = selIts(),
          b = union(S2.map(bbox)),
          cs = [
            [b.x0, b.y0],
            [b.x1, b.y0],
            [b.x1, b.y1],
            [b.x0, b.y1],
          ];
        s.mode = {
          ...base,
          k: "size",
          orig: S2,
          a: cs[(hi + 2) % 4],
          c0: cs[hi],
          uni: S2.length > 1 || S2.some(i => "shxn".includes(i.t)),
        };
        return;
      }
      const it = topAt(x, y);
      if (it) {
        let ns = c.sel;
        if (e.shiftKey) ns = ns.includes(it._id) ? ns.filter(i => i !== it._id) : [...ns, it._id];
        else if (!ns.includes(it._id)) ns = [it._id];
        setSel(ns);
        cur.current.sel = ns;
        s.mode = {
          ...base,
          k: "move",
          x0: x,
          y0: y,
          orig: ns.map(id => c.items.find(i => i._id === id)).filter(Boolean),
          hit: it,
        };
      } else {
        if (!e.shiftKey) {
          setSel([]);
          cur.current.sel = [];
        }
        s.mode = { ...base, k: "marq", x0: x, y0: y, x1: x, y1: y, add: e.shiftKey ? c.sel : [] };
      }
      need(2);
      return;
    }
    if (t === "text" || t === "note") {
      s.mode = { ...base, k: "place", x, y };
      return;
    }
    s.mode = { ...base, k: "shape", t, x0: x, y0: y, it: null };
  };
  const eraseAt = ev => {
    const m = s.mode,
      [x, y] = toW(ev.clientX, ev.clientY),
      r = eraseR() / s.view.k,
      its = cur.current.items;
    m.at = [
      ev.clientX - cv.current.getBoundingClientRect().left,
      ev.clientY - cv.current.getBoundingClientRect().top,
    ];
    for (const it of its)
      if (!s.hide.has(it._id) && hit(it, x, y, r, false)) {
        s.hide.add(it._id);
        m.gone.add(it);
      }
    need();
  };
  const move = e => {
    const c = cur.current;
    if (!s.pts.has(e.pointerId)) {
      if (e.pointerType === "mouse" && (c.tool === "select" || c.tool === "hand")) {
        const [x, y] = toW(e.clientX, e.clientY),
          it = topAt(x, y),
          ln = it && linkAt(it, x, y);
        top.current.style.cursor =
          s.space || c.tool === "hand"
            ? "grab"
            : ln
              ? "pointer"
              : handleAt(e.clientX, e.clientY) >= 0
                ? "nwse-resize"
                : it
                  ? "move"
                  : "";
      }
      return;
    }
    s.pts.set(e.pointerId, { ...s.pts.get(e.pointerId), x: e.clientX, y: e.clientY });
    if (s.pinch) {
      if (s.pts.size < 2) return;
      const [a, b] = [...s.pts.values()],
        p = s.pinch,
        r = cv.current.getBoundingClientRect(),
        k = Math.min(8, Math.max(0.1, (p.k * Math.hypot(a.x - b.x, a.y - b.y)) / p.d));
      const wx = (p.mx - r.left - p.vx) / p.k,
        wy = (p.my - r.top - p.vy) / p.k;
      s.view = { k, x: (a.x + b.x) / 2 - r.left - wx * k, y: (a.y + b.y) / 2 - r.top - wy * k };
      need();
      saveView();
      return;
    }
    const m = s.mode;
    if (!m || m.id !== e.pointerId) return;
    m.moved = Math.max(m.moved, Math.hypot(e.clientX - m.sx, e.clientY - m.sy));
    const [x, y] = toW(e.clientX, e.clientY);
    if (m.k === "pan") {
      s.view.x = m.vx + e.clientX - m.sx;
      s.view.y = m.vy + e.clientY - m.sy;
      need();
      saveView();
    } else if (m.k === "draw") {
      evs(e).forEach(ev => addPt(m, ev));
      const pr = e.getPredictedEvents ? e.getPredictedEvents() : [];
      m.pred = pr.length
        ? pr.slice(0, 2).map(ev => {
            const [px, py] = toW(ev.clientX, ev.clientY);
            return { x: px, y: py, p: m.pts[m.pts.length - 1].p };
          })
        : null;
      if (Math.hypot(e.clientX - m.scr[0], e.clientY - m.scr[1]) > 4) {
        m.scr = [e.clientX, e.clientY];
        clearTimeout(m.hold);
        m.hold = setTimeout(() => trySnap(m), 550);
        if (m.snapped && Math.hypot(e.clientX - m.snapAt[0], e.clientY - m.snapAt[1]) > 12) m.snapped = null;
      }
      need(2);
    } else if (m.k === "erase") evs(e).forEach(eraseAt);
    else if (m.k === "move") {
      if (m.moved < 3) return;
      const dx = x - m.x0,
        dy = y - m.y0;
      s.ov.clear();
      m.orig.forEach(it => s.ov.set(it._id, moved(it, dx, dy)));
      need();
    } else if (m.k === "size") {
      const [ax, ay] = m.a,
        [cx, cy] = m.c0;
      let sx = (x - ax) / (cx - ax || 1),
        sy = (y - ay) / (cy - ay || 1);
      sx = Math.max(0.05, sx);
      sy = Math.max(0.05, sy);
      if (m.uni || e.shiftKey) {
        const u = Math.max(sx, sy);
        sx = sy = u;
      }
      s.ov.clear();
      m.orig.forEach(it => s.ov.set(it._id, scaled(it, ax, ay, sx, sy)));
      need();
    } else if (m.k === "marq") {
      m.x1 = x;
      m.y1 = y;
      need(2);
    } else if (m.k === "shape") {
      let x1 = x,
        y1 = y;
      const c2 = cur.current,
        l = SZ.shape[c2.size] || 2;
      if (e.shiftKey) {
        if (m.t === "r" || m.t === "e") {
          const d = Math.max(Math.abs(x - m.x0), Math.abs(y - m.y0));
          x1 = m.x0 + Math.sign(x - m.x0 || 1) * d;
          y1 = m.y0 + Math.sign(y - m.y0 || 1) * d;
        } else {
          const a = (Math.round(Math.atan2(y - m.y0, x - m.x0) / (Math.PI / 4)) * Math.PI) / 4,
            d = Math.hypot(x - m.x0, y - m.y0);
          x1 = m.x0 + Math.cos(a) * d;
          y1 = m.y0 + Math.sin(a) * d;
        }
      }
      m.it =
        m.t === "r" || m.t === "e"
          ? {
              t: m.t,
              x: Math.min(m.x0, x1),
              y: Math.min(m.y0, y1),
              w: Math.abs(x1 - m.x0),
              h: Math.abs(y1 - m.y0),
              l,
              c: c2.pc,
            }
          : { t: m.t, x: m.x0, y: m.y0, u: x1, v: y1, l, c: c2.pc };
      need(2);
    }
  };
  const up = e => {
    const had = s.pts.delete(e.pointerId);
    if (!had) return;
    if (s.pinch) {
      if (s.pts.size < 2) s.pinch = null;
      if (!s.pts.size) saveView();
      return;
    }
    const m = s.mode;
    if (!m || m.id !== e.pointerId) return;
    const c = cur.current,
      [x, y] = toW(e.clientX, e.clientY),
      tap = m.moved < (m.touch ? 10 : 5),
      b = () => ensure();
    if (m.k === "pan") {
      s.mode = null;
      if (tap) {
        const it = topAt(x, y),
          ln = it && linkAt(it, x, y);
        if (ln) goLink(ln);
      }
      return;
    }
    if (m.k === "draw") {
      if (e.type === "pointercancel" && m.pts.length < 3) {
        cancel();
        return;
      }
      finishStroke(m);
      return;
    }
    s.mode = null;
    if (m.k === "erase") {
      const g = [...m.gone];
      g.forEach(it => s.hide.delete(it._id));
      if (g.length)
        commit(
          g.map(it => [it._id, it, null]),
          b(),
        );
      need();
      return;
    }
    if (m.k === "move") {
      if (m.moved >= 3) {
        const ch = m.orig.map(it => [it._id, it, s.ov.get(it._id)]).filter(x => x[2]);
        s.ov.clear();
        commit(ch, b());
      } else {
        const it = m.hit,
          ln = linkAt(it, x, y),
          t0 = Date.now(),
          dbl = s.lastTap.id === it._id && t0 - s.lastTap.t < 450;
        s.lastTap = { t: t0, id: it._id };
        if (ln && !e.shiftKey) goLink(ln);
        else if (dbl && (it.t === "x" || it.t === "n")) startEdit(it, false);
      }
      need();
      return;
    }
    if (m.k === "size") {
      const ch = m.orig.map(it => [it._id, it, s.ov.get(it._id)]).filter(x => x[2]);
      s.ov.clear();
      commit(ch, b());
      need();
      return;
    }
    if (m.k === "marq") {
      const r = {
        x0: Math.min(m.x0, m.x1),
        y0: Math.min(m.y0, m.y1),
        x1: Math.max(m.x0, m.x1),
        y1: Math.max(m.y0, m.y1),
      };
      const ids = tap ? [] : c.items.filter(it => meets(bbox(it), r)).map(i => i._id);
      setSel([...new Set([...m.add, ...ids])]);
      need(2);
      return;
    }
    if (m.k === "place") {
      if (!tap) return;
      const it = topAt(x, y);
      if (it && (it.t === "x" || it.t === "n") && (c.tool === "text" || it.t === "n")) {
        startEdit(it, false);
        return;
      }
      const o = Date.now(),
        id = uid();
      if (c.tool === "text") {
        const f = SZ.text[c.size];
        startEdit({ _id: id, t: "x", x: r1(x), y: r1(y - f * 0.65), s: "", f, c: c.pc, o }, true);
      } else {
        const f = SZ.note[c.size] || 16,
          k = f / 16;
        startEdit(
          {
            _id: id,
            t: "n",
            x: r1(x - 90 * k),
            y: r1(y - 24),
            w: r1(180 * k),
            h: r1(140 * k),
            f,
            s: "",
            c: c.nc,
            o,
          },
          true,
        );
      }
      setTool("select");
      return;
    }
    if (m.k === "shape") {
      const it = m.it;
      need(2);
      if (!it) return;
      const big = it.t === "r" || it.t === "e" ? Math.max(it.w, it.h) : Math.hypot(it.u - it.x, it.v - it.y);
      if (big * s.view.k < 6) return;
      const id = uid(),
        o = { ...it, b: b(), o: Date.now() };
      ["x", "y", "w", "h", "u", "v"].forEach(k => {
        if (o[k] != null) o[k] = r1(o[k]);
      });
      commit([[id, null, o]], o.b);
    }
  };

  /* ---- keyboard ---- */
  const delSel = () => {
    const S2 = cur.current.sel.map(id => cur.current.items.find(i => i._id === id)).filter(Boolean);
    if (!S2.length) return;
    commit(
      S2.map(it => [it._id, it, null]),
      cur.current.bid,
    );
    setSel([]);
  };
  const dupSel = (dx = 24) => {
    const S2 = cur.current.sel.map(id => cur.current.items.find(i => i._id === id)).filter(Boolean);
    if (!S2.length) return;
    const o = Date.now(),
      ch = S2.map((it, i) => [uid(), null, { ...strip(moved(it, dx, dx)), o: o + i }]);
    commit(ch, ensure());
    setSel(ch.map(x => x[0]));
  };
  const pasteItems = (list, at) => {
    if (!list.length) return;
    const b = ensure(),
      bb = union(list.map(bbox)),
      [cx, cy] = at || [(bb.x0 + bb.x1) / 2 + 24, (bb.y0 + bb.y1) / 2 + 24],
      dx = cx - (bb.x0 + bb.x1) / 2,
      dy = cy - (bb.y0 + bb.y1) / 2,
      o = Date.now();
    const ch = list.map((it, i) => [uid(), null, { ...strip(moved(it, dx, dy)), b, o: o + i }]);
    commit(ch, b);
    setSel(ch.map(x => x[0]));
  };
  const key = e => {
    if (e.target !== box.current) return;
    const c = cur.current,
      mod = e.ctrlKey || e.metaKey,
      k = e.key.toLowerCase();
    if (mod && k === "z") {
      e.preventDefault();
      (e.shiftKey ? redo : undo)();
      setSel([]);
      return;
    }
    if (mod && k === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k === "a") {
      e.preventDefault();
      setTool("select");
      setSel(c.items.map(i => i._id));
      return;
    }
    if (mod && k === "d") {
      e.preventDefault();
      dupSel();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (c.sel.length) {
        e.preventDefault();
        delSel();
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!s.space) {
        s.space = true;
        top.current.style.cursor = "grab";
      }
      return;
    }
    if (e.key === "Escape") {
      if (c.sel.length) {
        e.stopPropagation();
        setSel([]);
      }
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === "+" || e.key === "=") {
      zoomBy(1.25);
      return;
    }
    if (e.key === "-") {
      zoomBy(0.8);
      return;
    }
    if (e.key === "0") {
      s.view.k = 1;
      zoomBy(1);
      return;
    }
    if (e.key === "!" || (e.shiftKey && e.key === "1")) {
      fit();
      return;
    }
    const t = TOOLS.find(x => x[3] === k);
    if (t) {
      setTool(t[0]);
      if (t[0] !== "select") setSel([]);
    }
  };
  const copy = e => {
    if (e.target !== box.current) return;
    const S2 = selIts();
    if (!S2.length) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", "toybox-ink:" + JSON.stringify(S2.map(strip)));
  };
  const cut = e => {
    copy(e);
    if (cur.current.sel.length) delSel();
  };
  const paste = e => {
    if (e.target !== box.current) return;
    const t = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!t) return;
    e.preventDefault();
    if (t.startsWith("toybox-ink:")) {
      try {
        pasteItems(JSON.parse(t.slice(11)));
      } catch {
        // not a whiteboard clipboard payload
      }
      return;
    }
    const { w, h } = dims(),
      [x, y] = toW(
        cv.current.getBoundingClientRect().left + w / 2,
        cv.current.getBoundingClientRect().top + h / 2,
      ),
      b = ensure(),
      id = uid();
    commit(
      [
        [
          id,
          null,
          {
            b,
            t: "x",
            x: r1(x),
            y: r1(y),
            s: t.slice(0, 4000),
            f: SZ.text[cur.current.size],
            c: cur.current.pc,
            o: Date.now(),
          },
        ],
      ],
      b,
    );
    setSel([id]);
  };

  const pick = v => {
    const c = cur.current;
    (tool === "hl" ? setHc : tool === "note" ? setNc : setPc)(v);
    const kinds = tool === "hl" ? "h" : tool === "note" ? "n" : "srelax";
    const S2 = c.sel.map(id => c.items.find(i => i._id === id)).filter(it => it && kinds.includes(it.t));
    if (S2.length)
      commit(
        S2.map(it => [it._id, it, { ...it, c: v }]),
        c.bid,
      );
  };
  const menu = e =>
    openSheet({
      title: "Board",
      at: e.currentTarget,
      Body: ({ close }) => html`<div class="acts">
      <button class="mi" onClick=${() => {
        close();
        fit();
      }}><${Icon} n="grid"/><span>Fit everything</span><em>Shift+1</em></button>
      <button class="mi" onClick=${() => {
        close();
        exportPNG(cur.current.items, cur.current.title);
      }}><${Icon} n="image"/><span>Export PNG</span></button>
      <div class="sep"/>
      <button class=${"mi gf" + (snap ? " on" : "")} role="switch" aria-checked=${String(snap)} onClick=${() => setSnap(!snap)}><${Icon} n="snap"/><span>Snap shapes when you lift</span><i class="tsw"/></button>
      ${pen ? html`<button class=${"mi gf" + (finger ? " on" : "")} role="switch" aria-checked=${String(finger)} onClick=${() => setFinger(!finger)}><${Icon} n="hand"/><span>Fingers draw too (stylus seen)</span><i class="tsw"/></button>` : null}
    </div>`,
    });
  /* size buttons: what you draw next, and whatever is selected right now */
  const selIts = () => {
      const c = cur.current;
      return c.sel.map(id => c.items.find(i => i._id === id)).filter(Boolean);
    },
    txtSel = selIts().filter(it => it.t === "x" || it.t === "n"),
    hasTxt = txtSel.length > 0,
    txt = tool === "text" || tool === "note" || (tool === "select" && hasTxt);
  const pickSize = i => {
    setSize(i);
    const c = cur.current,
      ch = [];
    selIts().forEach(it => {
      if (it.t === "x") ch.push([it._id, it, { ...it, f: SZ.text[i] }]);
      else if (it.t === "n") {
        const f = SZ.note[i],
          k = f / (it.f || 16);
        ch.push([it._id, it, { ...it, f, w: r1((it.w || 180) * k), h: r1((it.h || 140) * k) }]);
      } else if ("rela".includes(it.t)) ch.push([it._id, it, { ...it, l: SZ.shape[i] }]);
    });
    if (ch.length) commit(ch, c.bid);
  };
  const scaleText = k => {
    const c = cur.current,
      ch = [];
    selIts().forEach(it => {
      if (it.t !== "x" && it.t !== "n") return;
      const f = Math.max(8, Math.min(240, r1((it.f || (it.t === "x" ? 18 : 16)) * k)));
      ch.push([
        it._id,
        it,
        it.t === "n"
          ? { ...it, f, w: r1(((it.w || 180) * f) / (it.f || 16)), h: r1(((it.h || 140) * f) / (it.f || 16)) }
          : { ...it, f },
      ]);
    });
    if (ch.length) commit(ch, c.bid);
  };
  const styleSheet = e =>
    openSheet({
      title: "Colour & size",
      at: e.currentTarget,
      Body: () => html`<div class="wbsh"><${Swatches}/></div>`,
    });
  const Swatches =
    () => html`<div class="wbsw" role="group" aria-label="Colour">${pal.map(v => html`<button class="wsw" aria-label=${v ? "Colour " + v : "Ink"} aria-pressed=${String(v === col)} style=${v ? "--c:" + v : ""} onClick=${() => pick(v)}/>`)}</div>
    <div class="wbsz" role="group" aria-label=${txt ? "Text size" : "Size"}>${[0, 1, 2].map(i => html`<button class=${"sz" + (txt ? " tz" : "")} aria-label=${txt ? ["Small", "Medium", "Large"][i] + " text" : ["Thin", "Medium", "Thick"][i]} aria-pressed=${String(i === size)} onClick=${() => pickSize(i)}>${txt ? html`<b style=${"font-size:" + (11 + i * 4) + "px"}>A</b>` : html`<i style=${"--d:" + (3 + i * 3.5) + "px"}/>`}</button>`)}
      ${hasTxt ? html`<button class="sz tz" aria-label="Smaller text" title="Smaller text" onClick=${() => scaleText(1 / 1.15)}><b style="font-size:11px">A−</b></button><button class="sz tz" aria-label="Bigger text" title="Bigger text" onClick=${() => scaleText(1.15)}><b style="font-size:14px">A+</b></button>` : null}</div>`;
  const tb = ([id, ic, l, k]) =>
    html`<button key=${id} class="btn wt" aria-label=${l} title=${l + " (" + k.toUpperCase() + ")"} aria-pressed=${String(tool === id)} onClick=${() => {
      setTool(id);
      if (id !== "select") setSel([]);
    }}><${Icon} n=${ic}/></button>`;
  const hint =
    tool === "pen"
      ? snap
        ? "Snap is on: shapes clean up when you lift"
        : "Hold still at the end of a stroke to snap a shape"
      : tool === "select"
        ? "Drag to move · corners resize · double-click text to edit"
        : tool === "text"
          ? "Click to type · end a line with = to work it out · $x^2$ for maths"
          : tool === "eraser"
            ? "Drag across strokes to erase"
            : tool === "note"
              ? "Click to stick a note"
              : tool === "hand"
                ? "Drag to pan · wheel or pinch to zoom"
                : "Drag to draw · Shift keeps it straight";
  const e2 = edit && edit.it,
    v = s.view;
  return html`<${Tools} cls="wbtools">
      <${Btn} cls="wbb" icon="whiteboard" aria-label="Boards" title="Boards" onClick=${e => openSheet({ title: "Boards", at: e.currentTarget, Body: BoardList, props: { cur: bid } })}><span class="wbn">${board ? board.title : "New board"}</span><${Icon} n="chev"/><//>
      <${Btn} cls="ib" aria-label="Undo" title="Undo (Ctrl+Z)" onClick=${() => {
        undo();
        setSel([]);
      }}><${Icon} n="undo"/><//>
      <${Btn} cls="ib" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick=${redo}><${Icon} n="redo"/><//>
      ${sel.length ? html`<${Btn} cls="ib" aria-label="Delete selection" title="Delete" onClick=${delSel}><${Icon} n="trash"/><//><${Btn} cls="ib" aria-label="Duplicate selection" title="Duplicate (Ctrl+D)" onClick=${() => dupSel()}><${Icon} n="cards"/><//>` : null}
      <span class="wsp"/>
      <${Btn} cls="ib wsn" aria-label="Snap shapes" title="Snap shapes when you lift" aria-pressed=${String(snap)} onClick=${() => setSnap(!snap)}><${Icon} n="snap"/><span class="wsl">Snap</span><//>
      <${Btn} cls="ib" aria-label="Board options" title="More" onClick=${menu}><${Icon} n="more"/><//><//>
    <div class="gbox wbx" ref=${box} tabindex="0" data-tool=${tool} onKeyDown=${key} onCopy=${copy} onCut=${cut} onPaste=${paste} aria-label="Whiteboard">
      <canvas ref=${cv} aria-hidden="true"/>
      <canvas ref=${top} class="wtop" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onContextMenu=${e => e.preventDefault()}
        onPointerLeave=${() => {
          if (s.mode && s.mode.k === "erase") {
            s.mode.at = null;
            need(2);
          }
        }} onDblClick=${e => {
          const [x, y] = toW(e.clientX, e.clientY),
            it = topAt(x, y);
          if (it && (it.t === "x" || it.t === "n") && !cur.current.edit) startEdit(it, false);
        }}/>
      <div class="wbox win" role="toolbar" aria-label="Tools">
        <div class="wtg">${TOOLS.map(tb)}</div>
        ${phone ? html`<button class="btn wt wst" aria-label="Colour and size" onClick=${styleSheet}><i class="wsw" style=${col ? "--c:" + col : ""}/></button>` : html`<div class="wsep"/><${Swatches}/>`}
      </div>
      ${!phone ? html`<div class="wzoom"><button class="btn ib" aria-label="Zoom out" onClick=${() => zoomBy(0.8)}><${Icon} n="minus"/></button><button class="btn wzp" title="Fit everything" onClick=${() => fit()}>${zoom}%</button><button class="btn ib" aria-label="Zoom in" onClick=${() => zoomBy(1.25)}><${Icon} n="plus"/></button></div>` : null}
      <ul class="wsr">${items
        .filter(i => i.t === "x" || i.t === "n")
        .slice(0, 200)
        .map(i => html`<li key=${i._id}>${geo(i).L.text}</li>`)}</ul>
      ${!items.length && !edit ? html`<div class="wempty"><b>${tool === "pen" || tool === "hl" ? "Draw anywhere" : "Pick the pen and draw anywhere"}</b>${hint ? html`<small>${hint}</small>` : null}</div>` : null}
      ${
        e2
          ? html`<textarea ref=${ta} class=${"wta" + (e2.t === "n" ? " note" : "")} spellcheck="false" aria-label=${e2.t === "n" ? "Note text" : "Text"} value=${edit.v}
        style=${`left:${e2.x * v.k + v.x}px;top:${(e2.y + (e2.t === "n" ? (e2.f || 16) * NPAD * 0.7 : -(e2.f || 16) * 0.1)) * v.k + v.y}px;font-size:${(e2.f || 16) * v.k}px;${e2.t === "n" ? `width:${(e2.w || 180) * v.k}px;min-height:${(e2.h || 140) * v.k - (e2.f || 16) * NPAD * 0.7 * v.k}px;padding:0 ${(e2.f || 16) * NPAD * v.k}px ${(e2.f || 16) * NPAD * v.k}px;background:${e2.c || NOTE[0]};` : `color:${e2.c || "var(--ink)"};`}`}
        onInput=${e => {
          edit.v = e.target.value;
          fitTa();
        }} onBlur=${finishEdit}
        onKeyDown=${e => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            finishEdit();
          }
        }}/>`
          : null
      }
    </div>
    <${StatusBar} items=${[plural(items.length, "item"), phone ? null : zoom + "%"]}/>`;
}

const textOf = b =>
  D.ink
    .filter(i => i.b === b && i.s)
    .map(i => i.s)
    .join(" ");
export default {
  id: "whiteboard",
  name: "Whiteboard",
  title: "whiteboard",
  Comp: Whiteboard,
  search: q => {
    const out = [];
    D.boards.forEach(b => {
      if ((b.title || "").toLowerCase().includes(q))
        out.push({ icon: "whiteboard", l: "Board: " + b.title, r: () => openBoard(b._id) });
    });
    D.ink.forEach(i => {
      if (i.s && out.length < 5 && i.s.toLowerCase().includes(q)) {
        const b = D.boards.find(x => x._id === i.b);
        if (b)
          out.push({
            icon: "whiteboard",
            l: "On " + b.title + ": " + i.s.replace(/\s+/g, " ").slice(0, 40),
            r: () => openBoard(b._id, i._id),
          });
      }
    });
    return out.slice(0, 4);
  },
  cmd: (v, arg) => {
    if (!["board", "whiteboard", "draw", "wb", "sketch"].includes(v)) return [];
    if (!arg) return [{ icon: "whiteboard", l: "Open Whiteboard", r: () => openMod("whiteboard", true) }];
    const lo = arg.toLowerCase(),
      m = D.boards.filter(b => (b.title || "").toLowerCase().includes(lo));
    return [
      ...m
        .slice(0, 3)
        .map(b => ({ icon: "whiteboard", l: "Open board: " + b.title, r: () => openBoard(b._id) })),
      ...(m.some(b => b.title.toLowerCase() === lo)
        ? []
        : [
            {
              icon: "whiteboard",
              l: "New board: " + arg,
              r: () => {
                newBoard(arg);
                openMod("whiteboard", true);
              },
            },
          ]),
    ];
  },
  textOf,
};

export * from "./whiteboard-draw.js";
