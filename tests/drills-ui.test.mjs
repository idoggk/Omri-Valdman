import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const D = await import('../js/drills-ui.js');
const P = await import('../js/practice-ui.js');

const raw = readFileSync(new URL('../data/drills.json', import.meta.url), 'utf8');
const okFetch = async () => ({ ok: true, json: async () => JSON.parse(raw) });
const badFetch = async () => { throw new Error('offline'); };
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn: okFetch };
const text = () => dom.root.textContent;
const btns = () => dom.root.all((n) => n.tagName === 'BUTTON');
const KEY = 'omri-study-drills-v1';

test('offline: friendly error and a retry button, no throw', async () => {
  D.resetDrillCache();
  await D.viewDrills({ ...ctx, fetchFn: badFetch });
  assert.match(text(), /לא ניתן לטעון את התרגולים/);
  assert.ok(dom.root.byText('button', 'נסו שוב'));
  await D.viewDrills({ ...ctx, fetchFn: async () => ({ ok: false, status: 404 }) });
  assert.match(text(), /לא ניתן לטעון/);
});

for (const [label, stored] of [['empty', null], ['corrupted', '{not json'], ['garbage shape', '{"items":5,"traps":[1]}'],
  ['populated', JSON.stringify({ v: 1, items: { 'trap-m-01': { right: 1, wrong: 2, ts: 5 } }, traps: { 'divide-by-zero': { right: 1, wrong: 2 } } })]]) {
  test(`menu, traps, sanity, cards and progress render with ${label} storage`, async () => {
    dom.store.clear();
    if (stored != null) dom.store.set(KEY, stored);
    D.resetDrillCache();
    await D.viewDrills(ctx);
    assert.match(text(), /מלכודות נפוצות/);
    assert.ok(dom.root.byText('button', 'פיזיקה'));
    assert.ok(dom.root.byText('button', 'כרטיסיות'));
    P.viewProgress({ ...ctx, topics: [] });
    assert.match(text(), /דיוק במלכודות/);
  });
}

test('trap session: 10 items, feedback + next, summary lists missed trapIds, results persist', async () => {
  dom.store.clear();
  await D.viewDrills(ctx);
  dom.root.byText('button', 'מלכודות נפוצות').click();
  let missedTraps = new Set();
  for (let i = 0; i < 10; i++) {
    assert.match(text(), new RegExp(`שאלה ${i + 1} מתוך 10`));
    const opts = dom.root.all((n) => n.tagName === 'BUTTON' && n.className.includes('drill-opt'));
    assert.ok(opts.length >= 2);
    opts[opts.length - 1].click();
    assert.match(text(), /(נכון!|לא מדויק\.)/);
    assert.ok(opts.every((b) => b.disabled));
    (dom.root.byText('button', 'הבא') || dom.root.byText('button', 'לסיכום')).click();
  }
  assert.match(text(), /ציון: \d+ מתוך 10/);
  const d = store.loadDrills();
  assert.equal(Object.keys(d.items).length, 10);
  const wrongTotal = Object.values(d.traps).reduce((s, t) => s + t.wrong, 0);
  const missedLis = dom.root.all((n) => n.tagName === 'LI').length;
  assert.ok(wrongTotal === 0 ? /בלי טעויות/.test(text()) : missedLis >= 1);
  assert.ok(store.weakTraps().length <= 5);
  assert.ok(dom.root.byText('button', 'סשן נוסף'));
});

test('topic filter limits the pool; physics-only sanity session', async () => {
  dom.store.clear();
  await D.viewDrills(ctx);
  dom.root.byText('button', 'פיזיקה').click();
  dom.root.byText('button', 'בדיקות שפיות').click();
  const q = text();
  assert.match(q, /שאלה 1 מתוך \d+/);
  const { data } = await D.loadDrillData(okFetch);
  const phys = D.pickSession(data.sanity, 'physics');
  assert.ok(phys.length > 0 && phys.every((x) => x.topic.startsWith('phys')));
  assert.ok(D.pickSession(data.traps, 'all').length === 10);
});

test('flashcards: flip, "again" repeats at the end, stored once per card', async () => {
  dom.store.clear();
  await D.viewDrills(ctx);
  dom.root.byText('button', 'כרטיסיות').click();
  assert.match(text(), /נותרו 10 כרטיסים/);
  dom.root.all((n) => n.className.includes('flashcard'))[0].click();
  dom.root.byText('button', 'שוב').click(); // first card goes to the back
  assert.match(text(), /נותרו 10 כרטיסים/);
  for (let i = 0; i < 10; i++) {
    dom.root.all((n) => n.className.includes('flashcard'))[0].click();
    dom.root.byText('button', 'ידעתי').click();
  }
  assert.match(text(), /ציון: 9 מתוך 10/);
  const d = store.loadDrills();
  assert.equal(Object.keys(d.items).length, 10);
  assert.deepEqual(Object.keys(d.traps), []); // cards do not feed trap accuracy
});

test('store: sanitizeDrills drops junk, weakTraps sorts by accuracy', () => {
  assert.deepEqual(store.sanitizeDrills(7), { v: 1, items: {}, traps: {} });
  dom.store.clear();
  store.recordDrill('a', 'x', true); store.recordDrill('b', 'y', false); store.recordDrill('c', 'x', false);
  const w = store.weakTraps();
  assert.deepEqual(w.map((t) => t.trapId), ['y', 'x']);
  dom.store.set(KEY, '[1,2]');
  assert.deepEqual(store.weakTraps(), []);
});

test('cleanup', () => dom.restore());
