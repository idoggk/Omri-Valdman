// Units and dimensional analysis (#/units). Pure logic: a dimension-vector engine over (kg, m, s), the unit table with SI scale
// factors, derived answers for the 30 questions of js/units-data.js, saved results and the session picker.
// The same engine is used to author the questions and to validate answers: a choice question has no stored answer, the correct
// option is the unique one whose dimension vector equals the target; a conversion is value * scale(from) / scale(to); a formula
// is consistent when both sides have the same vector and every sum adds equal dimensions. tools/verify-units.mjs recomputes all.
import { safeSetItem } from './storage.js';
import { parse as parseNumberText } from './check.js';
import { QUESTIONS } from './units-data.js';

export const KEY = 'omri-study-units-v1';
export const TOPIC = 'units';
export const SESSION_SIZE = 10;
export { QUESTIONS };

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/* ---------- dimension vectors [kg, m, s] ---------- */
export const BASE_NAMES = ['kg', 'm', 's'];
export const ZERO = [0, 0, 0];
export const dimMul = (a, b) => a.map((x, i) => x + b[i]);
export const dimDiv = (a, b) => a.map((x, i) => x - b[i]);
export const dimPow = (a, n) => a.map((x) => x * n);
export const dimEq = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
export const isDimensionless = (a) => dimEq(a, ZERO);

/** Unit table: symbol -> { dim, scale to SI }. */
export const UNITS = {
  kg: { dim: [1, 0, 0], scale: 1 }, g: { dim: [1, 0, 0], scale: 1e-3 }, t: { dim: [1, 0, 0], scale: 1000 },
  m: { dim: [0, 1, 0], scale: 1 }, cm: { dim: [0, 1, 0], scale: 0.01 }, mm: { dim: [0, 1, 0], scale: 0.001 }, km: { dim: [0, 1, 0], scale: 1000 },
  s: { dim: [0, 0, 1], scale: 1 }, min: { dim: [0, 0, 1], scale: 60 }, h: { dim: [0, 0, 1], scale: 3600 },
  N: { dim: [1, 1, -2], scale: 1 }, kN: { dim: [1, 1, -2], scale: 1000 },
  J: { dim: [1, 2, -2], scale: 1 }, kJ: { dim: [1, 2, -2], scale: 1000 },
  W: { dim: [1, 2, -3], scale: 1 }, kW: { dim: [1, 2, -3], scale: 1000 },
  Pa: { dim: [1, -1, -2], scale: 1 }, kPa: { dim: [1, -1, -2], scale: 1000 }, MPa: { dim: [1, -1, -2], scale: 1e6 },
  Hz: { dim: [0, 0, -1], scale: 1 }, L: { dim: [0, 3, 0], scale: 1e-3 },
};

/** parseUnit('kg*m/s^2') -> { dim, scale }. Left-associative * and /, integer powers, parentheses. Throws on unknown symbols. */
export function parseUnit(src) {
  const s = String(src);
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  const peek = () => { ws(); return s[i]; };
  function atom() {
    ws();
    if (s[i] === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error(`missing ) in unit "${src}"`); i++; return v; }
    const m = /^[A-Za-z]+/.exec(s.slice(i));
    if (!m) throw new Error(`bad unit "${src}"`);
    i += m[0].length;
    if (!Object.hasOwn(UNITS, m[0])) throw new Error(`unknown unit symbol "${m[0]}"`);
    const u = UNITS[m[0]];
    return { dim: u.dim.slice(), scale: u.scale };
  }
  function factor() {
    let v = atom();
    if (peek() === '^') {
      i++; ws();
      const m = /^-?\d+/.exec(s.slice(i));
      if (!m) throw new Error(`bad exponent in unit "${src}"`);
      i += m[0].length;
      const n = Number(m[0]);
      v = { dim: dimPow(v.dim, n), scale: Math.pow(v.scale, n) };
    }
    return v;
  }
  function expr() {
    let v = factor();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; const r = factor(); v = { dim: dimMul(v.dim, r.dim), scale: v.scale * r.scale }; }
      else if (c === '/') { i++; const r = factor(); v = { dim: dimDiv(v.dim, r.dim), scale: v.scale / r.scale }; }
      else return v;
    }
  }
  const out = expr();
  if (peek() !== undefined) throw new Error(`unexpected "${peek()}" in unit "${src}"`);
  return out;
}

/** Display form of a unit string: kg*m/s^2 -> kg·m/s². */
export function fmtUnit(u) {
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
  return String(u).replace(/\*/g, '·').replace(/\^(-?\d+)/g, (m, n) => [...n].map((c) => SUP[c]).join(''));
}
export const fmtNum = (v) => String(Number(Number(v).toPrecision(10)));

/* ---------- formula consistency ---------- */
export class DimError extends Error {}
/**
 * evalDim('v*t+a*t^2/2', { v:'m/s', a:'m/s^2', t:'s' }) -> dimension vector.
 * Grammar: sum of products; numbers and pi are dimensionless; sqrt(...); integer powers. Adding or subtracting different
 * dimensions throws DimError (the formula is inconsistent).
 */
export function evalDim(src, symbols) {
  const toks = String(src).match(/[A-Za-z][A-Za-z0-9]*|\d+(?:\.\d+)?|[+\-*/^()]/g) || [];
  let p = 0;
  const op = (v) => toks[p] === v;
  const need = (v) => { if (!op(v)) throw new Error(`expected ${v} in "${src}"`); p++; };
  function atom() {
    const k = toks[p++];
    if (k === undefined) throw new Error(`unexpected end in "${src}"`);
    if (/^\d/.test(k) || k === 'pi') return ZERO.slice();
    if (k === 'sqrt') { need('('); const v = sum(); need(')'); return dimPow(v, 0.5); }
    if (k === '(') { const v = sum(); need(')'); return v; }
    if (Object.hasOwn(symbols, k)) return parseUnit(symbols[k]).dim;
    throw new Error(`unknown symbol ${k} in "${src}"`);
  }
  function pow() {
    const b = atom();
    if (op('^')) {
      p++;
      let sign = 1;
      if (op('-')) { p++; sign = -1; }
      const e = toks[p++];
      if (!/^\d+$/.test(e || '')) throw new Error(`only integer powers in "${src}"`);
      return dimPow(b, sign * Number(e));
    }
    return b;
  }
  function prod() {
    let v = pow();
    for (;;) {
      if (op('*')) { p++; v = dimMul(v, pow()); } else if (op('/')) { p++; v = dimDiv(v, pow()); } else return v;
    }
  }
  function sum() {
    let v = prod();
    while (op('+') || op('-')) {
      p++;
      const r = prod();
      if (!dimEq(v, r)) throw new DimError('adding different dimensions');
    }
    return v;
  }
  const out = sum();
  if (p !== toks.length) throw new Error(`trailing tokens in "${src}"`);
  return out;
}
/** Is lhs = rhs consistent? DimError (a sum of unlike dimensions) counts as inconsistent. */
export function formulaConsistent(lhs, rhs, symbols) {
  try { return dimEq(evalDim(lhs, symbols), evalDim(rhs, symbols)); } catch (e) { if (e instanceof DimError) return false; throw e; }
}

/* ---------- named quantities ---------- */
export const QUANTITIES = {
  mass: { he: 'מסה', unit: 'kg', kind: 'scalar' }, time: { he: 'זמן', unit: 's', kind: 'scalar' },
  distance: { he: 'מרחק שעבר', unit: 'm', kind: 'scalar' }, displacement: { he: 'העתק', unit: 'm', kind: 'vector' },
  speed: { he: 'מהירות סקלרית', unit: 'm/s', kind: 'scalar' }, velocity: { he: 'מהירות וקטורית', unit: 'm/s', kind: 'vector' },
  acceleration: { he: 'תאוצה', unit: 'm/s^2', kind: 'vector' }, force: { he: 'כוח', unit: 'N', kind: 'vector' },
  momentum: { he: 'תנע', unit: 'kg*m/s', kind: 'vector' }, energy: { he: 'אנרגיה', unit: 'J', kind: 'scalar' },
  work: { he: 'עבודה', unit: 'J', kind: 'scalar' }, power: { he: 'הספק', unit: 'W', kind: 'scalar' },
  pressure: { he: 'לחץ או מאמץ', unit: 'Pa', kind: 'scalar' }, density: { he: 'צפיפות', unit: 'kg/m^3', kind: 'scalar' },
  area: { he: 'שטח', unit: 'm^2', kind: 'scalar' }, volume: { he: 'נפח', unit: 'm^3', kind: 'scalar' }, frequency: { he: 'תדירות', unit: 'Hz', kind: 'scalar' },
};
export const quantityDim = (id) => parseUnit(QUANTITIES[id].unit).dim;
export const KIND_CHOICES = ['סקלר', 'וקטור'];
export const YESNO_CHOICES = ['כן, הנוסחה תקינה מבחינת יחידות', 'לא, היחידות לא מתאימות'];

/**
 * The answer of a question, derived from the engine.
 * -> { kind:'choice', index, choices:[display strings] } | { kind:'num', value, unit }
 */
export function answerOf(q) {
  switch (q.type) {
    case 'unit': {
      const target = q.target.derive ? parseUnit(q.target.derive).dim : quantityDim(q.target.quantity);
      return { kind: 'choice', index: q.options.findIndex((o) => dimEq(parseUnit(o).dim, target)), choices: q.options.map(fmtUnit) };
    }
    case 'graph': {
      const y = parseUnit(q.y).dim; const x = parseUnit(q.x).dim;
      const target = q.ask === 'slope' ? dimDiv(y, x) : dimMul(y, x);
      return { kind: 'choice', index: q.options.findIndex((o) => dimEq(parseUnit(o).dim, target)), choices: q.options.map(fmtUnit) };
    }
    case 'qty': {
      const target = parseUnit(q.unit).dim;
      return { kind: 'choice', index: q.options.findIndex((id) => dimEq(quantityDim(id), target)), choices: q.options.map((id) => QUANTITIES[id].he) };
    }
    case 'kind': return { kind: 'choice', index: QUANTITIES[q.quantity].kind === 'vector' ? 1 : 0, choices: KIND_CHOICES.slice() };
    case 'dim': return { kind: 'choice', index: formulaConsistent(q.lhs, q.rhs, q.symbols) ? 0 : 1, choices: YESNO_CHOICES.slice() };
    case 'conv': {
      const a = parseUnit(q.from); const b = parseUnit(q.to);
      if (!dimEq(a.dim, b.dim)) throw new Error(`${q.id}: cannot convert ${q.from} to ${q.to}`);
      return { kind: 'num', value: (q.value * a.scale) / b.scale, unit: q.to };
    }
    case 'calc': {
      let dim = ZERO.slice(); let si = 1;
      for (const t of q.terms) { const u = parseUnit(t.u); dim = dimMul(dim, u.dim); si *= t.v * u.scale; }
      const res = parseUnit(q.result);
      if (!dimEq(dim, res.dim)) throw new Error(`${q.id}: result unit ${q.result} does not match the terms`);
      return { kind: 'num', value: si / res.scale, unit: q.result };
    }
    default: throw new Error(`unknown question type ${q.type}`);
  }
}

/** Checks a response: a choice index (number) or typed text for numeric questions. -> { valid, correct } */
export function checkUnitsAnswer(q, response) {
  const a = answerOf(q);
  if (a.kind === 'choice') return { valid: Number.isInteger(response) && response >= 0 && response < a.choices.length, correct: response === a.index };
  const v = parseNumberText(response);
  if (v === null) return { valid: false, correct: false, error: 'כתבו מספר (למשל 20 או 0.025).' };
  return { valid: true, correct: Math.abs(v - a.value) <= 1e-6 * Math.max(1, Math.abs(a.value)) };
}
export const expectedText = (q) => { const a = answerOf(q); return a.kind === 'choice' ? a.choices[a.index] : `${fmtNum(a.value)} ${fmtUnit(a.unit)}`; };

/** Error-notebook entry of a units question: { title, key, href }, or null for an unknown id. */
export function describeUnits(id) {
  const q = QUESTIONS.find((x) => x.id === id);
  if (!q) return null;
  return { title: q.prompt.length > 70 ? `${q.prompt.slice(0, 67)}…` : q.prompt, key: `${expectedText(q)}. ${q.why}`, href: '#/units' };
}

export function validQuestion(q) {
  if (!isRec(q) || !/^un-\d+$/.test(q.id) || typeof q.prompt !== 'string' || typeof q.why !== 'string' || typeof q.cat !== 'string') return false;
  try {
    const a = answerOf(q);
    return a.kind === 'num' ? Number.isFinite(a.value) : a.index >= 0;
  } catch (e) { return false; }
}

/* ---------- saved state ---------- */
export const emptySaved = () => ({ v: 1, q: {} });
const cnt = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
export function sanitizeSaved(raw) {
  const out = emptySaved();
  if (!isRec(raw) || !isRec(raw.q)) return out;
  const ids = new Set(QUESTIONS.map((q) => q.id));
  for (const [id, e] of Object.entries(raw.q)) {
    if (ids.has(id) && isRec(e)) out.q[id] = { right: cnt(e.right), wrong: cnt(e.wrong), ts: Number.isFinite(e.ts) && e.ts > 0 ? e.ts : 0, last: e.last === 1 ? 1 : 0 };
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptySaved(); }
}
export function saveSaved(s, storage = globalThis.localStorage) { safeSetItem(KEY, JSON.stringify(sanitizeSaved(s)), storage); }
export function recordResult(saved, id, correct, now = Date.now()) {
  const e = saved.q[id] || (saved.q[id] = { right: 0, wrong: 0, ts: 0, last: 0 });
  if (correct) e.right += 1; else e.wrong += 1;
  e.ts = now; e.last = correct ? 1 : 0;
  return saved;
}
/** Questions answered correctly last time count as "known". */
export const knownCount = (saved) => QUESTIONS.filter((q) => saved.q[q.id] && saved.q[q.id].last === 1).length;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const shuffleSeeded = (arr, seed) => {
  const r = mulberry32(seed); const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
/** n questions for a session: never answered first, then missed last time, then the longest ago. Order shuffled by seed. */
export function pickSession(saved, n = SESSION_SIZE, seed = 1, cat = null) {
  const pool = QUESTIONS.filter((q) => !cat || q.cat === cat);
  const rank = (q) => { const e = saved.q[q.id]; return !e ? 0 : e.last === 0 ? 1 : 2; };
  const sorted = shuffleSeeded(pool, seed).sort((a, b) => rank(a) - rank(b) || ((saved.q[a.id] || {}).ts || 0) - ((saved.q[b.id] || {}).ts || 0));
  return shuffleSeeded(sorted.slice(0, n), seed + 1);
}
export const CATS = [
  { id: 'si', title: 'יחידות SI של גדלים נגזרים' }, { id: 'qty', title: 'איזה גודל היחידה מודדת' }, { id: 'conv', title: 'המרות יחידות' },
  { id: 'calc', title: 'חישובים הנדסיים עם יחידות' }, { id: 'dim', title: 'בדיקת ממדים של נוסחה' }, { id: 'kind', title: 'סקלר או וקטור' }, { id: 'graph', title: 'שיפוע ושטח בגרף' },
];
