// Verifies data/math.json: exact rational Gaussian elimination, no dependencies.
// Usage: node tools/verify-math.mjs [path-to-json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const abs = (a) => (a < 0n ? -a : a);
const gcd = (a, b) => {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

export class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('zero denominator');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { return new Frac(this.n * o.d, this.d * o.n); }
  isZero() { return this.n === 0n; }
  equals(o) { return this.n === o.n && this.d === o.d; }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
}

// Accepts integers, "p/q" strings and plain decimal strings ("2.5").
export function parseFrac(v) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`bad number ${v}`);
    v = String(v);
  }
  if (typeof v !== 'string') throw new Error(`bad value ${JSON.stringify(v)}`);
  const s = v.trim();
  let m;
  if ((m = /^([+-]?\d+)\/(\d+)$/.exec(s))) return new Frac(BigInt(m[1]), BigInt(m[2]));
  if ((m = /^([+-]?)(\d+)\.(\d+)$/.exec(s))) {
    const sign = m[1] === '-' ? -1n : 1n;
    return new Frac(sign * BigInt(m[2] + m[3]), 10n ** BigInt(m[3].length));
  }
  if (/^[+-]?\d+$/.test(s)) return new Frac(BigInt(s));
  throw new Error(`cannot parse number "${v}"`);
}

// rows: augmented matrix, each row has n coefficients then the right-hand side.
// Returns { kind: 'unique'|'none'|'infinite', solution: Frac[]|null, rank }.
export function solveSystem(rows, n = rows[0].length - 1) {
  const m = rows.map((r) => {
    if (r.length !== n + 1) throw new Error(`row has ${r.length} entries, expected ${n + 1}`);
    return r.map(parseFrac);
  });
  let r = 0;
  const pivots = [];
  for (let c = 0; c < n && r < m.length; c++) {
    let p = r;
    while (p < m.length && m[p][c].isZero()) p++;
    if (p === m.length) continue;
    [m[r], m[p]] = [m[p], m[r]];
    const pv = m[r][c];
    m[r] = m[r].map((x) => x.div(pv));
    for (let i = 0; i < m.length; i++) {
      if (i === r || m[i][c].isZero()) continue;
      const f = m[i][c];
      m[i] = m[i].map((x, j) => x.sub(f.mul(m[r][j])));
    }
    pivots.push(c);
    r++;
  }
  for (let i = r; i < m.length; i++) {
    if (!m[i][n].isZero()) return { kind: 'none', solution: null, rank: r };
  }
  if (r === n) return { kind: 'unique', solution: pivots.map((c, i) => m[i][n]), rank: r };
  return { kind: 'infinite', solution: null, rank: r };
}

const HEB = /[֐-׿]/;
const KIND_OPTION = { none: 'אין פתרון', unique: 'פתרון יחיד', infinite: 'אינסוף פתרונות' };

function numberAppears(text, value) {
  return new RegExp(`(?<![\\d.])${value}(?!\\d)`).test(text);
}

export function validate(data) {
  const errors = [];
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  if (!Array.isArray(data)) return ['top level must be an array'];
  const seen = new Set();
  const counts = {};
  for (const [idx, ex] of data.entries()) {
    const id = ex && ex.id ? ex.id : `#${idx}`;
    if (!ex || typeof ex !== 'object') { err(id, 'not an object'); continue; }
    if (seen.has(ex.id)) err(id, 'duplicate id');
    seen.add(ex.id);
    if (ex.topic !== 'math-3' && ex.topic !== 'math-4') { err(id, `bad topic ${ex.topic}`); continue; }
    counts[ex.topic] = (counts[ex.topic] || 0) + 1;
    const n = ex.topic === 'math-3' ? 3 : 4;
    if (!new RegExp(`^${ex.topic}-\\d{3}$`).test(ex.id)) err(id, 'id must look like math-3-001');
    if (![1, 2, 3].includes(ex.level)) err(id, 'level must be 1, 2 or 3');
    for (const f of ['title', 'statement']) {
      if (typeof ex[f] !== 'string' || !ex[f].trim()) err(id, `${f} empty`);
      else if (!HEB.test(ex[f])) err(id, `${f} has no Hebrew`);
    }
    if (!Array.isArray(ex.tips) || ex.tips.length !== 3) err(id, 'tips must have exactly 3 entries');
    else ex.tips.forEach((t, i) => { if (typeof t !== 'string' || !HEB.test(t)) err(id, `tip ${i + 1} empty or not Hebrew`); });
    if (!Array.isArray(ex.solution) || ex.solution.length < 3) err(id, 'solution needs at least 3 steps');
    else ex.solution.forEach((t, i) => { if (typeof t !== 'string' || !HEB.test(t)) err(id, `solution step ${i + 1} empty or not Hebrew`); });

    const COMPLEX = /sqrt\(\s*-|(?<![A-Za-z])i(?![A-Za-z])|imaginary|complex|מרוכב|דמיוני/i;
    const strings = [ex.title, ex.statement, ...(ex.tips || []), ...(ex.solution || []), ...(ex.inputs || []).flatMap((x) => [x.label, x.answer])];
    for (const s of strings) if (typeof s === 'string' && COMPLEX.test(s.replace(/<[^>]*>/g, ' '))) err(id, `complex/imaginary text found: "${s.slice(0, 40)}"`);
    for (const inp of ex.inputs || []) {
      if (/^-?\d+(\.\d{1,2})?$/.test(String(inp.answer))) continue;
      if (ex.verify && ex.verify.kind === 'unique') continue; // reported with detail below
      err(id, `answer "${inp.answer}" must be an integer or a decimal with at most 2 decimal places`);
    }

    const v = ex.verify;
    if (!v || !Array.isArray(v.system) || !['unique', 'none', 'infinite'].includes(v.kind)) {
      err(id, 'verify.system / verify.kind missing or invalid');
      continue;
    }
    if (v.system.length !== n) err(id, `system must have ${n} equations`);
    let res;
    try {
      res = solveSystem(v.system, n);
    } catch (e) {
      err(id, `verify.system invalid: ${e.message}`);
      continue;
    }
    if (res.kind !== v.kind) err(id, `declared kind "${v.kind}" but the system is "${res.kind}"`);

    const hasInputs = Array.isArray(ex.inputs) && ex.inputs.length > 0;
    if (hasInputs === !!ex.choice) err(id, 'exactly one of inputs / choice is required');
    if (hasInputs) {
      ex.inputs.forEach((inp, i) => {
        if (!inp || typeof inp.label !== 'string' || !inp.label.trim()) err(id, `input ${i + 1} label empty`);
        if (typeof inp.unit !== 'string') err(id, `input ${i + 1} unit must be a string`);
        if (typeof inp.tolerance !== 'number' || !(inp.tolerance > 0)) err(id, `input ${i + 1} tolerance must be > 0`);
      });
      if (v.kind === 'unique' && res.kind === 'unique') {
        if (ex.inputs.length !== n) err(id, `unique system needs ${n} inputs`);
        else ex.inputs.forEach((inp, i) => {
          try {
            if (!/^-?\d+(\.\d{1,2})?$/.test(String(inp.answer))) {
              err(id, `input ${i + 1} answer "${inp.answer}" must be an integer or a decimal with at most 2 decimal places`);
            }
            if (!parseFrac(inp.answer).equals(res.solution[i])) {
              err(id, `input ${i + 1} answer "${inp.answer}" but exact solution is ${res.solution[i]}`);
            }
          } catch (e) { err(id, `input ${i + 1}: ${e.message}`); }
        });
      }
    }
    if (ex.choice) {
      const c = ex.choice;
      if (!Array.isArray(c.options) || c.options.length < 2 || !Number.isInteger(c.correct) || !c.options[c.correct]) {
        err(id, 'choice malformed');
      } else if (c.options[c.correct] !== KIND_OPTION[res.kind]) {
        err(id, `choice marks "${c.options[c.correct]}" but system is "${res.kind}"`);
      }
    }

    // Sanity: coefficients of a direct (non word-problem) system appear in the statement.
    if (typeof ex.statement === 'string') {
      const text = ex.statement.replace(/<[^>]*>/g, ' ');
      const direct = (text.match(/=/g) || []).length >= v.system.length;
      const hasParam = /(?<![A-Za-z])[kt](?![A-Za-z])/.test(text);
      if (direct && !hasParam) {
        for (const row of v.system) {
          for (const cell of row) {
            let f;
            try { f = parseFrac(cell); } catch { continue; }
            if (f.isZero()) continue;
            const nums = f.d === 1n ? [abs(f.n)] : [abs(f.n), f.d];
            for (const x of nums) {
              if (x !== 1n && !numberAppears(text, x)) err(id, `number ${x} from verify.system does not appear in the statement`);
            }
          }
        }
      }
    }
  }
  for (const t of ['math-3', 'math-4']) {
    if (counts[t] !== 12) errors.push(`${t}: expected 12 exercises, found ${counts[t] || 0}`);
  }
  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'math.json');
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`FAIL: cannot read/parse ${file}: ${e.message}`);
    process.exit(1);
  }
  const errors = validate(data);
  if (errors.length) {
    console.error(`FAIL: ${errors.length} problem(s)`);
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  console.log(`OK: ${data.length} exercises verified`);
}
