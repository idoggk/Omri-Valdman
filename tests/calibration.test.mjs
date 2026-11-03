import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const C = await import('../js/calibration.js');
const UI = await import('../js/calibration-ui.js');
const S = await import('../js/srs.js');
const N = await import('../js/notebook.js');
const B = await import('../js/backup.js');
const E = await import('../js/engine.js');

const att = (predicted, full, extra = {}) => ({ exerciseId: `x${Math.random()}`, ts: 1000, outcome: full ? 'alone' : 'wrong', hintsUsed: 0, seconds: 10, predicted, ...extra });
const many = (n, predicted, fullCount) => Array.from({ length: n }, (_, i) => att(predicted, i < fullCount));
const text = (els) => els.flat().filter(Boolean).map((e) => e.textContent).join(' ').replace(/[⁦⁩]/g, '');

test('buckets: counts and rates per chip, attempts without a prediction are ignored', () => {
  const log = [att(50, true), att(50, false), att(90, true), att(90, true), att(90, false), att(100, true), { exerciseId: 'n', ts: 1, outcome: 'alone', hintsUsed: 0, seconds: 1 }];
  const b = C.buckets(log);
  assert.deepEqual(b.map((r) => [r.chip, r.n, r.full, r.rate]), [[50, 2, 1, 0.5], [70, 0, 0, null], [90, 3, 2, 0.67], [100, 1, 1, 1]]);
});

test('Brier score fixtures', () => {
  assert.equal(C.brier([]), null);
  assert.equal(C.brier([att(100, true), att(100, true)]), 0);
  assert.equal(C.brier([att(100, false)]), 1);
  assert.equal(C.brier([att(50, true), att(50, false)]), 0.25); // always 50% = 0.25
  assert.equal(C.brier([att(90, true), att(90, false), att(50, true), att(50, false)]), 0.33); // (0.01 + 0.81 + 0.25 + 0.25) / 4
  assert.equal(C.brier([att(70, true), att(70, false)]), 0.29);
  assert.match(C.brierText(0.05), /מצוין/);
  assert.match(C.brierText(0.25), /50 אחוז/);
  assert.match(C.brierText(0.4), /רחוקות/);
  assert.match(C.BRIER_EXPLAIN, /ריבוע/);
});

test('full marks: partial-credit score needs 1, otherwise an independent solve without hints', () => {
  assert.equal(C.fullMarks(att(90, true)), true);
  assert.equal(C.fullMarks({ outcome: 'hinted', hintsUsed: 1 }), false);
  assert.equal(C.fullMarks({ outcome: 'alone', hintsUsed: 1 }), false);
  assert.equal(C.fullMarks({ outcome: 'hinted', score: 1 }), true);
  assert.equal(C.fullMarks({ outcome: 'hinted', score: 0.9 }), false);
});

test('verdict: no data below 20 predictions, then over / under / calibrated', () => {
  const v0 = C.verdict(many(19, 90, 0));
  assert.equal(v0.kind, 'nodata');
  assert.equal(v0.n, 19);
  assert.equal(C.verdict([]).kind, 'nodata');
  assert.equal(C.verdict(many(20, 90, 10)).kind, 'over');
  assert.equal(C.verdict(many(20, 50, 20)).kind, 'under');
  const ok = C.verdict(many(20, 70, 14));
  assert.equal(ok.kind, 'calibrated');
  assert.equal(ok.predictedMean, 0.7);
  assert.equal(ok.actualRate, 0.7);
  assert.equal(C.verdict(many(20, 70, 13)).kind, 'calibrated'); // 5 points exactly is still within tolerance
  assert.equal(C.verdict(many(20, 70, 12)).kind, 'over');
});

test('confident but wrong: 90/100 percent without full marks, newest per exercise first', () => {
  const log = [
    att(90, false, { exerciseId: 'a', ts: 10 }), att(100, false, { exerciseId: 'a', ts: 30 }), att(70, false, { exerciseId: 'b', ts: 20 }),
    att(90, true, { exerciseId: 'c', ts: 40 }), att(90, false, { exerciseId: 'd', ts: 25 }),
  ];
  const items = C.confidentWrongItems(log);
  assert.deepEqual(items.map((a) => [a.exerciseId, a.predicted]), [['a', 100], ['d', 90]]);
  assert.equal(C.confidentWrong(att(90, true)), false);
});

test('attempt records keep a valid prediction and drop anything else (backward compatible)', () => {
  assert.equal(S.makeAttempt({ exerciseId: 'e', outcome: 'alone', predicted: 90 }).predicted, 90);
  assert.equal('predicted' in S.makeAttempt({ exerciseId: 'e', outcome: 'alone', predicted: 60 }), false);
  assert.equal('predicted' in S.makeAttempt({ exerciseId: 'e', outcome: 'alone' }), false);
  assert.equal(S.cleanLog(JSON.parse(JSON.stringify([{ exerciseId: 'e', ts: 1, outcome: 'wrong', hintsUsed: 0, seconds: 0, predicted: 70 }])))[0].predicted, 70);
});

test('confident-but-wrong attempts enter the error notebook, even a lightly hinted one; calibrated ones do not', () => {
  const log = [
    S.makeAttempt({ exerciseId: 'hot', ts: 100, outcome: 'hinted', hintsUsed: 1, seconds: 5, predicted: 90, topic: 'math-hard-radical' }),
    S.makeAttempt({ exerciseId: 'cool', ts: 200, outcome: 'hinted', hintsUsed: 1, seconds: 5, predicted: 50, topic: 'math-hard-radical' }),
    S.makeAttempt({ exerciseId: 'plain', ts: 300, outcome: 'hinted', hintsUsed: 1, seconds: 5, topic: 'math-hard-radical' }),
  ];
  const state = N.sanitize(null);
  N.syncNotebook(state, log, [], () => null, 1000);
  assert.deepEqual(Object.keys(state.entries), ['hot']);
  assert.ok(state.entries.hot.tags.includes(N.OVERCONFIDENT_TAG));
});

test('confidence bar: hidden when off, optional chips, one prediction per visit', () => {
  const off = UI.confidenceBar({ on: false });
  assert.equal(off.node, null);
  assert.deepEqual(UI.predExtra(off), {});
  const bar = UI.confidenceBar({ on: true });
  const chips = bar.node.all((n) => n.tagName === 'BUTTON');
  assert.deepEqual(chips.map((c) => c.textContent), ['50%', '70%', '90%', '100%']);
  assert.equal(bar.value(), undefined);
  chips[2].click();
  assert.equal(bar.value(), 90);
  chips[2].click(); // tapping again clears
  assert.equal(bar.value(), undefined);
  chips[1].click();
  assert.deepEqual(UI.predExtra(bar), { predicted: 70 });
  assert.deepEqual(UI.predExtra(bar), {}); // consumed: a second attempt record of the same visit carries nothing
  chips[3].click(); // locked after take
  assert.equal(chips[3].disabled, true);
  const none = UI.confidenceBar({ on: true });
  assert.deepEqual(UI.predExtra(none), {}); // nothing chosen, nothing stored
});

test('the setting is off by default and persists', () => {
  dom.store.clear();
  assert.equal(C.loadOn(), false);
  C.saveOn(true);
  assert.equal(C.loadOn(), true);
  C.saveOn(false);
  assert.equal(C.loadOn(), false);
});

test('calibration page: no data message, table, Brier text, verdict only from 20 predictions, confident-but-wrong list', () => {
  const empty = text(UI.renderCalibration([]));
  assert.match(empty, /עוד אין נתונים/);
  assert.doesNotMatch(empty, /ביטחון יתר: אתם/);
  const few = text(UI.renderCalibration(many(5, 90, 1)));
  assert.match(few, /5 מתוך 20 הערכות/);
  assert.match(few, /ציון בריאר/);
  const log = many(20, 90, 10).map((a, i) => ({ ...a, exerciseId: `id${i}`, topic: 'math-hard-radical', ts: 1000 + i }));
  const page = text(UI.renderCalibration(log));
  assert.match(page, /ביטחון יתר: אתם/);
  assert.match(page, /90%/);
  assert.match(page, /בממוצע אמרתם 90% והצלחתם 50%/);
  const els = UI.renderCalibration(log).flat().filter(Boolean);
  const links = els.flatMap((e) => e.all((n) => n.tagName === 'A' && /^#\//.test(n.getAttribute('href') || '')));
  assert.ok(links.length >= 10, 'confident-but-wrong items link back to the exercise');
});

test('the new stores are in the backup key list and the ladder-math / counter topics have titles and links', () => {
  for (const k of ['omri-study-calib-v1', 'omri-study-journal-v1', 'omri-study-examday-v1', 'omri-study-counter-v1']) assert.ok(B.KNOWN_KEYS[k], k);
  assert.equal(E.topicTitle('ladder-math'), 'סולם המתמטיקה');
  assert.equal(E.topicHref('counter'), '#/counter');
  assert.equal(E.itemHref('ce-04', 'counter'), '#/counter/t/ce-04');
});
