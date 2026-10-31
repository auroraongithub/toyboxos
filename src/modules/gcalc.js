/* calc.exe: a scientific calculator (core/calc.js) and a Desmos-style grapher (core/graphmath.js), saved to `graphs`. */
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { html } from "../core/lib.js";
import { ls, usePref, useMedia } from "../core/pref.js";
import { toast, warn } from "../core/bus.js";
import { useCols, W, D } from "../core/store.js";
import { calc, convert, fmtNum } from "../core/calc.js";
import { mathBox } from "../core/mathtype.js";
import { compileAll, trace, implicit, roots, extrema } from "../core/graphmath.js";
import { Tools, Panel, StatusBar, Btn, Field, Tabs, Icon, Empty } from "../ui/index.js";
import { openSheet, askText } from "../ui/sheet.js";
import { openMod } from "../shell/os.js";
import "../styles/gcalc.css";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* mid-lightness hues that read on white, on grey and on the Night skin */
const PAL = ["#d6453d", "#2f7ed8", "#2e9e4f", "#8a5cd6", "#e08a1e", "#17a2b8", "#d6409f"];

/* ================= calculator ================= */
/* degree mode: sin(..) takes degrees, asin(..) returns them */
function degWrap(s) {
  let out = "",
    i = 0;
  while (i < s.length) {
    const m = s.slice(i).match(/^(a?(?:sin|cos|tan))\s*\(/i);
    if (m && !(i > 0 && /[a-z]/i.test(s[i - 1]))) {
      const inv = /^a/i.test(m[1]);
      let d = 1,
        j = i + m[0].length;
      while (j < s.length && d) {
        if (s[j] === "(") d++;
        else if (s[j] === ")") d--;
        j++;
      }
      const inner = degWrap(s.slice(i + m[0].length, d ? s.length : j - 1));
      out += inv ? `(180/pi*${m[1]}(${inner}))` : `${m[1]}(pi/180*(${inner}))`;
      i = j;
      continue;
    }
    out += s[i++];
  }
  return out;
}
export function evaluate(q, vars, deg) {
  const s = String(q).trim().replace(/=\s*$/, "").trim();
  if (!s) return null;
  const T = x => (deg ? degWrap(x) : x);
  const a = s.match(/^([a-zA-Z_]\w{0,15})\s*=\s*([^=]+)$/);
  if (a) {
    const v = calc(T(a[2]), vars);
    if (v != null) {
      vars[a[1]] = v;
      return { r: a[1] + " = " + fmtNum(v), v };
    }
  }
  const cv = convert(s, vars);
  if (cv != null) return { r: cv };
  const v = calc(T(s), vars);
  return v == null ? null : { r: fmtNum(v), v };
}
const KEYS = [
  ["sin(", "sin"],
  ["cos(", "cos"],
  ["tan(", "tan"],
  ["ln(", "ln"],
  ["log(", "log"],
  ["sqrt(", "√"],
  ["7"],
  ["8"],
  ["9"],
  ["/", "÷"],
  ["^", "xʸ"],
  ["!"],
  ["4"],
  ["5"],
  ["6"],
  ["*", "×"],
  ["pi", "π"],
  ["e"],
  ["1"],
  ["2"],
  ["3"],
  ["-", "−"],
  ["ans"],
  ["^2", "x²"],
  ["0"],
  ["."],
  ["%"],
  ["+"],
];

function Calculator() {
  const [hist, setHist] = usePref("os-calc-h", []);
  const [deg, setDeg] = usePref("os-calc-deg", false);
  const [q, setQ] = useState(""),
    vars = useRef({}).current,
    inp = useRef(),
    box = useRef();
  const coarse = useMedia("(pointer:coarse)");
  useEffect(() => {
    const t = box.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [hist.length]);
  const live = useMemo(() => {
    const r = q.trim() && evaluate(q, { ...vars }, deg);
    return r ? r.r : "";
  }, [q, deg]);
  const put = t => {
    const el = inp.current;
    if (!el) return setQ(q + t);
    const a = el.selectionStart ?? q.length,
      b = el.selectionEnd ?? q.length,
      n = q.slice(0, a) + t + q.slice(b);
    setQ(n);
    setTimeout(() => {
      if (!coarse) el.focus();
      try {
        el.setSelectionRange(a + t.length, a + t.length);
      } catch {
        // some inputs don't support selection
      }
    }, 0);
  };
  const go = () => {
    if (!q.trim()) return;
    const r = evaluate(q, vars, deg);
    if (!r) {
      toast("Can't work that out");
      return;
    }
    if (r.v != null) vars.ans = r.v;
    setHist([...hist, { q: q.trim(), r: r.r }].slice(-60));
    setQ(r.v != null ? "" : "");
  };
  const back = () => setQ(q.slice(0, -1));
  return html`<div class="calcx">
    <div class="chist selectable" ref=${box} aria-label="History">${
      hist.length
        ? hist.map(
            (h, i) => html`<div class="ch" key=${i}>
        <button class="chq" title="Use this expression" onClick=${() => put(h.q)}>${h.q}</button>
        <button class="chr" title="Use this result" onClick=${() => put(h.r.replace(/^.*= /, "").replace(/,/g, "").replace(/ .*$/, ""))}>= ${h.r}</button></div>`,
          )
        : html`<${Empty}>Type or tap. Try 2^10, 15% * 80, sin(30°), 5km in mi, 100 usd in php, x = 4.<//>`
    }</div>
    <div class="cin"><${Field} inputRef=${inp} cls="cinp" w="w" placeholder="Expression" aria-label="Expression" maxlength="200" inputmode=${coarse ? "none" : "text"} autocomplete="off" autocapitalize="off" spellcheck="false" value=${q} onInput=${e => setQ(e.target.value)} onEnter=${go}/>
      <div class="clive" aria-live="polite">${live ? "= " + live : ""}</div></div>
    <div class="ckeys" role="group" aria-label="Keypad">
      <button class=${"btn ck2" + (deg ? " on" : "")} aria-pressed=${String(deg)} title="Angle unit for sin/cos/tan" onClick=${() => setDeg(!deg)}>${deg ? "DEG" : "RAD"}</button>
      <button class="btn ck2" onClick=${() => setHist([])} title="Clear history">CH</button>
      <button class="btn ck2" onClick=${() => setQ("")}>C</button>
      <button class="btn ck2" aria-label="Backspace" onClick=${back}>⌫</button>
      <button class="btn ck2" onClick=${() => put("(")}>(</button>
      <button class="btn ck2" onClick=${() => put(")")}>)</button>
      ${KEYS.map(([v, l]) => html`<button class=${"btn ck1" + (/^\d$|^\.$/.test(v) ? " num" : "")} key=${v} onClick=${() => put(v)}>${l || v}</button>`)}
      <button class="btn ck2 go ceq" onClick=${go}>=</button>
    </div></div>`;
}

/* ================= grapher ================= */
const niceStep = (px, k) => {
  const t = px / k,
    p = Math.pow(10, Math.floor(Math.log10(t))),
    m = t / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
};
const fmtTick = (v, step) => {
  if (Math.abs(v) < step * 1e-9) return "0";
  if (Math.abs(v) >= 1e6 || step < 1e-4) return v.toExponential(1).replace(".0e", "e").replace("e+", "e");
  return String(parseFloat(v.toFixed(Math.max(0, -Math.floor(Math.log10(step))) + 1)));
};
const num = v => fmtNum(v, 5).replace(/,/g, "");
const BLANK = () => ({
  title: "Graph",
  rows: [{ id: uid(), t: "" }],
  vars: {},
  view: { cx: 0, cy: 0, k: 50 },
  tbl: { id: "", x0: 0, dx: 1 },
});
const DEMO = ["y = sin(x)"];

function Typeset({ src, color }) {
  const cv = useRef();
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    try {
      const b = mathBox(src, 15),
        dpr = devicePixelRatio || 1,
        w = Math.ceil(b.w + 4),
        h = Math.ceil(b.a + b.d + 4);
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = w + "px";
      c.style.height = h + "px";
      const g = c.getContext("2d");
      g.scale(dpr, dpr);
      g.fillStyle = g.strokeStyle = getComputedStyle(c).color;
      g.lineCap = "round";
      b.draw(g, 2, b.a + 2);
    } catch (e) {
      warn("calculator", e);
    }
  }, [src, color]);
  return html`<canvas ref=${cv} class="gts" aria-hidden="true"/>`;
}
const worthTypesetting = t => /[\^_]|sqrt|\/|theta|pi|\bsin|\bcos/.test(t) && t.length < 80;

function Grapher() {
  useCols("graphs");
  const [curId] = usePref("os-gr-cur", "");
  const phone = useMedia("(max-width:860px)");
  const [g, setG] = useState(BLANK);
  const [info, setInfo] = useState(null);
  const [tick, setTick] = useState(0);
  const box = useRef(),
    cv = useRef();
  const S = useRef({
    E: { x: 0, y: 0, t: 0, theta: 0 },
    view: { cx: 0, cy: 0, k: 50 },
    marks: [],
    paths: [],
    sel: null,
    loaded: null,
    ptr: new Map(),
    raf: 0,
    save: 0,
    an: 0,
    w: 0,
    h: 0,
  }).current;
  S.g = g;

  /* ---- load / save ---- */
  const save = now => {
    clearTimeout(S.save);
    S.save = setTimeout(
      () => {
        const d = { ...S.g, view: { ...S.view }, upd: new Date().toISOString() };
        if (!d.rows.some(r => r.t.trim()) && !S.loaded) return;
        if (!S.loaded) {
          S.loaded = uid();
          ls.set("os-gr-cur", S.loaded);
          d.at = d.upd;
        }
        W.set("graphs", S.loaded, d);
      },
      now ? 0 : 600,
    );
  };
  const load = d => {
    S.loaded = d._id;
    S.view = { cx: 0, cy: 0, k: 50, ...(d.view || {}) };
    const b = BLANK();
    setG({
      ...b,
      ...d,
      rows: d.rows && d.rows.length ? d.rows : b.rows,
      vars: d.vars || {},
      tbl: d.tbl || b.tbl,
    });
    setInfo(null);
    S.sel = null;
    need();
  };
  useEffect(() => {
    if (curId === "-") {
      if (S.loaded) {
        S.loaded = null;
        S.view = { cx: 0, cy: 0, k: 50 };
        setG(BLANK());
        S.sel = null;
        setInfo(null);
        need();
      }
      return;
    }
    const d =
      D.graphs.find(x => x._id === curId) ||
      (!curId && !S.loaded && D.graphs.slice().sort((a, b) => String(b.upd).localeCompare(String(a.upd)))[0]);
    if (d && S.loaded !== d._id) load(d);
  }, [curId, D.graphs.length]);
  useEffect(
    () => () => {
      clearTimeout(S.save);
    },
    [],
  );
  const patch = p => {
    const n = { ...S.g, ...p };
    S.g = n;
    setG(n);
    save();
  };

  /* ---- compile ---- */
  const key = g.rows.map(r => r.t).join("\n");
  const C = useMemo(() => {
    const r = compileAll(g.rows, S.E, g.vars);
    return r;
  }, [key]);
  useEffect(() => {
    /* free variables get sliders (value 1 to start) */
    const miss = [...C.free].filter(n => !g.vars[n]);
    if (miss.length) {
      const v = { ...g.vars };
      miss.forEach(n => {
        v[n] = { v: 1, min: -5, max: 5 };
      });
      patch({ vars: v });
    }
  }, [C]);
  const syncVars = () => {
    for (const n of C.free) {
      const v = S.g.vars[n];
      if (v) S.E[n] = v.v;
    }
  };
  /* constants a=2 were evaluated at compile; re-run after slider changes so b=a+1 follows */
  S.C = C;

  const toX = px => S.view.cx + (px - S.w / 2) / S.view.k,
    toY = py => S.view.cy - (py - S.h / 2) / S.view.k;
  const sX = x => S.w / 2 + (x - S.view.cx) * S.view.k,
    sY = y => S.h / 2 - (y - S.view.cy) * S.view.k;
  const colOf = (r, i) => r.c || PAL[i % PAL.length];

  function need() {
    if (!S.raf)
      S.raf = requestAnimationFrame(() => {
        S.raf = 0;
        draw();
      });
  }
  function analyse() {
    clearTimeout(S.an);
    S.an = setTimeout(() => {
      const { plans } = S.C,
        fns = [],
        marks = [],
        xl = toX(0),
        xr = toX(S.w);
      syncVars();
      S.g.rows.forEach((r, i) => {
        const p = plans[r.id];
        if (!p || r.h) return;
        if (p.kind === "fn") fns.push({ p, c: colOf(r, i), r });
      });
      for (const { p, c } of fns.slice(0, 8)) {
        const f = p.f;
        roots(f, xl, xr)
          .slice(0, 12)
          .forEach(x => marks.push({ x, y: 0, k: "root", c }));
        extrema(f, xl, xr)
          .slice(0, 12)
          .forEach(e => marks.push({ x: e.x, y: e.y, k: e.max ? "max" : "min", c }));
      }
      const F = fns.slice(0, 6);
      for (let i = 0; i < F.length; i++)
        for (let j = i + 1; j < F.length; j++) {
          const a = F[i].p.f,
            b = F[j].p.f;
          roots(x => a(x) - b(x), xl, xr, 500)
            .slice(0, 10)
            .forEach(x => {
              const y = a(x);
              if (isFinite(y)) marks.push({ x, y, k: "cross", c: F[j].c });
            });
        }
      S.g.rows.forEach((r, i) => {
        const p = plans[r.id];
        if (!p || r.h || p.kind !== "vline") return;
        const x = p.c();
        F.forEach(fn => {
          const y = fn.p.f(x);
          if (isFinite(y)) marks.push({ x, y, k: "cross", c: colOf(r, i) });
        });
      });
      S.marks = marks;
      need();
      setTick(n => n + 1);
    }, 140);
  }

  function draw() {
    const c = cv.current;
    if (!c || !S.w) return;
    const ctx = c.getContext("2d"),
      dpr = devicePixelRatio || 1,
      w = S.w,
      h = S.h,
      v = S.view,
      cs = getComputedStyle(box.current);
    const ink = cs.getPropertyValue("--ink").trim() || "#111",
      paper = cs.getPropertyValue("--paper").trim() || "#fff";
    syncVars();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    const target = phone ? 70 : 90,
      step = niceStep(target, v.k),
      p10 = Math.pow(10, Math.floor(Math.log10(step))),
      m = step / p10,
      sub = step / (m === 2 ? 4 : 5);
    const x0 = toX(0),
      x1 = toX(w),
      yT = toY(0),
      yB = toY(h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink;
    const grid = (st, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) {
        const px = Math.round(sX(x)) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
      }
      for (let y = Math.ceil(yB / st) * st; y <= yT; y += st) {
        const py = Math.round(sY(y)) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(w, py);
      }
      ctx.stroke();
    };
    if (sub * v.k >= 11) grid(sub, 0.07);
    grid(step, 0.17);
    /* axes + labels */
    const ax = Math.min(Math.max(sX(0), 0), w),
      ay = Math.min(Math.max(sY(0), 0), h);
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(ay) + 0.5);
    ctx.lineTo(w, Math.round(ay) + 0.5);
    ctx.moveTo(Math.round(ax) + 0.5, 0);
    ctx.lineTo(Math.round(ax) + 0.5, h);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = ink;
    ctx.font = "11px Tahoma,Verdana,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ly = Math.min(Math.max(ay + 4, 2), h - 14);
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      if (Math.abs(x) < step * 1e-6) continue;
      ctx.fillText(fmtTick(x, step), sX(x), ly);
    }
    const onLeft = ax > w - 40;
    ctx.textAlign = onLeft ? "right" : "left";
    ctx.textBaseline = "middle";
    const lx = onLeft ? ax - 5 : Math.max(ax + 5, 2);
    for (let y = Math.ceil(yB / step) * step; y <= yT; y += step) {
      if (Math.abs(y) < step * 1e-6) continue;
      ctx.fillText(fmtTick(y, step), lx, sY(y));
    }
    ctx.textAlign = onLeft ? "right" : "left";
    ctx.textBaseline = "top";
    ctx.fillText("0", lx, ly);
    ctx.globalAlpha = 1;
    /* curves */
    S.paths = [];
    const { plans } = S.C,
      big = Math.max(w, h) * 1.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2.2;
    g_rows: for (let i = 0; i < S.g.rows.length; i++) {
      const r = S.g.rows[i],
        p = plans[r.id];
      if (!p || r.h) continue;
      const col = colOf(r, i);
      ctx.strokeStyle = ctx.fillStyle = col;
      let segs = null;
      try {
        if (p.kind === "fn") {
          const f = p.f,
            rg = p.range ? [p.range[0](), p.range[1]()] : null;
          segs = trace(
            px => {
              const x = toX(px);
              if (rg && (x < rg[0] || x > rg[1])) return null;
              const y = f(x);
              if (!isFinite(y)) return null;
              const sy = sY(y);
              return Math.abs(sy) > 1e7 ? null : [px, sy];
            },
            -1,
            w + 1,
            w + 2,
            big,
          );
        } else if (p.kind === "xfn") {
          const f = p.f;
          segs = trace(
            py => {
              const y = toY(py),
                x = f(y);
              if (!isFinite(x)) return null;
              const sx = sX(x);
              return Math.abs(sx) > 1e7 ? null : [sx, py];
            },
            -1,
            h + 1,
            h + 2,
            big,
          );
        } else if (p.kind === "vline") {
          const x = p.c();
          if (isFinite(x)) segs = [[sX(x), 0, sX(x), h]];
        } else if (p.kind === "param") {
          const lo = p.lo(),
            hi = p.hi();
          if (isFinite(lo) && isFinite(hi) && hi > lo)
            segs = trace(
              t => {
                S.E.t = t;
                const x = p.fx(),
                  y = p.fy();
                return isFinite(x) && isFinite(y) ? [sX(x), sY(y)] : null;
              },
              lo,
              hi,
              1200,
              big * 4,
            );
        } else if (p.kind === "polar") {
          const lo = p.lo(),
            hi = p.hi();
          if (isFinite(lo) && isFinite(hi) && hi > lo)
            segs = trace(
              th => {
                S.E.theta = th;
                const rr = p.f();
                return isFinite(rr) ? [sX(rr * Math.cos(th)), sY(rr * Math.sin(th))] : null;
              },
              lo,
              hi,
              1800,
              big * 4,
            );
        } else if (p.kind === "imp") {
          const a = implicit(p.F, w, h, toX, toY, phone ? 7 : 5);
          if (a.length) {
            ctx.beginPath();
            for (let k = 0; k < a.length; k += 4) {
              ctx.moveTo(a[k], a[k + 1]);
              ctx.lineTo(a[k + 2], a[k + 3]);
            }
            ctx.stroke();
            S.paths.push({ r, i, imp: a, c: col });
          }
          continue;
        } else if (p.kind === "pts") {
          for (const [x, y] of p.pts()) {
            if (!isFinite(x) || !isFinite(y)) continue;
            const px = sX(x),
              py = sY(y);
            ctx.beginPath();
            ctx.arc(px, py, 4.5, 0, 7);
            ctx.fill();
            ctx.strokeStyle = paper;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = col;
            S.paths.push({ r, i, pt: [px, py, x, y], c: col });
          }
          continue;
        }
      } catch (e) {
        continue g_rows;
      }
      if (!segs) continue;
      ctx.beginPath();
      for (const sg of segs) {
        if (sg.length < 4) {
          if (sg.length === 2) {
            ctx.moveTo(sg[0], sg[1]);
            ctx.lineTo(sg[0] + 0.01, sg[1]);
          }
          continue;
        }
        ctx.moveTo(sg[0], sg[1]);
        for (let k = 2; k < sg.length; k += 2) ctx.lineTo(sg[k], sg[k + 1]);
      }
      ctx.stroke();
      S.paths.push({ r, i, segs, p, c: col });
    }
    /* roots / extrema / intersections */
    ctx.lineWidth = 1.5;
    for (const mk of S.marks) {
      const px = sX(mk.x),
        py = sY(mk.y);
      if (px < -8 || px > w + 8 || py < -8 || py > h + 8) continue;
      ctx.beginPath();
      if (mk.k === "root") {
        ctx.arc(px, py, 4, 0, 7);
        ctx.fillStyle = mk.c;
        ctx.fill();
        ctx.strokeStyle = paper;
        ctx.stroke();
      } else if (mk.k === "cross") {
        ctx.arc(px, py, 4.5, 0, 7);
        ctx.fillStyle = paper;
        ctx.fill();
        ctx.strokeStyle = mk.c;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1.5;
      } else {
        ctx.moveTo(px, py - 5);
        ctx.lineTo(px + 5, py);
        ctx.lineTo(px, py + 5);
        ctx.lineTo(px - 5, py);
        ctx.closePath();
        ctx.fillStyle = mk.c;
        ctx.fill();
        ctx.strokeStyle = paper;
        ctx.stroke();
      }
    }
    if (S.sel) {
      const px = sX(S.sel.x),
        py = sY(S.sel.y);
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, 7);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, 7);
      ctx.fillStyle = ink;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---- view ---- */
  const moved = () => {
    need();
    analyse();
    save();
  };
  const zoomAt = (mx, my, k) => {
    const v = S.view;
    k = Math.min(1e8, Math.max(1e-6, k));
    const wx = toX(mx),
      wy = toY(my);
    v.k = k;
    v.cx = wx - (mx - S.w / 2) / k;
    v.cy = wy + (my - S.h / 2) / k;
    moved();
  };
  const panBy = (dx, dy) => {
    S.view.cx -= dx / S.view.k;
    S.view.cy += dy / S.view.k;
    moved();
  };
  const home = () => {
    S.view = { cx: 0, cy: 0, k: 50 };
    moved();
  };

  useEffect(() => {
    const b = box.current,
      c = cv.current;
    const ro = new ResizeObserver(() => {
      const r = b.getBoundingClientRect(),
        dpr = devicePixelRatio || 1;
      S.w = r.width;
      S.h = r.height;
      c.width = Math.max(10, Math.round(r.width * dpr));
      c.height = Math.max(10, Math.round(r.height * dpr));
      c.style.width = r.width + "px";
      c.style.height = r.height + "px";
      need();
      analyse();
    });
    ro.observe(b);
    const wheel = e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(),
        mx = e.clientX - r.left,
        my = e.clientY - r.top;
      const mouse =
        e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || (mouse && !e.shiftKey))
        zoomAt(
          mx,
          my,
          S.view.k * Math.exp(-e.deltaY * (mouse ? 0.0015 : 0.01) * (e.deltaMode === 1 ? 33 : 1)),
        );
      else panBy(-e.deltaX, -e.deltaY);
    };
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      c.removeEventListener("wheel", wheel);
      cancelAnimationFrame(S.raf);
      S.raf = 0;
      clearTimeout(S.an);
    };
  }, []);
  useEffect(() => {
    need();
    analyse();
  }, [key, phone]);
  const varKey = JSON.stringify(g.vars);
  useEffect(() => {
    need();
    analyse();
  }, [varKey]);

  /* ---- pointer: drag pans, two fingers pinch, a quick tap reads a point ---- */
  const hit = (mx, my) => {
    let best = null,
      bd = 18 * 18;
    for (const mk of S.marks) {
      const d = (sX(mk.x) - mx) ** 2 + (sY(mk.y) - my) ** 2;
      if (d < bd) {
        bd = d;
        best = {
          x: mk.x,
          y: mk.y,
          l: { root: "Root", min: "Minimum", max: "Maximum", cross: "Intersection" }[mk.k],
        };
      }
    }
    if (best) return best;
    bd = 16 * 16;
    for (const P of S.paths) {
      if (P.pt) {
        const d = (P.pt[0] - mx) ** 2 + (P.pt[1] - my) ** 2;
        if (d < bd) {
          bd = d;
          best = { x: P.pt[2], y: P.pt[3], l: "Point" };
        }
        continue;
      }
      if (P.imp) {
        const a = P.imp;
        for (let k = 0; k < a.length; k += 4) {
          const [d, t] = segD(mx, my, a[k], a[k + 1], a[k + 2], a[k + 3]);
          if (d < bd) {
            bd = d;
            best = { x: toX(a[k] + (a[k + 2] - a[k]) * t), y: toY(a[k + 1] + (a[k + 3] - a[k + 1]) * t) };
          }
        }
        continue;
      }
      for (const sg of P.segs)
        for (let k = 0; k + 3 < sg.length; k += 2) {
          const [d, t] = segD(mx, my, sg[k], sg[k + 1], sg[k + 2], sg[k + 3]);
          if (d < bd) {
            bd = d;
            const px = sg[k] + (sg[k + 2] - sg[k]) * t,
              py = sg[k + 1] + (sg[k + 3] - sg[k + 1]) * t;
            best = { x: toX(px), y: toY(py) };
            if (P.p && P.p.kind === "fn") {
              const yy = P.p.f(best.x);
              if (isFinite(yy)) best.y = yy;
            }
          }
        }
    }
    return best;
  };
  const down = e => {
    const r = cv.current.getBoundingClientRect();
    cv.current.setPointerCapture(e.pointerId);
    S.ptr.set(e.pointerId, {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      sx: e.clientX,
      sy: e.clientY,
      t: Date.now(),
      far: false,
    });
    if (S.ptr.size === 1) S.tapOk = true;
    else S.tapOk = false;
  };
  const move = e => {
    const p = S.ptr.get(e.pointerId);
    if (!p) return;
    const r = cv.current.getBoundingClientRect(),
      nx = e.clientX - r.left,
      ny = e.clientY - r.top;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) p.far = true;
    if (S.ptr.size === 1) {
      if (p.far) {
        S.tapOk = false;
        panBy(nx - p.x, ny - p.y);
      }
      p.x = nx;
      p.y = ny;
    } else if (S.ptr.size === 2) {
      const o = [...S.ptr.entries()].find(([id]) => id !== e.pointerId)[1],
        d0 = Math.hypot(p.x - o.x, p.y - o.y),
        d1 = Math.hypot(nx - o.x, ny - o.y);
      const cx0 = (p.x + o.x) / 2,
        cy0 = (p.y + o.y) / 2,
        cx1 = (nx + o.x) / 2,
        cy1 = (ny + o.y) / 2;
      p.x = nx;
      p.y = ny;
      S.view.cx -= (cx1 - cx0) / S.view.k;
      S.view.cy += (cy1 - cy0) / S.view.k;
      if (d0 > 4) zoomAt(cx1, cy1, (S.view.k * d1) / d0);
      else moved();
    }
  };
  const up = e => {
    const p = S.ptr.get(e.pointerId);
    S.ptr.delete(e.pointerId);
    if (p && S.tapOk && !p.far && Date.now() - p.t < 600) {
      const h = hit(p.x, p.y);
      S.sel = h;
      setInfo(h ? { ...h } : null);
      need();
    }
  };

  /* ---- rows ---- */
  const setRow = (id, o) => patch({ rows: g.rows.map(r => (r.id === id ? { ...r, ...o } : r)) });
  const addRow = (after, t = "") => {
    const r = { id: uid(), t };
    const i = after ? g.rows.findIndex(x => x.id === after) + 1 : g.rows.length;
    patch({ rows: [...g.rows.slice(0, i), r, ...g.rows.slice(i)] });
    setTimeout(() => {
      const el = document.getElementById("gr-" + r.id);
      if (el) el.focus();
    }, 30);
  };
  const delRow = id => {
    const rows = g.rows.filter(r => r.id !== id);
    patch({ rows: rows.length ? rows : [{ id: uid(), t: "" }] });
  };
  const rowKey = (e, r) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addRow(r.id);
    } else if (e.key === "Backspace" && !r.t && g.rows.length > 1) {
      e.preventDefault();
      const i = g.rows.findIndex(x => x.id === r.id);
      delRow(r.id);
      const pv = g.rows[Math.max(0, i - 1) === i ? 1 : Math.max(0, i - 1)];
      setTimeout(() => {
        const el = pv && document.getElementById("gr-" + pv.id);
        if (el) el.focus();
      }, 30);
    }
  };
  const setVar = (n, o) => patch({ vars: { ...g.vars, [n]: { ...g.vars[n], ...o } } });
  const varChange = (n, val) => {
    const d = g.vars[n];
    let o = { v: val };
    if (val > d.max) o.max = Math.ceil(val * 1.5);
    if (val < d.min) o.min = Math.floor(val * 1.5);
    setVar(n, o);
  };

  /* ---- graph picker ---- */
  const list = () => D.graphs.slice().sort((a, b) => String(b.upd).localeCompare(String(a.upd)));
  const newG = async () => {
    const t = await askText({ title: "New graph", value: "Graph " + (D.graphs.length + 1), ok: "Create" });
    if (t == null) return;
    const id = uid(),
      d = {
        ...BLANK(),
        title: t.trim() || "Graph",
        at: new Date().toISOString(),
        upd: new Date().toISOString(),
      };
    W.set("graphs", id, d);
    S.loaded = null;
    ls.set("os-gr-cur", id);
  };
  const GList = ({ close }) => html`<div class="acts">${list().map(
    x =>
      html`<button class=${"mi" + (x._id === S.loaded ? " on" : "")} key=${x._id} onClick=${() => {
        close();
        ls.set("os-gr-cur", x._id);
      }}><${Icon} n="graphc"/><span>${x.title || "Graph"}</span><em>${(x.rows || []).filter(r => r.t).length}</em></button>`,
  )}
    ${D.graphs.length ? html`<div class="sep"/>` : null}
    <button class="mi" onClick=${() => {
      close();
      newG();
    }}><${Icon} n="plus"/><span>New graph</span></button>
    ${
      S.loaded
        ? html`<button class="mi" onClick=${async () => {
            close();
            const t = await askText({ title: "Rename graph", value: S.g.title, ok: "Rename" });
            if (t && t.trim()) patch({ title: t.trim() });
          }}><${Icon} n="edit"/><span>Rename</span></button>
      <button class="mi dgr" onClick=${() => {
        close();
        const id = S.loaded,
          d = D.graphs.find(x => x._id === id);
        if (!d) return;
        const { _id, ...o } = d;
        W.del("graphs", id);
        S.loaded = null;
        setG(BLANK());
        ls.set("os-gr-cur", "");
        toast("Graph deleted", {
          label: "Undo",
          run: () => {
            W.set("graphs", id, o);
            ls.set("os-gr-cur", id);
          },
        });
      }}><${Icon} n="trash"/><span>Delete graph</span></button>`
        : null
    }</div>`;
  const insert = t => {
    const rows = [...g.rows];
    const emp = rows.find(r => !r.t.trim());
    if (emp) {
      emp.t = t;
      patch({ rows });
    } else addRow(null, t);
  };

  const tbl = g.tbl || { id: "", x0: 0, dx: 1 },
    tr = g.rows.find(r => r.id === tbl.id),
    tp = tr && C.plans[tr.id];
  const free = [...C.free].filter(n => g.vars[n]);
  const shown = g.rows.filter(r => r.t.trim()).length;
  return html`<${Tools} cls="wbtools">
      <${Btn} cls="wbb" icon="graphc" aria-label="Graphs" title="Graphs" onClick=${e => openSheet({ title: "Graphs", at: e.currentTarget, Body: GList })}><span class="wbn">${g.title || "Graph"}</span><${Icon} n="chev"/><//>
      <${Btn} cls="ib" aria-label="Add expression" title="Add expression" onClick=${() => addRow(null)}><${Icon} n="plus"/><//>
      <span class="wsp"/>
      <${Btn} cls="ib" aria-label="Zoom out" onClick=${() => zoomAt(S.w / 2, S.h / 2, S.view.k / 1.4)}><${Icon} n="minus"/><//>
      <${Btn} cls="ib" aria-label="Zoom in" onClick=${() => zoomAt(S.w / 2, S.h / 2, S.view.k * 1.4)}><${Icon} n="plus"/><//>
      <${Btn} cls="ib" aria-label="Reset view" title="Reset view" onClick=${home}><${Icon} n="grid"/><//>
    <//>
    <div class="gc">
      <div class="gcl">
        ${g.rows.map((r, i) => {
          const p = C.plans[r.id],
            col = colOf(r, i);
          return html`<div class=${"gr" + (r.h ? " off" : "")} key=${r.id}>
            <button class="gsw" style=${"--c:" + col} aria-label=${r.h ? "Show curve" : "Hide curve"} aria-pressed=${String(!r.h)} onClick=${() => setRow(r.id, { h: !r.h })}/>
            <div class="grb">
              <input id=${"gr-" + r.id} class="field grin" value=${r.t} placeholder=${i === 0 ? "y = sin(x)   or   x^2+y^2=4" : ""} spellcheck="false" autocomplete="off" autocapitalize="off" aria-label=${"Expression " + (i + 1)}
                onInput=${e => setRow(r.id, { t: e.target.value })} onKeyDown=${e => rowKey(e, r)}/>
              ${r.t && worthTypesetting(r.t) ? html`<${Typeset} src=${r.t.replace(/\{[^}]*\}\s*$/, "")} color=${col}/>` : null}
              ${
                p && p.kind === "err"
                  ? html`<div class="gerr">${p.msg}</div>`
                  : p && p.kind === "val" && !p.f.length
                    ? html`<div class="gval selectable">= ${(() => {
                        try {
                          return fmtNum(p.f());
                        } catch (e) {
                          return "?";
                        }
                      })()}</div>`
                    : null
              }
            </div>
            ${p && p.kind === "fn" ? html`<button class=${"x1 gtb" + (tbl.id === r.id ? " on" : "")} aria-label="Table of values" title="Table of values" onClick=${() => patch({ tbl: { ...tbl, id: tbl.id === r.id ? "" : r.id } })}>▦</button>` : null}
            <button class="x1" aria-label="Remove expression" onClick=${() => delRow(r.id)}>×</button></div>`;
        })}
        ${free.map(n => {
          const d = g.vars[n];
          return html`<div class="gsl" key=${n}><b class="gn">${n}</b>
          <input type="range" class="grng" aria-label=${"Slider " + n} min=${d.min} max=${d.max} step=${(d.max - d.min) / 400} value=${d.v} onInput=${e => varChange(n, +e.target.value)}/>
          <input class="field gnum" aria-label=${n + " value"} value=${String(+d.v.toFixed(4))} onChange=${e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v)) varChange(n, v);
          }}/>
          <span class="gmmw">
          <input class="field gmm" aria-label=${n + " minimum"} value=${d.min} onChange=${e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v) && v < d.max) setVar(n, { min: v, v: Math.max(v, d.v) });
          }}/>
          <input class="field gmm" aria-label=${n + " maximum"} value=${d.max} onChange=${e => {
            const v = parseFloat(e.target.value);
            if (isFinite(v) && v > d.min) setVar(n, { max: v, v: Math.min(v, d.v) });
          }}/></span></div>`;
        })}
        ${
          tp && tp.kind === "fn"
            ? html`<div class="gtab"><div class="gth"><span>Table</span><label>x from <input class="field gmm" aria-label="Table start" value=${tbl.x0} onChange=${e => {
                const v = parseFloat(e.target.value);
                if (isFinite(v)) patch({ tbl: { ...tbl, x0: v } });
              }}/></label>
            <label>step <input class="field gmm" aria-label="Table step" value=${tbl.dx} onChange=${e => {
              const v = parseFloat(e.target.value);
              if (isFinite(v) && v) patch({ tbl: { ...tbl, dx: v } });
            }}/></label></div>
          <table class="selectable"><tbody>${Array.from({ length: 10 }, (_, k) => {
            const x = tbl.x0 + k * tbl.dx;
            let y;
            try {
              syncVars();
              y = tp.f(x);
            } catch (e) {
              y = NaN;
            }
            return html`<tr key=${k}><td>${num(x)}</td><td>${isFinite(y) ? num(y) : "—"}</td></tr>`;
          })}</tbody></table></div>`
            : null
        }
        <div class="gadd"><button class="btn" onClick=${() => addRow(null)}><${Icon} n="plus"/> Expression</button>
          ${shown ? null : html`<button class="btn" onClick=${() => insert(DEMO[0])}>Try y = sin(x)</button>`}</div>
      </div>
      <div class="gbox gcv gcv" ref=${box} tabindex="0" aria-label="Graph canvas">
        <canvas ref=${cv} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onContextMenu=${e => e.preventDefault()}/>
        ${info ? html`<div class="gcinfo selectable" role="status">${info.l ? info.l + " " : ""}(${num(info.x)}, ${num(info.y)})</div>` : null}
        <ul class="wsr">${S.marks.map((m, i) => html`<li key=${i}>${m.k} ${num(m.x)} ${num(m.y)}</li>`)}</ul>
      </div>
    </div>
    <${StatusBar} items=${[shown + " expression" + (shown === 1 ? "" : "s"), S.marks.length + " marked points"]}/>`;
}
function segD(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t - px,
    y = ay + dy * t - py;
  return [x * x + y * y, t];
}

/* ================= module ================= */
function CalcMod() {
  const [mode, setMode] = usePref("os-gc-mode", "calc");
  return html`<div class="gcm"><div><${Tabs} items=${[
    ["calc", "Calculator"],
    ["graph", "Graph"],
  ]} cur=${mode} onChange=${setMode}/></div>
    ${mode === "graph" ? html`<${Grapher}/>` : html`<${Calculator}/>`}</div>`;
}
const plotRows = arg =>
  arg
    .split(/\s*;\s*/)
    .filter(Boolean)
    .map(t => ({ id: uid(), t }));
export default {
  id: "calc",
  name: "Calc",
  title: "calc",
  Comp: CalcMod,
  search: q =>
    /^[\d(.\-+]/.test(q) && /[+\-*/^]/.test(q)
      ? (() => {
          const r = evaluate(q, {}, false);
          return r ? [{ icon: "calc", l: q + " = " + r.r, r: () => openMod("calc", true) }] : [];
        })()
      : [],
  cmd: (v, arg) => {
    if (["calc", "calculate", "="].includes(v)) {
      if (!arg)
        return [
          {
            icon: "calc",
            l: "Open Calculator",
            r: () => {
              ls.set("os-gc-mode", "calc");
              openMod("calc", true);
            },
          },
        ];
      const r = evaluate(arg, {}, ls.get("os-calc-deg", false));
      return [
        {
          icon: "calc",
          l: r ? arg + " = " + r.r : "Can't work that out: " + arg,
          r: () => {
            if (!r) return;
            ls.set("os-calc-h", [...ls.get("os-calc-h", []), { q: arg, r: r.r }].slice(-60));
            ls.set("os-gc-mode", "calc");
            openMod("calc", true);
          },
        },
      ];
    }
    if (["graph", "plot", "gr"].includes(v)) {
      if (!arg)
        return v === "graph"
          ? []
          : [
              {
                icon: "graphc",
                l: "Open Graphing",
                r: () => {
                  ls.set("os-gc-mode", "graph");
                  openMod("calc", true);
                },
              },
            ];
      return [
        {
          icon: "graphc",
          l: "Plot: " + arg,
          r: () => {
            const id = uid(),
              t = new Date().toISOString();
            W.set("graphs", id, { ...BLANK(), title: arg.slice(0, 24), rows: plotRows(arg), at: t, upd: t });
            ls.set("os-gr-cur", id);
            ls.set("os-gc-mode", "graph");
            openMod("calc", true);
          },
        },
      ];
    }
    return [];
  },
};
