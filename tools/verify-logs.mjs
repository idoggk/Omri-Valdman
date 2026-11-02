// Independent numeric verifier for the logarithm course (data/logs-*.json). It never trusts a stored answer or domain:
//  - the displayed statement (eq[0]) is parsed by the same parser the app uses and solved by brute force:
//    equations by scanning for sign changes (scanRoots), inequalities and domains by dense sampling around every endpoint
//    (including the endpoints themselves, for open / closed brackets), parameter problems by counting real roots for many
//    values of the parameter, systems by a multi-start 2D Newton search.
//  - lesson examples and quiz items go through the same checks; rules / cards / derivation steps are checked as identities
//    at many random points (positives; negatives too where the rule claims it); listed "counter" statements must really fail.
//  - extraneous roots named in a trap must really fail the original statement; typical wrong answers must differ from the answer.
// Usage: node tools/verify-logs.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  holds, parseIntervals, normUnion, inUnion, canonSpec, sameCanon, evalExact,
} from '../js/mathhard.js';
import { scanRoots } from './verify-mathhard.mjs';
import { compileLog, parseLogRel, DATA_FILES, TIERS } from '../js/logs.js';

const HEB = /[֐-׿]/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fin = Number.isFinite;
const RANGE = { lo: -60, hi: 200 }; // default scan window; an item can override it with check.lo / check.hi
const close = (x, y, t = 1e-6) => fin(x) && fin(y) && Math.abs(x - y) <= t * (1 + Math.abs(x) + Math.abs(y));

export function loadAll() {
  const [first, ...rest] = DATA_FILES.map((f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')));
  return { lessons: first.lessons, cards: first.cards, exercises: rest.flat() };
}

/* ---------- sampling helpers ---------- */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** x-values to test: dense offset grid, small integers / halves / thirds (poles), and the neighbourhood of each endpoint. */
function samplePoints(lo, hi, ends, n = 6000) {
  const pts = [];
  const step = (hi - lo) / n;
  for (let i = 0; i <= n; i++) pts.push(lo + step * 0.3141592 + i * step);
  for (let k = Math.ceil(lo * 6); k <= Math.floor(hi * 6); k++) pts.push(k / 6 + 1e-7 * 0, k / 6);
  for (const e of ends) if (fin(e)) for (const d of [0, 1e-5, -1e-5, 1e-3, -1e-3, 0.0371, -0.0371]) pts.push(e + d);
  return pts.filter((x) => x >= lo - 1 && x <= hi + 1);
}

const endpointsOf = (parts) => parts.flatMap((p) => [p.lo, p.hi]).filter(fin);

/** Compares a predicate against an interval answer at every sample; returns an error text or null. */
function compareSet(pred, parts, lo, hi, extraEnds = []) {
  const all = [...endpointsOf(parts), ...extraEnds];
  const pts = samplePoints(lo, hi, all);
  for (const x of pts) {
    // points a hair away from an endpoint (bisection residue) are inconclusive: only the exact endpoint and clear neighbours count
    if (all.some((e) => x !== e && Math.abs(x - e) < 1e-7)) continue;
    const want = inUnion(parts, x);
    const got = pred(x);
    if (want !== got) return `mismatch at x = ${x}: statement ${got ? 'holds' : 'fails'} but the answer says ${want ? 'inside' : 'outside'}`;
  }
  return null;
}

function relEnds(rel, lo, hi) {
  // domain edges of a relation, found by bisection between defined and undefined neighbours on a coarse grid
  const def = (x) => rel.sides.every((f) => fin(f({ x })));
  const out = [];
  const N = 4000;
  const step = (hi - lo) / N;
  let prev = lo + step * 0.1234;
  for (let i = 1; i <= N; i++) {
    const x = lo + step * 0.1234 + i * step;
    if (def(prev) !== def(x)) {
      let d = def(prev) ? prev : x; let u = def(prev) ? x : prev;
      for (let k = 0; k < 70; k++) { const m = (d + u) / 2; if (def(m)) d = m; else u = m; }
      out.push(d);
    }
    prev = x;
  }
  return out;
}

const mostlyHebrew = (steps) => steps.filter((s) => HEB.test(s)).length >= Math.ceil(steps.length / 2);
const parts = (a) => normUnion(parseIntervals(a.text));
const hasDec3 = (s) => /\d+\.\d{3,}/.test(s);

/* ---------- checks ---------- */
function checkValue(c, ans, id, err) {
  const v = compileLog(c.expr)({});
  if (!fin(v)) return err(`${id}: value expression is undefined`);
  const want = canonSpec(ans);
  if (want.kind !== 'number') return err(`${id}: value check needs a number answer`);
  if (!close(v, want.vals[0], 1e-9)) err(`${id}: value ${v} != answer ${want.vals[0]}`);
}

function checkSolve(c, ans, id, err, relText) {
  const rel = parseLogRel(c.rel || relText);
  if (rel.ops.length !== 1 || rel.ops[0] !== '=') return err(`${id}: solve check needs one equation`);
  const [L, R] = rel.sides;
  const roots = scanRoots((x) => L({ x }) - R({ x }), c.lo ?? RANGE.lo, c.hi ?? RANGE.hi, c.N ?? 200000);
  const want = canonSpec(ans);
  if (want.kind !== 'set' && want.kind !== 'number') return err(`${id}: solve check needs a set / number answer`);
  const exp = want.vals;
  if (roots.length !== exp.length || !exp.every((v, i) => close(v, roots[i], 1e-5))) err(`${id}: scanned roots [${roots.map((r) => +r.toFixed(6))}] != answer [${exp.map((r) => +r.toFixed(6))}]`);
  return rel;
}

function checkIneq(c, ans, id, err, relText) {
  const rel = parseLogRel(c.rel || relText);
  if (!rel.ops.every((o) => o !== '=')) return err(`${id}: ineq check needs inequalities`);
  const want = canonSpec(ans);
  if (want.kind !== 'interval') return err(`${id}: ineq check needs an interval answer`);
  const lo = c.lo ?? RANGE.lo;
  const hi = c.hi ?? RANGE.hi;
  const e = compareSet((x) => holds(rel, { x }), want.parts, lo, hi, relEnds(rel, lo, hi));
  if (e) err(`${id}: ${e}`);
  return rel;
}

function checkDomain(c, ans, id, err, exprText) {
  const f = compileLog(c.expr || exprText);
  const want = canonSpec(ans);
  if (want.kind !== 'interval') return err(`${id}: domain check needs an interval answer`);
  const lo = c.lo ?? RANGE.lo;
  const hi = c.hi ?? RANGE.hi;
  const e = compareSet((x) => fin(f({ x })), want.parts, lo, hi, relEnds({ sides: [f] }, lo, hi));
  if (e) err(`${id}: ${e}`);
}

const COND = /^(==|>=|<=|>|<)(\d+)$/;
function checkParam(c, ans, id, err, relText) {
  const rel = parseLogRel(c.rel || relText);
  const [L, R] = rel.sides;
  const m = COND.exec(c.cond || '');
  if (!m) return err(`${id}: param check needs cond like "==2"`);
  const k = Number(m[2]);
  const test = { '==': (n) => n === k, '>=': (n) => n >= k, '<=': (n) => n <= k, '>': (n) => n > k, '<': (n) => n < k }[m[1]];
  const want = canonSpec(ans);
  const p = c.param || 'm';
  const pts = want.kind === 'interval' ? want.parts : null;
  const vals = want.kind === 'set' || want.kind === 'number' ? want.vals : null;
  const ends = pts ? endpointsOf(pts) : vals;
  const grid = [];
  for (let i = 0; i <= 160; i++) grid.push(c.mlo + ((c.mhi - c.mlo) * (i + 0.37)) / 161);
  for (let q = Math.ceil(c.mlo * 4); q <= Math.floor(c.mhi * 4); q++) grid.push(q / 4);
  for (const e of ends) for (const d of [0, 1e-3, -1e-3, 0.013, -0.013]) grid.push(e + d);
  for (const mv of grid) {
    const n = scanRoots((x) => L({ x, [p]: mv }) - R({ x, [p]: mv }), c.xlo, c.xhi, c.N ?? 20000).length;
    const got = test(n);
    const exp = pts ? inUnion(pts, mv) : vals.some((v) => close(v, mv, 1e-9));
    if (got !== exp) return err(`${id}: at ${p} = ${mv} the equation has ${n} roots; condition ${c.cond} is ${got} but the answer says ${exp}`);
  }
}

function newtonSystem(g1, g2, starts) {
  const found = [];
  const fnv = (x, y) => [g1({ x, y }), g2({ x, y })];
  for (const [x0, y0] of starts) {
    let x = x0; let y = y0;
    let ok = false;
    for (let it = 0; it < 80; it++) {
      const [f1, f2] = fnv(x, y);
      if (!fin(f1) || !fin(f2)) break;
      if (Math.abs(f1) + Math.abs(f2) < 1e-12) { ok = true; break; }
      const hx = 1e-7 * (1 + Math.abs(x));
      const hy = 1e-7 * (1 + Math.abs(y));
      const [a1, a2] = fnv(x + hx, y); const [b1, b2] = fnv(x - hx, y);
      const [c1, c2] = fnv(x, y + hy); const [d1, d2] = fnv(x, y - hy);
      const j11 = (a1 - b1) / (2 * hx); const j21 = (a2 - b2) / (2 * hx);
      const j12 = (c1 - d1) / (2 * hy); const j22 = (c2 - d2) / (2 * hy);
      const det = j11 * j22 - j12 * j21;
      if (!fin(det) || Math.abs(det) < 1e-14) break;
      let dx = (f1 * j22 - f2 * j12) / det;
      let dy = (j11 * f2 - j21 * f1) / det;
      const sz = Math.max(Math.abs(dx) / (1 + Math.abs(x)), Math.abs(dy) / (1 + Math.abs(y)));
      if (sz > 0.5) { dx *= 0.5 / sz; dy *= 0.5 / sz; }
      x -= dx; y -= dy;
    }
    if (ok && !found.some(([a, b]) => close(a, x, 1e-6) && close(b, y, 1e-6))) found.push([x, y]);
  }
  return found;
}

function checkSystem(c, ans, id, err) {
  const rels = c.rels.map(parseLogRel);
  if (rels.some((r) => r.ops.length !== 1 || r.ops[0] !== '=')) return err(`${id}: system needs equations`);
  const g = rels.map((r) => (v) => r.sides[0](v) - r.sides[1](v));
  const want = canonSpec(ans);
  if (want.kind !== 'points') return err(`${id}: system check needs a points answer`);
  for (const [x, y] of want.pts) if (!rels.every((r) => holds(r, { x, y }))) err(`${id}: answer point (${x}, ${y}) does not satisfy the system`);
  const axis = [];
  for (let e = -2; e <= 2.2; e += 0.2) { const v = 10 ** e; axis.push(v, -v); }
  const starts = [];
  for (const x of axis) for (const y of axis) starts.push([x, y]);
  const found = newtonSystem(g[0], g[1], starts).filter(([x, y]) => rels.every((r) => holds(r, { x, y })));
  const miss = want.pts.filter(([x, y]) => !found.some(([a, b]) => close(a, x) && close(b, y)));
  const extra = found.filter(([a, b]) => !want.pts.some(([x, y]) => close(a, x) && close(b, y)));
  if (miss.length || extra.length) err(`${id}: search found ${JSON.stringify(found.map((p) => p.map((v) => +v.toFixed(6))))}, answer ${JSON.stringify(want.pts.map((p) => p.map((v) => +v.toFixed(6))))}`);
}

/** Verifies one record { eq, domain?, answer, check, trap?, wrongs? } of an exercise or a lesson example. */
export function verifyItem(it, err) {
  const id = it.id || it.title;
  const c = it.check;
  const first = it.eq && it.eq[0];
  let rel = null;
  try {
    if (c.type === 'value') checkValue({ ...c, expr: c.expr || String(first).split('=').slice(1).join('=') }, it.answer, id, err);
    else if (c.type === 'solve') rel = checkSolve(c, it.answer, id, err, first);
    else if (c.type === 'ineq') rel = checkIneq(c, it.answer, id, err, first);
    else if (c.type === 'domain') checkDomain(c, it.answer, id, err, String(first).split('=').slice(1).join('='));
    else if (c.type === 'param') checkParam(c, it.answer, id, err, first);
    else if (c.type === 'system') checkSystem(c, it.answer, id, err);
  } catch (x) { err(`${id}: check crashed: ${x.message}`); return; }
  // domain step
  if (it.domain) {
    try {
      const dp = parts({ text: it.domain.set });
      if (rel) {
        const lo = c.lo ?? RANGE.lo;
        const hi = c.hi ?? RANGE.hi;
        const e = compareSet((x) => rel.sides.every((f) => fin(f({ x }))), dp, lo, hi, relEnds(rel, lo, hi));
        if (e) err(`${id}: domain ${it.domain.set}: ${e}`);
      } else if (c.type === 'domain' || c.type === 'value' || c.type === 'param' || c.type === 'system') {
        void dp; // free-form domain text for these types; the answer itself is checked above
      }
    } catch (x) { err(`${id}: bad domain set: ${x.message}`); }
  } else if (c.type === 'solve' || c.type === 'ineq') err(`${id}: solve / ineq items need a domain step`);
  // extraneous roots named by the trap must fail the original statement
  if (it.trap && Array.isArray(it.trap.extraneous) && rel) {
    for (const v of it.trap.extraneous) { const x = evalExact(v); if (holds(rel, { x })) err(`${id}: trap value ${v} actually satisfies the statement`); }
  }
  // typical wrong answers differ from the answer, and are well-formed
  try {
    const want = canonSpec(it.answer);
    for (const w of it.wrongs || []) {
      if (sameCanon(canonSpec(w.answer), want)) err(`${id}: a typical wrong answer equals the right answer`);
      if (!HEB.test(w.msg || '')) err(`${id}: wrong-answer message must be Hebrew`);
    }
  } catch (x) { err(`${id}: bad answer spec: ${x.message}`); }
  const strs = JSON.stringify(it.answer);
  if (hasDec3(strs)) err(`${id}: answer has a decimal longer than 2 digits`);
}

/* ---------- identities ---------- */
function randomVars(r, names, neg) {
  const pool = [0.2, 0.5, 1.5, 2, 3, 4, 5, 6, 7, 9, 10, 0.3, 8, 2.5];
  const v = {};
  for (const n of names) {
    v[n] = pool[Math.floor(r() * pool.length)];
    if (neg && n === 'x' && r() < 0.5) v[n] = -v[n];
  }
  return v;
}

export function identityHolds(chain, neg = false, seed = 7) {
  const sides = String(chain).split('=').map((s) => s.trim());
  if (sides.length < 2) return { ok: false, why: 'not an equation' };
  const fns = sides.map((s) => compileLog(s));
  const names = [...new Set(String(chain).replace(/log_|lg|ln|abs|sqrt|cbrt/g, ' ').match(/[a-z]/g) || [])];
  const r = rng(seed);
  let used = 0;
  for (let i = 0; i < 80; i++) {
    const v = randomVars(r, names, neg);
    const vals = fns.map((f) => f(v));
    if (vals.some(fin) && !vals.every(fin)) return { ok: false, why: `one side is undefined at ${JSON.stringify(v)}: ${vals}` };
    if (!vals.every(fin)) continue;
    used++;
    if (!vals.every((q) => close(q, vals[0], 1e-9))) return { ok: false, why: `differs at ${JSON.stringify(v)}: ${vals}` };
  }
  return used >= 25 ? { ok: true } : { ok: false, why: `only ${used} usable samples` };
}

function counterFails(eq, at) {
  const sides = String(eq).split('=').map((s) => s.trim());
  const vals = sides.map((s) => compileLog(s)(at));
  return !(vals.every(fin) && vals.every((q) => close(q, vals[0], 1e-9)));
}

/* ---------- quiz ---------- */
function verifyQuiz(q, id, err) {
  if (!Array.isArray(q.options) || q.options.length < 2 || !Number.isInteger(q.ans) || q.ans < 0 || q.ans >= q.options.length) return err(`${id}: bad quiz options`);
  if (!HEB.test(q.q)) err(`${id}: quiz text must be Hebrew`);
  if (q.defined) {
    const d = fin(compileLog(q.defined)({}));
    if (q.options[q.ans] !== (d ? 'מוגדר' : 'לא מוגדר')) err(`${id}: quiz "defined" answer is wrong (${q.defined} is ${d ? '' : 'not '}defined)`);
    return;
  }
  if (q.ineq) { // options are intervals: exactly the marked one equals the solution set of the inequality
    const rel = parseLogRel(q.ineq);
    if (!Array.isArray(q.intervals) || q.intervals.length !== q.options.length) return err(`${id}: quiz needs machine intervals for every option`);
    q.intervals.forEach((t, i) => {
      const e = compareSet((x) => holds(rel, { x }), parts({ text: t }), RANGE.lo, RANGE.hi, relEnds(rel, RANGE.lo, RANGE.hi));
      if ((e === null) !== (i === q.ans)) err(`${id}: option ${t} is ${e === null ? 'correct' : 'wrong'} but ans = ${q.ans}`);
    });
    return;
  }
  let target;
  if (q.value) target = compileLog(q.value)({});
  else if (q.rel) {
    const rel = parseLogRel(q.rel);
    const roots = scanRoots((x) => rel.sides[0]({ x }) - rel.sides[1]({ x }), q.lo ?? RANGE.lo, q.hi ?? RANGE.hi, 100000);
    if (roots.length !== 1) return err(`${id}: quiz equation has ${roots.length} roots, expected exactly 1`);
    target = roots[0];
  } else return err(`${id}: quiz needs value, rel or defined`);
  const nums = q.options.map((o) => { try { return evalExact(o); } catch (x) { return NaN; } });
  if (!close(nums[q.ans], target, 1e-9)) err(`${id}: quiz option ${q.options[q.ans]} != ${target}`);
  nums.forEach((v, i) => { if (i !== q.ans && close(v, target, 1e-9)) err(`${id}: quiz option ${q.options[i]} is also correct`); });
}

/* ---------- whole data set ---------- */
export function validate(data = loadAll()) {
  const errors = [];
  const err = (m) => errors.push(m);
  const stats = { lessons: 0, examples: 0, quiz: 0, rules: 0, cards: 0, exercises: 0, byTier: {}, traps: 0, byCheck: {}, wrongs: 0 };

  const seen = new Set();
  for (const l of data.lessons) {
    stats.lessons++;
    if (seen.has(l.id)) err(`duplicate lesson ${l.id}`);
    seen.add(l.id);
    if (![l.title, ...l.intuition, l.hook || '', l.mistake.why || ''].every((s) => HEB.test(s))) err(`${l.id}: lesson text must be Hebrew`);
    if (l.examples.length < 2 || l.examples.length > 3) err(`${l.id}: needs 2-3 worked examples`);
    if (l.quiz.length !== 3) err(`${l.id}: needs 3 quiz items`);
    if (!l.mistake.wrong || !l.mistake.right) err(`${l.id}: mistake box needs wrong and right`);
    if (!l.hook) err(`${l.id}: missing memory hook`);
    for (const r of l.rules) {
      stats.rules++;
      for (const v of [].concat(r.ver)) { const res = identityHolds(v, r.neg === true); if (!res.ok) err(`${l.id}: rule "${r.name}" (${v}) is not an identity: ${res.why}`); }
    }
    for (const co of l.counters || []) if (!counterFails(co.eq, co.at)) err(`${l.id}: counter-example "${co.eq}" actually holds at ${JSON.stringify(co.at)}`);
    for (const d of l.derive || []) for (const v of [].concat(d.ver || [])) { const res = identityHolds(v, d.neg === true); if (!res.ok) err(`${l.id}: derive step (${v}) is not an identity: ${res.why}`); }
    for (const ex of l.examples) {
      stats.examples++;
      if (ex.steps.length < 3 || !mostlyHebrew(ex.steps)) err(`${l.id}/${ex.title}: example needs >= 3 steps, mostly Hebrew`);
      verifyItem({ ...ex, id: `${l.id}/${ex.title}`, domain: ex.domain }, err);
    }
    l.quiz.forEach((q, i) => { stats.quiz++; verifyQuiz(q, `${l.id}/quiz${i + 1}`, err); });
  }
  if (data.lessons.length !== 12) err(`expected 12 lessons, found ${data.lessons.length}`);

  const cardIds = new Set();
  for (const c of data.cards) {
    stats.cards++;
    if (cardIds.has(c.id)) err(`duplicate card ${c.id}`);
    cardIds.add(c.id);
    if (!data.lessons.some((l) => l.id === c.lessonId)) err(`card ${c.id}: unknown lesson ${c.lessonId}`);
    for (const v of [].concat(c.ver || [])) { const res = identityHolds(v, c.neg === true); if (!res.ok) err(`card ${c.id}: ${v} is not an identity: ${res.why}`); }
    if (!c.ver) err(`card ${c.id}: needs a machine-checkable ver`);
  }
  if (data.cards.length !== 10) err(`expected 10 rule cards, found ${data.cards.length}`);

  const ids = new Set();
  for (const e of data.exercises) {
    stats.exercises++;
    stats.byTier[e.tier] = (stats.byTier[e.tier] || 0) + 1;
    stats.byCheck[e.check.type] = (stats.byCheck[e.check.type] || 0) + 1;
    if (e.trap) stats.traps++;
    stats.wrongs += (e.wrongs || []).length;
    if (ids.has(e.id)) err(`duplicate exercise ${e.id}`);
    ids.add(e.id);
    if (!HEB.test(e.ask) || !e.hints.some((s) => HEB.test(s)) || !mostlyHebrew(e.steps)) err(`${e.id}: ask must be Hebrew, a hint must be Hebrew, steps mostly Hebrew`);
    if (e.steps.length < 3) err(`${e.id}: needs at least 3 worked steps`);
    if (e.trap && !(HEB.test(e.trap.text || '') && ['domain', 'extraneous', 'flip', 'logx2', 'cases', 'base'].includes(e.trap.kind))) err(`${e.id}: bad trap`);
    verifyItem(e, err);
  }
  for (const t of TIERS) if ((stats.byTier[t.id] || 0) < 12) err(`tier ${t.id} has only ${stats.byTier[t.id] || 0} exercises`);
  if (data.exercises.length < 70) err(`expected at least 70 exercises, found ${data.exercises.length}`);
  if (stats.traps < 20) err(`expected at least 20 trap flags, found ${stats.traps}`);
  return { errors, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { errors, stats } = validate();
  console.log(`logs: ${stats.lessons} lessons, ${stats.examples} examples, ${stats.quiz} quiz items, ${stats.rules} rules, ${stats.cards} cards`);
  console.log(`  ${stats.exercises} exercises ${JSON.stringify(stats.byTier)} checks ${JSON.stringify(stats.byCheck)}, traps ${stats.traps}, typical wrong answers ${stats.wrongs} (${Date.now() - t0} ms)`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('OK: every example, quiz item, rule, card and exercise answer verified numerically.');
}
