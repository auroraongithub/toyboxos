/* QR codes for pairing links: byte mode, error correction M, versions 1-10 (up to 213 bytes). Follows ISO 18004 the way
   Nayuki's reference encoder does; the mask is picked by the standard penalty rules. qr(text) -> boolean[][] (true = dark). */
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // level M, per version
const mul = (x, y) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 255;
};
const divisor = n => {
  const r = new Array(n).fill(0);
  r[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < n) r[j] ^= r[j + 1];
    }
    root = mul(root, 2);
  }
  return r;
};
const remainder = (data, div) => {
  const r = div.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    div.forEach((c, i) => (r[i] ^= mul(c, f)));
  }
  return r;
};
const rawModules = v => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
};
const dataBytes = v => Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v];
const alignAt = (v, size) => {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2,
    step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2,
    r = [6];
  for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
  return r;
};
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export function qr(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataBytes(v) * 8) v++;
  if (v > 10) throw new Error("Too long for a QR code");
  /* data bits: mode, length, bytes, terminator, padding */
  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach(b => put(b, 8));
  const cap = dataBytes(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let p = 0xec; data.length < dataBytes(v); p ^= 0xec ^ 0x11) data.push(p);
  /* split into blocks, add Reed-Solomon, interleave */
  const nb = BLOCKS[v],
    ecl = ECC[v],
    raw = Math.floor(rawModules(v) / 8),
    short = nb - (raw % nb),
    slen = Math.floor(raw / nb),
    div = divisor(ecl),
    blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + slen - ecl + (i < short ? 0 : 1));
    k += d.length;
    const e = remainder(d, div);
    if (i < short) d.push(0);
    blocks.push(d.concat(e));
  }
  const words = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== slen - ecl || j >= short) words.push(b[i]);
    });
  /* function patterns */
  const size = v * 4 + 17,
    m = [...Array(size)].map(() => Array(size).fill(false)),
    fn = [...Array(size)].map(() => Array(size).fill(false));
  const set = (x, y, d) => {
    m[y][x] = d;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy,
          d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const al = alignAt(v, size),
    last = al.length - 1;
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const format = mask => {
    const d = mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412,
      bit = i => ((b >>> i) & 1) === 1; // level M = 00
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const d = ((b >>> i) & 1) === 1,
        a = size - 11 + (i % 3),
        c = Math.floor(i / 3);
      set(a, c, d);
      set(c, a, d);
    }
  }
  /* codewords in the zigzag */
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x] && i < words.length * 8) {
          m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
  /* the mask with the lowest penalty */
  const apply = k => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x];
  };
  let best = 0,
    bestP = Infinity;
  for (let k = 0; k < 8; k++) {
    apply(k);
    format(k);
    const p = penalty(m, size);
    if (p < bestP) {
      bestP = p;
      best = k;
    }
    apply(k);
  }
  apply(best);
  format(best);
  return m;
}
function penalty(m, size) {
  let p = 0,
    dark = 0;
  const at = (x, y, col) => (col ? m[x][y] : m[y][x]);
  for (const col of [false, true])
    for (let y = 0; y < size; y++) {
      let run = 1;
      const line = [];
      for (let x = 0; x < size; x++) {
        const c = at(x, y, col);
        line.push(c ? 1 : 0);
        if (x && c === at(x - 1, y, col)) {
          run++;
          if (run === 5) p += 3;
          else if (run > 5) p++;
        } else run = 1;
      }
      const s = line.join("");
      for (const pat of ["10111010000", "00001011101"]) {
        let k = s.indexOf(pat);
        while (k >= 0) {
          p += 40;
          k = s.indexOf(pat, k + 1);
        }
      }
    }
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
  for (const r of m) for (const c of r) if (c) dark++;
  return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}
/* an SVG string; black on white with a 4-module quiet zone whatever the theme, so every camera reads it */
export function qrSvg(text) {
  const m = qr(text),
    n = m.length,
    q = 4;
  let d = "";
  m.forEach((r, y) =>
    r.forEach((c, x) => {
      if (c) d += `M${x + q} ${y + q}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
