// Lazy routes: the home route stays small, every lazily imported module is precached, backup still knows all stores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reachable } from './import-graph.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('home route: app.js statically pulls in at most 30 modules, and no mode UI', () => {
  const mods = [...reachable('js/app.js')];
  assert.ok(mods.length <= 30, `${mods.length} modules: ${mods.join(' ')}`);
  assert.deepEqual(mods.filter((m) => /-ui\.js$/.test(m)), [], 'a *-ui module is statically reachable from app.js');
});

test('every module named in routes.js is dynamically imported and precached', () => {
  const routes = read('js/routes.js');
  const sw = read('sw.js');
  const named = new Set([...routes.matchAll(/import\('\.\/([\w-]+\.js)'\)/g)].map((m) => m[1]));
  assert.ok(named.size > 40);
  for (const f of named) assert.ok(sw.includes(`'js/${f}'`), `js/${f} missing from PRECACHE`);
  assert.doesNotMatch(routes, /^import .* from '\.\/[\w-]+-ui\.js'/m);
});

// Backup coverage of all store keys is asserted by tests/backup.test.mjs ("every omri-study-*-vN key literal ... is in KNOWN_KEYS").
