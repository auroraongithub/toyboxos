/* A small, safe calculator for text on the whiteboard (no eval): 12*3.5=, sqrt(2)=, 2^10=, 15% * 80=,
   sin(30°)=, variables (r = 4 on one line, pi*r^2= on a later one) and unit conversions (5km in mi,
   72 f to c, 100 usd in php — currencies use the app's live USD rate). */
import { fx } from "./store.js";

const FN = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: Math.log,
  log: (x, b) => (b == null ? Math.log10(x) : Math.log(x) / Math.log(b)),
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (x, d) => {
    const m = Math.pow(10, d || 0);
    return Math.round(x * m) / m;
  },
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  hypot: Math.hypot,
  fact: x => fact(x),
  nCr: (n, k) => fact(n) / (fact(k) * fact(n - k)),
  nPr: (n, k) => fact(n) / fact(n - k),
  mod: (a, b) => ((a % b) + b) % b,
};
const CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, inf: Infinity };
function fact(n) {
  if (n < 0 || n !== Math.floor(n)) throw 0;
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function lex(s) {
  s = s
    .replace(/[×·∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\*\*/g, "^")
    .replace(/π/g, " pi ")
    .replace(/√/g, " sqrt ")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3");
  const T = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const n = s.slice(i).match(/^(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (n) {
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
    if ("+-*/^%!(),|°".includes(c)) {
      T.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw 0;
  }
  return T;
}
/* precedence climbing with implicit multiplication (2pi, 3(4+1), 2sqrt(2)) */
function parse(T, vars) {
  let i = 0;
  const pk = () => T[i],
    is = v => T[i] && T[i].t === "op" && T[i].v === v,
    eat = v => {
      if (!is(v)) throw 0;
      i++;
    };
  const starts = () => {
    const t = pk();
    return t && (t.t === "n" || t.t === "id" || (t.t === "op" && (t.v === "(" || t.v === "|")));
  };
  function add() {
    let v = mul();
    while (is("+") || is("-")) {
      const o = T[i++].v,
        r = mul();
      v = o === "+" ? v + r : v - r;
    }
    return v;
  }
  function mul() {
    let v = unary();
    for (;;) {
      if (is("*")) {
        i++;
        v *= unary();
      } else if (is("/")) {
        i++;
        v /= unary();
      } else if (starts() && !(pk().t === "op" && pk().v === "|" && absDepth)) v *= unary();
      else return v;
    }
  }
  function unary() {
    if (is("-")) {
      i++;
      return -unary();
    }
    if (is("+")) {
      i++;
      return unary();
    }
    return pow();
  }
  function pow() {
    const b = post();
    if (is("^")) {
      i++;
      return Math.pow(b, unary());
    }
    return b;
  }
  function post() {
    let v = prim();
    for (;;) {
      if (is("!")) {
        i++;
        v = fact(v);
      } else if (is("%")) {
        i++;
        v /= 100;
      } else if (is("°")) {
        i++;
        v *= Math.PI / 180;
      } else return v;
    }
  }
  let absDepth = 0;
  function prim() {
    const t = T[i++];
    if (!t) throw 0;
    if (t.t === "n") return t.v;
    if (t.t === "op" && t.v === "(") {
      const v = add();
      eat(")");
      return v;
    }
    if (t.t === "op" && t.v === "|") {
      absDepth++;
      const v = add();
      absDepth--;
      eat("|");
      return Math.abs(v);
    }
    if (t.t === "id") {
      const id = t.v,
        lo = id.toLowerCase();
      if (vars && id in vars) return vars[id];
      const f = FN[id] || FN[lo];
      if (f) {
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
          return f(...a);
        }
        return f(pow());
      }
      if (lo in CONST) return CONST[lo];
      if (lo === "deg") return Math.PI / 180;
      throw 0;
    }
    throw 0;
  }
  const v = add();
  if (i < T.length) throw 0;
  return v;
}
export function calc(src, vars) {
  try {
    const v = parse(lex(String(src)), vars);
    return typeof v === "number" && !isNaN(v) ? v : null;
  } catch (e) {
    return null;
  }
}

export function fmtNum(v, sig = 10) {
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "−∞";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-6))
    return v
      .toExponential(6)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e");
  return parseFloat(v.toPrecision(sig)).toLocaleString("en-US", { maximumFractionDigits: 10 });
}

/* ---- units: [dimension, factor to the base unit] ---- */
const U = {};
const def = (dim, f, ...names) =>
  names.forEach(n => {
    U[n] = [dim, f];
  });
def("len", 1e-3, "mm", "millimeter", "millimeters");
def("len", 0.01, "cm", "centimeter", "centimeters");
def("len", 1, "m", "meter", "meters", "metre", "metres");
def("len", 1e3, "km", "kilometer", "kilometers", "kilometre", "kilometres");
def("len", 0.0254, "in", "inch", "inches");
def("len", 0.3048, "ft", "foot", "feet");
def("len", 0.9144, "yd", "yard", "yards");
def("len", 1609.344, "mi", "mile", "miles");
def("len", 1852, "nmi");
def("mass", 1e-6, "mg");
def("mass", 1e-3, "g", "gram", "grams");
def("mass", 1, "kg", "kilo", "kilos", "kilogram", "kilograms");
def("mass", 1e3, "t", "ton", "tons", "tonne");
def("mass", 0.45359237, "lb", "lbs", "pound", "pounds");
def("mass", 0.028349523125, "oz", "ounce", "ounces");
def("time", 1e-3, "ms");
def("time", 1, "s", "sec", "secs", "second", "seconds");
def("time", 60, "min", "mins", "minute", "minutes");
def("time", 3600, "h", "hr", "hrs", "hour", "hours");
def("time", 86400, "d", "day", "days");
def("time", 604800, "wk", "week", "weeks");
def("time", 31557600, "yr", "yrs", "year", "years");
def("vol", 1e-3, "ml", "mL");
def("vol", 1, "l", "L", "liter", "liters", "litre", "litres");
def("vol", 3.785411784, "gal", "gallon", "gallons");
def("vol", 0.946352946, "qt", "quart", "quarts");
def("vol", 0.2365882365, "cup", "cups");
def("vol", 0.0295735295625, "floz");
def("vol", 0.01478676478125, "tbsp");
def("vol", 0.00492892159375, "tsp");
def("area", 1, "m2", "m²", "sqm");
def("area", 1e6, "km2", "km²");
def("area", 0.09290304, "ft2", "ft²", "sqft");
def("area", 1e4, "ha", "hectare", "hectares");
def("area", 4046.8564224, "acre", "acres");
def("speed", 1, "m/s", "mps");
def("speed", 1 / 3.6, "km/h", "kph", "kmh");
def("speed", 0.44704, "mph");
def("speed", 0.514444, "kn", "knot", "knots");
def("data", 0.125, "bit", "bits");
def("data", 1, "B", "byte", "bytes");
def("data", 1e3, "KB", "kB");
def("data", 1e6, "MB");
def("data", 1e9, "GB");
def("data", 1e12, "TB");
def("data", 1024, "KiB");
def("data", 1048576, "MiB");
def("data", 1073741824, "GiB");
const TEMP = { c: ["C", "°C", "c", "celsius"], f: ["F", "°F", "f", "fahrenheit"], k: ["K", "kelvin"] };
const CURR = { php: ["php", "₱", "peso", "pesos"], usd: ["usd", "$", "dollar", "dollars"] };
function unit(n) {
  if (!n) return null;
  const raw = n.trim(),
    lo = raw.toLowerCase();
  for (const [k, l] of Object.entries(TEMP))
    if (l.includes(raw) || (l.includes(lo) && lo.length > 1))
      return { dim: "temp", k, n: k === "k" ? "K" : "°" + k.toUpperCase() };
  for (const [k, l] of Object.entries(CURR)) if (l.includes(lo)) return { dim: "cur", k, n: k.toUpperCase() };
  const u = U[raw] || U[lo];
  return u ? { dim: u[0], f: u[1], n: raw } : null;
}
const toK = (v, k) => (k === "c" ? v + 273.15 : k === "f" ? ((v - 32) * 5) / 9 + 273.15 : v);
const fromK = (v, k) => (k === "c" ? v - 273.15 : k === "f" ? ((v - 273.15) * 9) / 5 + 32 : v);

/* "5km in mi", "$20 to php", "72 f in c" -> "3.10686 mi" (null if it isn't a conversion) */
export function convert(s, vars) {
  const m = String(s)
    .trim()
    .replace(/=\s*$/, "")
    .match(/^(.+?)\s*(?:\s(?:in|to|as)\s|->|→)\s*(\S+)\s*$/i);
  if (!m) return null;
  let left = m[1].trim(),
    from = null;
  const pre = left.match(/^([$₱])\s*(.+)$/);
  if (pre) {
    from = unit(pre[1]);
    left = pre[2];
  } else {
    const u = left.match(/^(.*?[\d)a-z.])\s*(°?[a-zA-Z$₱µ][a-zA-Z/²0-9]*)$/);
    if (!u) return null;
    from = unit(u[2]);
    left = u[1];
  }
  const to = unit(m[2]);
  if (!from || !to || from.dim !== to.dim) return null;
  const v = calc(left, vars);
  if (v == null) return null;
  let r;
  if (from.dim === "temp") r = fromK(toK(v, from.k), to.k);
  else if (from.dim === "cur") {
    const usd = fx().r;
    r = from.k === to.k ? v : from.k === "usd" ? v * usd : v / usd;
    return (
      (to.k === "php" ? "₱" : "$") +
      r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  } else r = (v * from.f) / to.f;
  return fmtNum(r, 6) + " " + to.n;
}

/* one line of a text box. vars carries assignments down the box.
   -> {res, expr} when the line asks for an answer, {def} for an assignment, else null */
export function evalLine(line, vars) {
  const t = String(line).trim();
  if (!t || t.length > 200) return null;
  const a = t.match(/^([a-zA-Z_]\w{0,15})\s*=\s*([^=]+)$/);
  if (a && !(a[1] in FN)) {
    const v = calc(a[2], vars);
    if (v != null) {
      vars[a[1]] = v;
      return { def: a[1] };
    }
  }
  const asks = /(?:[^=<>!]|[\d)]!)=\s*$/.test(t);
  const body = asks ? t.replace(/=\s*$/, "").trim() : t;
  const cv = convert(body, vars);
  if (cv != null) return { res: cv, expr: body, conv: true };
  if (!asks || !/[\d)a-z]/i.test(body)) return null;
  const v = calc(body, vars);
  if (v == null) return null;
  return { res: fmtNum(v), expr: body };
}
