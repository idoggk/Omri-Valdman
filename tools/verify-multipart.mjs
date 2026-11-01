// Verifies data/multipart.json (multi-part exam questions).
// Every part answer is recomputed from an independent projectile model (v0, angle, h0 with sin/cos 37/53 table, g = 10),
// and every dependency formula is re-evaluated with the TRUE earlier answers and must reproduce the stored answer.
// Also checks: `uses` equals the part ids the formula references (earlier parts only), answers are real numbers with
// at most 2 decimals, text is Hebrew, no complex numbers, and a wrong earlier answer is classified as carried-forward.
// Usage: node tools/verify-multipart.mjs [path-to-json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evalFormula, formulaRefs, classifyPart, validQuestion } from '../js/multipart.js';

const G = 10;
const HEB = /[֐-׿]/;
const COMPLEX = /sqrt\(\s*-|imaginary|complex|מרוכב|דמיוני/i;
const DECIMAL2 = /^-?\d+(\.\d{1,2})?$/;
const TRIG = { 37: [0.6, 0.8], 53: [0.8, 0.6], 90: [1, 0], 0: [0, 1] }; // [sin, cos]
const trig = (ang) => { const t = TRIG[Math.abs(ang)]; return t ? [Math.sign(ang || 1) * t[0], t[1]] : null; };

/** Independent physics for one question model. Returns a function quantity(q-spec) -> number. */
export function physics(model) {
  const [s, c] = trig(model.ang);
  const vy0 = model.v0 * s;
  const vx = model.v0 * c;
  const h0 = model.h0 || 0;
  const T = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * h0)) / G;
  const rise = vy0 > 0 ? vy0 * vy0 / (2 * G) : 0;
  const timeOf = (k) => (k === 'T' ? T : k === 't1' ? model.t1 : k === 't2' ? (vy0 + Math.sqrt(vy0 * vy0 - 2 * G * (model.H - h0))) / G : NaN);
  const vyAt = (t) => vy0 - G * t;
  const tH = (which) => (vy0 + (which === 'first' ? -1 : 1) * Math.sqrt(vy0 * vy0 - 2 * G * (model.H - h0))) / G;
  return (spec) => {
    switch (spec.k) {
      case 'vx': return vx;
      case 'vy0': return vy0;
      case 'tpeak': return vy0 / G;
      case 'hmax': return rise;
      case 'hmaxAbs': return h0 + rise;
      case 'tflight': return T;
      case 'tfall': return Math.sqrt(2 * (h0 + rise) / G);
      case 'range': return vx * T;
      case 'vyAt': return vyAt(timeOf(spec.t));
      case 'speedAt': return Math.hypot(vx, vyAt(timeOf(spec.t)));
      case 'tanAt': return vyAt(timeOf(spec.t)) / vx;
      case 'tAtH': return tH(spec.which);
      case 'xAtH': return vx * tH(spec.which);
      default: return NaN;
    }
  };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;
const plain = (s) => String(s).replace(/<[^>]*>/g, ' ');

export function validate(data) {
  const errs = [];
  if (!Array.isArray(data)) return ['data is not an array'];
  if (data.length !== 8) errs.push(`expected 8 questions, got ${data.length}`);
  const ids = new Set();
  for (const q of data) {
    const e = (m) => errs.push(`${q && q.id}: ${m}`);
    if (!validQuestion(q)) { e('malformed question'); continue; }
    if (ids.has(q.id)) e('duplicate id');
    ids.add(q.id);
    if (q.parts.length < 4 || q.parts.length > 6) e('needs 4-6 parts');
    for (const f of ['title', 'stem']) if (!HEB.test(q[f] || '')) e(`${f} must be Hebrew`);
    if (!q.model || !trig(q.model.ang)) { e('model.ang must be 0, 37, 53, 90 or negative of those'); continue; }
    const [s, c] = trig(q.model.ang);
    if (q.given.v0 !== q.model.v0 || (q.given.h0 || 0) !== (q.model.h0 || 0)) e('given v0/h0 differ from model');
    if (q.given.g !== G) e('g must be 10');
    if ('sin' in q.given && q.given.sin !== s) e('given.sin differs from table');
    if ('cos' in q.given && q.given.cos !== c) e('given.cos differs from table');
    if (q.model.t1 != null && q.given.t1 !== q.model.t1) e('given.t1 differs from model');
    if (q.model.H != null && q.given.H !== q.model.H) e('given.H differs from model');
    const quantity = physics(q.model);
    const seen = [];
    const vars = { ...q.given };
    const dependsOnLater = q.parts.some((p) => p.uses.length > 0);
    if (!dependsOnLater) e('no part uses an earlier part');
    for (const p of q.parts) {
      const pe = (m) => e(`part ${p.id}: ${m}`);
      if (!HEB.test(p.ask) || !HEB.test(p.solution)) pe('ask and solution must be Hebrew');
      if (COMPLEX.test(p.ask + p.solution)) pe('complex numbers are not allowed');
      if (/<script|on\w+\s*=/i.test(p.ask + p.solution)) pe('unsafe html');
      if (!DECIMAL2.test(String(p.answer))) pe(`answer ${p.answer} is not an integer or decimal with at most 2 places`);
      const truth = quantity(p.q || {});
      if (!Number.isFinite(truth)) pe('q does not name a computable quantity');
      else if (!near(truth, p.answer)) pe(`answer ${p.answer} differs from independent physics ${truth}`);
      const refs = formulaRefs(p.formula, q.parts.map((x) => x.id));
      if (refs.some((r) => !seen.includes(r))) pe('formula references a later or the same part');
      if (JSON.stringify([...refs].sort()) !== JSON.stringify([...p.uses].sort())) pe(`uses ${JSON.stringify(p.uses)} does not match formula references ${JSON.stringify(refs)}`);
      try {
        const v = evalFormula(p.formula, vars);
        if (!near(v, p.answer)) pe(`formula "${p.formula}" gives ${v}, answer is ${p.answer}`);
      } catch (x) { pe(`formula error: ${x.message}`); }
      if (!plain(p.solution).includes(String(p.answer).replace('-', '−')) && !plain(p.solution).includes(String(p.answer))) pe('solution text does not show the answer');
      // carried-forward behaviour: feeding a wrong earlier answer into the formula must be accepted as method credit
      const mine = {};
      for (const u of p.uses) mine[u] = q.parts.find((x) => x.id === u).answer + 3;
      if (p.uses.length) {
        try {
          const v = evalFormula(p.formula, { ...vars, ...mine });
          if (Number.isFinite(v) && Math.abs(v - p.answer) > 0.011) {
            const r = Math.round(v * 100) / 100;
            if (classifyPart(q, p, r, mine) !== 'carried') pe('carried-forward value is not classified as carried');
          }
        } catch (x) { /* formula domain error for the perturbed value: nothing to check */ }
      }
      if (classifyPart(q, p, p.answer) !== 'correct') pe('true answer not classified correct');
      seen.push(p.id);
      vars[p.id] = p.answer;
    }
  }
  return errs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const file = process.argv[2] || fileURLToPath(new URL('../data/multipart.json', import.meta.url));
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validate(data);
  if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
  console.log(`multipart: ${data.length} questions, ${data.reduce((n, q) => n + q.parts.length, 0)} parts verified`);
}
