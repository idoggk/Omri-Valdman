import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const NB = await import('../js/notebook.js');
const B = await import('../js/backup.js');
const S = await import('../js/srs.js');
const N = await import('../js/nav.js');
const store = await import('../js/store.js');
const UI = await import('../js/notebook-ui.js');

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const att = (exerciseId, ts, outcome, extra = {}) => ({ exerciseId, ts, outcome, hintsUsed: 0, seconds: 90, topic: 'math-3', ...extra });
const fresh = () => ({ v: 1, entries: {} });
const describe = (id) => ({ title: `כותרת ${id}`, key: `צעד ראשון של ${id}`, href: `#/ex/${id}` });
const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};

test('collects wrong, solution-shown and hint-heavy attempts; ignores clean and lightly hinted ones', () => {
  const st = fresh();
  const log = [
    att('a', T0, 'wrong'), att('b', T0, 'solution'), att('c', T0, 'hinted', { hintsUsed: 2 }),
    att('d', T0, 'hinted', { hintsUsed: 1 }), att('e', T0, 'alone'),
  ];
  NB.syncNotebook(st, log, [], describe, T0);
  assert.deepEqual(Object.keys(st.entries).sort(), ['a', 'b', 'c']);
  assert.equal(st.entries.a.title, 'כותרת a');
  assert.equal(st.entries.a.key, 'צעד ראשון של a');
  assert.equal(st.entries.a.status, 'open');
  assert.equal(st.entries.a.due, T0 + DAY);
});

test('keeps the reason, hard tags, hints and seconds of the latest miss', () => {
  const st = fresh();
  const fb = [{ exerciseId: 'a', ts: T0 + 1000, hardTags: ['algebra', 'signs'], rating: 4 }];
  NB.syncNotebook(st, [att('a', T0, 'wrong', { errorReason: 'sign', hintsUsed: 1, seconds: 200 })], fb, describe, T0);
  const e = st.entries.a;
  assert.equal(e.reason, 'sign');
  assert.deepEqual(e.tags, ['algebra', 'signs']);
  assert.equal(e.hints, 1);
  assert.equal(e.seconds, 200);
});

test('dedupes by exerciseId: the count goes up and the latest attempt wins', () => {
  const st = fresh();
  NB.syncNotebook(st, [att('a', T0, 'wrong', { errorReason: 'sign', seconds: 50 }), att('a', T0 + 5 * DAY, 'solution', { seconds: 70 })], [], describe, T0 + 5 * DAY);
  assert.equal(Object.keys(st.entries).length, 1);
  assert.equal(st.entries.a.count, 2);
  assert.equal(st.entries.a.lastTs, T0 + 5 * DAY);
  assert.equal(st.entries.a.firstTs, T0);
  assert.equal(st.entries.a.seconds, 70);
  assert.equal(st.entries.a.reason, 'sign', 'the older reason stays when the new miss has none');
});

test('sync is idempotent: replaying the same log changes nothing', () => {
  const st = fresh();
  const log = [att('a', T0, 'wrong'), att('b', T0 + 1, 'wrong')];
  assert.equal(NB.syncNotebook(st, log, [], describe, T0), 2);
  const snap = JSON.stringify(st);
  assert.equal(NB.syncNotebook(st, log, [], describe, T0 + 10), 0);
  assert.equal(JSON.stringify(st), snap);
});

test('reserved topics (transfer, writing) and migrated rows never enter the notebook', () => {
  const st = fresh();
  NB.syncNotebook(st, [
    att('t1', T0, 'wrong', { topic: 'transfer-math' }), att('w1', T0, 'wrong', { topic: 'writing' }), att('m1', T0, 'wrong', { migrated: true }),
  ], [], describe, T0);
  assert.deepEqual(Object.keys(st.entries), []);
});

test('interval ladder 1 / 3 / 7 / 14: each clean re-solve at the due time moves one step, the last one masters', () => {
  const st = fresh();
  let t = T0;
  const log = [att('a', t, 'wrong')];
  NB.syncNotebook(st, log, [], describe, t);
  const expectDays = [1, 3, 7, 14];
  const dueDays = [];
  for (let i = 0; i < 4; i++) {
    t = st.entries.a.due;
    dueDays.push(i === 0 ? 1 : null);
    log.push(att('a', t, 'alone'));
    NB.syncNotebook(st, log, [], describe, t);
    if (i < 3) assert.equal(st.entries.a.due, t + expectDays[i + 1] * DAY, `step ${i + 1}`);
  }
  assert.equal(st.entries.a.status, 'mastered');
  assert.equal(st.entries.a.due, null);
  assert.equal(st.entries.a.step, 4);
  assert.equal(NB.dueEntries(st, t + 100 * DAY).length, 0, 'mastered entries are never due');
});

test('a clean solve before the due date does not advance the ladder (cramming)', () => {
  const st = fresh();
  const log = [att('a', T0, 'wrong'), att('a', T0 + 1000, 'alone')];
  NB.syncNotebook(st, log, [], describe, T0 + 1000);
  assert.equal(st.entries.a.step, 0);
  assert.equal(st.entries.a.status, 'open');
  assert.equal(st.entries.a.due, T0 + DAY);
});

test('a wrong re-solve resets the ladder to day 1 and reopens the entry', () => {
  const st = fresh();
  const log = [att('a', T0, 'wrong'), att('a', T0 + DAY, 'alone'), att('a', T0 + 4 * DAY, 'alone')];
  NB.syncNotebook(st, log, [], describe, T0 + 4 * DAY);
  assert.equal(st.entries.a.step, 2);
  assert.equal(st.entries.a.status, 'understood');
  log.push(att('a', T0 + 11 * DAY, 'wrong'));
  NB.syncNotebook(st, log, [], describe, T0 + 11 * DAY);
  assert.equal(st.entries.a.step, 0);
  assert.equal(st.entries.a.status, 'open');
  assert.equal(st.entries.a.count, 2);
  assert.equal(st.entries.a.due, T0 + 12 * DAY);
});

test('a lightly hinted re-solve is neutral', () => {
  const st = fresh();
  const log = [att('a', T0, 'wrong'), att('a', T0 + DAY, 'hinted', { hintsUsed: 1 })];
  NB.syncNotebook(st, log, [], describe, T0 + DAY);
  assert.equal(st.entries.a.step, 0);
  assert.equal(st.entries.a.due, T0 + DAY);
});

test('"understood" by hand marks the status but never moves the date', () => {
  const st = fresh();
  NB.syncNotebook(st, [att('a', T0, 'wrong')], [], describe, T0);
  assert.equal(NB.markUnderstood(st, 'a', T0 + 10), 'marked');
  assert.equal(st.entries.a.status, 'understood');
  assert.equal(st.entries.a.due, T0 + DAY);
  assert.equal(NB.markUnderstood(st, 'a'), 'already');
  assert.equal(NB.markUnderstood(st, 'zzz'), null);
});

test('notes are saved, trimmed to the limit and unknown ids are refused', () => {
  const st = fresh();
  NB.syncNotebook(st, [att('a', T0, 'wrong')], [], describe, T0);
  assert.equal(NB.setNote(st, 'a', 'x'.repeat(900)), true);
  assert.equal(st.entries.a.note.length, NB.NOTE_MAX);
  assert.equal(NB.setNote(st, 'nope', 'x'), false);
});

test('sorted by due: overdue first, then upcoming, mastered last; due count and topic list', () => {
  const st = fresh();
  const log = [att('late', T0, 'wrong'), att('soon', T0 + 2 * DAY, 'wrong', { topic: 'phys-vertical' }), att('done', T0, 'wrong')];
  NB.syncNotebook(st, log, [], describe, T0 + 2 * DAY);
  st.entries.done.step = 4; st.entries.done.status = 'mastered'; st.entries.done.due = null;
  const now = T0 + 2.5 * DAY;
  assert.deepEqual(NB.sortedEntries(st, now).map((e) => e.id), ['late', 'soon', 'done']);
  assert.deepEqual(NB.dueEntries(st, now).map((e) => e.id), ['late']);
  assert.deepEqual(NB.topicsOf(st), ['math-3', 'phys-vertical']);
});

test('load / save round trip uses the notebook key, junk reads as empty', () => {
  const s = fake();
  const st = fresh();
  NB.syncNotebook(st, [att('a', T0, 'wrong')], [], describe, T0);
  NB.save(st, s);
  assert.ok(s.m.has('omri-study-notebook-v1'));
  assert.equal(NB.load(s).entries.a.count, 1);
  s.m.set('omri-study-notebook-v1', '{"entries": 5}');
  assert.deepEqual(NB.load(s), fresh());
  s.m.set('omri-study-notebook-v1', 'not json');
  assert.deepEqual(NB.load(s), fresh());
});

test('the notebook is in the backup keys, and a restore merges by exerciseId', () => {
  assert.ok(Object.hasOwn(B.KNOWN_KEYS, NB.KEY));
  const local = fresh();
  NB.syncNotebook(local, [att('a', T0, 'wrong'), att('b', T0, 'wrong')], [], describe, T0);
  NB.setNote(local, 'a', 'הערה מקומית', T0 + 50);
  const other = fresh();
  NB.syncNotebook(other, [att('a', T0, 'wrong'), att('a', T0 + 2 * DAY, 'wrong'), att('c', T0, 'wrong')], [], describe, T0 + 2 * DAY);
  NB.setNote(other, 'a', 'הערה מהגיבוי', T0 + 99999);
  const dev = fake({ [NB.KEY]: JSON.stringify(local) });
  const parsed = B.parseBackup(JSON.stringify({ app: 'brain-gains', v: 2, ts: 1, data: { [NB.KEY]: JSON.stringify(other) } }));
  assert.equal(parsed.ok, true);
  assert.equal(B.restoreBackup(dev, parsed).ok, true);
  const merged = NB.load(dev);
  assert.deepEqual(Object.keys(merged.entries).sort(), ['a', 'b', 'c'], 'entries only on one side survive');
  assert.equal(merged.entries.a.count, 2, 'the higher count wins');
  assert.equal(merged.entries.a.note, 'הערה מהגיבוי', 'the entry edited last wins');
  assert.equal(merged.entries.a.lastTs, T0 + 2 * DAY);
});

test('merge keeps a note that only one copy has, and a tie keeps the local copy', () => {
  const a = fresh(); const b = fresh();
  NB.syncNotebook(a, [att('x', T0, 'wrong')], [], describe, T0);
  NB.syncNotebook(b, [att('x', T0, 'wrong')], [], describe, T0);
  b.entries.x.note = 'רק בגיבוי';
  const m = JSON.parse(NB.mergeNotebook(JSON.stringify(a), JSON.stringify(b)));
  assert.equal(m.entries.x.note, 'רק בגיבוי');
  a.entries.x.title = 'מקומי'; b.entries.x.title = 'מהגיבוי';
  assert.equal(JSON.parse(NB.mergeNotebook(JSON.stringify(a), JSON.stringify(b))).entries.x.title, 'מקומי');
  assert.equal(JSON.parse(NB.mergeNotebook('garbage', JSON.stringify(b))).entries.x.title, 'מהגיבוי');
});

test('the home daily path mentions due notebook entries only when there are some', () => {
  const none = N.dailyPath({ now: T0 });
  assert.equal(none.length, 3);
  const some = N.dailyPath({ now: T0, notebookDue: 2 });
  assert.equal(some.length, 4);
  assert.equal(some[3].href, '#/notebook');
  assert.match(some[3].label, /2 רשומות/);
  assert.match(N.dailyPath({ now: T0, notebookDue: 1 })[3].label, /רשומה אחת|1 רשומה/);
});

test('dueCount reads the stored notebook plus new misses from the log', () => {
  const s = fake();
  const st = fresh();
  NB.syncNotebook(st, [att('a', T0, 'wrong')], [], describe, T0);
  NB.save(st, s);
  const log = [att('a', T0, 'wrong'), att('b', T0 + DAY, 'wrong')];
  assert.equal(NB.dueCount(log, [], T0 + 3 * DAY, s), 2);
  assert.equal(NB.dueCount(log, [], T0 + 0.5 * DAY, s), 0);
});

test('route and reopen links', () => {
  assert.equal(N.resolveRoute('#/notebook').name, 'notebook');
  assert.equal(NB.reopenHref('math-3-001', 'math-3'), '#/ex/math-3-001');
  assert.equal(NB.reopenHref('mh-rad-1', 'math-hard-radical'), '#/mathhard/mh-rad-1');
  assert.equal(NB.reopenHref('mp-1', 'multipart'), '#/multipart/mp-1');
});

test('screen: lists entries, filters by topic, notes persist, "understood" marks the entry', () => {
  dom.store.clear();
  store.resetCache();
  dom.clock.now = T0 + 10 * DAY;
  const log = [att('math-3-001', Date.now() - 3 * DAY, 'wrong', { errorReason: 'sign' }), att('phys-vertical-001', Date.now() - 2 * DAY, 'solution', { topic: 'phys-vertical' })];
  dom.store.set('omri-study-attempts-v1', JSON.stringify(log));
  const ex = [{ id: 'math-3-001', topic: 'math-3', title: 'מערכת עם סוגריים', solution: ['<b>ראשית</b> פותחים סוגריים'] }, { id: 'phys-vertical-001', topic: 'phys-vertical', title: 'שני כדורים', inputs: [{ label: 't', answer: '4', unit: 'ש' }] }];
  const ctx = { topics: [{ id: 'math-3', title: 'מערכות' }, { id: 'phys-vertical', title: 'תנועה אנכית' }], exercises: ex, byId: (id) => ex.find((e) => e.id === id), show: dom.show, hard: null, hardTitle: (id) => id };
  UI.viewNotebook(ctx);
  const text = () => dom.root.textContent;
  assert.match(text(), /מערכת עם סוגריים/);
  assert.match(text(), /ראשית פותחים סוגריים/, 'tags are stripped from the stored key step');
  assert.match(text(), /t = 4\W* ש/,'an exercise without a worked solution shows its answers');
  assert.match(text(), /טעות בסימן/);
  assert.match(text(), /2 רשומות מחכות לחזרה/);
  const chip = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'תנועה אנכית')[0];
  chip.click();
  assert.doesNotMatch(text(), /מערכת עם סוגריים/);
  assert.match(text(), /שני כדורים/);
  const stored = JSON.parse(dom.store.get(NB.KEY));
  assert.deepEqual(Object.keys(stored.entries).sort(), ['math-3-001', 'phys-vertical-001']);
  const understood = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'הבנתי את הטעות')[0];
  understood.click();
  assert.equal(JSON.parse(dom.store.get(NB.KEY)).entries['phys-vertical-001'].status, 'understood');
});
