// Small safe statement parser for the step-transition verifier (tools/verify-steps.mjs).
// Expressions are parsed by the app's own parser (compileExpr in js/mathhard.js: numbers, single-letter variables,
// + - * / ^, sqrt, cbrt, abs, |x|, log(base;arg)); this module adds the syntax the stored lines use:
//   log_2(x), log_(1/2)(x), log_x(5), lg(x) = log10, ln(x)
//   relations and chains:  a = b, a <= b < c, a != b   (also ≤ ≥ ≠)
//   statements:            "x = 1 or x = 2", "x > 0 and x != 1", "x in (-inf,-1) U [1/2,2)", "true", "false"
// Nothing is evaluated with eval/Function: every expression goes through the tokenising parser.
import { compileExpr, parseIntervals, normUnion, inUnion, EPS } from '../../js/mathhard.js';

const E = '2.718281828459045';

/** Rewrites the log notations of the stored lines into the app parser's log(base;arg). */
export function prep(src) {
  let s = String(src).replace(/\s+/g, '');
  for (let guard = 0; guard < 50; guard++) {
    const i = s.indexOf('log_');
    if (i < 0) break;
    let j = i + 4;
    let base;
    if (s[j] === '(') {
      let depth = 0;
      let k = j;
      for (; k < s.length; k++) { if (s[k] === '(') depth++; else if (s[k] === ')') { depth--; if (depth === 0) break; } }
      if (depth !== 0) throw new Error(`unbalanced log base in "${src}"`);
      base = s.slice(j + 1, k);
      j = k + 1;
    } else {
      const m = /^(\d+\.?\d*|[a-z])/.exec(s.slice(j));
      if (!m) throw new Error(`bad log base in "${src}"`);
      base = m[1];
      j += m[1].length;
    }
    if (s[j] !== '(') throw new Error(`log base must be followed by ( in "${src}"`);
    s = `${s.slice(0, i)}log(${base};${s.slice(j + 1)}`;
  }
  return s.replace(/(?<![a-z])lg\(/g, 'log(10;').replace(/(?<![a-z])ln\(/g, `log(${E};`);
}

const VAR_NOISE = /sqrt|cbrt|abs|log/g;
/** Variables used in an expression string (after prep). */
export function varsOf(prepared) {
  return new Set((prepared.replace(VAR_NOISE, '').match(/[a-z]/g)) || []);
}

function compileSide(text) {
  const p = prep(text);
  return { fn: compileExpr(p), vars: varsOf(p), text };
}

function parseChain(text) {
  const parts = String(text).replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=').split(/(<=|>=|!=|<|>|=)/);
  const sides = [];
  const ops = [];
  parts.forEach((x, i) => { if (i % 2) ops.push(x); else sides.push(compileSide(x)); });
  return { sides, ops };
}

function chainTruth(rel, vars) {
  const vals = rel.sides.map((s) => s.fn(vars));
  if (!vals.every(Number.isFinite)) return false;
  return rel.ops.every((op, i) => {
    const a = vals[i];
    const b = vals[i + 1];
    // relative tolerance (an absolute one would call 3^-22 and 3^-28 equal), with a small floor for values near zero
    const tol = EPS * Math.max(Math.abs(a), Math.abs(b), 1e-4);
    if (op === '=') return Math.abs(a - b) <= tol;
    if (op === '!=') return Math.abs(a - b) > tol;
    if (op === '<=') return a <= b + tol;
    if (op === '>=') return a >= b - tol;
    if (op === '<') return a < b - tol;
    return a > b + tol;
  });
}

/**
 * Parses one stored line.
 *  - an expression (no relation sign): { kind:'expr', value(vars) }
 *  - a statement: { kind:'stmt', truth(vars), rels (every comparison, for root finding), unions (membership endpoints) }
 */
export function parseLine(text) {
  const raw = String(text).trim();
  if (!raw) throw new Error('empty line');
  if (!/[<>=≤≥≠]| in |^true$|^false$/.test(raw)) {
    const side = compileSide(raw);
    return { kind: 'expr', text: raw, vars: side.vars, value: side.fn, rels: [], unions: [] };
  }
  const vars = new Set();
  const rels = [];
  const unions = [];
  const clauses = raw.split(/\s+or\s+/).map((orPart) => orPart.split(/\s+and\s+/).map((c) => {
    const t = c.trim();
    if (t === 'true') return () => true;
    if (t === 'false') return () => false;
    const mem = /^([a-z])\s+in\s+(.+)$/.exec(t);
    if (mem) {
      const v = mem[1];
      const parts = normUnion(parseIntervals(mem[2].replace(/∪/g, 'U')));
      vars.add(v);
      unions.push({ v, parts });
      return (p) => Number.isFinite(p[v]) && inUnion(parts, p[v]);
    }
    const rel = parseChain(t);
    if (!rel.ops.length) throw new Error(`no relation in clause "${t}"`);
    rel.sides.forEach((s) => s.vars.forEach((v) => vars.add(v)));
    rels.push(rel);
    return (p) => chainTruth(rel, p);
  }));
  const truth = (p) => clauses.some((ands) => ands.every((f) => f(p)));
  return { kind: 'stmt', text: raw, vars, truth, rels, unions };
}

/** (lhs - rhs) closures of every comparison of a parsed statement: the zero sets used as test points. */
export function differences(parsed) {
  const out = [];
  for (const rel of parsed.rels) for (let i = 0; i + 1 < rel.sides.length; i++) out.push((p) => rel.sides[i].fn(p) - rel.sides[i + 1].fn(p));
  return out;
}
