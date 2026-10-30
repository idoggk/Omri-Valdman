// Generates the PNG icons (no dependencies): node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
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

mkdirSync(outDir, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { rounded: true, scale: 1 }],
  ['icon-512.png', 512, { rounded: true, scale: 1 }],
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.7 }], // full bleed, symbol in safe zone
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.85 }], // opaque; iOS rounds corners
  ['favicon-32.png', 32, { rounded: true, scale: 1.1 }],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(join(outDir, name), encodePng(size, size, render(size, opts)));
  console.log('wrote', name);
}
