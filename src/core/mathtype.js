/* A tiny TeX-ish typesetter for canvas, plus the rich-text layout the whiteboard uses for text boxes and notes.
   Math: $\frac{a}{b}$, \sqrt{x}, x^2, a_n, greek, \pm \le \infty \sum..., and the same in plain typing:
   x^2+1, (a+b)/(c-d), sqrt(2), alpha, <= ->. Lines ending in "=" are worked out (calc.js); [[Page]] is a link. */
import { evalLine } from "./calc.js";

export const MATH_FONT = '"Cambria Math",Cambria,"Times New Roman",serif';
export const TEXT_FONT = 'Tahoma,Verdana,"Segoe UI",sans-serif';
let MC = null;
const mc = () => MC || (MC = document.createElement("canvas").getContext("2d"));

const GREEK = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};
const SYM = {
  infty: "∞",
  inf: "∞",
  pm: "±",
  mp: "∓",
  times: "×",
  cdot: "·",
  div: "÷",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  implies: "⇒",
  iff: "⇔",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  partial: "∂",
  nabla: "∇",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  emptyset: "∅",
  angle: "∠",
  degree: "°",
  circ: "∘",
  ldots: "…",
  cdots: "⋯",
  dots: "…",
  prime: "′",
  neg: "¬",
  land: "∧",
  lor: "∨",
  perp: "⊥",
  parallel: "∥",
  propto: "∝",
  hbar: "ħ",
  ell: "ℓ",
  quad: " ",
  qquad: "  ",
  ",": " ",
  ";": " ",
  "!": "",
  lbrace: "{",
  rbrace: "}",
};
const FUNCS = new Set([
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "exp",
  "lim",
  "max",
  "min",
  "det",
  "gcd",
  "mod",
  "arg",
  "dim",
  "lg",
]);
const BIN = new Set(["+", "−", "±", "∓", "×", "·", "÷", "∘", "∪", "∩", "∧", "∨"]);
const REL = new Set([
  "=",
  "≠",
  "<",
  ">",
  "≤",
  "≥",
  "≈",
  "≡",
  "∼",
  "→",
  "←",
  "⇒",
  "⇔",
  "∈",
  "∉",
  "⊂",
  "⊆",
  "∝",
  "⊥",
  "∥",
]);
const PLAINOP = [
  ["<=", "≤"],
  [">=", "≥"],
  ["!=", "≠"],
  ["->", "→"],
  ["=>", "⇒"],
  ["+-", "±"],
  ["*", "·"],
  ["-", "−"],
  ["×", "×"],
  ["÷", "÷"],
];

function lex(s) {
  const T = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "\\") {
      const m = s.slice(i + 1).match(/^([a-zA-Z]+|.)/);
      i += 1 + (m ? m[0].length : 0);
      if (m) T.push({ k: "cmd", v: m[0] });
      continue;
    }
    const n = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (n) {
      T.push({ k: "num", v: n[0] });
      i += n[0].length;
      continue;
    }
    const w = s.slice(i).match(/^[a-zA-Z]+/);
    if (w) {
      const x = w[0];
      i += x.length;
      if (GREEK[x]) T.push({ k: "sym", v: GREEK[x], it: x[0] === x[0].toLowerCase() });
      else if (x === "inf" || x === "infty") T.push({ k: "sym", v: "∞" });
      else if (x === "sqrt") T.push({ k: "cmd", v: "sqrt" });
      else if (FUNCS.has(x)) T.push({ k: "fn", v: x });
      else for (const ch of x) T.push({ k: "var", v: ch });
      continue;
    }
    const op = PLAINOP.find(([a]) => s.startsWith(a, i));
    if (op) {
      T.push({ k: "sym", v: op[1] });
      i += op[0].length;
      continue;
    }
    if ("^_{}()[]|/,'".includes(c)) {
      T.push({ k: "ch", v: c });
      i++;
      continue;
    }
    const cp = s.codePointAt(i),
      ch = String.fromCodePoint(cp);
    T.push({ k: "sym", v: ch });
    i += ch.length;
  }
  return T;
}
function parse(src) {
  const T = lex(src);
  let i = 0,
    abs = 0;
  const isc = v => T[i] && T[i].k === "ch" && T[i].v === v;
  const unpar = n => (n && n.k === "par" && n.o === "(" ? { k: "row", c: n.b } : n);
  function group() {
    if (isc("{")) {
      i++;
      const r = row("}");
      if (isc("}")) i++;
      return { k: "row", c: r };
    }
    if (isc("(")) {
      i++;
      const r = row(")");
      if (isc(")")) i++;
      return { k: "row", c: r };
    }
    return atom() || { k: "row", c: [] };
  }
  function script() {
    if (T[i] && T[i].k === "sym" && T[i].v === "−") {
      i++;
      const a = atom();
      return { k: "row", c: [{ k: "t", s: "−" }, a || { k: "row", c: [] }] };
    }
    return unpar(atom()) || { k: "row", c: [] };
  }
  function atom() {
    const t = T[i++];
    if (!t) return null;
    if (t.k === "num") return { k: "t", s: t.v };
    if (t.k === "var") return { k: "t", s: t.v, it: true };
    if (t.k === "fn") return { k: "t", s: t.v, fn: true };
    if (t.k === "sym")
      return { k: "t", s: t.v, it: t.it, op: BIN.has(t.v) ? "bin" : REL.has(t.v) ? "rel" : null };
    if (t.k === "cmd") {
      const v = t.v;
      if (v === "frac" || v === "dfrac" || v === "tfrac") {
        const n = group(),
          d = group();
        return { k: "frac", n, d };
      }
      if (v === "sqrt") {
        let idx = null;
        if (isc("[")) {
          i++;
          idx = { k: "row", c: row("]") };
          if (isc("]")) i++;
        }
        return { k: "sqrt", c: group(), idx };
      }
      if (v === "text" || v === "mathrm" || v === "operatorname" || v === "textrm") {
        let s = "";
        if (isc("{")) {
          i++;
          while (T[i] && !isc("}")) {
            s += T[i].v;
            i++;
          }
          i++;
        }
        return { k: "t", s };
      }
      if (v === "left" || v === "right" || v === "displaystyle") return atom();
      if (v === "mathbf" || v === "boldsymbol" || v === "mathit" || v === "mathbb" || v === "mathcal")
        return group();
      if (v === "overline" || v === "bar") return { k: "acc", c: group(), ch: "‾" };
      if (v === "vec") return { k: "acc", c: group(), ch: "→" };
      if (v === "hat") return { k: "acc", c: group(), ch: "^" };
      if (v === "dot") return { k: "acc", c: group(), ch: "˙" };
      if (v === "binom") {
        const a = group(),
          b = group();
        return { k: "par", o: "(", c: ")", b: [{ k: "frac", n: a, d: b }] };
      }
      const g = GREEK[v];
      if (g) return { k: "t", s: g, it: v[0] === v[0].toLowerCase() };
      const y = SYM[v];
      if (y != null)
        return { k: "t", s: y, op: BIN.has(y) ? "bin" : REL.has(y) ? "rel" : null, big: "∑∏∫∮".includes(y) };
      if (FUNCS.has(v)) return { k: "t", s: v, fn: true };
      return { k: "t", s: v === "{" || v === "}" || v === "|" ? v : "\\" + v };
    }
    if (t.k === "ch") {
      const v = t.v;
      if (v === "{") {
        const r = row("}");
        if (isc("}")) i++;
        return { k: "row", c: r };
      }
      if (v === "(" || v === "[") {
        const c = v === "(" ? ")" : "]",
          r = row(c);
        const closed = isc(c);
        if (closed) i++;
        return { k: "par", o: v, c: closed ? c : "", b: r };
      }
      if (v === "|") {
        if (abs) {
          i--;
          return null;
        }
        abs++;
        const r = row("|");
        abs--;
        const closed = isc("|");
        if (closed) i++;
        return { k: "par", o: "|", c: closed ? "|" : "", b: r };
      }
      if (v === "/") return { slash: true };
      if (v === "'") return { k: "t", s: "′" };
      if (v === ",") return { k: "t", s: ",", punct: true };
      return { k: "t", s: v };
    }
    return null;
  }
  function post(a) {
    let sup = null,
      sub = null;
    for (;;) {
      if (isc("^")) {
        i++;
        sup = script();
      } else if (isc("_")) {
        i++;
        sub = script();
      } else break;
    }
    return sup || sub ? { k: "ss", b: a, sup, sub } : a;
  }
  function row(stop) {
    const out = [];
    while (i < T.length) {
      if (stop && isc(stop)) break;
      if (!stop && (isc("}") || isc(")") || isc("]"))) {
        out.push({ k: "t", s: T[i].v });
        i++;
        continue;
      }
      const a = atom();
      if (!a) {
        if (stop === "|" || abs) break;
        continue;
      }
      out.push(a.slash ? a : post(a));
    }
    const r = [];
    for (let j = 0; j < out.length; j++) {
      const n = out[j];
      if (n.slash && r.length && j + 1 < out.length && !out[j + 1].slash) {
        r.push({ k: "frac", n: unpar(r.pop()), d: unpar(out[++j]) });
      } else r.push(n.slash ? { k: "t", s: "/" } : n);
    }
    return r;
  }
  return { k: "row", c: row(null) };
}

/* ---- layout: every box is {w, a (ascent), d (descent), draw(g,x,baseline)} ---- */
const tbox = (s, size, o = {}) => {
  const g = mc(),
    f = (o.it ? "italic " : "") + (o.bold ? "700 " : "") + size + "px " + (o.font || MATH_FONT);
  g.font = f;
  const w = g.measureText(s).width;
  return {
    w,
    a: size * 0.74,
    d: size * 0.24,
    draw: (c, x, y) => {
      c.font = f;
      c.fillText(s, x, y);
    },
  };
};
function lay(n, size) {
  size = Math.max(6, size);
  if (n.k === "t") {
    const b = tbox(n.s, n.big ? size * 1.35 : size, { it: n.it && n.s.length === 1 });
    if (n.big) {
      b.a = size * 0.9;
      b.d = size * 0.32;
    }
    return b;
  }
  if (n.k === "row") return rowBox(n.c, size);
  if (n.k === "acc") return lay(n.c, size);
  if (n.k === "ss") {
    const b = lay(n.b, size),
      S = size * 0.7,
      up = n.sup && lay(n.sup, S),
      dn = n.sub && lay(n.sub, S);
    const u = Math.max(size * 0.4, b.a - size * 0.3),
      dd = Math.max(size * 0.2, b.d + size * 0.02),
      ex = Math.max(up ? up.w : 0, dn ? dn.w : 0);
    return {
      w: b.w + ex + size * 0.05,
      a: Math.max(b.a, up ? u + up.a : 0),
      d: Math.max(b.d, dn ? dd + dn.d : 0),
      draw: (c, x, y) => {
        b.draw(c, x, y);
        const sx = x + b.w + size * 0.03;
        if (up) up.draw(c, sx, y - u);
        if (dn) dn.draw(c, sx, y + dd);
      },
    };
  }
  if (n.k === "frac") {
    const S = size * 0.86,
      nu = lay(n.n, S),
      de = lay(n.d, S),
      ax = size * 0.28,
      th = Math.max(1, size * 0.055),
      gp = size * 0.12,
      w = Math.max(nu.w, de.w) + size * 0.3;
    return {
      w,
      a: ax + th / 2 + gp + nu.d + nu.a,
      d: Math.max(0, gp + th / 2 + de.a + de.d - ax),
      draw: (c, x, y) => {
        c.fillRect(x + size * 0.08, y - ax - th / 2, w - size * 0.16, th);
        nu.draw(c, x + (w - nu.w) / 2, y - ax - th / 2 - gp - nu.d);
        de.draw(c, x + (w - de.w) / 2, y - ax + th / 2 + gp + de.a);
      },
    };
  }
  if (n.k === "sqrt") {
    const b = lay(n.c, size),
      ix = n.idx && lay(n.idx, size * 0.55),
      pre = ix ? Math.max(0, ix.w - size * 0.2) : 0,
      rw = size * 0.6,
      top = b.a + size * 0.16;
    return {
      w: pre + rw + b.w + size * 0.1,
      a: top + size * 0.06,
      d: b.d + size * 0.04,
      draw: (c, x, y) => {
        const X = x + pre;
        c.lineWidth = Math.max(1, size * 0.06);
        c.lineJoin = "round";
        c.beginPath();
        c.moveTo(X + size * 0.02, y - size * 0.26);
        c.lineTo(X + size * 0.14, y - size * 0.34);
        c.lineTo(X + size * 0.3, y + b.d);
        c.lineTo(X + rw - size * 0.04, y - top);
        c.lineTo(X + rw + b.w + size * 0.08, y - top);
        c.stroke();
        b.draw(c, X + rw, y);
        if (ix) ix.draw(c, x, y - size * 0.38);
      },
    };
  }
  if (n.k === "par") {
    const b = rowBox(n.b, size),
      h = b.a + b.d,
      tall = h > size * 1.3;
    if (!tall) {
      const o = tbox(n.o, size),
        cl = tbox(n.c, size);
      return {
        w: o.w + b.w + cl.w,
        a: Math.max(b.a, o.a),
        d: Math.max(b.d, o.d),
        draw: (c, x, y) => {
          o.draw(c, x, y);
          b.draw(c, x + o.w, y);
          cl.draw(c, x + o.w + b.w, y);
        },
      };
    }
    const pw = size * 0.42,
      a = b.a + size * 0.06,
      d = b.d + size * 0.06;
    const pp = (c, ch, x, y, flip) => {
      if (!ch) return;
      c.lineWidth = Math.max(1, size * 0.06);
      c.beginPath();
      const t = y - a,
        bt = y + d,
        m = (t + bt) / 2,
        in_ = flip ? x + pw * 0.25 : x + pw * 0.75,
        out = flip ? x + pw * 0.65 : x + pw * 0.35;
      if (ch === "|") {
        c.moveTo(x + pw / 2, t);
        c.lineTo(x + pw / 2, bt);
      } else if (ch === "[" || ch === "]") {
        const e = ch === "[" ? x + pw * 0.75 : x + pw * 0.25,
          s = ch === "[" ? x + pw * 0.35 : x + pw * 0.65;
        c.moveTo(e, t);
        c.lineTo(s, t);
        c.lineTo(s, bt);
        c.lineTo(e, bt);
      } else {
        c.moveTo(in_, t);
        c.quadraticCurveTo(out - (flip ? -1 : 1) * pw * 0.2, m, in_, bt);
      }
      c.stroke();
    };
    const cw = n.c ? pw : 0;
    return {
      w: pw + b.w + cw,
      a,
      d,
      draw: (c, x, y) => {
        pp(c, n.o, x, y, false);
        b.draw(c, x + pw, y);
        pp(c, n.c, x + pw + b.w, y, true);
      },
    };
  }
  return { w: 0, a: 0, d: 0, draw: () => {} };
}
function rowBox(nodes, size) {
  const it = [];
  let x = 0,
    a = size * 0.5,
    d = size * 0.1,
    prev = null;
  for (const n of nodes) {
    const b = lay(n, size);
    let pre = 0,
      post = 0;
    if (n.op === "bin" && prev && !prev.op && !(prev.k === "t" && prev.s === "(")) {
      pre = post = size * 0.22;
    } else if (n.op === "rel" && prev) {
      pre = post = size * 0.28;
    } else if (n.punct) post = size * 0.17;
    else if (n.fn) post = size * 0.12;
    x += pre;
    it.push([x, b]);
    x += b.w + post;
    a = Math.max(a, b.a);
    d = Math.max(d, b.d);
    prev = n;
  }
  return {
    w: x,
    a,
    d,
    draw: (c, X, y) => {
      for (const [dx, b] of it) b.draw(c, X + dx, y);
    },
  };
}
export const mathBox = (src, size) => lay(parse(src), size);

/* ---- same parse tree -> MathML (notes, chat): selectable, crisp, themed by currentColor ---- */
const ex = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const BIGOP = new Set(["∑", "∏", "∫", "∮"]);
function ml(n, disp) {
  if (!n) return "";
  if (n.k === "t") {
    const s = n.s;
    if (n.fn) return `<mi mathvariant="normal">${ex(s)}</mi>`;
    if (/^\d+(\.\d+)?$/.test(s)) return `<mn>${s}</mn>`;
    if (n.op || n.big || n.punct || (s.length === 1 && !/[\p{L}]/u.test(s)))
      return `<mo${n.big ? ' largeop="true"' : ""}>${ex(s)}</mo>`;
    if (s.length > 1 && /^[\p{L} ]+$/u.test(s) && !n.it) return `<mtext>${ex(s)}</mtext>`;
    return n.it || (/^\p{L}$/u.test(s) && n.it !== false && !n.rm)
      ? `<mi>${ex(s)}</mi>`
      : `<mi mathvariant="normal">${ex(s)}</mi>`;
  }
  if (n.k === "row") return `<mrow>${n.c.map(c => ml(c, disp)).join("")}</mrow>`;
  if (n.k === "ss") {
    const b = ml(n.b, disp),
      u = n.sup ? ml(n.sup, disp) : "",
      d = n.sub ? ml(n.sub, disp) : "";
    const under =
      n.b.k === "t" &&
      ((BIGOP.has(n.b.s) && n.b.s !== "∫" && n.b.s !== "∮") || (n.b.fn && /^(lim|max|min)$/.test(n.b.s))) &&
      disp;
    if (under)
      return u && d
        ? `<munderover>${b}${d}${u}</munderover>`
        : u
          ? `<mover>${b}${u}</mover>`
          : `<munder>${b}${d}</munder>`;
    return u && d ? `<msubsup>${b}${d}${u}</msubsup>` : u ? `<msup>${b}${u}</msup>` : `<msub>${b}${d}</msub>`;
  }
  if (n.k === "frac") return `<mfrac>${ml(n.n, disp)}${ml(n.d, disp)}</mfrac>`;
  if (n.k === "sqrt")
    return n.idx ? `<mroot>${ml(n.c, disp)}${ml(n.idx, disp)}</mroot>` : `<msqrt>${ml(n.c, disp)}</msqrt>`;
  if (n.k === "par")
    return `<mrow><mo lspace="0" rspace="0">${ex(n.o)}</mo>${n.b.map(c => ml(c, disp)).join("")}${n.c ? `<mo lspace="0" rspace="0">${ex(n.c)}</mo>` : ""}</mrow>`;
  if (n.k === "acc") return `<mover accent="true">${ml(n.c, disp)}<mo>${n.ch}</mo></mover>`;
  return "";
}
export function toMathML(src, display) {
  try {
    return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ""}>${ml(parse(String(src || "")), display)}</math>`;
  } catch (e) {
    return `<span class="mxerr">${ex(src)}</span>`;
  }
}
/* typed formulas like f(x)=36x+3x^2-2x^3, y = 2x - 1, a^2+b^2=c^2 -> true */
export function formulaLike(line) {
  const t = String(line || "").trim();
  if (!t || t.length > 140 || /\s{3,}/.test(t) || /[.:;!?]$/.test(t)) return false;
  if (/\$|\[\[/.test(t)) return false;
  if (!/^[\w\s.+\-*/^=()<>,'\\{}[\]²³√π×÷·−≤≥≠∞±|]+$/.test(t)) return false;
  if (!(t.match(/[a-zA-Z]{3,}/g) || []).every(w => KNOWN.has(w))) return false;
  if (/\b[a-zA-Z]{2,}\s+[a-zA-Z]{2,}\b/.test(t.replace(/\\[a-zA-Z]+/g, ""))) return false;
  if (/[\^_\\√]/.test(t)) return true;
  const eq = t.match(/^([A-Za-z](?:\([a-z](?:\s*,\s*[a-z])*\))?)\s*=\s*(.+)$/);
  return !!eq && /[+\-*/()]|\d[a-z]|[a-z]\d/.test(eq[2]) && /[a-z\d]/i.test(eq[2]);
}

/* does a plain line read as a formula? (has ^ _ \ or √, only math characters, no long words) */
const KNOWN = new Set([...FUNCS, ...Object.keys(GREEK), "sqrt", "inf", "infty"]);
export function mathy(line) {
  const t = line.trim();
  if (!t || t.length > 160 || !/[\^_\\√]/.test(t)) return false;
  if (!/^[\w\s.+\-*/^=()<>!|,'\\{}[\]²³√π×÷·−≤≥≠∞±]+$/.test(t)) return false;
  return (t.match(/[a-zA-Z]{3,}/g) || []).every(w => KNOWN.has(w) || /^\\/.test(t.slice(t.indexOf(w) - 1)));
}

/* rich text: one text box -> lines of boxes. wrap = max width (0 = none). Links come back as rects. */
const words = (s, size, o) =>
  s
    .split(/(\s+)/)
    .filter(Boolean)
    .map(w => ({ b: tbox(w, size, { ...o, font: TEXT_FONT }), sp: /^\s+$/.test(w), link: o.link }));
export function layoutText(src, size, wrap = 0) {
  const vars = {},
    lines = [],
    links = [],
    text = [];
  let y = 0,
    W = 0;
  for (const raw of String(src || "").split("\n")) {
    let parts = [];
    const ev = evalLine(raw, vars);
    text.push(ev && ev.res != null ? ev.expr + " = " + ev.res : raw);
    if (ev && ev.res != null) {
      parts =
        ev.conv || !/[\^\/]|sqrt|\b(?:pi|alpha|beta|theta)\b/.test(ev.expr)
          ? words(ev.conv ? ev.expr : ev.expr.replace(/\*/g, "×"), size, {})
          : [{ b: mathBox(ev.expr, size) }];
      parts.push(
        { b: tbox(" = ", size, { font: TEXT_FONT }) },
        { b: tbox(ev.res, size, { bold: true, font: TEXT_FONT }) },
      );
    } else if (!/\$|\[\[/.test(raw) && mathy(raw)) parts = [{ b: mathBox(raw, size) }];
    else
      raw.split(/(\$[^$\n]+\$)/).forEach(seg => {
        if (/^\$[^$]+\$$/.test(seg)) {
          parts.push({ b: mathBox(seg.slice(1, -1), size) });
          return;
        }
        seg.split(/(\[\[[^\]\n]+\]\])/).forEach(p => {
          const m = p.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
          if (m) parts.push(...words((m[2] || m[1]).trim(), size, { link: m[1].trim() }));
          else if (p) parts.push(...words(p, size, {}));
        });
      });
    /* fill lines, wrapping between words */
    let cur = { items: [], w: 0, a: size * 0.78, d: size * 0.27 };
    const flush = () => {
      lines.push(cur);
      cur = { items: [], w: 0, a: size * 0.78, d: size * 0.27 };
    };
    for (const p of parts) {
      if (wrap && cur.items.length && cur.w + p.b.w > wrap && !p.sp) flush();
      if (p.sp && !cur.items.length && lines.length && wrap) continue;
      cur.items.push({ x: cur.w, ...p });
      cur.w += p.b.w;
      cur.a = Math.max(cur.a, p.b.a);
      cur.d = Math.max(cur.d, p.b.d);
    }
    flush();
  }
  for (const l of lines) {
    const lead = size * 0.12;
    y += l.a + lead;
    l.y = y;
    y += l.d + lead;
    W = Math.max(W, l.w);
    for (const it of l.items)
      if (it.link && !it.sp)
        links.push({ x: it.x, y: l.y - it.b.a, w: it.b.w, h: it.b.a + it.b.d, t: it.link });
  }
  return { lines, w: W, h: y, links, size, text: text.join("\n") };
}
export function drawLayout(g, L, ox, oy) {
  for (const l of L.lines)
    for (const it of l.items) {
      it.b.draw(g, ox + it.x, oy + l.y);
      if (it.link && !it.sp)
        g.fillRect(ox + it.x, oy + l.y + L.size * 0.14, it.b.w, Math.max(1, L.size * 0.07));
    }
}
