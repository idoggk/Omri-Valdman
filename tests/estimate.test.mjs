import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const Es = await import('../js/estimate.js');
const UI = await import('../js/estimate-ui.js');
const store = await import('../js/store.js');
const B = await import('../js/backup.js');
const E = await import('../js/engine.js');
const SRS = await import('../js/srs.js');
const N = await import('../js/nav.js');
const { verifyEstimate } = await import('../tools/verify-estimate.mjs');

const q = (id) => Es.QUESTIONS.find((x) => x.id === id);

test('verifier: exact values recomputed independently, bounds contain them and wrong ranges do not', () => {
  const r = verifyEstimate();
  assert.deepEqual(r.errs, []);
  assert.equal(r.count, 24);
});

test('verifier catches a broken question', () => {
  const broken = Es.QUESTIONS.map((x) => (x.id === 'es-01' ? { ...x, expr: 'sqrt(h/g)' } : x));
  assert.ok(verifyEstimate(broken).errs.some((e) => /es-01/.test(e)));
  const shifted = Es.QUESTIONS.map((x) => (x.id === 'es-02' ? { ...x, bounds: [5, 30, 40, 200, 1000] } : x));
  assert.ok(verifyEstimate(shifted).errs.some((e) => /es-02/.test(e)), 'exact value on a bound');
});

test('exact values of the worked examples', () => {
  assert.equal(Es.exactOf(q('es-01')), 2);
  assert.equal(Es.exactOf(q('es-02')), 40);
  assert.equal(Es.exactOf(q('es-09')), 9600);
  assert.equal(Es.exactOf(q('es-10')), 60);
  assert.ok(Math.abs(Es.exactOf(q('es-21')) - 0.36) < 1e-9);
});

test('choice judging: only the range containing the exact value brackets it', () => {
  const x = q('es-09');
  const right = Es.correctIndex(x);
  assert.equal(Es.rangesOf(x)[right].lo <= 9600 && 9600 < Es.rangesOf(x)[right].hi, true);
  assert.deepEqual([Es.judgeChoice(x, right).bracketed, Es.judgeChoice(x, right).success], [true, true]);
  for (let i = 0; i < 4; i++) if (i !== right) assert.equal(Es.judgeChoice(x, i).bracketed, false);
  assert.equal(Es.judgeChoice(x, right - 1).side, 'high', 'the exact value lies above a lower range');
  assert.equal(Es.judgeChoice(x, right + 1).side, 'low');
  assert.equal(Es.judgeChoice(x, 9).success, false);
});

test('slider judging: bracketed, too wide, or missed (with the side)', () => {
  const x = q('es-04'); // 36 m
  assert.deepEqual(Es.judgeSlider(x, 20, 60), { ...Es.judgeSlider(x, 20, 60), bracketed: true, tooWide: false, success: true });
  assert.equal(Es.judgeSlider(x, 60, 20).success, true, 'ends in either order');
  const wide = Es.judgeSlider(x, 2, 900);
  assert.deepEqual([wide.bracketed, wide.tooWide, wide.success], [true, true, false]);
  const low = Es.judgeSlider(x, 3, 20);
  assert.deepEqual([low.bracketed, low.side], [false, 'high']);
  assert.equal(Es.judgeSlider(x, 50, 200).side, 'low');
  assert.equal(Es.judgeSlider(x, 36, 360).success, true, 'the boundary counts as bracketed, a factor of exactly 10 is allowed');
});

test('log slider mapping spans the axis and inverts', () => {
  const axis = [1, 1000];
  assert.equal(Es.sliderValue(0, axis), 1);
  assert.ok(Math.abs(Es.sliderValue(1000, axis) - 1000) < 1e-9);
  assert.ok(Math.abs(Es.sliderValue(500, axis) - Math.sqrt(1000)) < 1e-9, 'the middle is the geometric mean');
  assert.equal(Es.sliderPos(Es.sliderValue(250, axis), axis), 250);
  assert.equal(Es.fmtVal(9600), '9,600');
  assert.equal(Es.fmtVal(15.588), '15.6');
  assert.equal(Es.fmtVal(0.0711), '0.0711');
});

test('saved results, hit rate, session picker, persistence', () => {
  const s = Es.emptySaved();
  assert.equal(Es.hitRate(s), null);
  Es.recordResult(s, 'es-01', true, 5);
  Es.recordResult(s, 'es-02', false, 6);
  Es.recordResult(s, 'es-02', true, 7);
  assert.equal(Es.hitRate(s), 2 / 3);
  const p = Es.pickSession(s, 8, 3);
  assert.equal(p.length, 8);
  assert.ok(!p.some((x) => x.id === 'es-01' || x.id === 'es-02'), 'unseen questions come first');
  assert.deepEqual(Es.pickSession(s, 8, 3).map((x) => x.id), p.map((x) => x.id));
  assert.ok(Es.pickSession(s, 8, 1, 'math').every((x) => x.group === 'math'));
  assert.deepEqual(Es.sanitizeSaved({ q: { 'es-01': { hit: 2, miss: 'x', ts: 4, last: 1 }, nope: { hit: 1 } } }).q, { 'es-01': { hit: 2, miss: 0, ts: 4, last: 1 } });
  assert.ok(Es.KEY in B.KNOWN_KEYS);
});

test('engine topic is reserved from mastery, titled and linked; routes and precache', () => {
  assert.ok(SRS.isReservedTopic('estimate'));
  assert.match(E.topicTitle('estimate'), /הערכה/);
  assert.equal(E.topicHref('estimate'), '#/estimate');
  assert.equal(E.itemHref('es-01', 'estimate'), '#/estimate');
  assert.equal(N.resolveRoute('#/estimate/run/math').name, 'estimate');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['js/estimate.js', 'js/estimate-data.js', 'js/estimate-ui.js']) assert.ok(sw.includes(`'${f}'`), f);
});

test('screen: choose a range, see the verdict and the calculation, attempt recorded', () => {
  dom.store.clear();
  store.resetCache();
  const ctx = { show: dom.show };
  UI.viewEstimate(ctx);
  assert.match(dom.root.textContent, /24 שאלות/);
  UI.viewEstimate(ctx, 'run', 'build');
  const text = () => dom.root.textContent.replace(/[⁦-⁩]/g, '');
  const shown = Es.QUESTIONS.filter((x) => x.group === 'build').find((x) => text().includes(x.prompt));
  assert.ok(shown, 'a construction question is shown');
  if (shown.mode === 'choice') {
    const right = Es.correctIndex(shown);
    const label = Es.rangeLabel(shown, right);
    dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.replace(/[⁦-⁩]/g, '').trim() === label)[0].click();
    assert.match(text(), /ההערכה שלכם תפסה/);
  } else {
    dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'אישור הטווח')[0].click();
    assert.match(text(), /החישוב המדויק/);
  }
  assert.match(text(), /החישוב המדויק/);
  assert.ok(text().includes(Es.fmtVal(Es.exactOf(shown))));
  const log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.length, 1);
  assert.equal(log[0].topic, 'estimate');
  assert.equal(log[0].exerciseId, shown.id);
  assert.equal(JSON.parse(dom.store.get(Es.KEY)).q[shown.id].hit + JSON.parse(dom.store.get(Es.KEY)).q[shown.id].miss, 1);
});

test('cleanup', () => dom.restore());
