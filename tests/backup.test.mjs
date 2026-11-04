import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const B = await import('../js/backup.js');

const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};
const sample = () => fake({
  'omri-study-progress-v2': JSON.stringify({ v: 2, ex: { a: { done: true }, b: { done: true } } }),
  'omri-study-attempts-v1': JSON.stringify([{ exerciseId: 'a' }, { exerciseId: 'b' }, { exerciseId: 'c' }]),
  'omri-study-drills-v1': JSON.stringify({ v: 1, items: { x: { right: 1, wrong: 0 } }, traps: {} }),
  'unrelated-key': 'secret',
});

test('round trip: build then restore into empty storage reproduces every known key, nothing else', () => {
  const src = sample();
  const code = B.buildBackup(src, 5);
  assert.ok(!code.includes('unrelated-key') && !code.includes('secret'));
  const res = B.parseBackup(code);
  assert.equal(res.ok, true);
  assert.deepEqual(res.preview.map((p) => p.count), [2, 3, 1]);
  const dst = fake();
  assert.equal(B.applyBackup(dst, res), true);
  for (const k of ['omri-study-progress-v2', 'omri-study-attempts-v1', 'omri-study-drills-v1']) assert.equal(dst.getItem(k), src.getItem(k));
  assert.equal(dst.m.size, 4); // three keys plus the undo snapshot
  assert.ok(dst.m.has(B.UNDO_KEY));
});

test('code survives surrounding whitespace', () => {
  assert.equal(B.parseBackup('\n  ' + B.buildBackup(sample()) + '  \n').ok, true);
});

const wrap = (data, extra = {}) => JSON.stringify({ app: 'brain-gains', v: 1, ts: 1, data, ...extra });
for (const [label, input] of [
  ['empty', ''], ['not a string', null], ['truncated json', B.buildBackup(sample()).slice(0, 40)], ['garbage', 'hello'],
  ['array', '[]'], ['wrong app', JSON.stringify({ app: 'x', v: 1, data: {} })],
  ['wrong version', wrap({}, { v: 3 })], ['no data', JSON.stringify({ app: 'brain-gains', v: 1 })],
  ['empty data', wrap({})],
  ['unknown key', wrap({ 'omri-study-progress-v2': '{}', evil: '{}' })],
  ['proto key', '{"app":"brain-gains","v":1,"data":{"__proto__":"{}"}}'],
  ['value not string', wrap({ 'omri-study-progress-v2': { a: 1 } })],
  ['value not json', wrap({ 'omri-study-progress-v2': '{oops' })],
  ['value scalar', wrap({ 'omri-study-progress-v2': '5' })],
  ['too big', 'x'.repeat(B.MAX_CODE_CHARS + 1)],
]) {
  test(`invalid input is rejected and never overwrites: ${label}`, () => {
    const res = B.parseBackup(input);
    assert.equal(res.ok, false);
    assert.equal(typeof res.error, 'string');
    const dst = fake({ 'omri-study-progress-v2': '{"keep":1}' });
    assert.equal(B.applyBackup(dst, res), false);
    assert.equal(dst.getItem('omri-study-progress-v2'), '{"keep":1}');
  });
}

test('applyBackup reports failure when storage throws', () => {
  const res = B.parseBackup(B.buildBackup(sample()));
  assert.equal(B.applyBackup({ setItem() { throw new Error('quota'); } }, res), false);
});

test('last backup days and reminder text', () => {
  const s = fake();
  assert.equal(B.daysSinceBackup(s, 1e12), null);
  B.markBackedUp(s, 1e12);
  assert.equal(B.daysSinceBackup(s, 1e12 + 3 * 86_400_000 + 5), 3);
  assert.equal(B.reminderText(null, 2), null);
  assert.match(B.reminderText(null, 9), /עוד לא גיביתם/);
  assert.match(B.reminderText(3, 9), /לפני 3 ימים\./);
  assert.doesNotMatch(B.reminderText(3, 9), /כדאי/);
  assert.match(B.reminderText(8, 9), /כדאי לגבות שוב/);
  assert.match(B.reminderText(0, 0), /היום/);
});

test('backup screen renders; clipboard failure shows the fallback textarea; restore previews then applies only on confirm', async () => {
  dom.store.clear();
  dom.store.set('omri-study-drills-v1', JSON.stringify({ v: 1, items: { x: { right: 1, wrong: 0 } }, traps: {} }));
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => { throw new Error('denied'); } } }, configurable: true });
  B.viewBackup({ show: dom.show });
  assert.ok(dom.root.byText('button', 'העתק קוד התקדמות'));
  dom.root.byText('button', 'העתק קוד התקדמות').click();
  await new Promise((r) => setTimeout(r, 0));
  const box = dom.root.all((n) => n.tagName === 'TEXTAREA' && n.attrs['aria-label'] === 'קוד גיבוי')[0];
  assert.ok(box, 'fallback textarea visible');
  assert.equal(B.parseBackup(box.value).ok, true);
  assert.ok(dom.store.has(B.LAST_BACKUP_KEY));

  const input = dom.root.all((n) => n.tagName === 'TEXTAREA' && n.attrs.placeholder)[0];
  input.value = '{bad';
  dom.root.byText('button', 'בדוק קוד').click();
  assert.match(dom.root.textContent, /לא בוצע שום שינוי/);
  assert.equal(dom.root.byText('button', 'אשרו שחזור'), null);

  dom.store.delete('omri-study-drills-v1');
  input.value = box.value;
  dom.root.byText('button', 'בדוק קוד').click();
  assert.match(dom.root.textContent, /תרגולים מהירים: 1 רשומות/);
  assert.equal(dom.store.has('omri-study-drills-v1'), false, 'nothing applied before confirm');
  dom.root.byText('button', 'אשרו שחזור').click();
  assert.equal(dom.store.has('omri-study-drills-v1'), true);
  assert.match(dom.root.textContent, /הגיבוי שוחזר/);
});

test('order trainer best scores are part of the backup allowlist and round-trip', () => {
  assert.ok('omri-study-order-v1' in B.KNOWN_KEYS);
  const st = fake({ 'omri-study-order-v1': '{"best":{"a":100}}' });
  const code = B.buildBackup(st, 1);
  assert.equal(JSON.parse(code).data['omri-study-order-v1'], '{"best":{"a":100}}');
});

test('checkpoints attempts are part of the backup allowlist and round-trip', () => {
  assert.ok('omri-study-checkpoints-v1' in B.KNOWN_KEYS);
  const v = '{"v":1,"items":{"cp-math-01":{"runs":1,"perfect":true,"missed":[],"ts":5}}}';
  const code = B.buildBackup(fake({ 'omri-study-checkpoints-v1': v }), 1);
  assert.equal(JSON.parse(code).data['omri-study-checkpoints-v1'], v);
});

test('methods trainer results are part of the backup allowlist and round-trip', () => {
  assert.ok('omri-study-methods-v1' in B.KNOWN_KEYS);
  const v = '{"v":1,"items":{"mt-math-01":{"tries":2,"right":1,"last":true,"ts":5}}}';
  const code = B.buildBackup(fake({ 'omri-study-methods-v1': v }), 1);
  assert.equal(JSON.parse(code).data['omri-study-methods-v1'], v);
});

test('edge-case lab results are part of the backup allowlist and round-trip', () => {
  assert.ok('omri-study-edgecases-v1' in B.KNOWN_KEYS);
  const v = '{"v":1,"items":{"ec-m-01":{"tries":2,"right":1,"last":true,"ts":5}}}';
  const code = B.buildBackup(fake({ 'omri-study-edgecases-v1': v }), 1);
  assert.equal(JSON.parse(code).data['omri-study-edgecases-v1'], v);
});

test('edge-case lab: data passes the verifier, injected errors are caught, UI grades and records', async () => {
  const { readFileSync } = await import('node:fs');
  const { validateEdgecases } = await import('../tools/verify-edgecases.mjs');
  const E = await import('../js/edgecases-ui.js');
  const load = () => JSON.parse(readFileSync(new URL('../data/edgecases.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateEdgecases(load()), []);
  const bad = (mut) => { const d = load(); mut(d); return validateEdgecases(d).join('\n'); };
  assert.match(bad((d) => { d.items[0].candidates[0].ok = false; }), /marked false but substituting/);
  assert.match(bad((d) => { d.items[0].answers.pop(); }), /differ from the independently solved set/);
  assert.match(bad((d) => { d.items[5].answers = [[3, 3, 9]]; }), /differ/);
  assert.match(bad((d) => { d.items[10].answers = [[2]]; }), /differ|quadratic/);
  assert.match(bad((d) => { d.items[1].explanation = 'short'; }), /explanation/);

  const items = load().items;
  const ctx = { show: dom.show, edgecases: items, rnd: () => 0.5 };
  dom.root.replaceChildren();
  await E.viewEdgeRoute(ctx);
  assert.match(dom.root.textContent, /מתוך 20 נענו/);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && /^#\/edge\/ec-/.test(n.getAttribute('href') || '')).length, items.length);

  const run = async (id, tick) => {
    globalThis.localStorage.removeItem(E.EDGE_KEY);
    await E.viewEdgeRoute(ctx, id);
    const it = items.find((x) => x.id === id);
    const boxes = dom.root.all((n) => n.tagName === 'INPUT');
    assert.equal(boxes.length, it.candidates.length);
    // rows are shuffled: match a box to its candidate through the label text
    boxes.forEach((b) => { b.checked = false; });
    for (const b of boxes) {
      const text = b.parent.textContent;
      const c = it.candidates.find((q) => text.includes(E.labelOf(it, q).replace(/\s/g, ' ')) && !it.candidates.some((o) => o !== q && E.labelOf(it, o).length > E.labelOf(it, q).length && text.includes(E.labelOf(it, o))));
      b.checked = tick(c);
    }
    dom.root.byText('button', 'בדיקה').click();
  };
  await run('ec-m-05', (c) => c.ok);
  assert.match(dom.root.textContent, /נכון! זיהיתם/);
  assert.equal(JSON.parse(localStorage.getItem(E.EDGE_KEY)).items['ec-m-05'].last, true);
  await run('ec-m-05', (c) => c.v[0] === 3 || c.ok);
  assert.match(dom.root.textContent, /לא מדויק/);
  assert.match(dom.root.textContent, /פתרון זר/);
  assert.equal(JSON.parse(localStorage.getItem(E.EDGE_KEY)).items['ec-m-05'].last, false);
  await run('ec-p-04', () => false); // no solution: ticking nothing is right
  assert.match(dom.root.textContent, /אין פתרון/);
  assert.match(dom.root.textContent, /נכון!/);
  await E.viewEdgeRoute(ctx, 'summary');
  assert.match(dom.root.textContent, /סיכום תוצאות/);
  assert.deepEqual(E.sanitizeEdge({ items: { a: { tries: -3, right: 9, last: 'x' }, b: 5 } }), { v: 1, items: { a: { tries: 1, right: 1, last: false, ts: 0 } } });
});

test('reverse problems: key in backup allowlist, verifier catches errors, UI checks and records', async () => {
  const { readFileSync } = await import('node:fs');
  const { validateReverse } = await import('../tools/verify-reverse.mjs');
  const R = await import('../js/reverse-ui.js');
  assert.equal(R.REVERSE_KEY, 'omri-study-reverse-v1');
  assert.ok(R.REVERSE_KEY in B.KNOWN_KEYS);
  const v = JSON.stringify({ v: 1, items: { 'rv-m-01': { done: true, tries: 1, hints: 0, solution: false, ts: 1 } } });
  assert.equal(JSON.parse(B.buildBackup(fake({ [R.REVERSE_KEY]: v }), 1)).data[R.REVERSE_KEY], v);

  const load = () => JSON.parse(readFileSync(new URL('../data/reverse.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateReverse(load()), []);
  const bad = (mut) => { const d = load(); mut(d); return validateReverse(d).join('\n'); };
  assert.match(bad((d) => { d.items[0].answers[0].value = 3; }), /rv-m-01: answer k = 3/);
  assert.match(bad((d) => { d.items[0].equations[1] = 'k·x − y + 2z = 12'; }), /answer/);
  assert.match(bad((d) => { d.items[12].answers[0].value = 16; }), /rv-p-01: answer v0 = 16/);
  assert.match(bad((d) => { d.items[0].hints.pop(); }), /2 Hebrew hints/);
  assert.match(bad((d) => { d.items[2].answers[0].value = 0.123; }), /decimals/);
  assert.match(bad((d) => { d.items = d.items.slice(0, 20); }), /at least 12/);

  const items = load().items;
  const ctx = { show: dom.show, reverse: items };
  dom.root.replaceChildren();
  await R.viewReverseRoute(ctx);
  assert.match(dom.root.textContent, /0 מתוך 24 הושלמו/);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && /^#\/reverse\/rv-/.test(n.getAttribute('href') || '')).length, 24);

  globalThis.localStorage.removeItem(R.REVERSE_KEY);
  await R.viewReverseRoute(ctx, 'rv-m-01');
  const inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, 2);
  inputs[0].value = '2'; inputs[1].value = '5';
  dom.root.byText('button', 'בדיקה').click();
  assert.match(dom.root.textContent, /לא מדויק: 1 מתוך 2/);
  assert.equal(JSON.parse(localStorage.getItem(R.REVERSE_KEY)).items['rv-m-01'].done, false);
  inputs[1].value = '−6';
  dom.root.byText('button', 'בדיקה').click();
  assert.match(dom.root.textContent, /נכון! פתרתם לבד/);
  assert.equal(JSON.parse(localStorage.getItem(R.REVERSE_KEY)).items['rv-m-01'].done, true);
  dom.root.byText('button', 'רמז').click();
  assert.match(dom.root.textContent, /רמז 1/);
  dom.root.byText('button', 'הצגת פתרון').click();
  assert.match(dom.root.textContent, /פתרון מלא/);
  assert.equal(JSON.parse(localStorage.getItem(R.REVERSE_KEY)).items['rv-m-01'].solution, true);

  await R.viewReverseRoute(ctx, 'rv-p-02'); // decimals / manual mark
  dom.root.byText('button', 'סמנו כהושלם').click();
  assert.equal(JSON.parse(localStorage.getItem(R.REVERSE_KEY)).items['rv-p-02'].done, true);
  assert.deepEqual(R.sanitizeReverse({ items: { a: { tries: -3, hints: 9, done: 'x' }, b: 5 } }), { v: 1, items: { a: { done: false, tries: 0, hints: 2, solution: false, ts: 0 } } });
});

/* ---------- corrupt-backup fuzz: the merge functions on their own ---------- */
{
  const { HOSTILE, MERGES, assertSane } = await import('./fixtures/hostile.mjs');
  for (const m of MERGES) {
    test(`fuzz ${m.name}: valid local survives 12 hostile backups, a valid backup survives 12 hostile local values, nothing throws`, () => {
      assert.match(m.fn(m.local, m.local), m.sentinel, 'sample is valid');
      for (const [label, bad] of HOSTILE) {
        const keep = m.fn(m.local, bad);
        assertSane(assert, keep, `${m.name} backup=${label}`);
        assert.match(keep, m.sentinel, `${m.name}: local lost when backup is "${label}"`);
        const take = m.fn(bad, m.local);
        assertSane(assert, take, `${m.name} local=${label}`);
        assert.match(take, m.sentinel, `${m.name}: backup lost when local is "${label}"`);
        assertSane(assert, m.fn(bad, bad), `${m.name} both=${label}`);
      }
    });
  }
  test('fuzz buildBackup/parseBackup: hostile stored values never throw', () => {
    const mem = (init) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
    for (const [label, bad] of HOSTILE) {
      const init = Object.fromEntries(MERGES.map((m) => [m.key, bad]));
      let code;
      assert.doesNotThrow(() => { code = B.buildBackup(mem(init), 1000); }, label);
      assert.doesNotThrow(() => B.parseBackup(code), label);
      assert.doesNotThrow(() => B.parseBackup(bad), label);
    }
  });
}
