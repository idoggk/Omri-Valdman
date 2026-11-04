// #/derive logic: spaced derivation recall. 24 original derivation tasks (data/derive.json), each an ordered chain of 4-7 checkpoints
// (the lines of a derivation, in the parser syntax of js/fbuilder.js plus log_b(x), ln(x) and sum(i;from;to;body)).
// Pure: no DOM. Shared by js/derive-ui.js, tools/verify-derive.mjs and tests/derive.test.mjs.
//
//  task  = { id, subject: 'math'|'physics', title, start, goal, sym?, vars, defs?, dom?, mode: 'identity'|'solve', unknown?, scan?, udom?,
//            steps: [{ f, n, s?, typed?, w: [{ f, e, s? } x3] }], key: [3 step indexes] }
//   mode identity: every line is TRUE for all values of the free variables (derived quantities in `defs` are computed from them),
//                  so a step is verified by the line being an identity at 200 points; a wrong candidate is one that is false somewhere.
//   mode solve:    consecutive lines are equations in `unknown` with the same solution set (checked by root finding at random parameters).
// Levels (from the schedule box b, intervals 1/3/7/14 days as in the error notebook): 0 read the full derivation, 1 choose the next
// step among 4 candidates, 2 type the hidden lines, 3 blank page: type the 3 key lines.
import { INTERVAL_DAYS, DAY_MS } from './srs.js';
import { parseFormula, FUNCS } from './fbuilder.js';

export const TOPIC = 'derive';
export const DATA_FILES = ['data/derive-math.json', 'data/derive-physics.json'];
export const LEVEL_LABELS = ['קריאה של הגזירה המלאה', 'בחירת הצעד הבא', 'הקלדת השורות המוסתרות', 'דף ריק: שלוש שורות מפתח'];
export const POINTS = 200;

/** Named error types of the wrong candidates: id -> { label, text }. */
export const ERR = {
  sign: { label: 'טעות סימן', text: 'סימן שגוי במעבר: בדקו כל + וכל − מול הזהות שבה השתמשתם.' },
  factor: { label: 'גורם נעלם או מיותר', text: 'אחד הגורמים (2, ½ או חזקה) נשמט או נוסף.' },
  identity: { label: 'זהות שגויה', text: 'השתמשתם בזהות או בנוסחה שלא מתאימה למעבר הזה.' },
  linear: { label: 'פיזור שגוי של פונקציה', text: 'f(a+b) אינו f(a)+f(b), ו־f(2a) אינו 2f(a). פונקציה לא מתפזרת על סכום.' },
  swap: { label: 'החלפת רכיבים', text: 'החלפתם בין סינוס לקוסינוס, או בין שני גדלים דומים.' },
  power: { label: 'חזקה או ארגומנט שגויים', text: 'חזקה שהוצבה במקום הלא נכון, או פעולה בתוך הארגומנט במקום מחוצה לו.' },
  paren: { label: 'סוגריים', text: 'סימן מינוס או כפל לא חלו על כל מה שבסוגריים.' },
  partial: { label: 'פעולה על חלק מהביטוי', text: 'פעלתם רק על איבר אחד, או רק על המונה או רק על המכנה.' },
  invert: { label: 'הפיכה', text: 'הפכתם מונה ומכנה, או עשיתם פעולה הפוכה (חילוק במקום כפל).' },
  cross: { label: 'איבר אמצעי נשכח', text: 'בפתיחת סוגריים נשכח האיבר האמצעי: (p+q)² אינו p²+q².' },
  axis: { label: 'ציר או גודל שגויים', text: 'הצבתם גודל מציר אחר, או מגודל אחר, בנוסחה.' },
  quantity: { label: 'גודל פיזיקלי שגוי', text: 'נוסחה נכונה בצורה אבל לא לגודל הזה (מסה לא נכונה, מהירות במקום תאוצה).' },
  dropped: { label: 'איבר שנשמט', text: 'איבר, סוגר או פתרון אחד אבד באמצע.' },
  premature: { label: 'מעבר מוקדם או לא מוצדק', text: 'קפצתם לתוצאה בלי הצעד שמצדיק אותה.' },
};
export const errInfo = (id) => ERR[id] || { label: 'טעות', text: 'הקו הזה לא נובע מהשורה הקודמת.' };

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const FN_NAMES = new Set([...Object.keys(FUNCS), 'ln', 'sum']);

/* ---------- parsing the line syntax ---------- */

/** Finds the matching ")" of the "(" at index i (or -1). */
function closeOf(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (d === 0) return k; } }
  return -1;
}

/** log_b(arg) -> (ln(arg)/ln(b)); then ln( -> log( (natural log of fbuilder). */
export function toParse(text) {
  let s = String(text);
  for (let guard = 0; guard < 30; guard++) {
    const i = s.indexOf('log_');
    if (i < 0) break;
    let j = i + 4;
    let base;
    if (s[j] === '(') { const c = closeOf(s, j); if (c < 0) throw new Error('log base'); base = s.slice(j + 1, c); j = c + 1; }
    else { const m = /^[A-Za-z0-9.]+/.exec(s.slice(j)); if (!m) throw new Error('log base'); base = m[0]; j += m[0].length; }
    if (s[j] !== '(') throw new Error('log argument');
    const c2 = closeOf(s, j);
    if (c2 < 0) throw new Error('log argument');
    s = `${s.slice(0, i)}(ln(${s.slice(j + 1, c2)})/ln(${base}))${s.slice(c2 + 1)}`;
  }
  return s.replace(/(?<![A-Za-z])ln\(/g, 'log(');
}

const SUM_MAX = 40;
const wordsOf = (t) => [...new Set((String(t).match(/[A-Za-z][A-Za-z0-9]*/g) || []).filter((w) => !FN_NAMES.has(w)))];

/** Splits the top-level ";" parts of the inside of sum( ... ) starting at the "(" index `open`. Returns { parts, end }. */
function sumParts(s, open) {
  const c = closeOf(s, open);
  if (c < 0) throw new Error('sum parentheses');
  const parts = [];
  let d = 0;
  let from = open + 1;
  for (let k = open + 1; k < c; k++) {
    if (s[k] === '(') d++; else if (s[k] === ')') d--;
    else if (s[k] === ';' && d === 0) { parts.push(s.slice(from, k)); from = k + 1; }
  }
  parts.push(s.slice(from, c));
  if (parts.length !== 4) throw new Error('sum needs 4 parts');
  return { parts, end: c };
}

/**
 * Text -> env => number. Throws on a syntax error. Variables: every identifier of the text.
 * sum(v;from;to;body) is evaluated numerically (the sum is replaced by a placeholder variable that is computed per environment).
 */
export function exprFn(src) {
  let t = toParse(src);
  const sums = [];
  for (let guard = 0; guard < 10; guard++) {
    const i = t.search(/(?<![A-Za-z])sum\(/);
    if (i < 0) break;
    const { parts, end } = sumParts(t, i + 3);
    const name = `zq${String.fromCharCode(97 + sums.length)}`;
    sums.push({ name, v: parts[0].trim(), lo: exprFn(parts[1]), hi: exprFn(parts[2]), body: exprFn(parts[3]) });
    t = `${t.slice(0, i)}${name}${t.slice(end + 1)}`;
  }
  const p = parseFormula(t, wordsOf(t));
  if (!p.ok) throw new Error(p.error.msg);
  if (!sums.length) return p.fn;
  return (env) => {
    const e = { ...env };
    for (const s of sums) {
      const lo = s.lo(e);
      const hi = s.hi(e);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi - lo > SUM_MAX) return NaN;
      let acc = 0;
      for (let k = lo; k <= hi; k++) acc += s.body({ ...e, [s.v]: k });
      e[s.name] = acc;
    }
    return p.fn(e);
  };
}

const OPS = /(<=|>=|!=|=|<|>)/;
const close = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x), Math.abs(y));
const CMP = {
  '=': (x, y) => close(x, y),
  '!=': (x, y) => Number.isFinite(x) && Number.isFinite(y) && !close(x, y),
  '<=': (x, y) => Number.isFinite(x) && Number.isFinite(y) && (x <= y || close(x, y)),
  '>=': (x, y) => Number.isFinite(x) && Number.isFinite(y) && (x >= y || close(x, y)),
  '<': (x, y) => Number.isFinite(x) && Number.isFinite(y) && x < y && !close(x, y),
  '>': (x, y) => Number.isFinite(x) && Number.isFinite(y) && x > y && !close(x, y),
};

/** "a = b", "p > 0 and q = 1", "x = 1 or x = 2" -> { ors: [[{ op, l, r }]], truth(env), rels }. Throws on bad syntax. */
export function parseStatement(text) {
  const raw = String(text).trim();
  if (!raw) throw new Error('empty line');
  const ors = raw.split(/\s+or\s+/).map((o) => o.split(/\s+and\s+/).map((c) => {
    const parts = c.split(OPS);
    if (parts.length !== 3) throw new Error(`a clause needs exactly one relation: "${c}"`);
    return { op: parts[1], l: exprFn(parts[0]), r: exprFn(parts[2]), lt: parts[0].trim(), rt: parts[2].trim() };
  }));
  const rels = ors.flat();
  return { raw, ors, rels, truth: (env) => ors.some((cl) => cl.every((r) => CMP[r.op](r.l(env), r.r(env)))) };
}

/* ---------- deterministic points ---------- */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const DEFAULT_RANGE = [0.5, 3];

function sampleFree(vars, names, rnd) {
  const env = {};
  for (const n of names) {
    const r = vars[n] || DEFAULT_RANGE;
    const v = r[0] + (r[1] - r[0]) * rnd();
    env[n] = r[2] === 'int' ? Math.round(v) : v;
  }
  return env;
}

/** Builds { points(n), withDefs(env) } for a task: free variables from `vars`, derived ones from `defs`, rejection sampling on `dom`. */
export function taskSampler(task) {
  const free = Object.keys(task.vars || {});
  const defs = Object.entries(task.defs || {}).map(([k, src]) => [k, exprFn(src)]);
  const dom = task.dom ? parseStatement(task.dom) : null;
  const withDefs = (env) => { const e = { ...env }; for (const [k, f] of defs) e[k] = f(e); return e; };
  return {
    free, withDefs, dom,
    points(n, seed = task.id) {
      const rnd = mulberry32(hashStr(seed));
      const out = [];
      for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
        const e = withDefs(sampleFree(task.vars, free, rnd));
        if (!Object.values(e).every(Number.isFinite)) continue;
        if (dom && !dom.truth(e)) continue;
        out.push(e);
      }
      return out;
    },
  };
}

/* ---------- verification of lines (the checks tools/verify-derive.mjs runs) ---------- */

/** Identity check: statement truth at every point. Returns { ok, bad } where bad = first failing env or null; undefinedAt when a side is not finite. */
export function holdsEverywhere(stmt, pts) {
  for (const p of pts) if (!stmt.truth(p)) return { ok: false, bad: p };
  return { ok: true, bad: null };
}

function rootsOf(stmt, env, unknown, lo, hi, steps = 600) {
  const out = [];
  for (const rel of stmt.rels) {
    const g = (t) => rel.l({ ...env, [unknown]: t }) - rel.r({ ...env, [unknown]: t });
    let a = lo;
    let ga = g(a);
    for (let i = 1; i <= steps; i++) {
      const b = lo + ((hi - lo) * i) / steps;
      const gb = g(b);
      if (Number.isFinite(ga) && Number.isFinite(gb) && ((ga < 0 && gb > 0) || (ga > 0 && gb < 0))) {
        let x = a; let y = b; let gx = ga;
        for (let k = 0; k < 60; k++) { const m = (x + y) / 2; const gm = g(m); if ((gx < 0) === (gm < 0)) { x = m; gx = gm; } else y = m; }
        out.push((x + y) / 2);
      } else if (Number.isFinite(gb) && gb === 0) out.push(b);
      a = b; ga = gb;
    }
  }
  return out;
}

/**
 * Solve mode: do two statements in `unknown` have the same solutions? Tested at `n` random parameter points, at every root found
 * of either statement and at random values. Returns { ok, bad, tested } (bad = env + value of the first difference).
 */
export function sameSolutions(task, A, B, n = 60) {
  const s = taskSampler(task);
  const u = task.unknown;
  const [lo, hi] = task.scan || [-30, 30];
  const udom = task.udom ? parseStatement(task.udom) : null;
  const rnd = mulberry32(hashStr(`${task.id}:solve`));
  let tested = 0;
  for (const p of s.points(n, `${task.id}:par`)) {
    const cands = [...rootsOf(A, p, u, lo, hi), ...rootsOf(B, p, u, lo, hi)];
    for (let i = 0; i < 40; i++) cands.push(lo + (hi - lo) * rnd());
    for (const c of cands) {
      const e = { ...p, [u]: c };
      if (udom && !udom.truth(e)) continue;
      tested++;
      if (A.truth(e) !== B.truth(e)) return { ok: false, bad: e, tested };
    }
  }
  return { ok: true, bad: null, tested };
}

/* ---------- typed lines (levels 2 and 3) ---------- */

export const typeable = (step) => !!step && step.typed !== false && !/\s(or)\s/.test(step.f);
const flat = (s) => String(s).replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/\s+/g, '').toLowerCase();

/** Same line? Sides equal as expressions (either order), or the two equations differ by a constant factor. */
export function sameLine(task, typed, correct, seedExtra = '') {
  const t = parseStatement(typed);
  const c = parseStatement(correct);
  if (t.rels.length !== 1 || c.rels.length !== 1 || t.ors.length !== 1 || c.ors.length !== 1 || t.rels[0].op !== c.rels[0].op) return false;
  const [tr, cr] = [t.rels[0], c.rels[0]];
  const pts = taskSampler(task).points(60, `${task.id}:t${seedExtra}`).filter((e) => [cr.l(e), cr.r(e)].every(Number.isFinite)).slice(0, 30);
  if (pts.length < 8) return false;
  const straight = pts.every((e) => close(tr.l(e), cr.l(e)) && close(tr.r(e), cr.r(e)));
  const swapped = pts.every((e) => close(tr.l(e), cr.r(e)) && close(tr.r(e), cr.l(e)));
  if (straight || swapped) return true;
  const dT = pts.map((e) => tr.l(e) - tr.r(e));
  const dC = pts.map((e) => cr.l(e) - cr.r(e));
  if (!dC.some((v) => Math.abs(v) > 1e-9) || !dT.every(Number.isFinite)) return false;
  const k = pts.findIndex((_, i) => Math.abs(dC[i]) > 1e-6);
  const ratio = dT[k] / dC[k];
  return Math.abs(ratio) > 1e-9 && dT.every((v, i) => close(v, ratio * dC[i]));
}

const bagOf = (s) => {
  const bag = new Map();
  for (const tok of String(s).match(/[A-Za-z][A-Za-z0-9]*|\d+(?:\.\d+)?/g) || []) bag.set(tok, (bag.get(tok) || 0) + 1);
  return bag;
};
/** Distance between the token multisets (functions, variables, numbers) of two lines. */
export function bagDistance(a, b) {
  const x = bagOf(a);
  const y = bagOf(b);
  let d = 0;
  for (const k of new Set([...x.keys(), ...y.keys()])) d += Math.abs((x.get(k) || 0) - (y.get(k) || 0));
  return d;
}

/**
 * Checks one typed line against the stored line of a step. `others` = lines already on the page (never accepted as the answer).
 * Returns { ok, code, msg }: code 'ok' | 'empty' | 'syntax' | 'norel' | 'echo' | 'wrong'.
 */
export function checkTyped(task, step, typed, others = []) {
  const text = String(typed == null ? '' : typed).trim();
  if (!text) return { ok: false, code: 'empty', msg: 'כתבו את השורה בשדה.' };
  if (text.length > 160) return { ok: false, code: 'syntax', msg: 'השורה ארוכה מדי.' };
  let st;
  try { st = parseStatement(text.replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')); } catch (e) {
    const m = String(e.message || '');
    return /relation|empty/.test(m)
      ? { ok: false, code: 'norel', msg: 'כתבו שורה מלאה עם סימן שוויון אחד, למשל: cos(2*a) = ...' }
      : { ok: false, code: 'syntax', msg: m || 'הכתיב לא תקין.' };
  }
  const norm = flat(text);
  if (others.some((o) => flat(o) === norm)) return { ok: false, code: 'echo', msg: 'זו שורה שכבר מופיעה בדף. כתבו את הצעד הבא.' };
  let same = false;
  try { same = sameLine(task, text.replace(/[−–]/g, '-').replace(/[×·]/g, '*'), step.f); } catch (e) { same = false; }
  // an identity has equal sides, so "equal to the stored line" alone would accept any true line: the typed line must also look
  // more like the expected step than like any other line of the chain (same functions, variables and numbers, counted)
  if (same && task.mode === 'identity') {
    const dExp = bagDistance(text, step.f);
    const dOther = Math.min(...task.steps.filter((s) => s !== step).map((s) => bagDistance(text, s.f)));
    if (dExp > 0 && dExp >= dOther) same = false;
  }
  if (!same && task.mode === 'identity') {
    let true_ = false;
    try { const pts = taskSampler(task).points(40, `${task.id}:true`); true_ = pts.length >= 8 && holdsEverywhere(st, pts).ok; } catch (e) { true_ = false; }
    if (true_) return { ok: false, code: 'true-other', msg: 'השורה הזו נכונה, אבל היא לא הצעד הבא בשרשרת. חזרו לשורה האחרונה בדף וחשבו מה עושים איתה עכשיו.', st };
  }
  if (!same) return { ok: false, code: 'wrong', msg: 'השורה הזו לא שקולה לצעד הבא בשרשרת. בדקו את השורה הקודמת ונסו שוב.', st };
  return { ok: true, code: 'ok', msg: 'נכון.' };
}

/* ---------- display ---------- */
/** Parser syntax -> display string (the small HTML subset the app shows: <sub>, <sup>). `sym` renames single-letter variables. */
export function pretty(f, sym = {}) {
  let s = String(f);
  s = s.replace(/(?<![A-Za-z])sum\(([A-Za-z]);([^;()]+);([^;()]+);((?:[^()]|\([^()]*\))*)\)/g, (_, v, a, b, body) => `Σ<sub>${v}=${a}</sub><sup>${b}</sup> ${body}`);
  s = s.replace(/log_(\([^()]+\)|[A-Za-z0-9.]+)\(/g, (_, b) => `log<sub>${b.replace(/^\(|\)$/g, '')}</sub>(`);
  s = s.replace(/[A-Za-z]+/g, (w) => (FN_NAMES.has(w) || w === 'log' || w === 'or' || w === 'and' ? w : sym[w] || w));
  s = s.replace(/\^(\([^()]*\)|[\wα-ω.]+)/g, (_, e) => `<sup>${e.replace(/^\(|\)$/g, '').replace(/\*/g, '·')}</sup>`);
  s = s.replace(/ and /g, ' , ').replace(/ or /g, ' או ').replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/!=/g, '≠').replace(/\*/g, '·')
    .replace(/(?<![A-Za-z0-9)])-(?=\d|[A-Za-zα-ω(])/g, '−').replace(/ - /g, ' − ').replace(/sqrt\(/g, '√(');
  return s.replace(/(?<![A-Za-z0-9<\/.])([A-Za-z])(\d)(?![\dA-Za-z.])/g, '$1<sub>$2</sub>');
}
/** Display for a line: its own `s` when given, else the pretty form of f. */
export const lineText = (task, o) => (o && o.s ? o.s : pretty(o && o.f != null ? o.f : o, task.sym));

/* ---------- data ---------- */
export function validTask(t) {
  if (!isRec(t) || typeof t.id !== 'string' || !/^dv-[mp]-\d\d$/.test(t.id) || !['math', 'physics'].includes(t.subject)) return false;
  if (typeof t.title !== 'string' || typeof t.start !== 'string' || typeof t.goal !== 'string' || !isRec(t.vars)) return false;
  if (!['identity', 'solve'].includes(t.mode) || (t.mode === 'solve' && typeof t.unknown !== 'string')) return false;
  if (!Array.isArray(t.steps) || t.steps.length < 4 || t.steps.length > 7) return false;
  if (!t.steps.every((s) => isRec(s) && typeof s.f === 'string' && typeof s.n === 'string' && Array.isArray(s.w) && s.w.length === 3 && s.w.every((w) => isRec(w) && typeof w.f === 'string' && typeof w.e === 'string'))) return false;
  const last = t.steps.length - 1;
  return Array.isArray(t.key) && t.key.length === 3 && new Set(t.key).size === 3 && t.key.every((i) => Number.isInteger(i) && i >= 0 && i < last && typeable(t.steps[i]));
}

let cache = null;
export const resetDeriveCache = () => { cache = null; };
export const loadedTasks = () => (cache ? cache.tasks : null);
/** { ok, tasks }. */
export async function loadDeriveData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, ...cache };
  try {
    const tasks = [];
    for (const file of DATA_FILES) {
      const res = await fetchFn(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (!d || !Array.isArray(d.tasks)) throw new Error('bad derive file');
      tasks.push(...d.tasks.filter(validTask));
    }
    cache = { tasks };
    return { ok: true, ...cache };
  } catch (e) {
    return { ok: false };
  }
}

import { levelOf, isDue } from './derive-state.js';
export * from './derive-state.js';

/* ---------- sessions ---------- */
export function shuffle(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Level 1: the 4 candidates of a checkpoint, shuffled: [{ f, s, correct, e }]. */
export function candidates(task, i, rnd = Math.random) {
  const st = task.steps[i];
  return shuffle([{ f: st.f, s: st.s, correct: true, e: null }, ...st.w.map((w) => ({ f: w.f, s: w.s, correct: false, e: w.e, why: w.why }))], rnd);
}

/** Feedback for a wrong pick: { label, text, why }. */
export function wrongFeedback(cand) {
  const info = errInfo(cand.e);
  return { label: info.label, text: info.text, why: cand.why || '' };
}

/** Level 2: indexes of the steps typed by the learner (every other typeable step, never the last one = the goal; at least 2). */
export function hiddenSteps(task) {
  const last = task.steps.length - 1;
  const out = [];
  for (let i = 0; i < last; i += 2) if (typeable(task.steps[i])) out.push(i);
  for (let i = 1; i < last && out.length < 2; i += 2) if (typeable(task.steps[i])) out.push(i);
  return out.sort((a, b) => a - b);
}

/** Result of a session -> { clean, outcome } for the attempts log. */
export function sessionResult({ wrongs = 0, hints = 0, peeked = false }) {
  const clean = !wrongs && !hints && !peeked;
  return { clean, outcome: peeked ? 'solution' : clean ? 'alone' : wrongs ? 'wrong' : 'hinted' };
}

/** One line for the hub: where this task stands. */
export function statusText(e, now = Date.now()) {
  if (!e || !e.seen) return 'חדש: קוראים את הגזירה';
  const lvl = LEVEL_LABELS[levelOf(e)];
  if (isDue(e, now)) return `לחזרה עכשיו · ${lvl}`;
  const days = Math.max(1, Math.ceil((e.due - now) / DAY_MS));
  return `בעוד ${days === 1 ? 'יום' : `${days} ימים`} · ${lvl}`;
}

/* ---------- one recall session (pure state machine; js/derive-ui.js draws it) ---------- */

/** Indexes the learner must answer at a level: 1 every step before the goal, 2 the hidden steps, 3 the three key lines. */
export function pendingSteps(task, level) {
  const last = task.steps.length - 1;
  if (level <= 1) return Array.from({ length: last }, (_, i) => i);
  if (level === 2) return hiddenSteps(task);
  return [...task.key].sort((a, b) => a - b);
}

/**
 * Level 1-3 session. State: pos = index into pending(), wrongs, hints, peeked, done. Methods return plain results:
 *  pick(i)     level 1: i = index into candidates() -> { ok, cand, feedback? }
 *  submit(txt) levels 2-3: -> checkTyped result (a wrong line counts as one wrong try)
 *  hint()      -> the note of the current step (counts as a hint)
 *  peek()      shows the whole derivation; the session ends and is never clean
 */
export function createSession(task, level, rnd = Math.random) {
  const pending = pendingSteps(task, level);
  const s = { task, level, pending, pos: 0, wrongs: 0, hints: 0, peeked: false, typedLines: [], picked: new Set(), cands: null };
  s.current = () => (s.peeked || s.pos >= pending.length ? null : pending[s.pos]);
  s.done = () => s.peeked || s.pos >= pending.length;
  s.candidates = () => {
    const i = s.current();
    if (i == null) return [];
    if (!s.cands || s.cands.i !== i) s.cands = { i, list: candidates(task, i, rnd) };
    return s.cands.list;
  };
  s.pick = (k) => {
    const i = s.current();
    const cand = s.candidates()[k];
    if (i == null || !cand || s.picked.has(k)) return { ok: false, cand: null };
    if (cand.correct) { s.pos += 1; s.picked = new Set(); s.cands = null; return { ok: true, cand }; }
    s.picked.add(k); s.wrongs += 1;
    return { ok: false, cand, feedback: wrongFeedback(cand) };
  };
  s.submit = (text) => {
    const i = s.current();
    if (i == null) return { ok: false, code: 'done', msg: '' };
    const r = checkTyped(task, task.steps[i], text, i > 0 ? [task.steps[i - 1].f] : []);
    if (r.ok) { s.typedLines.push(String(text).trim()); s.pos += 1; } else if (r.code !== 'empty' && r.code !== 'syntax' && r.code !== 'norel' && r.code !== 'echo') s.wrongs += 1;
    return r;
  };
  s.hint = () => {
    const i = s.current();
    if (i == null) return '';
    s.hints += 1;
    return task.steps[i].n;
  };
  s.peek = () => { s.peeked = true; };
  s.result = () => sessionResult({ wrongs: s.wrongs, hints: s.hints, peeked: s.peeked });
  return s;
}
