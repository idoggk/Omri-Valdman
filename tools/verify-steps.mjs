// Step-transition verifier. Items carry machine-readable `lines`: an ordered list of the formulas the worked
// solution shows, in the parser syntax of tools/lib/expr.mjs, with the relation between consecutive formulas.
//
//   "lines": [ { "step": 2, "f": ["@eq", "x^2-5x-6=0", "x=6 or x=-1", "x=6"],
//                "r": ["implies", "equiv", {"t":"domain-restrict","c":"x>=2"}] } ]
//
//  f      formulas, "@eq" = the statement of the item (eq[0], or all eq joined with "and")
//  r      one relation per consecutive pair (default equiv):
//           equiv            same truth value (equations / inequalities) or same value (expressions) at every test point
//                            inside the domain
//           implies          one-way (squaring ...): earlier => later, and a later domain-restrict (root check) is required
//           domain-restrict  later = earlier AND c  (c is a condition the earlier line did not know); tested on the whole line
//  dom    optional domain statement (default: the first line is defined); case chains set it ("x>-2")
//  defs   optional substitutions {"t":"2^x"}: derived variables, computed from the others at every point
//  wrong  true = a deliberately wrong chain (recover items): the verifier must find a failing pair (at index wrongAt)
// Test points: 200 seeded random points, plus the zero set of every comparison of every line (roots of lhs - rhs
// found by scanning) so that equations and the boundaries of inequalities are really exercised.
// Usage: node tools/verify-steps.mjs [--report]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseLine, differences } from './lib/expr.mjs';
import { scanRoots } from './verify-mathhard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));

export const SOURCES = [
  { file: 'data/mathhard-rational.json', kind: 'array' },
  { file: 'data/mathhard-exponent.json', kind: 'array' },
  { file: 'data/mathhard-radical.json', kind: 'array' },
  { file: 'data/mathhard-param.json', kind: 'array' },
  { file: 'data/mathhard-circle.json', kind: 'array' },
  { file: 'data/logs-ex-1.json', kind: 'array' },
  { file: 'data/logs-ex-2.json', kind: 'array' },
  { file: 'data/logs-ex-3.json', kind: 'array' },
  { file: 'data/ladder-math.json', kind: 'ladder' },
  { file: 'data/recover.json', kind: 'array', filter: (e) => e.subject === 'math' },
  { file: 'data/writing.json', kind: 'array', filter: (e) => e.subject === 'math' },
];

export function loadItems() {
  const out = [];
  for (const s of SOURCES) {
    const j = readJson(s.file);
    const list = s.kind === 'ladder' ? j.stages.flatMap((st) => st.items) : j;
    for (const item of list) if (!s.filter || s.filter(item)) out.push({ file: s.file, item });
  }
  return out;
}

const stepList = (item) => item.steps || item.solution || item.model || [];

/* ---------- deterministic randomness ---------- */
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 2147483647, 7);

/* ---------- chain checking ---------- */
const RELS = ['equiv', 'implies', 'domain-restrict'];
const relName = (r) => (typeof r === 'string' ? r : r && r.t);

function expandFormula(f, item) {
  if (f === '@eq') return item.eq.length === 1 ? item.eq[0] : item.eq.join(' and ');
  if (/^@eq\d$/.test(f)) return item.eq[Number(f.slice(3))];
  return f;
}

function makeEnv(chain) {
  const defs = Object.entries(chain.defs || {}).map(([v, src]) => [v, parseLine(src)]);
  const withDefs = (p) => { const q = { ...p }; for (const [v, d] of defs) q[v] = d.value(q); return q; };
  return { defs, withDefs };
}

function buildChain(chain, item) {
  const errs = [];
  if (!Array.isArray(chain.f) || chain.f.length < 2) return { errs: ['a chain needs at least two formulas'] };
  const rels = chain.r || [];
  if (rels.length > chain.f.length - 1) errs.push('more relations than formula pairs');
  const parsed = [];
  chain.f.forEach((f, i) => {
    try { parsed.push(parseLine(expandFormula(f, item))); } catch (x) { errs.push(`line ${i} "${f}" cannot be parsed: ${x.message}`); }
  });
  if (errs.length) return { errs };
  const kinds = new Set(parsed.map((p) => p.kind));
  if (kinds.size > 1) errs.push('a chain mixes expressions and statements');
  const steps = [];
  for (let i = 0; i < chain.f.length - 1; i++) {
    const r = rels[i] === undefined ? 'equiv' : rels[i];
    const name = relName(r);
    if (!RELS.includes(name)) { errs.push(`pair ${i}: unknown relation ${JSON.stringify(r)}`); continue; }
    let cond = null;
    if (name === 'domain-restrict') {
      try { cond = parseLine(r.c); if (cond.kind !== 'stmt') throw new Error('condition must be a statement'); } catch (x) { errs.push(`pair ${i}: bad domain-restrict condition: ${x.message}`); }
    }
    if (name === 'implies' && kinds.has('expr')) errs.push(`pair ${i}: implies only applies to statements`);
    steps.push({ name, cond });
  }
  // an implies step (squaring ...) must be followed by an explicit root / domain check
  steps.forEach((s, i) => {
    if (s.name === 'implies' && !steps.slice(i + 1).some((t) => t.name === 'domain-restrict')) errs.push(`pair ${i}: implies step is not followed by a domain-restrict (root check) line`);
  });
  return { errs, parsed, steps, kind: [...kinds][0] };
}

function testPoints(chain, parsed, steps, item) {
  const { defs, withDefs } = makeEnv(chain);
  const derived = new Set(defs.map(([v]) => v));
  const all = new Set();
  for (const p of parsed) p.vars.forEach((v) => all.add(v));
  for (const [, d] of defs) d.vars.forEach((v) => all.add(v));
  for (const s of steps) if (s.cond) s.cond.vars.forEach((v) => all.add(v));
  let dom = null;
  if (chain.dom) { dom = parseLine(chain.dom); dom.vars.forEach((v) => all.add(v)); }
  const free = [...all].filter((v) => !derived.has(v));
  const rnd = rng(seedOf(item.id + JSON.stringify(chain.f)));
  const pts = [];
  // [-8, 8]: wide enough for every item, narrow enough that 3^-30 and 3^-25 are not both "zero"
  const randVal = () => (rnd() < 0.3 ? Math.round((rnd() * 16 - 8) * 6) / 6 : rnd() * 16 - 8);
  for (let i = 0; i < 200; i++) { const p = {}; for (const v of free) p[v] = randVal(); pts.push(p); }
  if (!free.length) pts.length = 1;
  if (dom && free.length) { // case chains: top up with rejection sampling so a narrow case still gets ~200 points
    let got = 0;
    for (let a = 0; a < 8000 && got < 200; a++) {
      const p = {}; for (const v of free) p[v] = a % 2 ? randVal() : rnd() * 60 - 30;
      if (dom.truth(withDefs(p))) { pts.push(p); got++; }
    }
  }
  // zero sets of every comparison: equation roots and inequality boundaries
  const diffs = [...parsed, ...steps.map((s) => s.cond).filter(Boolean), ...(dom ? [dom] : [])].flatMap(differences);
  const members = [...parsed, ...steps.map((s) => s.cond).filter(Boolean)].flatMap((p) => p.unions);
  for (const d of diffs) {
    for (const v of free) {
      for (let k = 0; k < 3; k++) {
        const base = {}; for (const w of free) base[w] = randVal();
        const g = (t) => d(withDefs({ ...base, [v]: t }));
        for (const r of scanRoots(g, -30, 30, 6000)) pts.push({ ...base, [v]: r });
      }
    }
  }
  for (const u of members) for (const part of u.parts) for (const e of [part.lo, part.hi]) if (Number.isFinite(e)) {
    for (const dlt of [0, 1e-3, -1e-3]) { const p = {}; for (const w of free) p[w] = randVal(); p[u.v] = e + dlt; pts.push(p); }
  }
  // values the lines state outright (x = 6, y = 1/25 ...): every combination is tested against every line,
  // which is how the isolated solutions of a system are reached
  const consts = {};
  for (const p of [...parsed, ...steps.map((s) => s.cond).filter(Boolean), ...(dom ? [dom] : [])]) {
    for (const rel of p.rels) for (let i = 0; i + 1 < rel.sides.length; i++) {
      for (const [a, b] of [[rel.sides[i], rel.sides[i + 1]], [rel.sides[i + 1], rel.sides[i]]]) {
        const name = a.text.replace(/\s+/g, '');
        if (/^[a-z]$/.test(name) && !derived.has(name) && b.vars.size === 0) {
          const val = b.fn({});
          if (Number.isFinite(val)) (consts[name] = consts[name] || new Set()).add(val);
        }
      }
    }
  }
  const names = Object.keys(consts);
  let combos = [{}];
  for (const n of names) combos = combos.flatMap((c) => [...consts[n]].slice(0, 6).map((v) => ({ ...c, [n]: v }))).slice(0, 80);
  if (names.length) for (const c of combos) for (let k = 0; k < 2; k++) { const p = {}; for (const w of free) p[w] = c[w] !== undefined ? c[w] : randVal(); pts.push(p); }
  const full = pts.map(withDefs);
  const inDom = (p) => (dom ? dom.truth(p) : parsed[0].kind === 'expr' ? Number.isFinite(parsed[0].value(p)) : parsed[0].rels.every((r) => r.sides.every((sd) => Number.isFinite(sd.fn(p)))));
  return { full, inDom, free: free.length };
}

const near = (a, b) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b));
const fmt = (p) => JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6])));

/** Returns { pairs: [{index, message}] } listing the failing pairs of one chain, plus structural errors. */
export function runChain(chain, item) {
  const built = buildChain(chain, item);
  if (built.errs.length) return { structural: built.errs, failures: [] };
  const { parsed, steps, kind } = built;
  const { full, inDom, free } = testPoints(chain, parsed, steps, item);
  const domPts = full.filter(inDom);
  const failures = [];
  const structural = [];
  if (domPts.length < (free ? 20 : 1)) structural.push(`only ${domPts.length} test points inside the domain`);
  const check = (i, a, b, name, cond) => {
    const pool = name === 'domain-restrict' ? full : domPts;
    for (const p of pool) {
      if (kind === 'expr') {
        const va = a.value(p); const vb = b.value(p);
        if (!Number.isFinite(va)) continue;
        if (!Number.isFinite(vb) || !near(va, vb)) return `"${a.text}" = ${va} but "${b.text}" = ${vb} at ${fmt(p)}`;
        continue;
      }
      const ta = a.truth(p); const tb = b.truth(p);
      if (name === 'equiv' && ta !== tb) return `"${a.text}" is ${ta} but "${b.text}" is ${tb} at ${fmt(p)}: different solution sets`;
      if (name === 'implies' && ta && !tb) return `"${a.text}" holds but "${b.text}" does not at ${fmt(p)}: not a valid consequence`;
      if (name === 'domain-restrict' && tb !== (ta && cond.truth(p))) return `"${b.text}" is ${tb} but ("${a.text}" and "${cond.text}") is ${ta && cond.truth(p)} at ${fmt(p)}`;
    }
    return null;
  };
  steps.forEach((s, i) => {
    const m = check(i, parsed[i], parsed[i + 1], s.name, s.cond);
    if (m) failures.push({ index: i, message: `pair ${i}→${i + 1} (${s.name}): ${m}` });
  });
  // end to end: a chain that starts at the statement of the item must still describe the same solution set
  if (!failures.length && /^@eq/.test(chain.f[0]) && kind === 'stmt') {
    const m = check(-1, parsed[0], parsed[parsed.length - 1], 'equiv', null);
    if (m) failures.push({ index: -1, message: `end to end: ${m}` });
  }
  return { structural, failures };
}

/** Errors of one item (strings). */
export function verifyItem(item) {
  const errs = [];
  const err = (m) => errs.push(`${item.id}: ${m}`);
  if (!Array.isArray(item.lines) || !item.lines.length) return errs;
  const n = stepList(item).length;
  item.lines.forEach((chain, ci) => {
    const at = `lines[${ci}]`;
    if (chain.step !== undefined && !(Number.isInteger(chain.step) && chain.step >= 0 && (n === 0 || chain.step < n))) err(`${at}: step ${chain.step} is outside the ${n} stored steps`);
    let res;
    try { res = runChain(chain, item); } catch (x) { err(`${at}: verifier crashed: ${x.message}`); return; }
    res.structural.forEach((m) => err(`${at}: ${m}`));
    if (chain.wrong) {
      if (!res.failures.length && !res.structural.length) err(`${at}: planted error was not detected`);
      else if (chain.wrongAt !== undefined && res.failures[0] && res.failures[0].index !== chain.wrongAt) err(`${at}: first failing pair is ${res.failures[0].index}, expected ${chain.wrongAt}`);
    } else res.failures.forEach((f) => err(`${at} (step ${chain.step}): ${f.message}`));
  });
  return errs;
}

export function loadSkips() { return readJson('tools/steps-skip.json'); }

/** Verifies all stored lines and builds the coverage report. */
export function verifyAll(entries = loadItems()) {
  const errors = [];
  const withLines = [];
  const skipped = [];
  const skips = loadSkips();
  const byFile = {};
  for (const { file, item } of entries) {
    byFile[file] = byFile[file] || { total: 0, covered: 0 };
    byFile[file].total++;
    if (Array.isArray(item.lines) && item.lines.length) {
      byFile[file].covered++;
      withLines.push(item.id);
      errors.push(...verifyItem(item));
    } else skipped.push({ id: item.id, file, reason: skips[item.id] || skips[`default:${file}`] || 'no lines yet' });
  }
  return { errors, withLines, skipped, byFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, withLines, skipped, byFile } = verifyAll();
  console.log(`steps: ${withLines.length} items with verified lines (${Date.now() - t0} ms)`);
  for (const [f, c] of Object.entries(byFile)) console.log(`  ${f}: ${c.covered}/${c.total}`);
  if (process.argv.includes('--report')) {
    console.log(`skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s.id} (${s.file}): ${s.reason}`);
  } else console.log(`  ${skipped.length} items skipped (node tools/verify-steps.mjs --report lists them with the reason)`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every consecutive pair of displayed lines checks out.');
}
