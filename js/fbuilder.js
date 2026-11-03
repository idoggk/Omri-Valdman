// Personal formula-sheet builder (#/formulas). Pure logic: restricted formula parser, numeric equivalence checker,
// catalogue loading, saved state (personal sheet, Leitner cards, stats). js/fbuilder-ui.js draws it.
//
// The student types each formula from memory in a restricted syntax (variables of the item, numbers, + - * / ^ ( ),
// sqrt sin cos tan log). It is accepted when it equals the reference expression at CHECK_POINTS random points
// (equivalence, not string match). Implicit multiplication ("2x", "x(y+1)") is REJECTED with a clear message; spaces
// are ignored; the Unicode minus, the dot and the times / divide signs are normalised. Wrong answers queue the item
// in the Leitner boxes of js/trig.js (gradeCard / dueCards), under this module's own storage key.
import { safeSetItem } from './storage.js';
import { gradeCard, dueCards, boxCounts, sanitizeState as sanitizeTrigState } from './trig.js';

export const KEY = 'omri-study-fsheet-v1';
export const DATA_FILE = 'data/formula-catalogue.json';
export const FORMULAS_TOPIC = 'formulas';
export const ID_PREFIX = 'fc-';
export const CHECK_POINTS = 20;
export const MAX_LEN = 160;
export const FUNCS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log,
};
export const TOKEN_HELP = 'x, y, t, v0, a, g (ולפי התרגיל), + - * / ^ ( ), sqrt, sin, cos, tan, log';

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

/* ---------- parser ---------- */
const fail = (code, msg) => ({ ok: false, error: { code, msg } });

function tokenize(src) {
  // spaces are ignored between tokens but never merge two words ("sin x" stays two tokens)
  const s = String(src).replace(/[−–־]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/');
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if (/^\s/.test(rest)) i += 1;
    else if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) { toks.push({ k: 'num', v: parseFloat(m[1]) }); i += m[1].length; }
    else if ((m = /^[A-Za-z][A-Za-z0-9]*/.exec(rest))) { toks.push({ k: 'id', v: m[0] }); i += m[0].length; }
    else if ('+-*/^()'.includes(s[i])) { toks.push({ k: 'op', v: s[i] }); i += 1; }
    else return { error: { code: 'char', msg: `תו לא מותר: ״${s[i]}״. מותר: ${TOKEN_HELP}.` } };
  }
  return { toks };
}

/**
 * parseFormula(src, vars) -> { ok:true, fn(env) } | { ok:false, error:{ code, msg } }.
 * vars: array of allowed variable names. Error codes: empty, long, char, unknown, implicit, function, syntax.
 */
export function parseFormula(src, vars = []) {
  const text = String(src == null ? '' : src);
  if (!text.trim()) return fail('empty', 'כתבו את הנוסחה בשדה.');
  if (text.length > MAX_LEN) return fail('long', 'הביטוי ארוך מדי.');
  const { toks, error } = tokenize(text);
  if (error) return { ok: false, error };
  const allowed = new Set(vars);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].k === 'op' && toks[i].v === v;
  const startsAtom = () => toks[i] && (toks[i].k === 'num' || toks[i].k === 'id' || isOp('('));
  const err = (code, msg) => { throw Object.assign(new Error(msg), { code }); };

  function atom() {
    const t = toks[i++];
    if (!t) return err('syntax', 'הביטוי נגמר באמצע. בדקו שחסר ביטוי אחרי הפעולה האחרונה.');
    if (t.k === 'num') { const v = t.v; return () => v; }
    if (t.k === 'id') {
      if (Object.hasOwn(FUNCS, t.v)) {
        if (!isOp('(')) return err('function', `אחרי ${t.v} צריך סוגריים: ${t.v}(...)`);
        i++;
        const arg = expr();
        if (!isOp(')')) return err('syntax', 'חסר סוגר סוגריים.');
        i++;
        const f = FUNCS[t.v];
        return (env) => f(arg(env));
      }
      if (!allowed.has(t.v)) return err('unknown', `המשתנה ״${t.v}״ לא מופיע בשאלה. אם התכוונתם למכפלה, כתבו * בין הגורמים.`);
      return (env) => env[t.v];
    }
    if (t.v === '(') {
      const e = expr();
      if (!isOp(')')) return err('syntax', 'חסר סוגר סוגריים.');
      i++;
      return e;
    }
    return err('syntax', `במקום שבו צריך ערך מופיע ״${t.v}״.`);
  }
  function power() {
    const b = atom();
    if (isOp('^')) { i++; const e = unary(); return (env) => Math.pow(b(env), e(env)); }
    return b;
  }
  function unary() {
    if (isOp('-')) { i++; const u = unary(); return (env) => -u(env); }
    if (isOp('+')) { i++; return unary(); }
    return power();
  }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp('*')) { i++; const l = v; const r = unary(); v = (env) => l(env) * r(env); }
      else if (isOp('/')) { i++; const l = v; const r = unary(); v = (env) => l(env) / r(env); }
      else if (startsAtom()) return err('implicit', 'כפל חייב להיכתב עם * (למשל 2*x או a*(b+c)), גם בין מספר למשתנה ובין סוגריים.');
      else return v;
    }
  }
  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const plus = toks[i++].v === '+';
      const l = v; const r = term();
      v = plus ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
    }
    return v;
  }
  try {
    const fn = expr();
    if (i < toks.length) return fail('syntax', `לא ברור מה אחרי ״${peek().v}״. בדקו סוגריים ופעולות.`);
    return { ok: true, fn };
  } catch (e) {
    if (e.code) return fail(e.code, e.message);
    throw e;
  }
}

/* ---------- numeric equivalence ---------- */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const LIMIT = 1e7;
const close = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x), Math.abs(y));

/** Deterministic random points for an item: CHECK_POINTS envs where the reference is finite and moderate. */
export function samplePoints(item, refFn = null) {
  const names = Object.keys(item.vars);
  const ref = refFn || parseFormula(item.ref, names).fn;
  const rnd = mulberry32(hashStr(item.id));
  const pts = [];
  for (let tries = 0; tries < 600 && pts.length < CHECK_POINTS; tries++) {
    const env = {};
    for (const n of names) { const [lo, hi] = item.vars[n]; env[n] = lo + (hi - lo) * rnd(); }
    const v = ref(env);
    if (Number.isFinite(v) && Math.abs(v) < LIMIT) pts.push(env);
  }
  return pts;
}

/** Do two parsed functions agree at every sample point? A NaN or infinite value on one side only counts as different. */
export function equivalent(fa, fb, points) {
  if (!points.length) return false;
  return points.every((p) => close(fa(p), fb(p)));
}
/** Like equivalent, but two non-finite values at the same point count as equal (traps such as a^(m^n) are undefined at some points). */
const sameValues = (fa, fb, points) => points.every((p) => {
  const x = fa(p), y = fb(p);
  return Number.isFinite(x) || Number.isFinite(y) ? close(x, y) : true;
});

/**
 * checkAnswer(item, src) -> { valid:false, error } | { valid:true, correct, trap }.
 * trap: the matching known wrong form { expr, note } when the typed expression equals one of the item's traps.
 */
export function checkAnswer(item, src) {
  const names = Object.keys(item.vars);
  const p = parseFormula(src, names);
  if (!p.ok) return { valid: false, error: p.error.msg, code: p.error.code };
  const ref = parseFormula(item.ref, names).fn;
  const pts = samplePoints(item, ref);
  let correct = equivalent(p.fn, ref, pts);
  let echo = false;
  if (correct) {
    // typing the left-hand side back is not recalling the formula (it is numerically equal, so compare the text)
    const flat = (s) => String(s).replace(/[=\s]+$/, '').replace(/[\s−×]/g, (c) => (c === '−' ? '-' : c === '×' ? '*' : '')).replace(/\*/g, '').replace(/^\((.*)\)$/, '$1');
    if (flat(src) === flat(item.lhs || '')) { correct = false; echo = true; }
  }
  let trap = null;
  if (!correct) {
    for (const t of item.traps || []) {
      const tf = parseFormula(t.expr, names);
      if (tf.ok && sameValues(p.fn, tf.fn, pts)) { trap = t; break; }
    }
  }
  return { valid: true, correct, trap, echo };
}

/* ---------- catalogue ---------- */
export function validItem(q) {
  if (!isRec(q) || typeof q.id !== 'string' || !q.id.startsWith(ID_PREFIX) || typeof q.topic !== 'string' || typeof q.prompt !== 'string') return false;
  if (q.kind === 'self') return typeof q.answer === 'string' && q.answer.length > 0;
  if (q.kind !== 'expr' || typeof q.ref !== 'string' || typeof q.lhs !== 'string' || !isRec(q.vars) || !Object.keys(q.vars).length) return false;
  if (!Object.values(q.vars).every((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] < r[1])) return false;
  return parseFormula(q.ref, Object.keys(q.vars)).ok && Array.isArray(q.traps);
}

let cache = null;
export const resetCatalogueCache = () => { cache = null; };
/** The loaded catalogue (sync, for the notebook describer) or null before it was fetched. */
export const loadedCatalogue = () => cache;
export async function loadCatalogue(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn(DATA_FILE, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!isRec(d) || !Array.isArray(d.items) || !Array.isArray(d.topics)) throw new Error('bad shape');
    const items = d.items.filter(validItem);
    if (!items.length) throw new Error('empty');
    cache = { topics: d.topics.filter((t) => isRec(t) && typeof t.id === 'string' && typeof t.title === 'string'), items };
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}

/** Notebook description of a formula item: { title, key, href } from the loaded catalogue, or null. */
export function describeFormula(id) {
  const q = cache && cache.items.find((x) => x.id === id.replace(/^fm-/, ''));
  if (!q) return null;
  const key = q.kind === 'self' ? q.answer : `${q.lhs} ${q.ref}`;
  return { title: `נוסחה: ${q.prompt}`, key, href: '#/formulas' };
}
export const attemptId = (id) => `fm-${id}`;

/* ---------- saved state: { v, sheet: {id: {ts, tries}}, cards (Leitner, trig.js shape), stats: {id: {right, wrong, last}} } ---------- */
export function emptySaved() { return { v: 1, sheet: {}, cards: {}, stats: {} }; }

export function sanitizeSaved(raw) {
  const out = emptySaved();
  if (!isRec(raw)) return out;
  if (isRec(raw.sheet)) for (const [id, s] of Object.entries(raw.sheet)) if (id.startsWith(ID_PREFIX) && id.length <= 60 && isRec(s)) out.sheet[id] = { ts: nn(s.ts), tries: Math.max(1, Math.floor(nn(s.tries))) };
  if (isRec(raw.stats)) for (const [id, s] of Object.entries(raw.stats)) if (id.startsWith(ID_PREFIX) && id.length <= 60 && isRec(s)) out.stats[id] = { right: Math.floor(nn(s.right)), wrong: Math.floor(nn(s.wrong)), last: nn(s.last) };
  const cards = sanitizeTrigState({ cards: raw.cards }).cards;
  for (const [id, c] of Object.entries(cards)) if (id.startsWith(ID_PREFIX)) out.cards[id] = c;
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptySaved(); }
}
export function saveSaved(state, storage = globalThis.localStorage) {
  return safeSetItem(KEY, JSON.stringify(state), storage);
}

/**
 * Applies one check result (mutates and returns the state). Correct: the item enters (or stays on) the personal sheet,
 * and a queued card moves up a Leitner box. Wrong: the card is queued (box 0, due at once); a sheet entry is kept.
 */
export function recordCheck(state, id, correct, now = Date.now()) {
  const st = state.stats[id] || { right: 0, wrong: 0, last: 0 };
  if (correct) st.right += 1; else st.wrong += 1;
  st.last = now;
  state.stats[id] = st;
  if (correct) {
    const cur = state.sheet[id];
    state.sheet[id] = { ts: cur ? cur.ts : now, tries: (cur ? cur.tries : 0) + 1 };
    if (state.cards[id]) gradeCard(state, id, true, now);
  } else {
    gradeCard(state, id, false, now);
  }
  return state;
}

export const onSheet = (state, id) => !!state.sheet[id];
/** Items queued in the Leitner boxes and due now, weakest first. */
export function dueQueue(state, items, now = Date.now(), limit = 12) {
  return dueCards(state, items.filter((q) => state.cards[q.id]), now, limit);
}
/** Items never tried and not on the sheet and not queued: the "build" queue, catalogue order, optional topic filter. */
export function buildQueue(state, items, topic = '') {
  return items.filter((q) => (!topic || q.topic === topic) && !state.sheet[q.id] && !state.cards[q.id] && !state.stats[q.id]);
}
/** Sheet items grouped by topic in catalogue order: [{ topic, items }]. */
export function sheetGroups(state, catalogue) {
  return catalogue.topics.map((t) => ({ topic: t, items: catalogue.items.filter((q) => q.topic === t.id && state.sheet[q.id]) })).filter((g) => g.items.length);
}
export const cardBoxes = (state, items) => boxCounts(state, items.filter((q) => state.cards[q.id]));
