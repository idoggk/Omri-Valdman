import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng, resizeArea, artworkJobs } from '../tools/make-icons.mjs';

const p = (f) => fileURLToPath(new URL('../' + f, import.meta.url));

function synthetic(w, h) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    px[o] = (x * 37 + y * 11) & 255; px[o + 1] = (x * 5 + y * 91) & 255; px[o + 2] = (x ^ y) * 7 & 255; px[o + 3] = 255 - ((x + y) % 4) * 50;
  }
  return px;
}

test('encode/decode round trip on a synthetic RGBA PNG', () => {
  const px = synthetic(13, 9);
  const img = decodePng(encodePng(13, 9, px));
  assert.equal(img.width, 13); assert.equal(img.height, 9);
  assert.ok(img.data.equals(px));
});

test('decoder rejects unsupported formats clearly', () => {
  assert.throws(() => decodePng(Buffer.from('nope')), /Not a PNG/);
  const b = encodePng(2, 2, synthetic(2, 2));
  b[24] = 16; // bit depth
  assert.throws(() => decodePng(b), /Unsupported PNG/);
});

test('area resize averages pixels', () => {
  const px = Buffer.from([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]);
  const out = resizeArea({ width: 2, height: 2, data: px }, 1, 1);
  assert.deepEqual([...out.data], [100, 100, 100, 255]);
});

test('artwork jobs: sizes, opaque output, maskable keeps edges as background', () => {
  const w = 64, px = Buffer.alloc(w * w * 4);
  for (let i = 0; i < w * w; i++) px.set([60, 160, 250, 255], i * 4);
  px.set([255, 0, 0, 255], (32 * w + 32) * 4); // content in the middle
  const jobs = artworkJobs({ width: w, height: w, data: px });
  const sizes = Object.fromEntries(jobs.map(([n, s, d]) => [n, [s, d.length]]));
  assert.deepEqual(Object.keys(sizes).sort(), ['apple-touch-icon.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']);
  for (const [n, s, d] of jobs) {
    assert.equal(d.length, s * s * 4, n);
    for (let i = 3; i < d.length; i += 4) assert.equal(d[i], 255, n + ' must be opaque');
  }
});

test('committed icons are opaque RGBA with the right sizes', () => {
  const expect = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };
  for (const [name, size] of Object.entries(expect)) {
    const img = decodePng(readFileSync(p('icons/' + name)));
    assert.equal(img.width, size, name); assert.equal(img.height, size, name);
    for (let i = 3; i < img.data.length; i += 4) assert.equal(img.data[i], 255, name + ' must be opaque');
  }
});
