/* graph.exe: every page is a node; connections (rels) are solid edges, [[links]] dashed.
   Force layout on a canvas (grid-approximated repulsion, so it stays smooth with thousands of nodes),
   pan / pinch / wheel zoom, drag nodes, search, kind filters, focus on a node's neighbourhood. */
import { useState, useEffect, useRef } from "preact/hooks";
import { html, plural } from "../core/lib.js";
import { ls, usePref } from "../core/pref.js";
import { useCols, D } from "../core/store.js";
import { Tools, StatusBar, Btn, Field, Icon, Seg } from "../ui/index.js";
import { openMod } from "../shell/os.js";
import { KINDS, openPage, byTitle, newPage, makePage } from "./pages.js";
import { wikiTargets } from "../core/md.js";
import { AddRel, relsOf, connect } from "./rels.js";
import { openSheet } from "../ui/sheet.js";

const low = s =>
  String(s || "")
    .trim()
    .toLowerCase();
const SIM = {
  nodes: new Map(),
  edges: [],
  alpha: 1,
  view: { x: 0, y: 0, k: 1 },
  pos: ls.get("os-graph-pos", {}),
};

/* rebuild nodes/edges from the store, keeping positions of nodes we already had */
function rebuild() {
  const byT = new Map(D.pages.map(p => [low(p.title), p._id])),
    ids = new Set(D.pages.map(p => p._id));
  const edges = [],
    seen = new Set();
  D.rels.forEach(r => {
    if (ids.has(r.a) && ids.has(r.b) && r.a !== r.b)
      edges.push({ a: r.a, b: r.b, label: r.label || "", rel: true });
    seen.add(r.a + ">" + r.b);
    seen.add(r.b + ">" + r.a);
  });
  D.pages.forEach(p =>
    wikiTargets(p.body).forEach(t => {
      const b = byT.get(t);
      if (b && b !== p._id && !seen.has(p._id + ">" + b)) {
        seen.add(p._id + ">" + b);
        seen.add(b + ">" + p._id);
        edges.push({ a: p._id, b, label: "", rel: false });
      }
    }),
  );
  const deg = {};
  edges.forEach(e => {
    deg[e.a] = (deg[e.a] || 0) + 1;
    deg[e.b] = (deg[e.b] || 0) + 1;
  });
  const old = SIM.nodes,
    nodes = new Map();
  D.pages.forEach(p => {
    let n = old.get(p._id);
    if (!n) {
      const sp = SIM.pos[p._id],
        nb = edges.find(e => e.a === p._id || e.b === p._id),
        anchor = nb && old.get(nb.a === p._id ? nb.b : nb.a);
      n = {
        id: p._id,
        x: sp ? sp[0] : anchor ? anchor.x + (Math.random() - 0.5) * 60 : (Math.random() - 0.5) * 400,
        y: sp ? sp[1] : anchor ? anchor.y + (Math.random() - 0.5) * 60 : (Math.random() - 0.5) * 400,
        vx: 0,
        vy: 0,
      };
    }
    n.title = p.title || "Untitled";
    n.kind = p.kind || "note";
    n.icon = p.icon || "";
    n.deg = deg[p._id] || 0;
    n.r = 6 + Math.min(14, Math.sqrt(n.deg) * 2.6);
    nodes.set(p._id, n);
  });
  SIM.nodes = nodes;
  SIM.edges = edges.filter(e => nodes.has(e.a) && nodes.has(e.b));
  if (nodes.size !== old.size) SIM.alpha = Math.max(SIM.alpha, 0.5);
}

/* one physics step over the visible nodes */
function step(vis) {
  const a = SIM.alpha,
    list = vis,
    C = 140,
    cells = new Map();
  for (const n of list) {
    const k = Math.floor(n.x / C) + "," + Math.floor(n.y / C);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { x: 0, y: 0, m: 0, ns: [] }));
    c.x += n.x;
    c.y += n.y;
    c.m++;
    c.ns.push(n);
  }
  for (const c of cells.values()) {
    c.x /= c.m;
    c.y /= c.m;
  }
  const R = 900 * a;
  for (const n of list) {
    const cx = Math.floor(n.x / C),
      cy = Math.floor(n.y / C);
    for (const [k, c] of cells) {
      const [gx, gy] = k.split(",").map(Number);
      if (Math.abs(gx - cx) <= 1 && Math.abs(gy - cy) <= 1) {
        for (const o of c.ns) {
          if (o === n) continue;
          let dx = n.x - o.x,
            dy = n.y - o.y,
            d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const f = R / d2;
          n.vx += dx * f;
          n.vy += dy * f;
        }
      } else {
        const dx = n.x - c.x,
          dy = n.y - c.y,
          d2 = dx * dx + dy * dy + 1;
        const f = (R * c.m) / d2;
        n.vx += dx * f;
        n.vy += dy * f;
      }
    }
    n.vx -= n.x * 0.004 * a;
    n.vy -= n.y * 0.004 * a;
  }
  for (const e of SIM.edges) {
    const s = SIM.nodes.get(e.a),
      t = SIM.nodes.get(e.b);
    if (!s.on || !t.on) continue;
    const dx = t.x - s.x,
      dy = t.y - s.y,
      d = Math.sqrt(dx * dx + dy * dy) || 1,
      want = e.rel ? 90 : 120,
      f = ((d - want) / d) * 0.06 * a;
    s.vx += dx * f;
    s.vy += dy * f;
    t.vx -= dx * f;
    t.vy -= dy * f;
  }
  for (const n of list) {
    if (n.fixed) {
      n.vx = n.vy = 0;
      continue;
    }
    n.vx *= 0.55;
    n.vy *= 0.55;
    n.x += Math.max(-40, Math.min(40, n.vx));
    n.y += Math.max(-40, Math.min(40, n.vy));
  }
  SIM.alpha *= 0.985;
}

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function shape(g, kind, x, y, r) {
  g.beginPath();
  if (kind === "person") g.arc(x, y, r, 0, Math.PI * 2);
  else if (kind === "company") g.rect(x - r, y - r, r * 2, r * 2);
  else if (kind === "place") {
    g.moveTo(x, y - r * 1.25);
    g.lineTo(x + r * 1.1, y);
    g.lineTo(x, y + r * 1.25);
    g.lineTo(x - r * 1.1, y);
    g.closePath();
  } else if (kind === "thing") {
    g.moveTo(x, y - r * 1.2);
    g.lineTo(x + r * 1.15, y + r * 0.85);
    g.lineTo(x - r * 1.15, y + r * 0.85);
    g.closePath();
  } else if (kind === "subject") {
    g.rect(x - r * 1.2, y - r * 0.85, r * 2.4, r * 1.7);
  } else g.arc(x, y, r * 0.75, 0, Math.PI * 2);
}

/* what the graph shows: one button opens this instead of a row of toggles */
const GKINDS = () =>
  [...KINDS, ["subject", "Subject"]].filter((k, i, a) => a.findIndex(x => x[0] === k[0]) === i);
function GraphFilter() {
  const [hide, setHide] = usePref("os-graph-hide", []),
    [links, setLinks] = usePref("os-graph-links", true);
  const row = (ic, l, on, f) =>
    html`<button class=${"mi gf" + (on ? " on" : "")} role="switch" aria-checked=${String(on)} onClick=${f}><${Icon} n=${ic}/><span>${l}</span><i class="tsw"/></button>`;
  return html`<div class="acts">${GKINDS().map(([k, l]) => row(k, l === "Person" ? "People" : l === "Company" ? "Companies" : l + "s", !hide.includes(k), () => setHide(hide.includes(k) ? hide.filter(x => x !== k) : [...hide, k])))}
    <div class="sep"/>${row("wiki", "Links inside pages (dashed)", links, () => setLinks(!links))}
    ${hide.length ? html`<div class="sep"/><button class="mi" onClick=${() => setHide([])}><${Icon} n="reset"/><span>Show everything</span></button>` : null}</div>`;
}

function Graph() {
  useCols("pages", "rels");
  const box = useRef(),
    cv = useRef(),
    raf = useRef(0),
    st = useRef({ hover: null, drag: null, pan: null, pts: new Map(), pinch: null, moved: 0, lastTap: 0 });
  const [sel, setSel] = useState(null),
    [q, setQ] = useState("");
  const [hide, setHide] = usePref("os-graph-hide", []),
    [links, setLinks] = usePref("os-graph-links", true),
    [depth, setDepth] = useState(0);
  const [, tick] = useState(0);

  rebuild();
  /* what's shown: kind filters, notes with no edges are left out, focus = n hops around the selected node */
  const near = new Set();
  if (sel && depth && SIM.nodes.has(sel)) {
    let fr = [sel];
    near.add(sel);
    for (let i = 0; i < depth; i++) {
      const nx = [];
      for (const id of fr)
        for (const e of SIM.edges) {
          if (!links && !e.rel) continue;
          const o = e.a === id ? e.b : e.b === id ? e.a : null;
          if (o && !near.has(o)) {
            near.add(o);
            nx.push(o);
          }
        }
      fr = nx;
    }
  }
  for (const n of SIM.nodes.values())
    n.on =
      !hide.includes(n.kind) &&
      !(n.kind === "note" && n.deg === 0 && n.id !== sel) &&
      (!near.size || near.has(n.id));
  const vis = [...SIM.nodes.values()].filter(n => n.on);
  /* the animation loop outlives renders, so it reads the latest state from here */
  const cur = useRef({});
  cur.current = { vis, sel, links };

  const draw = () => {
    const c = cv.current;
    if (!c) return;
    const { vis, sel, links } = cur.current;
    const g = c.getContext("2d"),
      dpr = devicePixelRatio || 1,
      W = c.width / dpr,
      H = c.height / dpr,
      v = SIM.view;
    const ink = css("--ink") || "#111",
      paper = css("--paper") || "#fff",
      selc = css("--sel") || "#2a2a2a",
      mute = css("--ink-3") || "#888";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = paper;
    g.fillRect(0, 0, W, H);
    g.translate(W / 2 + v.x, H / 2 + v.y);
    g.scale(v.k, v.k);
    const hl = st.current.hover || sel,
      nb = new Set();
    if (hl)
      SIM.edges.forEach(e => {
        if (e.a === hl) nb.add(e.b);
        if (e.b === hl) nb.add(e.a);
      });
    g.lineCap = "round";
    for (const e of SIM.edges) {
      if (!e.rel && !links) continue;
      const s = SIM.nodes.get(e.a),
        t = SIM.nodes.get(e.b);
      if (!s.on || !t.on) continue;
      const hot = hl && (e.a === hl || e.b === hl);
      g.strokeStyle = hot ? selc : e.rel ? ink : mute;
      g.globalAlpha = hl && !hot ? 0.25 : e.rel ? 0.7 : 0.5;
      g.lineWidth = (hot ? 2 : e.rel ? 1.2 : 1) / Math.sqrt(v.k);
      g.setLineDash(e.rel ? [] : [4 / v.k, 4 / v.k]);
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(t.x, t.y);
      g.stroke();
      if (e.rel && e.label && (v.k > 1.1 || hot)) {
        g.setLineDash([]);
        g.globalAlpha = hl && !hot ? 0.3 : 1;
        const mx = (s.x + t.x) / 2,
          my = (s.y + t.y) / 2;
        g.font = 10 / v.k + "px Tahoma, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.lineWidth = 3 / v.k;
        g.strokeStyle = paper;
        g.strokeText(e.label, mx, my);
        g.fillStyle = mute;
        g.fillText(e.label, mx, my);
      }
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    /* sizes stay readable on screen at any zoom; small graphs are always labelled */
    const fs = 11.5 / v.k,
      showAll = vis.length < 150 || v.k > 0.55;
    g.font = "700 " + fs + "px Tahoma, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const n of vis) {
      const on = n.id === sel,
        hot = n.id === hl || nb.has(n.id),
        dim = hl && !hot;
      const r = Math.max(n.r, 5 / v.k);
      g.globalAlpha = dim ? 0.3 : 1;
      shape(g, n.kind, n.x, n.y, r);
      g.fillStyle = on ? selc : n.kind === "note" ? paper : ink;
      g.fill();
      g.lineWidth = (on ? 3 : 1.5) / Math.sqrt(v.k);
      g.strokeStyle = on ? ink : ink;
      g.stroke();
      if (n.icon) {
        g.font = r * 1.2 + "px sans-serif";
        g.textBaseline = "middle";
        g.fillText(n.icon, n.x, n.y + 1);
        g.font = "700 " + fs + "px Tahoma, sans-serif";
        g.textBaseline = "top";
      }
      if (showAll || on || hot || n.deg > 4) {
        const ty = n.y + r + 3 / v.k;
        g.lineWidth = 3 / v.k;
        g.strokeStyle = paper;
        g.strokeText(n.title, n.x, ty);
        g.fillStyle = ink;
        g.fillText(n.title, n.x, ty);
      }
    }
    g.globalAlpha = 1;
  };
  const loop = () => {
    raf.current = 0;
    if (SIM.alpha > 0.02 || st.current.drag) {
      step(cur.current.vis);
      draw();
      raf.current = requestAnimationFrame(loop);
    } else {
      draw();
      const p = {};
      SIM.nodes.forEach(n => {
        p[n.id] = [Math.round(n.x), Math.round(n.y)];
      });
      SIM.pos = p;
      ls.set("os-graph-pos", p);
    }
  };
  const kick = (a = 0.3) => {
    SIM.alpha = Math.max(SIM.alpha, a);
    if (!raf.current) raf.current = requestAnimationFrame(loop);
  };
  const redraw = () => {
    if (!raf.current) draw();
  };

  /* canvas size follows the window */
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const c = cv.current,
        b = box.current;
      if (!c || !b) return;
      const dpr = devicePixelRatio || 1,
        r = b.getBoundingClientRect();
      c.width = Math.max(10, r.width * dpr);
      c.height = Math.max(10, r.height * dpr);
      c.style.width = r.width + "px";
      c.style.height = r.height + "px";
      draw();
    });
    ro.observe(box.current);
    kick(0.6);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);
  useEffect(() => {
    kick(0.25);
  }, [D.pages.length, D.rels.length, hide.join(), links, depth, sel]);
  /* first time there's data: settle the layout before showing it (works even while the tab is hidden), then fit it on screen */
  const warm = useRef(false);
  useEffect(() => {
    if (warm.current || !vis.length) return;
    warm.current = true;
    const fresh = vis.filter(n => !SIM.pos[n.id]).length > vis.length / 3;
    if (fresh) {
      SIM.alpha = 1;
      const t0 = performance.now();
      for (let i = 0; i < 300 && performance.now() - t0 < 900; i++) step(vis);
    }
    fit();
    kick(fresh ? 0.05 : 0.1);
  }, [vis.length]);
  useEffect(redraw);

  const toWorld = (px, py) => {
    const c = cv.current.getBoundingClientRect(),
      v = SIM.view;
    return [(px - c.left - c.width / 2 - v.x) / v.k, (py - c.top - c.height / 2 - v.y) / v.k];
  };
  const hit = (px, py) => {
    const [x, y] = toWorld(px, py),
      k = SIM.view.k;
    let best = null,
      bd = 1e9;
    for (const n of vis) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < Math.max(n.r, 5 / k) + 10 / k && d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };
  const center = n => {
    SIM.view.x = -n.x * SIM.view.k;
    SIM.view.y = -n.y * SIM.view.k;
    redraw();
  };
  const fit = () => {
    const vis = cur.current.vis;
    if (!vis.length || !box.current) return;
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1e9,
      y1 = -1e9;
    vis.forEach(n => {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    });
    const r = box.current.getBoundingClientRect(),
      k = Math.min(2, Math.max(0.08, Math.min(r.width / (x1 - x0 + 120), r.height / (y1 - y0 + 120))));
    SIM.view = { k, x: (-(x0 + x1) / 2) * k, y: (-(y0 + y1) / 2) * k };
    redraw();
  };

  const down = e => {
    const s = st.current;
    cv.current.setPointerCapture(e.pointerId);
    s.pts.set(e.pointerId, [e.clientX, e.clientY]);
    s.moved = 0;
    if (s.pts.size === 2) {
      const [a, b] = [...s.pts.values()];
      s.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: SIM.view.k };
      s.drag = null;
      s.pan = null;
      return;
    }
    const n = hit(e.clientX, e.clientY);
    if (n) {
      s.drag = n;
      n.fixed = true;
      kick(0.15);
    } else s.pan = [e.clientX, e.clientY, SIM.view.x, SIM.view.y];
  };
  const move = e => {
    const s = st.current;
    if (!s.pts.has(e.pointerId)) {
      const n = hit(e.clientX, e.clientY);
      const id = n && n.id;
      if (id !== s.hover) {
        s.hover = id;
        cv.current.style.cursor = n ? "pointer" : "grab";
        redraw();
      }
      return;
    }
    const p0 = s.pts.get(e.pointerId);
    s.moved += Math.abs(e.clientX - p0[0]) + Math.abs(e.clientY - p0[1]);
    s.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (s.pinch && s.pts.size === 2) {
      const [a, b] = [...s.pts.values()];
      SIM.view.k = Math.min(
        4,
        Math.max(0.08, (s.pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1])) / s.pinch.d),
      );
      redraw();
      return;
    }
    if (s.drag) {
      const [x, y] = toWorld(e.clientX, e.clientY);
      s.drag.x = x;
      s.drag.y = y;
      kick(0.12);
    } else if (s.pan) {
      SIM.view.x = s.pan[2] + e.clientX - s.pan[0];
      SIM.view.y = s.pan[3] + e.clientY - s.pan[1];
      redraw();
    }
  };
  const up = e => {
    const s = st.current;
    s.pts.delete(e.pointerId);
    if (s.pts.size < 2) s.pinch = null;
    const tap = s.moved < 8,
      n = s.drag;
    if (n) {
      n.fixed = false;
      s.drag = null;
    }
    s.pan = null;
    if (tap) {
      const t = hit(e.clientX, e.clientY),
        now = Date.now();
      if (t && t.id === sel && now - s.lastTap < 400) {
        openPage(t.id);
        return;
      }
      s.lastTap = now;
      setSel(t ? t.id : null);
      if (!t) setDepth(0);
    }
  };
  const wheel = e => {
    e.preventDefault();
    const v = SIM.view,
      c = cv.current.getBoundingClientRect(),
      k = Math.min(4, Math.max(0.08, v.k * Math.exp(-e.deltaY * 0.0015)));
    const mx = e.clientX - c.left - c.width / 2,
      my = e.clientY - c.top - c.height / 2;
    v.x = mx - ((mx - v.x) * k) / v.k;
    v.y = my - ((my - v.y) * k) / v.k;
    v.k = k;
    redraw();
  };
  useEffect(() => {
    const c = cv.current;
    c.addEventListener("wheel", wheel, { passive: false });
    return () => c.removeEventListener("wheel", wheel);
  }, []);

  const find = () => {
    const ql = low(q);
    if (!ql) return;
    const n =
      vis.find(x => low(x.title) === ql) ||
      vis.find(x => low(x.title).includes(ql)) ||
      [...SIM.nodes.values()].find(x => low(x.title).includes(ql));
    if (n) {
      if (!n.on) {
        setHide(hide.filter(k => k !== n.kind));
        setDepth(0);
      }
      setSel(n.id);
      if (SIM.view.k < 0.9) SIM.view.k = 1.2;
      center(n);
    }
  };
  const sp = sel && D.pages.find(p => p._id === sel);
  const conns = sp
    ? relsOf(sp._id)
        .map(r => ({ r, o: D.pages.find(p => p._id === (r.a === sp._id ? r.b : r.a)), out: r.a === sp._id }))
        .filter(x => x.o)
    : [];
  const kinds = [...KINDS, ["subject", "Subject"]].filter((k, i, a) => a.findIndex(x => x[0] === k[0]) === i);
  return html`<${Tools} cls="gtools"><${Field} w="w" type="search" placeholder="Find someone or something" aria-label="Find in graph" value=${q} onInput=${e => setQ(e.target.value)} onEnter=${find}/>
      <${Btn} cls="gfb" icon="list" aria-label="Choose what to show" title="Choose what to show" onClick=${e => openSheet({ title: "Show in graph", Body: GraphFilter, at: e.currentTarget })}>Show${hide.length ? html`<b class="gfn">${GKINDS().length - hide.length}/${GKINDS().length}</b>` : null}<//>
      <${Btn} cls="ib" title="Fit everything" aria-label="Fit" onClick=${fit}><${Icon} n="grid"/><//><//>
    <div class="gbox" ref=${box}><canvas ref=${cv} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onPointerLeave=${e => {
      if (!st.current.pts.size && st.current.hover) {
        st.current.hover = null;
        redraw();
      }
    }}/>
      ${!vis.length ? html`<div class="gempty"><p>${D.pages.length ? "Nothing to show with these filters." : "No pages yet. Make a person and connect them to things."}</p><${Btn} go icon="person" onClick=${() => newPage({ title: "Someone", kind: "person" })}>New person<//></div>` : null}
      ${
        sp
          ? html`<div class="gp win">
        <div class="tb"><span class="t">${sp.title}</span><span class="cap x" role="button" tabindex="0" aria-label="Close" onClick=${() => {
          setSel(null);
          setDepth(0);
        }}><i/></span></div>
        <div class="gpb">
          <div class="gpm"><${Icon} n=${sp.kind || "note"}/>${(KINDS.find(k => k[0] === (sp.kind || "note")) || ["", "Page"])[1]} · ${plural(conns.length, "connection")}</div>
          <div class="gpc">${conns.slice(0, 12).map(
            ({ r, o, out }) =>
              html`<button class="cxr2" onClick=${() => {
                setSel(o._id);
                const n = SIM.nodes.get(o._id);
                if (n) center(n);
              }}><span class="cl">${r.label || "linked"}</span>${out ? "→" : "←"} <b>${o.title}</b></button>`,
          )}${conns.length > 12 ? html`<small>+${conns.length - 12} more</small>` : null}</div>
          <${AddRel} id=${sp._id} compact/>
          <div class="gpa"><${Btn} go icon="open" onClick=${() => openPage(sp._id)}>Open page<//>
            <${Seg}>${[
              [0, "All"],
              [1, "1 hop"],
              [2, "2 hops"],
            ].map(
              ([d, l]) =>
                html`<${Btn} aria-pressed=${String(depth === d)} onClick=${() => setDepth(d)}>${l}<//>`,
            )}<//></div>
        </div></div>`
          : null
      }
    </div>
    <${StatusBar} items=${[plural(vis.length, "node") + " shown", plural(SIM.edges.filter(e => e.rel).length, "connection")]}/>`;
}

export default {
  id: "graph",
  name: "Graph",
  title: "graph",
  Comp: Graph,
  cmd: (v, arg) => {
    if (v === "graph") return [{ icon: "graph", l: "Open Graph", r: () => openMod("graph", true) }];
    /* link Mom > works at > Acme */
    if (v === "link") {
      const m = arg.split(">").map(s => s.trim());
      if (m.length === 3 && m[0] && m[2])
        return [
          {
            icon: "graph",
            l: "Connect " + m[0] + " · " + m[1] + " · " + m[2],
            r: () => {
              const a = byTitle(m[0]),
                id = a ? a._id : makePage({ title: m[0], kind: "person" });
              connect(id, m[1], m[2]);
              openMod("graph", true);
            },
          },
        ];
      return [{ l: "link Mom > works at > Acme", hint: true }];
    }
    return [];
  },
};
