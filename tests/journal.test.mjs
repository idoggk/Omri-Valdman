import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const J = await import('../js/journal.js');
const JUI = await import('../js/journal-ui.js');
const B = await import('../js/backup.js');
const P = await import('../js/plan.js');
const PUI = await import('../js/plan-ui.js');

const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);
const pred = (o = {}) => ({ score: 80, topic: 'q:bk-m2', topicLabel: 'שאלה 2: מעגל', minutes: 80, ...o });
const act = (o = {}) => ({ score: 65, topic: 'q:bk-m2', topicLabel: 'שאלה 2: מעגל', minutes: 95, ...o });
const mk = (id, ts, p = {}, a = {}) => ({ id, kind: 'booklet', key: id, ts, pred: J.cleanPred({ ...pred(p), ts }), act: a.score === undefined && !Object.keys(a).length ? act() : { ...act(), ...a } });

test('prediction -> result -> comparison: the three gaps', () => {
  const st = J.emptyState();
  assert.ok(J.setPending(st, 'booklet', 'bk-math-4-7', pred(), NOW));
  const e = J.finishEntry(st, 'booklet', 'bk-math-4-7', 'bk-math-4-7', act(), NOW + 1000);
  assert.deepEqual(st.pending, {}); // consumed
  const c = J.compare(e);
  assert.deepEqual(c.score, { pred: 80, act: 65, gap: -15 });
  assert.deepEqual(c.time, { pred: 80, act: 95, gap: 15 });
  assert.equal(c.topic.hit, true);
  const t = J.gapTexts(c);
  assert.match(t.score, /חזיתם 80, קיבלתם 65: פחות מהצפוי ב־15 נקודות/);
  assert.match(t.time, /איטי מהצפוי ב־15 דקות/);
  assert.match(t.topic, /פגעתם/);
});

test('topic miss, missing time, nothing hard', () => {
  const st = J.emptyState();
  J.setPending(st, 'transfer', J.TRANSFER_KEY, pred({ topic: 'c:trig', topicLabel: 'טריגונומטריה', minutes: null }), NOW);
  const e = J.finishEntry(st, 'transfer', J.TRANSFER_KEY, 'transfer-1', act({ topic: 'c:param', topicLabel: 'משוואה עם פרמטר', minutes: 30 }), NOW);
  const c = J.compare(e);
  assert.equal(c.time, null);
  assert.equal(c.topic.hit, false);
  assert.match(J.gapTexts(c).topic, /טריגונומטריה.*משוואה עם פרמטר/);
  const allRight = J.compare(mk('z', 5, {}, { topic: null, topicLabel: '', score: 100, minutes: null }));
  assert.equal(allRight.topic.hit, null);
  assert.match(J.gapTexts(allRight).topic, /אין נושא שהוחמץ/);
});

test('no prediction means no entry; a re-entered booklet keeps its old prediction and one line', () => {
  const st = J.emptyState();
  assert.equal(J.finishEntry(st, 'booklet', 'k', 'k', act(), NOW), null);
  J.setPending(st, 'booklet', 'k', pred(), NOW);
  J.finishEntry(st, 'booklet', 'k', 'k', act(), NOW + 1);
  const again = J.finishEntry(st, 'booklet', 'k', 'k', act({ score: 70 }), NOW + 2);
  assert.equal(st.entries.length, 1);
  assert.equal(again.pred.score, 80);
  assert.equal(again.act.score, 70);
});

test('history: last 10, newest first, averages of the gap', () => {
  const st = J.emptyState();
  for (let i = 0; i < 12; i++) st.entries.push(mk(`m${i}`, 1000 + i, { score: 80 }, { score: 70 + i, minutes: 80 + 10 })); // gaps -10..+1
  const s = J.summary(st);
  assert.equal(s.n, 10);
  assert.equal(s.rows[0].entry.id, 'm11'); // newest first
  assert.equal(s.rows[9].entry.id, 'm2');
  // gaps of m2..m11 are -8..+1: mean = -3.5
  assert.equal(s.avgScoreGap, -3.5);
  assert.equal(s.avgTimeGap, 10);
  assert.equal(s.topicHits, 10);
  const empty = J.summary(J.emptyState());
  assert.equal(empty.n, 0);
  assert.equal(empty.avgScoreGap, null);
});

test('hardest question of a paper and of a transfer session', () => {
  const paper = { questions: [
    { id: 'bk-m1', n: 1, title: 'פרמטר', total: 25, parts: [{ id: 'a' }, { id: 'b' }] },
    { id: 'bk-m2', n: 2, title: 'מעגל', total: 25, parts: [{ id: 'a' }, { id: 'b' }] },
  ] };
  const h1 = J.hardestInPaper(paper, { 'bk-m1.a': 10, 'bk-m1.b': 15, 'bk-m2.a': 5, 'bk-m2.b': 5 });
  assert.equal(h1.topic, 'q:bk-m2');
  assert.match(h1.topicLabel, /שאלה 2: מעגל/);
  assert.equal(J.hardestInPaper(paper, { 'bk-m1.a': 25, 'bk-m2.a': 25 }), null);
  const items = [
    { id: 'tr-m-1', covers: ['math-hard-param'], budget: 300 }, { id: 'tr-p-1', covers: ['multipart', 'phys-vertical'], budget: 600 },
  ];
  const session = { ids: ['tr-m-1', 'tr-p-1'], results: { 'tr-m-1': { score: 1, total: 1, seconds: 100 }, 'tr-p-1': { score: 2, total: 6, seconds: 900 } } };
  assert.equal(J.hardestInTransfer(items, session).topic, 'c:vertical');
  session.results['tr-p-1'] = { score: 6, total: 6, seconds: 100 };
  session.results['tr-m-1'] = { score: 1, total: 1, seconds: 100 };
  assert.equal(J.hardestInTransfer(items, session), null);
});

test('sanitize drops garbage; merge unions by entry id (later wins) and pending by key', () => {
  assert.deepEqual(J.sanitize('nonsense'), J.emptyState());
  const bad = J.sanitize({ entries: [{ id: 'x', kind: 'nope' }, null], pending: { k: { score: 500, kind: 'booklet' } } });
  assert.equal(bad.entries.length, 0);
  assert.deepEqual(bad.pending, {});
  const local = J.emptyState();
  local.entries = [mk('a', 100), mk('b', 300)];
  local.pending.p1 = { ...J.cleanPred({ ...pred(), ts: 500 }), kind: 'booklet' };
  const backup = J.emptyState();
  backup.entries = [mk('a', 200, { score: 50 }), mk('c', 150)];
  backup.pending.p1 = { ...J.cleanPred({ ...pred({ score: 90 }), ts: 600 }), kind: 'booklet' };
  backup.pending.p2 = { ...J.cleanPred({ ...pred(), ts: 100 }), kind: 'transfer' };
  const m = J.sanitize(JSON.parse(J.mergeJournal(JSON.stringify(local), JSON.stringify(backup))));
  assert.deepEqual(m.entries.map((e) => e.id), ['c', 'a', 'b']);
  assert.equal(m.entries.find((e) => e.id === 'a').pred.score, 50); // ts 200 beats ts 100
  assert.equal(m.pending.p1.score, 90);
  assert.ok(m.pending.p2);
  assert.deepEqual(J.sanitize(JSON.parse(J.mergeJournal('garbage', JSON.stringify(backup)))).entries.length, 2);
});

test('backup restore merges the journal, exam-day record and counterexample progress', () => {
  const s = new Map();
  const storage = { getItem: (k) => (s.has(k) ? s.get(k) : null), setItem: (k, v) => s.set(k, String(v)), removeItem: (k) => s.delete(k) };
  const local = J.emptyState(); local.entries = [mk('a', 100)];
  const back = J.emptyState(); back.entries = [mk('b', 200)];
  storage.setItem(J.KEY, JSON.stringify(local));
  storage.setItem('omri-study-examday-v1', JSON.stringify({ v: 1, count: 1, last: 5 }));
  storage.setItem('omri-study-counter-v1', JSON.stringify({ v: 1, tasks: { 'ce-01': { done: false, tries: 1, ts: 1 } } }));
  const parsed = B.parseBackup(JSON.stringify({ app: 'brain-gains', v: 2, ts: 1, data: {
    [J.KEY]: JSON.stringify(back), 'omri-study-examday-v1': JSON.stringify({ v: 1, count: 3, last: 9 }),
    'omri-study-counter-v1': JSON.stringify({ v: 1, tasks: { 'ce-01': { done: true, tries: 2, ts: 2 }, 'ce-02': { done: true, tries: 1, ts: 3 } } }),
  } }));
  const r = B.restoreBackup(storage, parsed, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(J.sanitize(JSON.parse(storage.getItem(J.KEY))).entries.map((e) => e.id), ['a', 'b']);
  assert.equal(JSON.parse(storage.getItem('omri-study-examday-v1')).count, 3);
  const c = JSON.parse(storage.getItem('omri-study-counter-v1'));
  assert.equal(c.tasks['ce-01'].done, true);
  assert.ok(c.tasks['ce-02']);
});

test('prediction form validates, saves the pending prediction, and the comparison card shows the three gaps', () => {
  dom.store.clear();
  const node = JUI.predictionForm({ kind: 'booklet', key: 'bk-x', topics: [{ id: 'q:1', label: 'שאלה 1: א' }, { id: 'q:2', label: 'שאלה 2: ב' }], now: () => NOW });
  const [score, minutes] = node.all((n) => n.tagName === 'INPUT');
  const select = node.querySelector('select');
  const save = node.byText('button', 'שמירת התחזית');
  save.click();
  assert.match(node.textContent, /בין 0 ל־100/);
  score.value = '85'; minutes.value = '70'; select.value = 'q:2';
  save.click();
  const stored = J.load();
  assert.equal(stored.pending['bk-x'].score, 85);
  assert.equal(stored.pending['bk-x'].topic, 'q:2');
  assert.equal(stored.pending['bk-x'].minutes, 70);
  assert.match(node.textContent, /נשמרה תחזית: 85/);
  const e = J.finishEntry(stored, 'booklet', 'bk-x', 'bk-x', act({ topic: 'q:1', topicLabel: 'שאלה 1: א' }), NOW);
  const card = JUI.comparisonCard(e, J.compare(e)).textContent;
  assert.match(card, /חזיתם 85, קיבלתם 65/);
  assert.match(card, /ב״\s*והקשה בפועל|שאלה 1/);
  assert.match(card, /חזיתם 70 דקות, לקח 95/);
  const hist = JUI.historyBlock(stored).textContent;
  assert.match(hist, /פער ממוצע בציון: -20/);
});

test('plan screen: journal lines in the progress panel; exam-day card only in the last two weeks', () => {
  const day = (n) => { const d = new Date(NOW); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const st = J.emptyState(); st.entries = [mk('a', 100), mk('b', 200, {}, { score: 90 })];
  const lines = JUI.planLines(st);
  assert.match(lines.text, /2 מבחנים אחרונים/);
  assert.equal(JUI.planLines(J.emptyState()), null);
  const show = (n, examday) => {
    const plan = P.buildPlan({ settings: { ...P.emptySettings(), examDate: n === null ? null : day(n) }, log: [], now: NOW, exercises: [], journal: lines, examday });
    return PUI.renderPlan(plan).map((e) => e.textContent).join(' ').replace(/[⁦⁩]/g, '');
  };
  assert.match(show(10, { count: 2, last: NOW }), /שגרת יום המבחן/);
  assert.match(show(10, { count: 2, last: NOW }), /עשיתם 2 פעמים/);
  assert.match(show(14, null), /שגרת יום המבחן/);
  assert.doesNotMatch(show(15, null), /שגרת יום המבחן/);
  assert.doesNotMatch(show(-1, null), /שגרת יום המבחן/);
  assert.doesNotMatch(show(null, null), /שגרת יום המבחן/);
  assert.match(show(30, null), /תחזית מול מציאות/);
  assert.match(show(30, null), /פער ממוצע בין התחזית לציון/);
});
