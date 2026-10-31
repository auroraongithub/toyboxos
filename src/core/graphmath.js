/* Graph engine: parse a Desmos-style line into a closure (no eval), classify it, trace it onto the screen,
   and find roots / extrema / intersections. Shapes: y=f(x), x=c, x=g(y), f(x)=..., implicit F(x,y)=G(x,y),
   points (a,b), parametric (fx(t),fy(t)) {0<=t<=5}, polar r=f(theta), constants (a=2), bare numbers (2^10). */

const FN1 = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
  sec: x => 1 / Math.cos(x),
  csc: x => 1 / Math.sin(x),
  cot: x => 1 / Math.tan(x),
  fract: x => x - Math.floor(x),
  round: Math.round,
};
const FNN = {
  log: (x, b) => (b == null ? Math.log10(x) : Math.log(x) / Math.log(b)),
  min: Math.min,
  max: Math.max,
  mod: (a, b) => ((a % b) + b) % b,
  pow: Math.pow,
  hypot: Math.hypot,
  nCr: (n, k) => {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  },
};
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };
const GREEK = { θ: "theta", π: "pi", τ: "tau" };
const FNAMES = new Set([...Object.keys(FN1), ...Object.keys(FNN)]);
export const RESERVED = new Set(["x", "y", "t", "theta", "r"]);

function lex(s) {
  s = s
    .replace(/[×·∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\*\*/g, "^")
    .replace(/√/g, " sqrt ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/[θπτ]/g, c => " " + GREEK[c] + " ")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=");
  const T = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const n = s.slice(i).match(/^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (n && !/^\d+(?:\.\d*)?e(?![+-]?\d)/i.test(n[0])) {
      T.push({ t: "n", v: parseFloat(n[0]) });
      i += n[0].length;
      continue;
    }
    const w = s.slice(i).match(/^[a-zA-Z_][a-zA-Z_0-9]*/);
    if (w) {
      T.push({ t: "id", v: w[0] });
      i += w[0].length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=") {
      T.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^%(),|°=<>{}".includes(c)) {
      T.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error("Unexpected " + c);
  }
  return T;
}
/* known name? ("sin","pi","theta") else split letters: ax -> a*x */
function split(T, known) {
  const out = [];
  for (const k of T) {
    if (
      k.t !== "id" ||
      FNAMES.has(k.v) ||
      k.v in CONST ||
      RESERVED.has(k.v) ||
      known.has(k.v) ||
      k.v.length === 1 ||
      /_/.test(k.v) ||
      /\d/.test(k.v)
    ) {
      out.push(k);
      continue;
    }
    /* greedy: longest function/const prefix, otherwise single letters */
    let rest = k.v;
    while (rest) {
      let m = null;
      for (const nme of [...FNAMES, ...Object.keys(CONST), "theta"])
        if (rest.startsWith(nme) && (!m || nme.length > m.length)) m = nme;
      if (!m) m = rest[0];
      out.push({ t: "id", v: m });
      rest = rest.slice(m.length);
    }
  }
  return out;
}

/* AST: {k:"n",v} {k:"v",n} {k:"c",f,a[]} {k:"b",o,a,b} {k:"neg",a} {k:"abs",a} {k:"uf",n,a} */
function parseExpr(T, known, uf) {
  let i = 0;
  const pk = () => T[i],
    is = v => T[i] && T[i].t === "op" && T[i].v === v,
    eat = v => {
      if (!is(v)) throw new Error("Expected " + v);
      i++;
    };
  let absD = 0;
  const starts = () => {
    const t = pk();
    return t && (t.t === "n" || t.t === "id" || (t.t === "op" && (t.v === "(" || (t.v === "|" && !absD))));
  };
  const add = () => {
    let v = mul();
    while (is("+") || is("-")) {
      const o = T[i++].v,
        r = mul();
      v = { k: "b", o, a: v, b: r };
    }
    return v;
  };
  const mul = () => {
    let v = unary();
    for (;;) {
      if (is("*")) {
        i++;
        v = { k: "b", o: "*", a: v, b: unary() };
      } else if (is("/")) {
        i++;
        v = { k: "b", o: "/", a: v, b: unary() };
      } else if (starts() && !(pk().t === "op" && pk().v === "|" && absD))
        v = { k: "b", o: "*", a: v, b: unary() };
      else return v;
    }
  };
  const unary = () => {
    if (is("-")) {
      i++;
      return { k: "neg", a: unary() };
    }
    if (is("+")) {
      i++;
      return unary();
    }
    return pow();
  };
  const pow = () => {
    const b = post();
    if (is("^")) {
      i++;
      return { k: "b", o: "^", a: b, b: unary() };
    }
    return b;
  };
  const post = () => {
    let v = prim();
    for (;;) {
      if (is("%")) {
        i++;
        v = { k: "b", o: "/", a: v, b: { k: "n", v: 100 } };
      } else if (is("°")) {
        i++;
        v = { k: "b", o: "*", a: v, b: { k: "n", v: Math.PI / 180 } };
      } else return v;
    }
  };
  const prim = () => {
    const t = T[i++];
    if (!t) throw new Error("Unexpected end");
    if (t.t === "n") return { k: "n", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const v = add();
      eat(")");
      return v;
    }
    if (t.t === "op" && t.v === "|") {
      absD++;
      const v = add();
      absD--;
      eat("|");
      return { k: "abs", a: v };
    }
    if (t.t === "id") {
      const id = t.v;
      if (uf.has(id) && !RESERVED.has(id)) {
        if (is("(")) {
          i++;
          const a = add();
          eat(")");
          return { k: "uf", n: id, a };
        }
      }
      if (FNAMES.has(id)) {
        if (is("(")) {
          i++;
          const a = [];
          if (!is(")")) {
            a.push(add());
            while (is(",")) {
              i++;
              a.push(add());
            }
          }
          eat(")");
          return { k: "c", f: id, a };
        }
        /* sin x, sin 2x, sin x^2 */
        const num = pk() && pk().t === "n";
        let a = pow();
        if (num)
          while (pk() && ((pk().t === "id" && !FNAMES.has(pk().v)) || is("(")))
            a = { k: "b", o: "*", a, b: pow() };
        return { k: "c", f: id, a: [a] };
      }
      return { k: "v", n: id };
    }
    throw new Error("Unexpected " + t.v);
  };
  const v = add();
  if (i < T.length) throw new Error("Unexpected " + T[i].v);
  return v;
}

/* free names in an AST (not reserved, not constants) */
function names(a, o = new Set()) {
  if (!a) return o;
  if (a.k === "v") o.add(a.n);
  else if (a.k === "uf") {
    o.add("#" + a.n);
    names(a.a, o);
  } else if (a.k === "c") a.a.forEach(x => names(x, o));
  else {
    names(a.a, o);
    names(a.b, o);
  }
  return o;
}

/* compile against a shared env object E (E.x, E.y, E.t, E.theta, E.<param>) and a user-function table UF */
function comp(a, E, UF) {
  switch (a.k) {
    case "n": {
      const v = a.v;
      return () => v;
    }
    case "v": {
      const n = a.n;
      if (n in CONST) {
        const c = CONST[n];
        return () => c;
      }
      return () => E[n];
    }
    case "neg": {
      const f = comp(a.a, E, UF);
      return () => -f();
    }
    case "abs": {
      const f = comp(a.a, E, UF);
      return () => Math.abs(f());
    }
    case "uf": {
      const f = comp(a.a, E, UF),
        n = a.n;
      return () => {
        const u = UF[n];
        return u ? u(f()) : NaN;
      };
    }
    case "c": {
      const fs = a.a.map(x => comp(x, E, UF)),
        fn = FN1[a.f];
      if (fn && fs.length === 1) {
        const g = fs[0];
        return () => fn(g());
      }
      const fm = FNN[a.f];
      if (!fm) throw new Error("Bad arguments for " + a.f);
      return () => fm(...fs.map(f => f()));
    }
    case "b": {
      const p = comp(a.a, E, UF),
        q = comp(a.b, E, UF);
      switch (a.o) {
        case "+":
          return () => p() + q();
        case "-":
          return () => p() - q();
        case "*":
          return () => p() * q();
        case "/":
          return () => p() / q();
        case "^":
          return () => {
            const x = p(),
              y = q();
            if (x < 0 && y !== Math.floor(y)) {
              for (let d = 1; d <= 9; d += 2) {
                const nm = y * d;
                if (Math.abs(nm - Math.round(nm)) < 1e-9)
                  return (Math.round(nm) % 2 ? -1 : 1) * Math.pow(-x, y);
              }
              return NaN;
            }
            return Math.pow(x, y);
          };
      }
    }
  }
  throw new Error("bad node");
}

const has = (a, n) => {
  const s = names(a);
  return s.has(n);
};
const topSplit = (s, ch) => {
  const out = [];
  let d = 0,
    b = 0,
    last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") d++;
    else if (c === ")" || c === "]") d--;
    else if (c === "{") b++;
    else if (c === "}") b--;
    else if (c === ch && !d && !b) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
};

/* range suffix {0<=t<=5}  -> [lo,hi] expression strings */
function rangeOf(src, v) {
  const m = src.match(/\{([^}]*)\}\s*$/);
  if (!m) return [src, null];
  const body = m[1].replace(/≤/g, "<=").replace(/θ/g, "theta");
  const r = body.match(new RegExp("^(.+?)\\s*<=?\\s*" + v + "\\s*<=?\\s*(.+)$"));
  return [src.slice(0, m.index).trim(), r ? [r[1], r[2]] : null];
}

/* Parse every row into a plan. rows: [{id,t}]. Returns {plans: id->plan, free: Set, E, UF}.
   Each plan: {kind, ...} with kind in: empty err val def fn vline xfn imp param polar pts */
export function compileAll(rows, E, vars) {
  const UF = {},
    plans = {},
    free = new Set(),
    defined = new Set(),
    fnames = new Set();
  const infos = rows.map(r => ({ r, src: String(r.t || "").trim() }));
  /* pass 1: find definitions f(x)=..., a=... */
  for (const o of infos) {
    const m = o.src.match(/^([a-zA-Z]\w*)\s*\(\s*([a-zA-Z])\s*\)\s*=(?!=)\s*(.+)$/);
    if (m && !FNAMES.has(m[1]) && !RESERVED.has(m[1])) {
      o.def = { n: m[1], p: m[2], body: m[3] };
      fnames.add(m[1]);
      continue;
    }
    const c = o.src.match(/^([a-zA-Z])\s*=(?!=)\s*([^=<>]+)$/);
    if (c && !RESERVED.has(c[1]) && c[1] !== "e") {
      o.cdef = { n: c[1], body: c[2] };
      defined.add(c[1]);
    }
  }
  const known = new Set([...defined, ...fnames]);
  const P = (s, extra) => {
    const T = split(lex(s), known);
    return parseExpr(T, new Set([...known, ...(extra || [])]), fnames);
  };
  /* constants first (a couple of passes so b=a+1 works) */
  for (const o of infos) if (o.cdef) E[o.cdef.n] = NaN;
  for (let pass = 0; pass < 3; pass++)
    for (const o of infos)
      if (o.cdef) {
        try {
          const f = comp(P(o.cdef.body), E, UF);
          E[o.cdef.n] = f();
        } catch {
          // a function that can't be evaluated yet stays undefined
        }
      }
  for (const o of infos)
    if (o.def) {
      const { n, p, body } = o.def;
      try {
        const ast = P(body),
          f = comp(ast, E, UF);
        UF[n] = v => {
          const old = E[p];
          E[p] = v;
          const r = f();
          E[p] = old;
          return r;
        };
        o.defAst = ast;
        o.defP = p;
      } catch (e) {
        o.err = e.message;
      }
    }
  const note = ast => {
    names(ast).forEach(n => {
      if (n[0] !== "#" && !RESERVED.has(n) && !(n in CONST) && !defined.has(n) && n.length >= 1) free.add(n);
    });
  };
  for (const o of infos) {
    const { r, src } = o;
    let plan;
    try {
      plan = planRow(o, src, P, E, UF, note, vars);
    } catch (e) {
      plan = { kind: "err", msg: e.message };
    }
    if (o.err) plan = { kind: "err", msg: o.err };
    plans[r.id] = plan;
  }
  free.forEach(n => {
    if (!(n in E) || E[n] == null || Number.isNaN(E[n])) E[n] = vars && vars[n] ? vars[n].v : 1;
  });
  return { plans, free, UF };
}

function planRow(o, src, P, E, UF, note, vars) {
  if (!src) return { kind: "empty" };
  if (o.cdef) {
    const ast = P(o.cdef.body);
    return { kind: "def", n: o.cdef.n, f: comp(ast, E, UF), v: () => E[o.cdef.n] };
  }
  if (o.def) {
    const { p, n } = o.def,
      ast = o.defAst;
    note(ast);
    /* plot f(x)=... as a function of its parameter */
    const g = x => UF[n](x);
    return { kind: "fn", f: g, uf: n, defOnly: p !== "x" && false };
  }
  let [body, rng] = [src, null];
  /* tuples */
  const braceless = src.replace(/\{[^}]*\}\s*$/, "").trim();
  const parts = topSplit(braceless, ",");
  if (braceless[0] === "(" && parts.every(p => /^\s*\(.*\)\s*$/.test(p))) {
    const tuples = parts.map(p => {
      const t = topSplit(p.trim().slice(1, -1), ",");
      if (t.length !== 2) throw new Error("Points need two numbers");
      return t.map(s => {
        const ast = P(s);
        note(ast);
        return ast;
      });
    });
    const usesT = tuples.some(t => t.some(a => has(a, "t")));
    if (usesT) {
      if (tuples.length > 1) throw new Error("One parametric curve per line");
      const [lo, hi] = rangeOf(src, "t")[1] || ["0", "2pi"];
      const fl = comp(P(lo), E, UF),
        fh = comp(P(hi), E, UF),
        fx = comp(tuples[0][0], E, UF),
        fy = comp(tuples[0][1], E, UF);
      return { kind: "param", fx, fy, lo: fl, hi: fh, u: "t" };
    }
    const fs = tuples.map(t => [comp(t[0], E, UF), comp(t[1], E, UF)]);
    return { kind: "pts", pts: () => fs.map(([a, b]) => [a(), b()]) };
  }
  const [clean, range] = rangeOf(src, "x");
  const rel = clean.match(/^(.*?)(<=|>=|<|>|=)(.*)$/);
  if (rel && rel[2] !== "=") {
    throw new Error("Inequalities aren't drawn yet");
  }
  if (rel) {
    const L = rel[1].trim(),
      R = rel[3].trim();
    if (/=/.test(R)) throw new Error("One = per line");
    const la = P(L),
      ra = P(R);
    note(la);
    note(ra);
    const lx = has(la, "x"),
      ly = has(la, "y"),
      rx = has(ra, "x"),
      ry = has(ra, "y"),
      isL = n => la.k === "v" && la.n === n;
    if (isL("r") && !rx && !ry && !has(ra, "r")) {
      const [c2, rg] = rangeOf(clean, "theta");
      const rr = c2.match(/^r\s*=\s*(.*)$/)[1];
      const f = comp(P(rr), E, UF),
        [lo, hi] = rg || ["0", "2pi"];
      return { kind: "polar", f, lo: comp(P(lo), E, UF), hi: comp(P(hi), E, UF) };
    }
    if (isL("y") && !ry) {
      const f = comp(ra, E, UF);
      return {
        kind: "fn",
        f: x => {
          E.x = x;
          return f();
        },
        raw: f,
        range: range && [comp(P(range[0]), E, UF), comp(P(range[1]), E, UF)],
      };
    }
    if (isL("x") && !rx) {
      if (!ry) {
        const f = comp(ra, E, UF);
        return { kind: "vline", c: () => f() };
      }
      const f = comp(ra, E, UF);
      return {
        kind: "xfn",
        f: y => {
          E.y = y;
          return f();
        },
      };
    }
    if (!lx && !ly && !rx && !ry && la.k === "v") throw new Error("Define " + la.n + " with a number");
    if (!lx && !ly && !rx && !ry) {
      return { kind: "val", f: () => comp(la, E, UF)() - comp(ra, E, UF)() };
    }
    const fl = comp(la, E, UF),
      fr = comp(ra, E, UF);
    return {
      kind: "imp",
      F: (x, y) => {
        E.x = x;
        E.y = y;
        return fl() - fr();
      },
    };
  }
  /* bare expression */
  const [bare, range2] = [clean, range];
  const ast = P(bare);
  note(ast);
  if (has(ast, "x") && !has(ast, "y")) {
    const f = comp(ast, E, UF);
    return {
      kind: "fn",
      f: x => {
        E.x = x;
        return f();
      },
      raw: f,
      range: range2 && [comp(P(range2[0]), E, UF), comp(P(range2[1]), E, UF)],
    };
  }
  if (has(ast, "y") || has(ast, "x")) {
    const f = comp(ast, E, UF);
    return {
      kind: "imp",
      F: (x, y) => {
        E.x = x;
        E.y = y;
        return f();
      },
    };
  }
  const f = comp(ast, E, UF);
  return { kind: "val", f };
}

/* ---- tracing onto the screen. S(u) -> [sx,sy] | null. Returns [[x0,y0,x1,y1,...],...] ---- */
export function trace(S, u0, u1, n, big) {
  const out = [];
  let cur = null;
  const add = p => {
    if (!cur) {
      cur = [];
      out.push(cur);
    }
    cur.push(p[0], p[1]);
  };
  const link = (ua, a, ub, b, d) => {
    if (!a && !b) {
      cur = null;
      return;
    }
    if (a && b) {
      const dist = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (dist > 5 && d < 10) {
        const um = (ua + ub) / 2,
          m = S(um);
        link(ua, a, um, m, d + 1);
        link(um, m, ub, b, d + 1);
        return;
      }
      if (dist > big && d >= 10) {
        cur = null;
        add(b);
        return;
      }
      if (!cur) add(a);
      add(b);
      return;
    }
    if (d < 8) {
      const um = (ua + ub) / 2,
        m = S(um);
      link(ua, a, um, m, d + 1);
      link(um, m, ub, b, d + 1);
      return;
    }
    if (a) {
      if (!cur) add(a);
      cur = null;
    } else {
      cur = null;
      add(b);
    }
  };
  let ua = u0,
    a = S(u0);
  for (let i = 1; i <= n; i++) {
    const ub = u0 + ((u1 - u0) * i) / n,
      b = S(ub);
    link(ua, a, ub, b, 0);
    ua = ub;
    a = b;
  }
  return out.filter(s => s.length >= 4 || true);
}

/* marching squares on a screen grid. F(wx,wy). returns flat segment array [x0,y0,x1,y1,...] in screen px */
export function implicit(F, w, h, toX, toY, cell = 6) {
  const nx = Math.ceil(w / cell) + 1,
    ny = Math.ceil(h / cell) + 1,
    V = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const wy = toY(j * cell);
    for (let i = 0; i < nx; i++) V[j * nx + i] = F(toX(i * cell), wy);
  }
  const out = [];
  const lerp = (a, b) => {
    const d = a - b;
    return d === 0 ? 0.5 : a / d;
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = V[j * nx + i],
        b = V[j * nx + i + 1],
        c = V[(j + 1) * nx + i + 1],
        d = V[(j + 1) * nx + i];
      if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
      const m = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (m === 0 || m === 15) continue;
      const x0 = i * cell,
        y0 = j * cell,
        x1 = x0 + cell,
        y1 = y0 + cell;
      /* edge crossings: top, right, bottom, left */
      const T = () => [x0 + lerp(a, b) * cell, y0],
        R = () => [x1, y0 + lerp(b, c) * cell],
        B = () => [x0 + lerp(d, c) * cell, y1],
        L = () => [x0, y0 + lerp(a, d) * cell];
      const seg = (p, q) => out.push(p[0], p[1], q[0], q[1]);
      switch (m) {
        case 1:
        case 14:
          seg(L(), T());
          break;
        case 2:
        case 13:
          seg(T(), R());
          break;
        case 3:
        case 12:
          seg(L(), R());
          break;
        case 4:
        case 11:
          seg(R(), B());
          break;
        case 6:
        case 9:
          seg(T(), B());
          break;
        case 7:
        case 8:
          seg(L(), B());
          break;
        case 5:
        case 10: {
          const mid = (a + b + c + d) / 4 > 0;
          if ((m === 5) === mid) {
            seg(L(), B());
            seg(T(), R());
          } else {
            seg(L(), T());
            seg(R(), B());
          }
          break;
        }
      }
    }
  return out;
}

/* ---- analysis on math coordinates ---- */
const bis = (g, a, b, fa) => {
  for (let k = 0; k < 60; k++) {
    const m = (a + b) / 2,
      fm = g(m);
    if (fm === 0) return m;
    if (fm > 0 === fa > 0) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
};
export function roots(f, xl, xr, n = 800) {
  const out = [],
    dx = (xr - xl) / n;
  let px = xl,
    py = f(px);
  for (let i = 1; i <= n; i++) {
    const x = xl + dx * i,
      y = f(x);
    if (isFinite(py) && isFinite(y)) {
      if (y === 0) out.push(x);
      else if (py !== 0 && py > 0 !== y > 0) {
        const r = bis(f, px, x, py),
          fr = f(r);
        if (
          Math.abs(fr) <= Math.max(1e-6, Math.abs(py) * 1e-3, Math.abs(y) * 1e-3) &&
          Math.abs(fr) < 1e-4 * Math.max(1, Math.abs(py), Math.abs(y))
        )
          out.push(r);
      }
    }
    px = x;
    py = y;
  }
  return out
    .map(x => (Math.abs(x) < (xr - xl) * 1e-9 ? 0 : x))
    .filter((x, i, a) => !i || Math.abs(x - a[i - 1]) > dx * 0.01);
}
export function extrema(f, xl, xr, n = 800) {
  const out = [],
    dx = (xr - xl) / n,
    h = dx * 1e-3;
  const d = x => (f(x + h) - f(x - h)) / (2 * h);
  let px = xl,
    pd = d(px);
  for (let i = 1; i <= n; i++) {
    const x = xl + dx * i,
      dd = d(x);
    if (isFinite(pd) && isFinite(dd) && pd !== 0 && (pd > 0 ? dd <= 0 : dd >= 0)) {
      const r = bis(d, px, x, pd),
        fr = f(r);
      const turn = d(r - dx * 0.5) > 0 !== d(r + dx * 0.5) > 0; /* x^3 at 0 is flat, not a turn */
      /* a jump (asymptote, abs corner is fine) shows as a huge slope on both sides; skip those */
      if (turn && isFinite(fr) && Math.abs(d(r - dx * 0.1)) < 1e6 && Math.abs(d(r + dx * 0.1)) < 1e6)
        out.push({ x: Math.abs(r) < (xr - xl) * 1e-9 ? 0 : r, y: fr, max: pd > 0 });
    }
    px = x;
    pd = dd;
  }
  return out;
}
