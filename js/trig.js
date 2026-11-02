// Trig identities teacher: pure logic shared by js/trig-ui.js, tools/verify-trig.mjs and the tests. No DOM.
// Expressions are plain text such as "sin(a+b) = sin(a)cos(b) + cos(a)sin(b)". evalExpr() understands
// numbers, a b t pi, the degree sign, + - * / ^, superscripts ² ³ ⁴, implicit multiplication,
// sin cos tan cot sec csc sqrt (always with parentheses). Angles are radians; t is tan(a/2).

import { safeSetItem } from './storage.js';

export const KEY = 'omri-study-trig-v1';
export const DAY_MS = 86400000;
export const BOX_DAYS = [0, 1, 2, 4, 8, 16]; // days until due, indexed by Leitner box 0..5
export const MAX_BOX = BOX_DAYS.length - 1;
export const SPOT = { a: Math.PI / 6, b: Math.PI / 3 }; // the "plug a = 30°, b = 60°" spot check

const SUP = { '²': 2, '³': 3, '⁴': 4 };
const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: (x) => 1 / Math.tan(x),
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), sqrt: Math.sqrt,
};

/** Tokens of an expression; throws on characters it does not know. */
function tokenize(src) {
  const s = String(src).replace(/−/g, '-').replace(/[·×]/g, '*').replace(/\s+/g, '');
  const toks = [];
  const re = /(\d+\.?\d*)|(sin|cos|tan|cot|sec|csc|sqrt|pi)|([abt])|([²³⁴])|(°)|([-+*/^(),])/y;
  let m;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    m = re.exec(s);
    if (!m) throw new Error(`bad character "${s[i]}" in "${src}"`);
    i = re.lastIndex;
    if (m[1] != null) toks.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] != null) toks.push(m[2] === 'pi' ? { k: 'num', v: Math.PI } : { k: 'fn', v: m[2] });
    else if (m[3] != null) toks.push({ k: 'var', v: m[3] });
    else if (m[4] != null) toks.push({ k: 'sup', v: SUP[m[4]] });
    else if (m[5] != null) toks.push({ k: 'deg' });
    else toks.push({ k: 'op', v: m[6] });
  }
  return toks;
}

/** Value of one side of an equation. env: { a, b } in radians (t is derived). */
export function evalExpr(src, env) {
  const vars = { a: 0, b: 0, ...env };
  if (vars.t == null) vars.t = Math.tan(vars.a / 2);
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].k === 'op' && toks[i].v === v;
  const need = (v) => { if (!isOp(v)) throw new Error(`expected ${v} in "${src}"`); i++; };
  const startsAtom = () => { const t = toks[i]; return t && (t.k === 'num' || t.k === 'var' || t.k === 'fn' || (t.k === 'op' && t.v === '(')); };

  function atom() {
    const t = toks[i++];
    if (!t) throw new Error(`unexpected end in "${src}"`);
    let v;
    if (t.k === 'num') { v = t.v; if (peek() && peek().k === 'deg') { i++; v = (v * Math.PI) / 180; } }
    else if (t.k === 'var') v = vars[t.v];
    else if (t.k === 'fn') {
      let pow = 1;
      if (peek() && peek().k === 'sup') pow = toks[i++].v;
      need('(');
      const arg = expr();
      need(')');
      v = Math.pow(FUNCS[t.v](arg), pow);
      return v;
    } else if (t.k === 'op' && t.v === '(') { v = expr(); need(')'); }
    else throw new Error(`bad token ${t.v} in "${src}"`);
    if (peek() && peek().k === 'sup') v = Math.pow(v, toks[i++].v);
    return v;
  }
  function power() {
    const b = atom();
    if (isOp('^')) { i++; return Math.pow(b, unary()); }
    return b;
  }
  function unary() { if (isOp('-')) { i++; return -unary(); } if (isOp('+')) { i++; return unary(); } return power(); }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp('*')) { i++; v *= unary(); } else if (isOp('/')) { i++; v /= unary(); } else if (startsAtom()) v *= power(); // implicit product
      else return v;
    }
  }
  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) v = toks[i++].v === '+' ? v + term() : v - term();
    return v;
  }
  const out = expr();
  if (i < toks.length) throw new Error(`trailing token in "${src}"`);
  return out;
}

/** "A = B = C" -> ['A','B','C'] (top level '=' only; our expressions never nest '=' in parentheses). */
export const splitChain = (eq) => String(eq).split('=').map((s) => s.trim());

const close = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-8 * Math.max(1, Math.abs(x), Math.abs(y));

/** Deterministic pseudo-random angles (mulberry32) so tool and tests are reproducible. */
export function randomAngles(n, seed = 12345) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: n }, () => ({ a: (rnd() - 0.5) * 6, b: (rnd() - 0.5) * 6 }));
}

/**
 * Compares two expressions at many angles. Returns { valid, same, diff }:
 * valid = samples where both are finite (sampling skips poles); same = how many of them agree.
 */
export function compare(x, y, angles = randomAngles(60)) {
  let valid = 0;
  let same = 0;
  for (const env of angles) {
    let p;
    let q;
    try { p = evalExpr(x, env); q = evalExpr(y, env); } catch (e) { return { valid: 0, same: 0, error: e.message }; }
    if (!Number.isFinite(p) || !Number.isFinite(q) || Math.abs(p) > 1e4 || Math.abs(q) > 1e4) continue;
    valid++;
    if (close(p, q)) same++;
  }
  return { valid, same };
}

export const MIN_VALID = 25;
/** True when x and y agree at every usable sample (and enough samples were usable). */
export function isIdentity(x, y, angles) { const c = compare(x, y, angles); return !c.error && c.valid >= MIN_VALID && c.same === c.valid; }
/** True when x and y clearly disagree (at least a third of samples differ): a wrong option must be this. */
export function isFalse(x, y, angles) { const c = compare(x, y, angles); return !c.error && c.valid >= MIN_VALID && c.valid - c.same >= c.valid / 3; }

/** A whole equation chain "A = B = C" holds at every sample. */
export function chainHolds(eq, angles) {
  const parts = splitChain(eq);
  return parts.length >= 2 && parts.slice(1).every((p) => isIdentity(parts[0], p, angles));
}
/** A whole chain is false (some adjacent pair clearly differs). */
export function chainFalse(eq, angles) {
  const parts = splitChain(eq);
  return parts.length === 2 && isFalse(parts[0], parts[1], angles);
}

/** Spot check at a = 30°, b = 60°: both sides as numbers (or null when undefined there). */
export function spotValues(eq) {
  const parts = splitChain(eq);
  const fmt = (v) => (Number.isFinite(v) && Math.abs(v) < 1e6 ? Math.round(v * 1000) / 1000 : null); // null = undefined there (e.g. tan 90°)
  return parts.map((p) => { try { return fmt(evalExpr(p, SPOT)); } catch (e) { return null; } });
}
export const spotAgrees = (eq) => { const v = spotValues(eq); return v.length > 1 && v.every((x) => x != null && Math.abs(x - v[0]) < 0.0015); };

/* ---------- Leitner boxes ---------- */
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n, d = 0) => (Number.isFinite(n) && n >= 0 ? n : d);

export function emptyState() { return { v: 1, cards: {}, drills: {}, proofs: {} }; }

export function sanitizeState(raw) {
  const out = emptyState();
  if (!isObj(raw)) return out;
  if (isObj(raw.cards)) {
    for (const [id, c] of Object.entries(raw.cards)) {
      if (!isObj(c) || id.length > 80) continue;
      out.cards[id] = { box: Math.min(MAX_BOX, Math.floor(nn(c.box))), due: nn(c.due), seen: Math.floor(nn(c.seen)), lapses: Math.floor(nn(c.lapses)) };
    }
  }
  if (isObj(raw.drills)) {
    for (const [id, d] of Object.entries(raw.drills)) {
      if (isObj(d) && id.length <= 80) out.drills[id] = { right: Math.floor(nn(d.right)), wrong: Math.floor(nn(d.wrong)), last: nn(d.last) };
    }
  }
  if (isObj(raw.proofs)) {
    for (const [id, p] of Object.entries(raw.proofs)) {
      if (isObj(p) && id.length <= 80) out.proofs[id] = { done: p.done === true, mistakes: Math.floor(nn(p.mistakes)), hints: Math.floor(nn(p.hints)), best: p.best == null ? null : Math.floor(nn(p.best)), last: nn(p.last) };
    }
  }
  return out;
}

/** Right answer: up one box, due after BOX_DAYS[box]. Wrong: back to box 0 (due at once), lapse counted. Mutates and returns the state. */
export function gradeCard(state, id, correct, now = Date.now()) {
  const c = state.cards[id] || { box: 0, due: 0, seen: 0, lapses: 0 };
  c.seen += 1;
  if (correct) c.box = Math.min(MAX_BOX, c.box + 1); else { c.box = 0; c.lapses += 1; }
  c.due = correct ? now + BOX_DAYS[c.box] * DAY_MS : now;
  state.cards[id] = c;
  return state;
}

/** Cards to practise now: unseen and overdue ones, lowest box first (weakest come back first), then oldest due. */
export function dueCards(state, cards, now = Date.now(), limit = 12) {
  const rows = cards.map((c) => ({ c, s: state.cards[c.id] })).filter(({ s }) => !s || s.due <= now);
  rows.sort((x, y) => (x.s ? x.s.box : -1) - (y.s ? y.s.box : -1) || (x.s ? x.s.due : 0) - (y.s ? y.s.due : 0));
  return rows.slice(0, limit).map((r) => r.c);
}

/** Position to reinsert a missed card in a session queue: sooner for box 0 (always a few cards later, never last-only). */
export const requeueGap = (queueLength) => Math.min(queueLength, 3);

export function boxCounts(state, cards) {
  const counts = Array(MAX_BOX + 1).fill(0);
  for (const c of cards) counts[state.cards[c.id] ? state.cards[c.id].box : 0] += 1;
  return counts;
}

export function recordDrill(state, id, correct, now = Date.now()) {
  const d = state.drills[id] || { right: 0, wrong: 0, last: 0 };
  if (correct) d.right += 1; else d.wrong += 1;
  d.last = now;
  state.drills[id] = d;
  return state;
}

export function recordProof(state, id, { mistakes, hints, now = Date.now() }) {
  const p = state.proofs[id] || { done: false, mistakes: 0, hints: 0, best: null, last: 0 };
  p.done = true; p.mistakes = mistakes; p.hints = hints; p.last = now;
  p.best = p.best == null ? mistakes + hints : Math.min(p.best, mistakes + hints);
  state.proofs[id] = p;
  return state;
}

/** Drill items whose mistakes dominate come first; unseen next. */
export function pickDrills(state, items, n = 10, now = Date.now()) {
  const score = (it) => { const d = state.drills[it.id]; return d ? (d.wrong + 1) / (d.right + d.wrong + 2) : 0.5; };
  const jitter = (it) => ((Math.imul(it.id.length * 31 + Math.floor(now / DAY_MS), 2654435761) >>> 0) % 100) / 1000;
  return [...items].sort((x, y) => score(y) + jitter(y) - (score(x) + jitter(x))).slice(0, n);
}

export function loadState(storage = globalThis.localStorage) {
  try { return sanitizeState(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export function saveState(state, storage = globalThis.localStorage) {
  return safeSetItem(KEY, JSON.stringify(state), storage);
}
