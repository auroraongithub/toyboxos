/* Ink geometry for the whiteboard: compact point encoding, simplification, the variable-width outline
   that makes a stroke look like ink (perfect-freehand style), hit tests and shape recognition. */

/* ---- storage: points are stored relative to an origin, at half-pixel precision, as a polyline string
   (Google's encoding: ~1-2 chars per coordinate) plus one pressure digit per point ---- */
const Q = 2;
const encNum = v => {
  v = v < 0 ? ~(v << 1) : v << 1;
  let s = "";
  while (v >= 32) {
    s += String.fromCharCode((32 | (v & 31)) + 63);
    v >>= 5;
  }
  return s + String.fromCharCode(v + 63);
};
export function encode(pts, ox, oy) {
  let s = "",
    q = "",
    px = 0,
    py = 0;
  for (const p of pts) {
    const x = Math.round((p.x - ox) * Q),
      y = Math.round((p.y - oy) * Q);
    s += encNum(x - px) + encNum(y - py);
    px = x;
    py = y;
    q += Math.max(0, Math.min(9, Math.round((p.p == null ? 0.5 : p.p) * 9)));
  }
  return { p: s, q };
}
export function decode(p, q) {
  const out = [];
  let i = 0,
    x = 0,
    y = 0,
    n = 0;
  const next = () => {
    let r = 0,
      sh = 0,
      b;
    do {
      b = p.charCodeAt(i++) - 63;
      r |= (b & 31) << sh;
      sh += 5;
    } while (b >= 32 && i <= p.length);
    return r & 1 ? ~(r >> 1) : r >> 1;
  };
  while (i < p.length) {
    x += next();
    y += next();
    out.push({ x: x / Q, y: y / Q, p: q && q[n] != null ? +q[n] / 9 : 0.5 });
    n++;
  }
  return out;
}

/* Ramer-Douglas-Peucker, keeps pressure with the kept points */
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0,
      mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distSeg(pts[i].x, pts[i].y, pts[a].x, pts[a].y, pts[b].x, pts[b].y);
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1;
      st.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/* Chaikin corner cutting: two passes turn a polyline into a smooth curve (endpoints stay put) */
export function smooth(P, passes = 2) {
  for (let k = 0; k < passes && P.length > 2; k++) {
    const o = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i],
        b = P[i + 1];
      o.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, p: a.p * 0.75 + b.p * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, p: a.p * 0.25 + b.p * 0.75 },
      );
    }
    o.push(P[P.length - 1]);
    P = o;
  }
  return P;
}
export const pathLen = P => {
  let l = 0;
  for (let i = 1; i < P.length; i++) l += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
  return l;
};

/* the ink outline: a polygon whose half-width follows pressure, with round caps, drawn through midpoints */
export function outline(pts, size) {
  const P = smooth(pts),
    n = P.length,
    R = P.map(q => (size / 2) * (0.4 + 0.8 * q.p));
  const path = new Path2D();
  if (n < 2 || pathLen(P) < size * 0.3) {
    const r = Math.max(R[0] || size / 2, 0.6);
    path.arc(P[0].x, P[0].y, r, 0, Math.PI * 2);
    return path;
  }
  const L = [],
    Rt = [],
    A = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)],
      b = P[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x,
      ty = b.y - a.y;
    const d = Math.hypot(tx, ty) || 1;
    tx /= d;
    ty /= d;
    const nx = -ty,
      ny = tx;
    L.push([P[i].x + nx * R[i], P[i].y + ny * R[i]]);
    Rt.push([P[i].x - nx * R[i], P[i].y - ny * R[i]]);
    A.push(Math.atan2(ny, nx));
  }
  const side = (S, first) => {
    if (first) path.moveTo(S[0][0], S[0][1]);
    else path.lineTo(S[0][0], S[0][1]);
    for (let i = 1; i < S.length - 1; i++) {
      const m = [(S[i][0] + S[i + 1][0]) / 2, (S[i][1] + S[i + 1][1]) / 2];
      path.quadraticCurveTo(S[i][0], S[i][1], m[0], m[1]);
    }
    path.lineTo(S[S.length - 1][0], S[S.length - 1][1]);
  };
  side(L, true);
  path.arc(P[n - 1].x, P[n - 1].y, R[n - 1], A[n - 1], A[n - 1] - Math.PI, true);
  side(Rt.slice().reverse(), false);
  path.arc(P[0].x, P[0].y, R[0], A[0] + Math.PI, A[0], true);
  path.closePath();
  return path;
}
/* highlighter: an even-width smoothed centerline, stroked once (so overlaps don't darken) */
export function centerline(pts) {
  const P = smooth(pts),
    path = new Path2D();
  path.moveTo(P[0].x, P[0].y);
  if (P.length === 1) path.lineTo(P[0].x + 0.01, P[0].y);
  for (let i = 1; i < P.length; i++) path.lineTo(P[i].x, P[i].y);
  return path;
}

/* ---- shape recognition ----
   Returns {t:"l"|"a"|"r"|"e", ...} for a stroke that is clearly a line, arrow, rectangle or ellipse, else null.
   loose = the hold-to-snap gesture (you asked for a shape, so be generous); otherwise only obvious ones snap. */
const bbox = P => {
  let x0 = 1e9,
    y0 = 1e9,
    x1 = -1e9,
    y1 = -1e9;
  for (const p of P) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};
const straight = (P, a, b) => {
  const A = P[a],
    B = P[b],
    d = Math.hypot(B.x - A.x, B.y - A.y);
  let md = 0,
    l = 0;
  for (let i = a + 1; i <= b; i++) {
    l += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
    md = Math.max(md, distSeg(P[i].x, P[i].y, A.x, A.y, B.x, B.y));
  }
  return { d, l, dev: d ? md / d : 1, ratio: l ? d / l : 0 };
};
/* nudge near-horizontal/vertical/diagonal lines onto the axis */
function snapAngle(x, y, u, v) {
  const a = Math.atan2(v - y, u - x),
    d = Math.hypot(u - x, v - y),
    st = Math.PI / 4,
    r = Math.round(a / st) * st;
  return Math.abs(a - r) < 0.09 ? [x + Math.cos(r) * d, y + Math.sin(r) * d] : [u, v];
}
export function recognize(P, loose) {
  if (P.length < 4) return null;
  const b = bbox(P),
    diag = Math.hypot(b.w, b.h);
  if (diag < 14) return null;
  const L = pathLen(P),
    A = P[0],
    Z = P[P.length - 1],
    gap = Math.hypot(Z.x - A.x, Z.y - A.y);
  /* line */
  const s = straight(P, 0, P.length - 1);
  if (s.ratio > (loose ? 0.88 : 0.94) && s.dev < (loose ? 0.09 : 0.05)) {
    const [u, v] = snapAngle(A.x, A.y, Z.x, Z.y);
    return { t: "l", x: A.x, y: A.y, u, v };
  }
  /* arrow in one stroke: a straight shaft to the farthest point, then a short head scribbled around the tip */
  let mi = 0,
    md = 0;
  P.forEach((p, i) => {
    const d = Math.hypot(p.x - A.x, p.y - A.y);
    if (d > md) {
      md = d;
      mi = i;
    }
  });
  if (mi > 2 && mi < P.length - 2) {
    const sh = straight(P, 0, mi),
      T = P[mi],
      tail = L - sh.l;
    let far = 0;
    for (let i = mi; i < P.length; i++) far = Math.max(far, Math.hypot(P[i].x - T.x, P[i].y - T.y));
    if (
      sh.ratio > (loose ? 0.88 : 0.93) &&
      sh.dev < (loose ? 0.1 : 0.06) &&
      tail > sh.d * 0.12 &&
      tail < sh.d * 1.3 &&
      far < sh.d * 0.5 &&
      far > sh.d * 0.07
    ) {
      const [u, v] = snapAngle(A.x, A.y, T.x, T.y);
      return { t: "a", x: A.x, y: A.y, u, v };
    }
  }
  /* closed shapes */
  const mx = Math.max(b.w, b.h),
    mn = Math.min(b.w, b.h);
  if (gap > (loose ? 0.32 : 0.22) * mx || L < 2.4 * mx || mn < mx * 0.12) return null;
  const cx = (b.x0 + b.x1) / 2,
    cy = (b.y0 + b.y1) / 2,
    ra = b.w / 2,
    rb = b.h / 2;
  let ee = 0,
    er = 0;
  for (const p of P) {
    ee += Math.abs(Math.hypot((p.x - cx) / ra, (p.y - cy) / rb) - 1);
    er += Math.min(
      Math.abs(p.x - b.x0) / b.w,
      Math.abs(b.x1 - p.x) / b.w,
      Math.abs(p.y - b.y0) / b.h,
      Math.abs(b.y1 - p.y) / b.h,
    );
  }
  ee /= P.length;
  er /= P.length;
  const near = (x, y) => P.some(p => Math.hypot(p.x - x, p.y - y) < diag * 0.13);
  const corners = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ].filter(([x, y]) => near(x, y)).length;
  /* almost square / round: make it exact */
  const sq = Math.abs(b.w - b.h) / mx < 0.12;
  let w = b.w,
    h = b.h;
  if (sq) {
    w = h = (b.w + b.h) / 2;
  }
  const box = { x: cx - w / 2, y: cy - h / 2, w, h };
  if (corners >= 3 && er < (loose ? 0.075 : 0.05) && er < ee * 0.8) return { t: "r", ...box };
  if (ee < (loose ? 0.16 : 0.1) && corners <= 2) return { t: "e", ...box };
  if (loose && corners >= 3 && er < 0.09) return { t: "r", ...box };
  return null;
}
