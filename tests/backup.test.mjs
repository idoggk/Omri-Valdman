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
  assert.equal(dst.m.size, 3);
});

test('code survives surrounding whitespace', () => {
  assert.equal(B.parseBackup('\n  ' + B.buildBackup(sample()) + '  \n').ok, true);
});

const wrap = (data, extra = {}) => JSON.stringify({ app: 'brain-gains', v: 1, ts: 1, data, ...extra });
for (const [label, input] of [
  ['empty', ''], ['not a string', null], ['truncated json', B.buildBackup(sample()).slice(0, 40)], ['garbage', 'hello'],
  ['array', '[]'], ['wrong app', JSON.stringify({ app: 'x', v: 1, data: {} })],
  ['wrong version', wrap({}, { v: 2 })], ['no data', JSON.stringify({ app: 'brain-gains', v: 1 })],
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
