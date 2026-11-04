import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const W = await import('../js/workout.js');
const nav = { ...(await import('../js/nav.js')), ...(await import('../js/hub.js')) }; // hub.js is loaded lazily by the app
const store = await import('../js/store.js');

const rd = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const HARD = {
  mathhard: ['radical', 'exponent', 'rational', 'param', 'circle'].flatMap((f) => rd(`mathhard-${f}`)),
  multipart: rd('multipart'),
  logs: ['1', '2', '3'].flatMap((n) => rd(`logs-ex-${n}`)),
};
const NOW = new Date(2026, 10, 3, 12).getTime();
const mk = (topic, level, n) => Array.from({ length: n }, (_, i) => ({ id: `${topic}-${level}-${i + 1}`, topic, level }));
const EXS = [...mk('math-3', 3, 8), ...mk('phys', 3, 8)];
const att = (exerciseId, outcome, ts, topic) => ({ exerciseId, ts, outcome, hintsUsed: 0, seconds: 30, topic });
const kindOf = (id) => (id.startsWith('mh-') ? 'mathhard' : id.startsWith('mp-') ? 'multipart' : id.startsWith('lg-') ? 'logs' : 'base');

test('workout has 2 hard-math, 1 multipart and 1 logs item among 10, no duplicates, deterministic', () => {
  const w = W.pickWorkout([], EXS, NOW, 10, { hard: HARD });
  assert.equal(w.length, 10);
  assert.equal(new Set(w).size, 10);
  const count = (k) => w.filter((id) => kindOf(id) === k).length;
  assert.ok(count('mathhard') >= 2 && count('multipart') >= 1 && count('logs') >= 1, w.join());
  assert.deepEqual(w, W.pickWorkout([], EXS, NOW, 10, { hard: HARD }));
  const fam = w.filter((id) => kindOf(id) === 'mathhard').map((id) => HARD.mathhard.find((e) => e.id === id).family);
  assert.equal(new Set(fam).size, 2);
  assert.ok(w.every((id) => kindOf(id) === 'base' || W.hardHref(id)));
});

test('no hard data: workout is unchanged', () => {
  assert.deepEqual(W.pickWorkout([], EXS, NOW, 10), W.pickWorkout([], EXS, NOW, 10, { hard: { mathhard: [], multipart: [], logs: [] } }));
});

test('logs item starts at the first tier, multipart at warm-up, hard math at tier 1', () => {
  const picks = W.pickHard([], HARD, NOW);
  const by = (k) => HARD[k].find((e) => e.id === picks.find((p) => p.kind === k).id);
  assert.equal(by('logs').tier, 1);
  assert.equal(by('multipart').tier, 'warmup');
  for (const p of picks.filter((x) => x.kind === 'mathhard')) assert.equal(HARD.mathhard.find((e) => e.id === p.id).tier, 1);
});

test('three clean alone-solves promote per topic: hard math tier 1 -> level 4 -> level 5, other families unaffected', () => {
  const pool = W.hardPool(HARD).mathhard;
  const rad = pool.filter((e) => e.topic === 'math-hard-radical');
  const lvl = (log) => W.topicLevels(log, pool, [], { useBase: false });
  const solve = (lv, from) => rad.filter((e) => e.level === lv).slice(0, 3).map((e, i) => att(e.id, 'alone', from + i, e.topic));
  const l1 = solve(3, 10);
  assert.equal(lvl(l1).get('math-hard-radical').level, 4);
  assert.equal(lvl(l1).get('math-hard-exponent').level, 3);
  const l2 = [...l1, ...solve(4, 20)];
  assert.equal(lvl(l2).get('math-hard-radical').level, 5);
  // the picker now serves a tier 3 radical item (nearest unsolved to level 5)
  const fb = [];
  const radPicks = W.pickHard(l2, HARD, NOW, fb).filter((p) => p.kind === 'mathhard').map((p) => HARD.mathhard.find((e) => e.id === p.id)).filter((e) => e.family === 'radical');
  for (const e of radPicks) assert.equal(e.tier, 3);
});

test('multipart promotes from warm-up (4) to exam (5); a rating of 6 does not block it', () => {
  const pool = W.hardPool(HARD).multipart;
  const warm = pool.filter((e) => e.level === 4).slice(0, 3);
  const log = warm.map((e, i) => att(e.id, 'alone', 10 + i, 'multipart'));
  const fbs = warm.map((e) => ({ id: e.id, ts: 5, exerciseId: e.id, rating: 6, hintsUsed: 0, solutionViewed: false, correct: true }));
  assert.equal(W.topicLevels(log, pool, fbs, { useBase: false }).get('multipart').level, 5);
  const q = W.pickHard(log, HARD, NOW, fbs).find((p) => p.kind === 'multipart');
  assert.equal(HARD.multipart.find((e) => e.id === q.id).tier, 'exam');
});

test('a wrong attempt keeps the level and the item stays unsolved', () => {
  const pool = W.hardPool(HARD).mathhard;
  const rad = pool.filter((e) => e.topic === 'math-hard-radical' && e.level === 3);
  const log = [att(rad[0].id, 'alone', 1, rad[0].topic), att(rad[1].id, 'alone', 2, rad[1].topic), att(rad[2].id, 'wrong', 3, rad[2].topic)];
  assert.equal(W.topicLevels(log, pool, [], { useBase: false }).get('math-hard-radical').level, 3);
});

test('logs: once attempts exist the item follows the logs promotion level', () => {
  const pool = W.hardPool(HARD).logs;
  const t1 = pool.filter((e) => e.level === 1).slice(0, 3);
  const log = t1.map((e, i) => att(e.id, 'alone', 1 + i, 'logs'));
  const p = W.pickHard(log, HARD, NOW).find((x) => x.kind === 'logs');
  assert.equal(HARD.logs.find((e) => e.id === p.id).tier, 2);
});

/* ---------- home: the daily path ---------- */
const ctx = {
  topics: [{ id: 'math-3', title: 'מתמטיקה' }, { id: 'phys', title: 'פיזיקה' }],
  exercises: EXS, byId: (id) => EXS.find((e) => e.id === id), show: dom.show, hard: HARD,
  hardTitle: (id) => (Object.values(HARD).flat().find((e) => e.id === id) || { title: id }).title,
};
const hrefs = () => dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href'));

test('home: recommended button, links are unique and at most 8; the other modes live in the hub', () => {
  globalThis.fetch = async () => ({ ok: false });
  nav.viewHome(ctx);
  assert.ok(dom.root.byText('strong', 'ההמשך המומלץ'));
  const hs = hrefs();
  assert.equal(new Set(hs).size, hs.length, hs.join());
  assert.ok(hs.length <= 8, hs.join());
  assert.ok(hs.includes('#/practice-hub'));
});

test('dailyPath: done marks come from today\'s attempts only', () => {
  const log = [att('mh-rad-1', 'alone', NOW - 3600000, 'math-hard-radical'), att('mp-1', 'alone', NOW - 3 * 86400000, 'multipart')];
  const p = W.pickHard([], HARD, NOW);
  const path = nav.dailyPath({ log, hard: HARD, now: NOW, title: ctx.hardTitle });
  assert.deepEqual(path.map((s) => s.done), [false, true, false]);
  assert.equal(path[1].href, '#/mathhard/mh-rad-1');
  assert.ok(p.length >= 3);
  const both = nav.dailyPath({ log: [...log, att('mp-2', 'hinted', NOW - 1000, 'multipart')], hard: HARD, now: NOW, title: ctx.hardTitle });
  assert.deepEqual(both.map((s) => s.done), [false, true, true]);
  assert.equal(both[2].href, '#/multipart/mp-2');
  // finished workout started today
  store.saveWorkout({ ids: ['math-3-1'], startedAt: NOW - 7200000 });
  const fin = nav.dailyPath({ log: [att('math-3-1', 'alone', NOW - 60000)], hard: HARD, now: NOW, workout: store.loadWorkout(), title: ctx.hardTitle });
  assert.equal(fin[0].done, true);
});

test('hub: no two tiles share a target, so the exam modes are no longer duplicated', () => {
  nav.viewHub(ctx);
  const hs = hrefs();
  assert.equal(hs.filter((h) => h === '#/exam').length, 1);
});

test('prerequisite math topics: verifier catches a wrong answer and a wrong root count', async () => {
  const { validate, extraProblems } = await import('../tools/verify-math.mjs');
  const data = rd('math');
  assert.deepEqual(validate(data), []);
  const ex = structuredClone(data.find((e) => e.id === 'math-rad-002'));
  assert.deepEqual(extraProblems(ex), []);
  ex.inputs[0].answer = '2'; // the extraneous root, not a solution
  assert.ok(extraProblems(ex).some((m) => m.includes('independent check gives 9')));
  const ex2 = structuredClone(data.find((e) => e.id === 'math-pow-004'));
  ex2.verify.checks[0].count = 3;
  assert.ok(extraProblems(ex2).some((m) => m.includes('root(s)')));
  assert.equal(data.filter((e) => ['math-rad', 'math-pow', 'math-par', 'math-lg'].includes(e.topic)).length, 20);
});
