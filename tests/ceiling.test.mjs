import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTopic, analyzeTopics, ceilingSummary, outgrownTopics, budgetOf, subjectOf, isIndependent, TOPIC_BUDGET, DEFAULT_BUDGET, median,
} from '../js/ceiling.js';
import { topicLevels, levelLine } from '../js/workout.js';
import { buildExport } from '../js/feedback.js';
import { dueReviews, withVirtual } from '../js/srs.js';

const T = 'math-hard-radical'; // budget 480 s => 65% = 312 s
const att = (i, o = {}) => ({ exerciseId: `${o.topic || T}-${i}`, ts: 1000 + i * 100000, outcome: 'alone', hintsUsed: 0, seconds: 120, topic: T, ...o });
const fb = (i, o = {}) => ({ exerciseId: `${T}-${i}`, ts: 1000 + i * 100000 + 1000, rating: 3, hardTags: [], correct: true, hintsUsed: 0, solutionViewed: false, ...o });
const hist = (n, f) => Array.from({ length: n }, (_, i) => att(i, f ? f(i) : {}));
const ratings = (n, f) => Array.from({ length: n }, (_, i) => fb(i, f ? f(i) : {}));
const tr = (i, outcome = 'alone', subject = 'math', extra = {}) => ({ exerciseId: `tr-${subject[0]}-${i}`, ts: 5e6 + i, outcome, hintsUsed: 0, seconds: 200, topic: `transfer-${subject}`, ...extra });

test('constants: every budget is documented and positive', () => {
  for (const [k, v] of Object.entries(TOPIC_BUDGET)) assert.ok(v > 0, k);
  assert.equal(budgetOf('nope'), DEFAULT_BUDGET);
  assert.equal(budgetOf(T), 480);
  assert.equal(subjectOf('math-hard-param'), 'math');
  assert.equal(subjectOf('multipart'), 'physics');
  assert.equal(subjectOf('transfer-physics'), 'physics');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('fewer than five distinct exercises: no verdict', () => {
  const v = analyzeTopic(T, hist(4), ratings(4));
  assert.equal(v.status, 'insufficient');
  assert.equal(v.count, 0);
  assert.equal(v.escalate, false);
  assert.equal(analyzeTopic(T, [], []).status, 'insufficient');
});

test('repeating one exercise does not make a sample of distinct exercises', () => {
  const log = Array.from({ length: 9 }, (_, i) => ({ ...att(0), ts: 1000 + i }));
  assert.equal(analyzeTopic(T, log, []).status, 'insufficient');
});

test('all four non-transfer signals => 4 signals, escalate + extreme mixed, but no ceiling without transfer data', () => {
  const v = analyzeTopic(T, hist(6), ratings(6));
  assert.deepEqual(v.signals, [true, true, true, true, false]);
  assert.equal(v.count, 4);
  assert.equal(v.escalate, true);
  assert.equal(v.extremeMixed, true);
  assert.equal(v.contentCeilingReached, false);
  assert.equal(v.transferAttempted, 0);
});

test('five signals incl. transfer => contentCeilingReached', () => {
  const log = [...hist(6), tr(1), tr(2), tr(3), tr(4), tr(5, 'wrong')];
  const v = analyzeTopic(T, log, ratings(6));
  assert.equal(v.transferAttempted, 5);
  assert.equal(v.signals[4], true); // 4/5 = 80%
  assert.equal(v.count, 5);
  assert.equal(v.contentCeilingReached, true);
  assert.equal(analyzeTopic(T, [...hist(6), tr(1), tr(2, 'wrong'), tr(3)], ratings(6)).signals[4], false); // 66%
});

test('transfer needs at least two questions and matches the subject only', () => {
  assert.equal(analyzeTopic(T, [...hist(6), tr(1)], ratings(6)).signals[4], false);
  assert.equal(analyzeTopic(T, [...hist(6), tr(1, 'alone', 'physics'), tr(2, 'alone', 'physics')], ratings(6)).signals[4], false);
  // covers: only questions that cover the topic count
  const covers = new Map([['tr-m-1', ['math-hard-param']], ['tr-m-2', ['math-hard-param']], ['tr-m-3', [T]], ['tr-m-4', [T]]]);
  const v = analyzeTopic(T, [...hist(6), tr(1), tr(2), tr(3), tr(4, 'wrong')], ratings(6), { transferCovers: covers });
  assert.equal(v.transferAttempted, 2);
  assert.equal(v.signals[4], false);
});

test('accuracy below 60% blocks escalation and suggests repair', () => {
  const log = hist(8, (i) => (i < 4 ? { outcome: 'wrong', seconds: 40 } : {}));
  const v = analyzeTopic(T, log, ratings(8));
  assert.equal(v.accuracy, 0.5);
  assert.equal(v.blocked, true);
  assert.equal(v.suggestRepair, true);
  assert.equal(v.escalate, false);
  assert.equal(v.extremeMixed, false);
  assert.equal(v.contentCeilingReached, false);
});

test('ratings alone never promote', () => {
  // slow, sometimes hinted, but rated easy with no tags: signals 3 and 4 only
  const log = hist(6, (i) => ({ outcome: i % 2 ? 'hinted' : 'alone', hintsUsed: i % 2 ? 1 : 0, seconds: 600 }));
  const v = analyzeTopic(T, log, ratings(6, () => ({ rating: 1 })));
  assert.deepEqual(v.signals, [false, false, true, true, false]);
  assert.equal(v.count, 2);
  assert.equal(v.escalate, false);
});

test('without feedback only the performance signals can fire', () => {
  const v = analyzeTopic(T, hist(6), []);
  assert.deepEqual(v.signals, [true, true, false, false, false]);
  assert.equal(v.escalate, true);
  assert.equal(v.extremeMixed, false);
});

test('slow solves lose the time signal; budget is per topic', () => {
  const slow = analyzeTopic(T, hist(6, () => ({ seconds: 400 })), ratings(6));
  assert.equal(slow.signals[1], false);
  const phys = analyzeTopic('phys-vertical', hist(6, () => ({ topic: 'phys-vertical', seconds: 130 })), []);
  assert.equal(phys.signals[1], false); // 130 > 0.65 * 180
  const fast = analyzeTopic('phys-vertical', hist(6, () => ({ topic: 'phys-vertical', seconds: 110 })), []);
  assert.equal(fast.signals[1], true); // 110 <= 117
});

test('a hint, a hard tag, a high rating or an unmeasured time each switch off exactly their signal', () => {
  assert.equal(analyzeTopic(T, hist(6, (i) => (i === 0 ? { outcome: 'hinted', hintsUsed: 1 } : {})), []).signals[0], false);
  assert.equal(analyzeTopic(T, hist(10, (i) => (i === 0 ? { outcome: 'hinted', hintsUsed: 1 } : {})), []).signals[0], true); // window of 8 drops the oldest
  assert.equal(analyzeTopic(T, hist(6), ratings(6, (i) => (i === 2 ? { hardTags: ['algebra'] } : {}))).signals[3], false);
  assert.equal(analyzeTopic(T, hist(6), ratings(6, () => ({ rating: 6 }))).signals[2], false);
  assert.equal(analyzeTopic(T, hist(6, () => ({ seconds: 0 })), ratings(6)).signals[1], false);
});

test('feedback that disagrees with the attempt (wrong / solution viewed) removes independence', () => {
  assert.equal(isIndependent({ outcome: 'alone', hintsUsed: 0 }, { correct: false }), false);
  assert.equal(isIndependent({ outcome: 'alone', hintsUsed: 0 }, { solutionViewed: true }), false);
  assert.equal(isIndependent({ outcome: 'alone', hintsUsed: 0 }, null), true);
  const v = analyzeTopic(T, hist(6), ratings(6, (i) => (i < 2 ? { correct: false } : {})));
  assert.equal(v.signals[0], false);
});

test('skipped / abandoned and quick-wrong attempts never count as mastery', () => {
  // five solid solves plus three abandoned ones: independent rate 5/8 < 90%
  const log = hist(8, (i) => (i < 3 ? { outcome: 'solution', seconds: 3 } : {}));
  const v = analyzeTopic(T, log, []);
  assert.equal(v.signals[0], false);
  assert.equal(v.blocked, false); // abandoned rows are no evidence of inability
  // quick wrong guesses never feed the time signal, and count as failures
  const q = hist(8, (i) => (i < 2 ? { outcome: 'wrong', seconds: 4 } : { seconds: 100 }));
  const vq = analyzeTopic(T, q, []);
  assert.equal(vq.medianSeconds, 100);
  assert.equal(vq.signals[0], false);
  assert.equal(vq.accuracy, 0.75);
});

test('first attempt per exercise is what counts; migrated legacy rows are ignored', () => {
  const log = [...hist(6, (i) => (i === 0 ? { outcome: 'wrong', seconds: 50 } : {})), { ...att(0), ts: 9e6 }];
  assert.equal(analyzeTopic(T, log, []).signals[0], false); // the later clean retry does not erase the first miss
  const mig = hist(6, () => ({ migrated: true }));
  assert.equal(analyzeTopic(T, mig, []).status, 'insufficient');
});

test('analyzeTopics / outgrownTopics / ceilingSummary skip transfer topics and thin topics', () => {
  const other = Array.from({ length: 5 }, (_, i) => ({ exerciseId: `lg-${i}`, ts: 100 + i, outcome: 'alone', hintsUsed: 0, seconds: 60, topic: 'logs' }));
  const log = [...hist(6), ...other, tr(1), tr(2)];
  const all = analyzeTopics(log, ratings(6));
  assert.deepEqual([...all.keys()].sort(), ['logs', T]);
  const out = outgrownTopics(log, ratings(6));
  assert.equal(out[0].topic, T);
  assert.ok(out.every((v) => v.count >= 2));
  const sum = ceilingSummary(log, ratings(6));
  assert.deepEqual(sum.find((s) => s.topic === T).signals, [1, 1, 1, 1, 1]); // two clean transfer questions of the same subject
  assert.equal(sum.find((s) => s.topic === T).escalate, true);
  assert.equal(JSON.stringify(sum).includes('transfer'), false);
});

test('feedback export carries per-topic ceiling data', () => {
  const log = [...hist(6), tr(1), tr(2), tr(3), tr(4), tr(5)];
  const exp = buildExport(ratings(6), log, [], 1700000000000);
  const row = exp.summary.ceiling.find((c) => c.topic === T);
  assert.equal(row.contentCeilingReached, true);
  assert.equal(row.signalCount, 5);
  assert.deepEqual(row.signals, [1, 1, 1, 1, 1]);
  assert.equal(buildExport([], [], []).summary.ceiling.length, 0);
});

/* ---------- workout integration ---------- */
const ex = (id, topic, level) => ({ id, topic, level });
const exs = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ex(`w-${i}`, 'phys-vertical', i <= 4 ? 1 : i <= 6 ? 2 : 3));
const wlog = (n, o = {}) => Array.from({ length: n }, (_, i) => ({ exerciseId: `w-${i + 1}`, ts: 1000 + i * 1000, outcome: 'alone', hintsUsed: 0, seconds: 100, ...o }));

test('topicLevels: 2+ signals escalate one level above the streak result; blocked or thin topics do not', () => {
  const noCeil = topicLevels(wlog(5), exs, [], { ceiling: false }).get('phys-vertical');
  const withCeil = topicLevels(wlog(5), exs, []).get('phys-vertical');
  assert.ok(withCeil.level > noCeil.level || withCeil.level === 3);
  assert.equal(withCeil.ceiling >= 2, true);
  assert.equal(withCeil.ceilingUp, true);
  // thin history: untouched
  assert.equal(topicLevels(wlog(3), exs, []).get('phys-vertical').ceilingUp, false);
  // wrong answers: no escalation
  const bad = wlog(8).map((a, i) => (i < 5 ? { ...a, outcome: 'wrong', seconds: 30 } : a));
  const b = topicLevels(bad, exs, []).get('phys-vertical');
  assert.equal(b.ceilingUp, false);
  assert.equal(b.blocked, true);
});

test('topicLevels: 4+ signals jump to the topic top level (extreme mixed)', () => {
  const fbs = wlog(6).map((a) => ({ exerciseId: a.exerciseId, ts: a.ts + 10, rating: 2, hardTags: [], correct: true, hintsUsed: 0, solutionViewed: false }));
  const v = topicLevels(wlog(6), exs, fbs).get('phys-vertical');
  assert.equal(v.extremeMixed, true);
  assert.equal(v.level, 3);
  assert.match(levelLine(wlog(6), exs, fbs, () => 'תנועה אנכית'), /5 סימנים|סימנים/);
});

test('transfer attempts stay out of schedules, due reviews and virtual topics', () => {
  const log = [tr(1), tr(2, 'wrong'), att(0)];
  assert.deepEqual(dueReviews(log, 1e12), [att(0).exerciseId]);
  assert.deepEqual(withVirtual([], log).map((e) => e.topic), [T]);
});

test('analyze-feedback prints topics needing harder content from the export summary', async () => {
  const { analyze, renderReport, buildProposal } = await import('../tools/analyze-feedback.mjs');
  const log = [...hist(6), tr(1), tr(2), tr(3), tr(4), tr(5)];
  const exp = buildExport(ratings(6), log, [], 1700000000000);
  const a = analyze(JSON.parse(JSON.stringify(exp)));
  assert.deepEqual(a.needHarder.map((c) => [c.topic, c.signalCount, c.contentCeilingReached]), [[T, 5, true]]);
  const md = renderReport(a);
  assert.match(md, /נושאים שצריכים תוכן קשה יותר/);
  assert.match(md, new RegExp(`${T}: 5/5`));
  assert.equal(buildProposal(a).topicsNeedingHarderContent[0].topic, T);
  // exports without the ceiling block (older app versions) still work
  assert.deepEqual(analyze({ records: [] }).needHarder, []);
  assert.match(renderReport(analyze({ records: [] })), /נושאים שצריכים תוכן קשה יותר[\s\S]*- אין/);
});
