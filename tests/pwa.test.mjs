import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (f) => fileURLToPath(new URL('../' + f, import.meta.url));
const manifest = JSON.parse(readFileSync(p('manifest.webmanifest'), 'utf8'));

function pngSize(file) {
  const b = readFileSync(p(file));
  assert.equal(b.subarray(1, 4).toString(), 'PNG', file + ' is not a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]]; // w, h, colour type
}

test('manifest has required fields', () => {
  assert.equal(manifest.name, 'Brain Gains');
  assert.equal(manifest.short_name, 'Brain Gains');
  assert.equal(manifest.lang, 'he');
  assert.equal(manifest.dir, 'rtl');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
});

test('manifest icons exist with declared sizes, incl. maskable', () => {
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const i of manifest.icons) {
    assert.ok(!i.src.startsWith('/'), 'icon path must be relative');
    const [w, h] = pngSize(i.src);
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
  assert.deepEqual(pngSize('icons/apple-touch-icon.png').slice(0, 2), [180, 180]);
  assert.deepEqual(pngSize('icons/favicon-32.png').slice(0, 2), [32, 32]);
});

test('sw.js: cache name present, precache references existing files', () => {
  const sw = readFileSync(p('sw.js'), 'utf8');
  assert.match(sw, /CACHE_NAME\s*=\s*'omri-study-'/);
  const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1];
  const urls = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(urls.length > 5);
  for (const u of urls) {
    assert.ok(!u.startsWith('/') && !u.startsWith('http'), 'relative only: ' + u);
    if (u === 'data/formulas.json' || u === 'data/examples.json') continue; // optional, created by data jobs
    assert.ok(existsSync(p(u === './' ? 'index.html' : u)), 'missing: ' + u);
  }
});

test('index.html has the PWA tags', () => {
  const html = readFileSync(p('index.html'), 'utf8');
  for (const needle of [
    'rel="manifest" href="manifest.webmanifest"',
    'rel="apple-touch-icon"',
    'name="apple-mobile-web-app-capable" content="yes"',
    'name="mobile-web-app-capable"',
    'name="apple-mobile-web-app-status-bar-style"',
    'name="apple-mobile-web-app-title"',
    'prefers-color-scheme: dark',
    'src="js/pwa.js"',
  ]) assert.ok(html.includes(needle), 'missing ' + needle);
});
