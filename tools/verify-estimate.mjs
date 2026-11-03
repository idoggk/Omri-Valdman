// Independent verifier for js/estimate-data.js (24 estimation questions).
//   1. exact value: question.exact(p) must equal the independent expression question.expr evaluated by tools/verify-sprint.mjs's own
//      evaluator, and the explanation steps must state that value;
//   2. choice questions: 5 ascending bounds (4 contiguous ranges), exactly ONE range contains the exact value, the three wrong
//      ranges do not, and the exact value is at least 5% away from every bound (a borderline question would be unfair);
//   3. slider questions: the exact value lies inside the log axis with a factor of at least 1.5 to each end;
//   4. shape: 24 questions, 8 per group, 18 choice + 6 slider, Hebrew prompts, g = 10 whenever gravity is used, the correct range is
//      not always in the same position, and unit conversions in the prompt agree with the givens.
// Usage: node tools/verify-estimate.mjs
import { pathToFileURL } from 'node:url';
import { ev } from './verify-sprint.mjs';
import { QUESTIONS, GROUPS } from '../js/estimate-data.js';
import { exactOf, rangesOf, correctIndex, judgeChoice, judgeSlider, sliderValue, sliderPos, fmtVal, MAX_RATIO } from '../js/estimate.js';

const HEB = /[֐-׿]/;
const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1e-12, Math.abs(x), Math.abs(y));

export function verifyEstimate(questions = QUESTIONS) {
  const errs = [];
  const err = (id, m) => errs.push(`${id}: ${m}`);
  if (questions.length !== 24) err('set', `expected 24 questions, found ${questions.length}`);
  const ids = new Set();
  const positions = {};
  for (const q of questions) {
    if (ids.has(q.id)) err(q.id, 'duplicate id');
    ids.add(q.id);
    if (!HEB.test(q.prompt) || !q.steps || !q.steps.length || !q.steps.every((s) => typeof s === 'string')) err(q.id, 'Hebrew prompt and steps are required');
    if (!GROUPS.some((g) => g.id === q.group)) err(q.id, `unknown group ${q.group}`);
    if ('g' in q.p && q.p.g !== 10) err(q.id, 'g must be 10');
    if (/9\.8|9\.81/.test(q.prompt)) err(q.id, 'g must be 10');
    // 1 exact value
    const env = { ...q.p };
    let indep;
    try { indep = ev(q.expr, env); } catch (e) { err(q.id, `expression failed: ${e.message}`); continue; }
    const exact = exactOf(q);
    if (!Number.isFinite(exact) || exact <= 0) err(q.id, `exact value ${exact} must be positive and finite`);
    if (!near(exact, indep)) err(q.id, `exact() ${exact} != independent expression ${indep}`);
    const text = q.steps.join(' ');
    const forms = [fmtVal(exact), String(Number(exact.toPrecision(4))), String(Math.round(exact * 1000) / 1000), Math.round(exact).toLocaleString('en-US')];
    if (!forms.some((f) => text.includes(f))) err(q.id, `steps do not state the exact value ${fmtVal(exact)}`);
    if (q.mode === 'choice') {
      // 2 ranges
      const b = q.bounds;
      if (!Array.isArray(b) || b.length !== 5 || b.some((x, i) => !Number.isFinite(x) || (i && x <= b[i - 1]))) { err(q.id, 'bounds must be 5 ascending numbers'); continue; }
      const hits = rangesOf(q).map((r, i) => (exact >= r.lo && exact < r.hi ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) err(q.id, `${hits.length} ranges contain the exact value`);
      else {
        if (correctIndex(q) !== hits[0]) err(q.id, 'correctIndex disagrees');
        positions[hits[0]] = (positions[hits[0]] || 0) + 1;
        rangesOf(q).forEach((r, i) => { if (i !== hits[0] && judgeChoice(q, i).bracketed) err(q.id, `wrong range ${i} is judged as bracketing`); });
        if (!judgeChoice(q, hits[0]).success) err(q.id, 'correct range not judged successful');
      }
      for (const x of b) if (Math.abs(exact - x) / x < 0.05) err(q.id, `exact value is within 5% of bound ${x}`);
    } else if (q.mode === 'slider') {
      // 3 axis
      const [lo, hi] = q.axis;
      if (!(lo > 0 && hi > lo)) err(q.id, 'bad axis');
      if (exact / lo < 1.5 || hi / exact < 1.5) err(q.id, 'exact value too close to an end of the axis');
      if (!near(sliderValue(0, q.axis), lo) || !near(sliderValue(1000, q.axis), hi)) err(q.id, 'slider mapping does not span the axis');
      if (Math.abs(sliderPos(sliderValue(437, q.axis), q.axis) - 437) > 1) err(q.id, 'slider mapping is not invertible');
      if (!judgeSlider(q, exact / 2, exact * 2).success) err(q.id, 'a factor-4 range around the exact value should succeed');
      if (judgeSlider(q, exact * 1.2, exact * 3).bracketed) err(q.id, 'a range above the exact value must not bracket');
      if (!judgeSlider(q, exact / 100, exact * 100).tooWide) err(q.id, 'a range of factor 10^4 must be flagged as too wide');
      if (judgeSlider(q, exact / 100, exact * 100).success) err(q.id, 'too-wide range must not succeed');
      void MAX_RATIO;
    } else err(q.id, `unknown mode ${q.mode}`);
  }
  // 4 shape
  for (const g of GROUPS) if (questions.filter((q) => q.group === g.id).length !== 8) err('set', `group ${g.id} should have 8 questions`);
  if (questions.filter((q) => q.mode === 'choice').length !== 18 || questions.filter((q) => q.mode === 'slider').length !== 6) err('set', 'expected 18 choice + 6 slider questions');
  for (const [pos, n] of Object.entries(positions)) if (n > 8) err('set', `${n} questions have the correct range at position ${pos}`);
  if (Object.keys(positions).length < 3) err('set', 'the correct range should appear in at least 3 different positions');
  // explicit unit-conversion checks of givens quoted in prompts
  const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
  if (byId['es-02'] && !(byId['es-02'].p.v === 72 / 3.6)) err('es-02', '72 km/h must be 20 m/s');
  if (byId['es-11'] && byId['es-11'].p.m !== exactOf(byId['es-09'])) err('es-11', 'slab mass must equal the answer of es-09');
  if (byId['es-12'] && byId['es-12'].p.F !== exactOf(byId['es-09']) * 10) err('es-12', 'slab weight must equal es-09 mass times 10');
  return { errs, count: questions.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errs, count } = verifyEstimate();
  console.log(`estimate questions: ${count}`);
  if (errs.length) { console.error(`${errs.length} problem(s):`); errs.forEach((e) => console.error(' -', e)); process.exit(1); }
  console.log('OK');
}
