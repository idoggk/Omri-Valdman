import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const X = await import('../js/exam.js');
const store = await import('../js/store.js');
const { viewExam } = await import('../js/exam-ui.js');
const S = await import('../js/summary.js');

const TOPICS = [
  { id: 'math-3', title: 'מתמטיקה 3' }, { id: 'math-4', title: 'מתמטיקה 4' },
  { id: 'phys-vertical', title: 'אנכית' }, { id: 'phys-horizontal', title: 'אופקית' },
];
const EXS = [];
for (const t of TOPICS) for (let i = 0; i < 8; i++) {
  EXS.push({ id: `${t.id}-${i}`, topic: t.id, level: [1, 2, 3, 3, 3, 3, 3, 3][i], title: `${t.id} ${i}`, statement: 's', inputs: [{ label: 'x', answer: 1 }] });
}
const ctx = {
  topics: TOPICS, exercises: EXS, byId: (id) => EXS.find((e) => e.id === id), show: dom.show,
};
const NOW = 5_000_000_000;
const pick = (o) => X.buildSmartExamSet({ exercises: EXS, topics: TOPICS.map((t) => t.id), count: 8, now: NOW, seed: 7, ...o });

test('smart picker: deterministic, distinct, works with no history', () => {
  const a = pick({});
  assert.equal(a.length, 8);
  assert.equal(new Set(a).size, 8);
  assert.deepEqual(pick({}), a);
  assert.deepEqual(pick({ attempts: 'garbage' }), a);
  assert.notDeepEqual(pick({ seed: 8 }), a);
});

test('smart picker: mostly level 3, some level 2', () => {
  const lv = pick({ count: 10 }).map((id) => EXS.find((e) => e.id === id).level);
  assert.equal(lv.filter((l) => l === 3).length, 7);
  assert.equal(lv.filter((l) => l === 2).length, 3);
});

test('smart picker: weak topic and failed items are favoured', () => {
  const attempts = [];
  for (let i = 0; i < 6; i++) attempts.push({ exerciseId: `math-3-${i}`, ts: NOW - 1000 * (i + 1), outcome: 'wrong' });
  for (let i = 0; i < 6; i++) attempts.push({ exerciseId: `phys-vertical-${i}`, ts: NOW - 1000 * (i + 1), outcome: 'alone' });
  let weak = 0, strong = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const id of pick({ attempts, seed, count: 6 })) { if (id.startsWith('math-3')) weak++; if (id.startsWith('phys-vertical')) strong++; }
  }
  assert.ok(weak > strong, `${weak} vs ${strong}`);
});

test('pack: 6 math + 6 physics', () => {
  const ids = pick({ count: 12, quotas: { math: 6, phys: 6 } });
  assert.equal(ids.length, 12);
  assert.equal(ids.filter((i) => i.startsWith('math')).length, 6);
  assert.equal(ids.filter((i) => i.startsWith('phys')).length, 6);
});

test('exam times per question are banked and reported against the target', () => {
  const e = X.createExam({ ids: ['a', 'b'], seed: 1, limitMs: 450000, now: 1000, paceMs: 225000 });
  X.goTo(e, 1, 61000);
  X.finish(e, 91000);
  assert.deepEqual(e.times, { a: 60000, b: 30000 });
  assert.equal(X.targetMs(e), 225000);
  assert.equal(X.targetMs({ ids: ['a', 'b'], limitMs: 600000 }), 300000);
  const rep = { items: [{ id: 'a', topic: 't', status: 'wrong', ms: 300000 }, { id: 'b', topic: 't', status: 'right', ms: 30000 }], perTopic: { t: { right: 1, total: 2 } } };
  const ins = X.examInsights(rep, e, [{ exerciseId: 'b', ts: 1, outcome: 'hinted', hintsUsed: 1 }, { exerciseId: 'a', ts: 2, outcome: 'wrong', errorReason: 'sign' }]);
  assert.equal(ins.overCount, 1);
  assert.equal(ins.rightAssisted, 1);
  assert.deepEqual(ins.review.map((r) => r.ids), [['a']]);
  assert.equal(ins.reasons[0].reason, 'sign');
  assert.doesNotThrow(() => X.examInsights(rep, e, null));
});

test('setup view: smart on with history, pack button starts a 45 minute exam', () => {
  dom.store.clear(); store.resetCache();
  location.hash = '#/exam/new';
  viewExam(ctx, 'new');
  assert.ok(dom.root.byText('button', 'חבילת 45 דקות'));
  assert.equal(dom.root.all((n) => n.attrs && n.attrs.id === 'exam-smart')[0].checked, false);
  store.recordAttempt({ exerciseId: 'math-3-0', outcome: 'wrong' });
  viewExam(ctx, 'new');
  assert.equal(dom.root.all((n) => n.attrs && n.attrs.id === 'exam-smart')[0].checked, true);
  dom.root.byText('button', 'חבילת 45 דקות').click();
  const e = store.loadExam();
  assert.equal(e.ids.length, 12);
  assert.equal(e.limitMs, 45 * 60000);
  assert.equal(e.paceMs, 225000);
  assert.equal(location.hash, '#/exam/run');
  viewExam(ctx, 'run');
  assert.ok(dom.root.byText('p', 'קצב מומלץ'));
});

test('report view shows time, help, review links and reasons', () => {
  dom.store.clear(); store.resetCache();
  dom.clock.now = 1_000_000;
  store.recordAttempt({ exerciseId: 'math-3-0', outcome: 'wrong', errorReason: 'sign' });
  const e = X.createExam({ ids: ['math-3-0', 'math-3-1'], seed: 1, limitMs: 600000, now: dom.clock.now });
  X.setAnswer(e, 'math-3-1', ['1']);
  X.goTo(e, 1, dom.clock.now + 400000);
  X.finish(e, dom.clock.now + 450000);
  e.recorded = true;
  store.saveExam(e);
  viewExam(ctx, 'report');
  for (const t of ['זמן לכל שאלה', 'נושאים לחזרה', 'סיבות הטעויות']) assert.ok(dom.root.byText('h2', t), t);
  assert.ok(dom.root.byText('li', 'חריגה'));
  assert.ok(dom.root.all((n) => n.tagName === 'A' && n.attrs.href === '#/ex/math-3-0').length >= 1);
  assert.ok(dom.root.byText('li', 'טעות בסימן: 1'));
  assert.ok(dom.root.byText('a', 'סיכום להדפסה'));
});

test('summary: built from own data, with print button and checklist', async () => {
  dom.store.clear(); store.resetCache();
  store.recordAttempt({ exerciseId: 'math-3-0', outcome: 'wrong', errorReason: 'sign' });
  store.recordAttempt({ exerciseId: 'math-3-1', outcome: 'wrong', errorReason: 'sign' });
  store.recordDrill('trap-1', 'divide-by-zero', false);
  let printed = 0;
  globalThis.print = () => { printed++; };
  const formulas = { topics: { 'math-3': { title: 'מערכות', sections: [{ items: [{ label: 'חיסול', formula: '<b>ax+by=c</b><script>x</script>' }] }], mistakes: [] } } };
  await S.viewSummary(ctx, { loadFormulas: async () => formulas });
  assert.ok(dom.root.byText('h1', 'סיכום לפני המבחן'));
  assert.ok(dom.root.byText('a', 'מתמטיקה 3'));
  assert.ok(dom.root.byText('li', 'טעות בסימן: 2'));
  assert.ok(dom.root.byText('li', 'divide-by-zero'));
  assert.ok(dom.root.byText('h3', 'מערכות'));
  const html = dom.root.all((n) => n.className === 'sheet-formula').map((n) => n.innerHTML).join('');
  assert.ok(html.includes('ax+by=c'));
  assert.ok(!html.includes('<script'));
  assert.equal(dom.root.all((n) => n.tagName === 'LI' && n.textContent.startsWith('☐')).length, S.CHECKLIST.length);
  dom.root.byText('button', 'הדפסה').click();
  assert.equal(printed, 1);
});

test('summary: empty and corrupted storage still render', async () => {
  dom.store.clear(); store.resetCache();
  await S.viewSummary(ctx, { loadFormulas: async () => null });
  assert.ok(dom.root.byText('p', 'עדיין אין היסטוריית תרגול'));
  dom.store.set('omri-study-attempts-v1', '{not json');
  dom.store.set('omri-study-drills-v1', '[1,2');
  dom.store.set('omri-study-progress-v2', 'null');
  store.resetCache();
  await S.viewSummary(ctx, { loadFormulas: async () => { throw new Error('x'); } });
  assert.ok(dom.root.byText('h2', 'רשימת בדיקה'));
  const d = S.buildSummary({ attempts: 5, exercises: null, topics: null, traps: 'x', formulas: 7 });
  assert.deepEqual([d.weak, d.reasons, d.missedTraps, d.formulaTopics], [[], [], [], []]);
});

test('cleanup', () => dom.restore());
