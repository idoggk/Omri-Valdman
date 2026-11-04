import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectItems, findProblems, applyAllow, normalizeMath, check } from '../tools/verify-dupes.mjs';

const tool = fileURLToPath(new URL('../tools/verify-dupes.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/dupes', import.meta.url));

test('the real banks have no unallowed duplicate ids, statements or reserved/practice equation overlaps, and no stale allowlist entry', async () => {
  const r = await check();
  assert.deepEqual(r.bad.map((p) => p.detail), []);
  assert.deepEqual(r.stale, []);
  assert.ok(r.items.length > 700);
});

test('normalizeMath folds typography', () => {
  assert.equal(normalizeMath('<span dir="ltr">x² − 2x = √3 × 4 ≤ y</span>'), 'x^2-2x=sqrt3*4<=y');
});

test('seeded fixture: duplicate id, duplicate statement and reserved/practice equation overlap are found; the CLI exits 1', async () => {
  const items = await collectItems(fixture);
  const found = findProblems(items);
  assert.deepEqual([...new Set(found.map((p) => p.type))].sort(), ['eq', 'id', 'stmt']);
  assert.ok(found.some((p) => p.type === 'id' && p.key === 'm-1'));
  assert.ok(found.some((p) => p.type === 'eq' && p.ids.includes('tr-1')));
  const res = spawnSync(process.execPath, [tool], { env: { ...process.env, VERIFY_DUPES_ROOT: fixture }, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /DUPLICATE id: .*m-1/);
  assert.match(res.stderr, /DUPLICATE eq: reserved tr-1/);
});

test('allowlist: matching entries are allowed, entries that match nothing are stale', async () => {
  const found = findProblems(await collectItems(fixture));
  const allow = found.map((p) => (p.type === 'eq' ? { type: 'pair', key: p.pair } : { type: p.type, key: p.key }));
  const ok = applyAllow(found, allow);
  assert.equal(ok.bad.length, 0);
  assert.equal(ok.stale.length, 0);
  assert.equal(applyAllow(found, [...allow, { type: 'stmt', key: 'nope|nada' }]).stale.length, 1);
  assert.equal(applyAllow(found, allow.slice(1)).bad.length, 1);
});
