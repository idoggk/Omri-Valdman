import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const list = sw.match(/PRECACHE = \[([\s\S]*?)\]/)[1];
const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

const OPTIONAL = ['data/formulas.json', 'data/examples.json'];

test('every precached file exists', () => {
  for (const f of files) {
    if (f === './' || OPTIONAL.includes(f)) continue; // data created by other jobs; sw tolerates absence
    assert.ok(existsSync(new URL('../' + f, import.meta.url)), f);
  }
});

test('every js module is precached', () => {
  for (const f of readdirSync(new URL('../js/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    assert.ok(files.includes('js/' + f), f);
  }
});

test('optional data files are precached and install uses allSettled', () => {
  for (const f of OPTIONAL) assert.ok(files.includes(f), f);
  assert.match(sw, /Promise.allSettled/);
});
