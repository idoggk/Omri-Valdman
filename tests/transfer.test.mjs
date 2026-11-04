import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { loadTransfer, reservedLeaks, PHYS, MATH } from '../tools/verify-transfer.mjs';

const dom = installFakeDom();
const T = await import('../js/transfer.js');
const UI = await import('../js/transfer-ui.js');
const store = await import('../js/store.js');
const nav = { ...(await import('../js/nav.js')), ...(await import('../js/hub.js')) }; // hub.js is loaded lazily by the app
const backup = await import('../js/backup.js');
const { cleanLog, dueReviews, withVirtual } = await import('../js/srs.js');
const { pickWorkout } = await import('../js/workout.js');

const items = loadTransfer();
const byId = (id) => items.find((q) => q.id === id);
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8')) });
const ctx = { topics: [{ id: 'math-3', title: 'מערכת משוואות עם 3 נעלמים' }], exercises: [], byId: () => null, show: dom.show, fetchFn };
const freshStore = () => { dom.store.clear(); store.resetCache(); };

test('data: 12 math + 12 physics, unique tr- ids, valid shape, physics has 3-6 parts', () => {
  assert.equal(items.length, 24);
  assert.equal(new Set(items.map((q) => q.id)).size, 24);
  assert.ok(items.every(T.validItem));
  assert.equal(items.filter((q) => q.subject === 'math').length, 12);
  assert.equal(items.filter((q) => q.subject === 'physics').length, 12);
  for (const q of items.filter((x) => x.subject === 'physics')) assert.ok(q.parts.length >= 4 && q.parts.length <= 6, q.id);
  assert.equal(T.validItem({ ...items[0], id: 'mh-1' }), false);
  assert.equal(T.validItem({ ...items[0], answer: { kind: 'blob' } }), false);
});

test('reserved: no id or statement appears in any other data file or js module; no loader reads transfer.json except transfer.js', () => {
  assert.deepEqual(reservedLeaks(items), []);
  for (const f of readdirSync(new URL('../js/', import.meta.url))) {
    if (f === 'transfer.js' || f === 'transfer-ui.js') continue;
    const text = readFileSync(new URL('../js/' + f, import.meta.url), 'utf8');
    assert.equal(/data\/transfer/.test(text), false, f);
  }
  // the leak detector does fire when a statement is planted elsewhere
  const planted = items.map((q) => (q.id === 'tr-m-12' ? { ...q, eq: ['√(2x + 7) − √(x + 3) = 1'] } : q));
  assert.ok(reservedLeaks(planted).some((e) => /tr-m-12/.test(e)));
});

test('reserved: the workout, review schedule and virtual topics never see transfer attempts', () => {
  const log = cleanLog([
    { exerciseId: 'tr-m-01', topic: 'transfer-math', outcome: 'wrong', ts: 1, seconds: 100 },
    { exerciseId: 'tr-p-01', topic: 'transfer-physics', outcome: 'alone', ts: 2, seconds: 100 },
  ]);
  assert.deepEqual(dueReviews(log, 1e15), []);
  assert.deepEqual(withVirtual([], log), []);
  const exs = [{ id: 'e1', topic: 't', level: 1, title: 'x' }, { id: 'e2', topic: 't', level: 1, title: 'y' }];
  const ids = pickWorkout(log, exs, 1e12, 2);
  assert.ok(ids.every((id) => !id.startsWith('tr-')));
});

test('verifier catches a wrong stored answer (independent physics and math solvers)', () => {
  const p = byId('tr-p-04');
  const got = PHYS['tr-p-04']();
  assert.equal(got.length, p.parts.length);
  p.parts.forEach((part, i) => assert.ok(Math.abs(got[i] - part.answer) <= 0.005 + 1e-9, part.id));
  const wrong = { ...byId('tr-m-09'), answer: { kind: 'interval', text: '[1,3]' } }; // forgets that x = 2 is forbidden
  assert.ok(MATH['tr-m-09'](wrong).length > 0);
  assert.deepEqual(MATH['tr-m-09'](byId('tr-m-09')), []);
});

test('pickSession: deterministic, 3 math + 3 physics interleaved, skips seen, refills from the other subject', () => {
  const a = T.pickSession(items, {});
  assert.deepEqual(a, T.pickSession([...items].reverse().sort((x, y) => items.indexOf(x) - items.indexOf(y)), {}));
  assert.deepEqual(a, ['tr-m-01', 'tr-p-01', 'tr-m-02', 'tr-p-02', 'tr-m-03', 'tr-p-03']);
  const seen = Object.fromEntries(a.map((id) => [id, { correct: false }]));
  assert.deepEqual(T.pickSession(items, seen), ['tr-m-04', 'tr-p-04', 'tr-m-05', 'tr-p-05', 'tr-m-06', 'tr-p-06']);
  // only 1 physics question left: 5 math fill the rest
  const seenPhys = Object.fromEntries(items.filter((q) => q.subject === 'physics' && q.id !== 'tr-p-12').map((q) => [q.id, 1]));
  const rest = T.pickSession(items, seenPhys);
  assert.equal(rest.length, 6);
  assert.equal(rest.filter((id) => id.startsWith('tr-p-')).length, 1);
  // fewer than 6 unseen: take what remains; nothing unseen: empty
  const almost = Object.fromEntries(items.slice(0, 21).map((q) => [q.id, 1]));
  assert.equal(T.pickSession(items, almost).length, items.slice(21).length);
  assert.deepEqual(T.pickSession(items, Object.fromEntries(items.map((q) => [q.id, 1]))), []);
});

test('gradeItem: math accepts the stored answer, rejects others, unreadable input does not use the attempt', () => {
  const m = byId('tr-m-09');
  const right = { rows: [{ lc: true, lo: '1', hi: '2', hc: false }, { lc: false, lo: '2', hi: '3', hc: true }] };
  assert.equal(T.gradeItem(m, right).correct, true);
  assert.equal(T.gradeItem(m, { rows: [{ lc: true, lo: '1', hi: '3', hc: true }] }).correct, false);
  const bad = T.gradeItem(m, { rows: [{ lc: true, lo: 'abc', hi: '3', hc: true }] });
  assert.equal(bad.valid, false);
  assert.match(bad.error, /./);
  assert.equal(T.gradeItem(byId('tr-m-02'), { rows: ['8', '1/2'] }).correct, true);
  assert.equal(T.gradeItem(byId('tr-m-02'), { rows: ['8'] }).correct, false);
  assert.equal(T.gradeItem(byId('tr-m-06'), { rows: [['9/sqrt(5)', '1/sqrt(5)'], ['-9/sqrt(5)', '-1/sqrt(5)']] }).correct, true);
});

test('gradeItem: physics scores each part, blanks and junk are wrong, tolerance 0.01', () => {
  const q = byId('tr-p-04');
  const g = T.gradeItem(q, { a: '3', b: '48', c: '16', d: '34', e: '61.93' });
  assert.deepEqual([g.correct, g.score, g.total], [true, 5, 5]);
  const p = T.gradeItem(q, { a: '3', b: '47', c: '', d: 'x', e: '61,93' });
  assert.deepEqual([p.correct, p.score, p.total], [false, 2, 5]);
  assert.equal(T.gradeItem(q, { a: '3', b: '48', c: '16', d: '34', e: '61.94' }).parts.e, true);
  assert.equal(T.gradeItem(q, { a: '3', b: '48', c: '16', d: '34', e: '62' }).parts.e, false);
});

test('attempt log record: topic transfer-<subject>; clean first try = alone, miss = wrong, skip = solution (never mastery)', () => {
  const m = byId('tr-m-01'); const p = byId('tr-p-01');
  assert.deepEqual(T.attemptFor(m, { correct: true }, 61.4), { exerciseId: 'tr-m-01', topic: 'transfer-math', outcome: 'alone', hintsUsed: 0, seconds: 61 });
  assert.equal(T.attemptFor(p, { correct: false, score: 2, total: 5 }, 90).outcome, 'wrong');
  assert.equal(T.attemptFor(p, T.skipGrade(p), 5).outcome, 'solution');
  assert.equal(T.attemptFor(p, T.skipGrade(p), 5).topic, 'transfer-physics');
  assert.equal(T.skipGrade(p).total, p.parts.length);
});

test('saved state: sanitize junk; first attempt only; session finishes and keeps history; resume returns the same session', () => {
  freshStore();
  assert.deepEqual(T.sanitizeSaved('junk'), { v: 1, seen: {}, session: null, history: [] });
  assert.deepEqual(T.sanitizeSaved({ seen: { 'mh-1': { correct: true }, 'tr-m-01': { correct: true, score: 1, total: 1, seconds: 9 } }, session: { ids: ['x'] } }).session, null);
  const s = T.startSession(items, localStorage, 1000);
  assert.equal(s.ids.length, 6);
  assert.deepEqual(T.startSession(items, localStorage, 2000).ids, s.ids); // resume, not a new pick
  assert.equal(T.nextQuestionId(s), s.ids[0]);
  const ok = { correct: true, score: 1, total: 1 };
  assert.equal(T.submitResult(items, s.ids[0], ok, 50, localStorage, 1100), true);
  assert.equal(T.submitResult(items, s.ids[0], { correct: false, score: 0, total: 1 }, 60, localStorage, 1200), false); // no second try
  assert.equal(T.loadSaved().seen[s.ids[0]].correct, true);
  assert.equal(T.submitResult(items, 'tr-m-09', ok, 10, localStorage, 1300), false); // not part of the session
  for (const id of s.ids.slice(1)) T.submitResult(items, id, { correct: false, score: 0, total: byId(id).subject === 'math' ? 1 : byId(id).parts.length }, 30, localStorage, 1400);
  const d = T.loadSaved();
  assert.equal(d.session.finishedAt, 1400);
  assert.equal(d.history.length, 1);
  assert.equal(d.history[0].math, 1);
  const s2 = T.startSession(items, localStorage, 5000);
  assert.notDeepEqual(s2.ids, s.ids);
  assert.ok(s2.ids.every((id) => !s.ids.includes(id)));
});

test('resultData: score per subject, time, what was missed, next step from the most-missed topic', () => {
  const session = {
    ids: ['tr-m-01', 'tr-p-01', 'tr-m-02', 'tr-p-02', 'tr-m-03', 'tr-p-03'], startedAt: 1, finishedAt: 2,
    results: {
      'tr-m-01': { correct: true, score: 1, total: 1, seconds: 100 },
      'tr-p-01': { correct: false, score: 3, total: 5, seconds: 700 },
      'tr-m-02': { correct: false, score: 0, total: 1, seconds: 200 },
      'tr-p-02': { correct: true, score: 5, total: 5, seconds: 300 },
      'tr-m-03': { correct: true, score: 1, total: 1, seconds: 150 },
      'tr-p-03': { correct: true, score: 5, total: 5, seconds: 250 },
    },
  };
  const r = T.resultData(items, session, { titleOf: (t) => `T:${t}` });
  assert.deepEqual([r.perSubject.math.correct, r.perSubject.math.questions, r.perSubject.math.score, r.perSubject.math.total], [2, 3, 2, 3]);
  assert.deepEqual([r.perSubject.physics.correct, r.perSubject.physics.score, r.perSubject.physics.total], [2, 13, 15]);
  assert.equal(r.seconds, 1700);
  assert.deepEqual(r.missed.map((m) => m.id), ['tr-p-01', 'tr-m-02']);
  assert.equal(r.missed[0].overBudget, true); // 700 > 540
  assert.equal(r.missed[1].overBudget, false);
  assert.equal(r.next.topic, 'multipart'); // 2 missed parts there vs 1 for the exponent/log topic
  assert.match(r.next.text, /T:multipart/);
  assert.equal(r.next.href, '#/multipart');
  const clean = T.resultData(items, { ...session, results: Object.fromEntries(session.ids.map((id) => [id, { correct: true, score: 1, total: 1, seconds: 10 }])) });
  assert.equal(clean.missed.length, 0);
  assert.equal(clean.next.topic, null);
  // unanswered questions count as missed
  assert.equal(T.resultData(items, { ids: ['tr-m-01'], results: {} }).missed.length, 1);
  assert.equal(T.formatTime(125), '2:05');
});

test('wiring: route, hidden tab bar while running, hub tile, backup key', () => {
  assert.deepEqual(nav.resolveRoute('#/transfer/run'), { name: 'transfer', args: ['run'] });
  assert.equal(nav.tabsHidden('#/transfer/run'), true);
  assert.equal(nav.tabsHidden('#/transfer'), false);
  assert.equal(nav.activeTab('#/transfer'), 'practice');
  assert.ok(T.KEY in backup.KNOWN_KEYS);
  dom.show();
  nav.viewHub({ topics: [], exercises: [], show: dom.show });
  assert.ok(dom.root.all((n) => n.attrs && n.attrs.href === '#/transfer').length >= 1);
  const text = dom.root.textContent;
  for (const q of items) assert.equal(text.includes(q.id), false); // the hub shows no reserved question
});

const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent.includes(label))[0].dispatch('click');
const inputs = () => dom.root.all((n) => n.tagName === 'INPUT' && !n.disabled);
const settle = () => new Promise((r) => setTimeout(r, 5));

test('UI: full session - home, start, answer physics, skip math, result screen, attempt log, one try only', async () => {
  freshStore();
  await UI.viewTransfer(ctx);
  assert.match(dom.root.textContent, /ניסיון ראשון בלבד/);
  assert.match(dom.root.textContent, /נשארו 24 שאלות חדשות/);
  press('להתחיל מבחן חדש');
  await settle();
  assert.match(dom.root.textContent, /שאלה 1 מתוך 6 · מתמטיקה/);
  assert.match(dom.root.textContent, /זמן מומלץ: 8:00/);
  assert.equal(dom.root.all((n) => n.tagName === 'BUTTON' && /רמז|פתרון מלא/.test(n.textContent)).length, 0); // no hints, no solution button
  // unreadable math input keeps the question open
  inputs()[0].value = '(((';
  press('הגשה');
  await settle();
  assert.match(dom.root.textContent, /שאלה 1 מתוך 6/);
  assert.equal(store.getAttempts().length, 0);
  press('אין לי תשובה');
  await settle();
  assert.match(dom.root.textContent, /שאלה 2 מתוך 6 · פיזיקה/);
  const sess = T.loadSaved().session;
  const answers = { 'tr-p-01': [5, 100, 15, 30, 225], 'tr-p-02': [0.96, 36.87, 3, 4, 11.25], 'tr-p-03': [3, 2, 144, 3.5, 100] };
  for (let guard = 0; guard < 6 && !/תוצאות מבחן ההעברה/.test(dom.root.textContent); guard++) {
    const id = T.nextQuestionId(T.loadSaved().session);
    if (id && id.startsWith('tr-p-')) {
      inputs().forEach((el, i) => { el.value = String(answers[id][i]); });
      press('הגשה');
    } else press('אין לי תשובה');
    await settle();
  }
  assert.match(dom.root.textContent, /תוצאות מבחן ההעברה/);
  assert.match(dom.root.textContent, /מה הוחמץ/);
  assert.match(dom.root.textContent, /הצעד הבא/);
  
  const d = T.resultData(items, T.loadSaved().session);
  assert.equal(d.perSubject.physics.score, 5 + 5 + 4); // only part e of tr-p-03 is wrong
  assert.equal(d.perSubject.math.score, 0);
  // attempt log: topics transfer-<subject>, outcomes alone / wrong / solution, no hints
  const log = store.getAttempts();
  assert.equal(log.length, 6);
  assert.ok(log.every((a) => a.topic.startsWith('transfer-') && a.hintsUsed === 0));
  assert.deepEqual(log.filter((a) => a.outcome === 'solution').map((a) => a.exerciseId), ['tr-m-01', 'tr-m-02', 'tr-m-03']);
  assert.equal(log.find((a) => a.exerciseId === 'tr-p-02').outcome, 'alone');
  assert.equal(log.find((a) => a.exerciseId === 'tr-p-03').outcome, 'wrong');
  // the next test is a different set; the answered ones are never offered again
  await UI.viewTransfer(ctx);
  assert.match(dom.root.textContent, /נשארו 18 שאלות חדשות/);
  assert.match(dom.root.textContent, /התוצאות האחרונות/);
});
