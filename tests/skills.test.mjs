import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateSkills, loadExerciseIds, SOLVERS } from '../tools/verify-skills.mjs';
import * as S from '../js/skills.js';
import * as B from '../js/backup.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = () => JSON.parse(readFileSync(path.join(root, 'data', 'skills.json'), 'utf8'));
const ids = loadExerciseIds(root);
const bad = (mut) => { const d = load(); mut(d); return validateSkills(d, ids); };
const has = (errs, re) => assert.ok(errs.some((e) => re.test(e)), `expected /${re}/ in:\n${errs.join('\n')}`);

/* ---------- verifier ---------- */
test('real skills.json passes', () => assert.deepEqual(validateSkills(load(), ids), []));
test('12 skills, 3 questions each, math/physics split', () => {
  const d = load();
  assert.equal(d.skills.length, 12);
  assert.equal(d.skills.filter((s) => s.topic === 'math').length, 6);
  for (const s of d.skills) assert.equal(s.questions.length, 3, s.id);
});
test('data/math.json and data/physics.json are untouched by tags (tags live only in skills.json)', () => {
  for (const f of ['math', 'physics']) assert.ok(!JSON.parse(readFileSync(path.join(root, 'data', `${f}.json`), 'utf8')).some((e) => 'skillTags' in e));
});
test('injection: wrong stored answer', () => has(bad((d) => { d.skills[0].questions[0].answer = 5; }), /recomputed/));
test('injection: unknown prerequisite / self / cycle', () => {
  has(bad((d) => { d.skills[1].prereqs = ['nope']; }), /unknown prerequisite/);
  has(bad((d) => { d.skills[0].prereqs = ['math-lin']; }), /itself/);
  has(bad((d) => { d.skills[0].prereqs = ['math-elim']; }), /cycle/);
});
test('injection: question count, lesson length, no Hebrew', () => {
  has(bad((d) => { d.skills[2].questions.pop(); }), /exactly 3 questions/);
  has(bad((d) => { d.skills[2].lesson = d.skills[2].lesson.slice(0, 3); }), /4-6 lines/);
  has(bad((d) => { d.skills[2].name = 'substitution'; }), /name must contain Hebrew/);
});
test('injection: more than 2 decimals / non-finite answer', () => {
  has(bad((d) => { d.skills[0].questions[0].answer = 1 / 3; }), /more than 2 decimals/);
  has(bad((d) => { d.skills[0].questions[0].answer = null; }), /finite/);
});
test('injection: negative discriminant is rejected (no complex numbers)', () => has(bad((d) => { d.skills[4].questions[1].params = { a: 1, b: 1, c: 1, ask: 'max' }; }), /negative discriminant/));
test('injection: tag to a missing exercise or skill, unused skill', () => {
  has(bad((d) => { d.skillTags['no-such-ex'] = ['math-lin']; }), /unknown exercise id/);
  has(bad((d) => { d.skillTags['math-3-001'] = ['no-skill']; }), /unknown skill/);
  has(bad((d) => { for (const k of Object.keys(d.skillTags)) d.skillTags[k] = d.skillTags[k].filter((s) => s !== 'phys-comp'); }), /not used by any exercise tag/);
});
test('solvers: spot values', () => {
  assert.equal(SOLVERS.tof({ mode: 'cliff', v0: 10, h: 15 }), 3);
  assert.equal(SOLVERS.sqrtcheck({ p: 2, q: 4, s: 2 }), 6);
  assert.equal(SOLVERS.elim({ a1: 2, b1: 3, c1: 12, a2: 2, b2: -1, c2: 4, ask: 'x' }), 3);
  assert.throws(() => SOLVERS.sqrtcheck({ p: 4, q: -12, s: 3 })); // both candidates valid
});

/* ---------- weak-skill finder ---------- */
const data = {
  skills: [
    { id: 'a', prereqs: [] }, { id: 'b', prereqs: ['a'] }, { id: 'c', prereqs: ['b'] }, { id: 'd', prereqs: ['a'] },
  ],
  skillTags: { e1: ['c'], e2: ['c'], e3: ['b'], e4: ['a'], e5: ['d'] },
};
let clock = 0;
const at = (exerciseId, outcome) => ({ exerciseId, outcome, ts: ++clock, hintsUsed: 0, seconds: 1 });

test('no attempts or a single miss: nothing is weak', () => {
  assert.deepEqual(S.weakSkills([], data), []);
  assert.equal(S.recommendRepair([at('e1', 'wrong')], data), null);
});
test('two misses in the last five make a skill weak; hints do not count', () => {
  const log = [at('e1', 'wrong'), at('e1', 'hinted'), at('e2', 'solution')];
  assert.deepEqual(S.weakSkills(log, data).map((w) => [w.id, w.misses]), [['c', 2]]);
  assert.equal(S.weakSkills([at('e1', 'hinted'), at('e1', 'hinted'), at('e2', 'hinted')], data).length, 0);
});
test('only the last five attempts count', () => {
  const log = [at('e1', 'wrong'), at('e1', 'wrong'), at('e1', 'alone'), at('e2', 'alone'), at('e1', 'alone'), at('e2', 'alone'), at('e1', 'alone')];
  assert.equal(S.weakSkills(log, data).length, 0);
  assert.equal(S.skillStats(log, data).c.recent.length, 5);
});
test('attempts are sorted by time, not by array order', () => {
  // the two misses are the OLDEST by ts (listed last); four newer solves push them out of the window
  const solves = [10, 11, 12, 13, 14].map((ts) => ({ ...at('e1', 'alone'), ts }));
  const log = [...solves, { ...at('e1', 'wrong'), ts: 1 }, { ...at('e1', 'wrong'), ts: 2 }];
  assert.equal(S.weakSkills(log, data).length, 0);
  assert.equal(S.weakSkills([...solves.slice(0, 3), ...log.slice(5)], data).length, 1); // 3 solves + 2 misses: in window
});
test('recommendation goes to the weakest unrepaired prerequisite', () => {
  const log = [at('e1', 'wrong'), at('e2', 'wrong'), at('e3', 'wrong'), at('e4', 'alone')];
  // c is weak (2 misses); prerequisites b (1 miss, depth 1) and a (0 misses, depth 0): b has more misses
  assert.deepEqual(S.recommendRepair(log, data), { weak: 'c', target: 'b', misses: 2 });
});
test('with no prerequisite trouble the most basic unrepaired prerequisite is chosen', () => {
  const log = [at('e1', 'wrong'), at('e2', 'wrong')];
  assert.equal(S.recommendRepair(log, data).target, 'a');
});
test('repaired prerequisites are skipped; when all are repaired the skill itself is the target', () => {
  const log = [at('e1', 'wrong'), at('e2', 'wrong')];
  const rep = (...skills) => ({ v: 1, skills: Object.fromEntries(skills.map((s) => [s, { tries: 1, best: 3, last: 3, ts: 0 }])) });
  assert.equal(S.recommendRepair(log, data, rep('a')).target, 'b');
  assert.equal(S.recommendRepair(log, data, rep('a', 'b')).target, 'c');
});
test('a full-score repair clears older misses of that skill', () => {
  const log = [at('e1', 'wrong'), at('e2', 'wrong')];
  const rep = { v: 1, skills: { c: { tries: 1, best: 3, last: 3, ts: clock + 10 } } };
  assert.equal(S.weakSkills(log, data, rep).length, 0);
  assert.equal(S.skillStatuses(log, data, rep).find((x) => x.id === 'c').status, 'repaired');
});
test('the most-missed weak skill wins; garbage records and cyclic data do not break it', () => {
  const log = [at('e5', 'wrong'), at('e5', 'wrong'), at('e1', 'wrong'), at('e1', 'wrong'), at('e2', 'wrong'), { junk: true }, null];
  assert.equal(S.weakSkills(log, data)[0].id, 'c');
  const cyc = { skills: [{ id: 'x', prereqs: ['y'] }, { id: 'y', prereqs: ['x'] }], skillTags: {} };
  assert.deepEqual(S.allPrereqs(cyc, 'x'), ['y']);
  assert.doesNotThrow(() => S.depthOf(cyc, 'x'));
});
test('real data: tagged math exercise misses point at a real skill', () => {
  const d = load();
  const ex = Object.keys(d.skillTags).find((k) => d.skillTags[k].includes('math-disc'));
  const rec = S.recommendRepair([at(ex, 'wrong'), at(ex, 'solution')], d);
  assert.ok(rec && d.skills.some((s) => s.id === rec.target));
});

/* ---------- repair results storage and backup ---------- */
test('sanitizeRepair clamps and drops junk', () => {
  const r = S.sanitizeRepair({ skills: { a: { tries: 2, best: 9, last: 2, ts: 5 }, b: 'x', c: { tries: -1, last: -3 } } });
  assert.deepEqual(r.skills.a, { tries: 2, best: 3, last: 2, ts: 5 });
  assert.ok(!('b' in r.skills));
  assert.deepEqual(r.skills.c, { tries: 1, best: 0, last: 0, ts: 0 });
  assert.deepEqual(S.sanitizeRepair('junk'), { v: 1, skills: {} });
});
test('recordRepair/loadRepair round-trip through localStorage', () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  try {
    S.recordRepair('math-lin', 2, 10);
    S.recordRepair('math-lin', 3, 20);
    assert.deepEqual(S.loadRepair().skills['math-lin'], { tries: 2, best: 3, last: 3, ts: 20 });
    assert.ok(S.isRepaired(S.loadRepair(), 'math-lin'));
  } finally { delete globalThis.localStorage; }
});
test('repair results are part of the backup allowlist and round-trip', () => {
  assert.equal(S.REPAIR_KEY, 'omri-study-repair-v1');
  assert.ok(S.REPAIR_KEY in B.KNOWN_KEYS);
  const v = '{"v":1,"skills":{"math-lin":{"tries":1,"best":3,"last":3,"ts":5}}}';
  const code = B.buildBackup({ getItem: (k) => (k === S.REPAIR_KEY ? v : null) }, 1);
  assert.equal(JSON.parse(code).data[S.REPAIR_KEY], v);
});
