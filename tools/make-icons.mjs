// Generates the PNG icons (no dependencies): node tools/make-icons.mjs
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const outDir = fileURLToPath(new URL('../icons/', import.meta.url));
const BG = [47, 111, 176];      // site accent (light palette)
const FG = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- PNG decoding (8-bit, colour types 2 and 6, non-interlaced) -------------
export function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) throw new Error('Not a PNG file');
  let pos = 8, w = 0, h = 0, bpc = 0, ct = 0, interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bpc = data[8]; ct = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!w || !h) throw new Error('PNG has no IHDR');
  if (bpc !== 8 || (ct !== 2 && ct !== 6) || interlace !== 0) {
    throw new Error(`Unsupported PNG (bit depth ${bpc}, colour type ${ct}, interlace ${interlace}); need 8-bit RGB/RGBA, non-interlaced`);
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * h) throw new Error('PNG data truncated');
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add;
      switch (ft) {
        case 0: add = 0; break;
        case 1: add = a; break;
        case 2: add = b; break;
        case 3: add = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break;
        }
        default: throw new Error('Bad PNG filter type ' + ft);
      }
      cur[i] = (cur[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * bpp;
      out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
      out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width: w, height: h, data: out };
}

// ---- Area-average (box) downscale, alpha-premultiplied; also fine for upscale-free use
export function resizeArea(img, nw, nh) {
  const { width: w, height: h, data } = img;
  const weights = (n, m) => Array.from({ length: m }, (_, i) => {
    const a = (i * n) / m, b = ((i + 1) * n) / m, list = [];
    for (let k = Math.floor(a); k < Math.min(n, Math.ceil(b)); k++) {
      const wt = Math.min(b, k + 1) - Math.max(a, k);
      if (wt > 1e-9) list.push([k, wt / (b - a)]);
    }
    return list;
  });
  const wx = weights(w, nw), wy = weights(h, nh);
  // horizontal pass -> float rows (premultiplied)
  const tmp = new Float64Array(nw * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [k, wt] of wx[x]) {
      const o = (y * w + k) * 4, al = data[o + 3] / 255 * wt;
      r += data[o] * al; g += data[o + 1] * al; b += data[o + 2] * al; a += al;
    }
    const t = (y * nw + x) * 4; tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = b; tmp[t + 3] = a;
  }
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [k, wt] of wy[y]) {
      const t = (k * nw + x) * 4;
      r += tmp[t] * wt; g += tmp[t + 1] * wt; b += tmp[t + 2] * wt; a += tmp[t + 3] * wt;
    }
    const o = (y * nw + x) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = Math.round(a * 255);
  }
  return { width: nw, height: nh, data: out };
}

// Composite img (RGBA) onto an opaque solid canvas, centred; returns RGBA buffer, alpha 255.
export function compose(size, bg, img) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  const ox = Math.round((size - img.width) / 2), oy = Math.round((size - img.height) / 2);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const s = (y * img.width + x) * 4, d = ((y + oy) * size + x + ox) * 4, a = img.data[s + 3] / 255;
    for (let c = 0; c < 3; c++) px[d + c] = Math.round(img.data[s + c] * a + px[d + c] * (1 - a));
  }
  return px;
}

// Mean colour of the top-left n x n patch (the artwork's blue background).
export function sampleBackground(img, n = 16) {
  const s = [0, 0, 0];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) s[c] += img.data[(y * img.width + x) * 4 + c];
  return s.map((v) => Math.round(v / (n * n)));
}

// Symbol in unit coordinates [0,1]: parabola arc + x axis, scaled about the centre.
function symbolSegments(scale) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = -1 + (2 * i) / 40;                 // -1..1
    pts.push([0.5 + t * 0.30 * scale, 0.5 + (-0.30 + 0.60 * t * t) * 0.9 * scale * -1 + 0.0]);
  }
  return pts;
}
function distSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function render(size, { rounded, scale }) {
  const px = Buffer.alloc(size * size * 4);
  const arc = symbolSegments(scale);
  const axis = [[0.5 - 0.36 * scale, 0.5 + 0.30 * scale], [0.5 + 0.36 * scale, 0.5 + 0.30 * scale]];
  const stroke = 0.045 * scale;
  const r = 0.22, SS = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bg = 0, fg = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
      let inside = true;
      if (rounded) {
        const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
        inside = Math.hypot(u - cx, v - cy) <= r;
      }
      if (!inside) continue;
      bg++;
      let d = distSeg(u, v, axis[0], axis[1]) - stroke * 0.5;
      for (let i = 0; i < arc.length - 1; i++) d = Math.min(d, distSeg(u, v, arc[i], arc[i + 1]) - stroke);
      if (d <= 0) fg++;
    }
    const n = SS * SS, o = (y * size + x) * 4;
    const a = bg / n;
    const f = bg ? fg / bg : 0;
    for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
    px[o + 3] = Math.round(a * 255);
  }
  return px;
}

const srcDir = join(outDir, 'source');
const ORIGINAL = join(srcDir, 'study-icon-original.png');
const SMALL = join(srcDir, 'study-icon-1024.png');

// Artwork icons built from a source picture. Returns [name, size, rgba] jobs.
export function artworkJobs(art) {
  const bg = sampleBackground(art);
  const full = (size) => resizeArea(art, size, size);
  const opaque = (size) => compose(size, bg, full(size));
  const inner = Math.round(512 * 0.76);
  return [
    ['icon-192.png', 192, opaque(192)],
    ['icon-512.png', 512, opaque(512)],
    ['icon-maskable-512.png', 512, compose(512, bg, resizeArea(art, inner, inner))], // content inside safe zone
    ['apple-touch-icon.png', 180, opaque(180)],
    ['favicon-32.png', 32, opaque(32)],
  ];
}

function main() {
  mkdirSync(outDir, { recursive: true });
  let jobs;
  const srcFile = existsSync(ORIGINAL) ? ORIGINAL : existsSync(SMALL) ? SMALL : null;
  if (srcFile) {
    let art = decodePng(readFileSync(srcFile));
    if (art.width !== art.height) throw new Error('Source artwork must be square');
    if (srcFile === ORIGINAL && statSync(ORIGINAL).size > 1.5e6) {
      const small = resizeArea(art, 1024, 1024);
      writeFileSync(SMALL, encodePng(1024, 1024, small.data));
      console.log('wrote source/study-icon-1024.png (original is over 1.5 MB; do not commit it)');
      art = small;
    }
    jobs = artworkJobs(art).map(([n, s, px]) => [n, s, px]);
  } else {
    jobs = [
      ['icon-192.png', 192, { rounded: true, scale: 1 }],
      ['icon-512.png', 512, { rounded: true, scale: 1 }],
      ['icon-maskable-512.png', 512, { rounded: false, scale: 0.7 }], // full bleed, symbol in safe zone
      ['apple-touch-icon.png', 180, { rounded: false, scale: 0.85 }], // opaque; iOS rounds corners
      ['favicon-32.png', 32, { rounded: true, scale: 1.1 }],
    ].map(([n, s, o]) => [n, s, render(s, o)]);
  }
  for (const [name, size, px] of jobs) {
    writeFileSync(join(outDir, name), encodePng(size, size, px));
    console.log('wrote', name);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
