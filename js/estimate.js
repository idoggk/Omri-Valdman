// Estimation before calculation (#/estimate). Pure logic: ranges, judging an estimate against the exact value computed by the
// question's function, saved results, session picker. js/estimate-ui.js draws it; the 24 questions are in js/estimate-data.js.
// A choice estimate is "bracketed" when the chosen range contains the exact value. A slider estimate is a low and a high end on a
// log axis: bracketed when low <= exact <= high, and "useful" only when high/low <= MAX_RATIO (an order of magnitude), because a
// range of 1 to 1,000,000 always brackets and says nothing.
import { safeSetItem } from './storage.js';
import { QUESTIONS, GROUPS } from './estimate-data.js';
import { shuffleSeeded } from './units.js';

export const KEY = 'omri-study-estimate-v1';
export const TOPIC = 'estimate';
export const SESSION_SIZE = 8;
export const MAX_RATIO = 10;
export const SLIDER_STEPS = 1000;
export { QUESTIONS, GROUPS };

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

export const exactOf = (q) => q.exact(q.p);
export function rangesOf(q) {
  const out = [];
  for (let i = 0; i + 1 < q.bounds.length; i++) out.push({ lo: q.bounds[i], hi: q.bounds[i + 1] });
  return out;
}
export const correctIndex = (q) => rangesOf(q).findIndex((r) => exactOf(q) >= r.lo && exactOf(q) < r.hi);

/** 1234567 -> "1,234,567"; 0.0711 -> "0.0711"; 15.588 -> "15.6". */
export function fmtVal(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US');
  return String(Number(v.toPrecision(3)));
}
export const rangeLabel = (q, i) => { const r = rangesOf(q)[i]; return `${fmtVal(r.lo)} עד ${fmtVal(r.hi)}${q.unit ? ` ${q.unit}` : ''}`; };

/* ---------- log slider ---------- */
export const sliderValue = (pos, axis) => axis[0] * Math.pow(axis[1] / axis[0], Math.min(1, Math.max(0, pos / SLIDER_STEPS)));
export const sliderPos = (v, axis) => Math.round((Math.log(v / axis[0]) / Math.log(axis[1] / axis[0])) * SLIDER_STEPS);

/* ---------- judging ---------- */
/** -> { bracketed, success, side: 'low'|'high'|null, exact, lo, hi } side says where the exact value lies relative to the choice. */
export function judgeChoice(q, index) {
  const exact = exactOf(q);
  const r = rangesOf(q)[index];
  if (!r) return { bracketed: false, success: false, side: null, exact, lo: null, hi: null };
  const bracketed = exact >= r.lo && exact < r.hi;
  return { bracketed, success: bracketed, side: bracketed ? null : exact >= r.hi ? 'high' : 'low', exact, lo: r.lo, hi: r.hi };
}
export function judgeSlider(q, a, b) {
  const exact = exactOf(q);
  const lo = Math.min(a, b); const hi = Math.max(a, b);
  const bracketed = exact >= lo && exact <= hi;
  const ratio = hi / lo;
  const tooWide = bracketed && ratio > MAX_RATIO;
  return { bracketed, tooWide, success: bracketed && !tooWide, side: bracketed ? null : exact > hi ? 'high' : 'low', exact, lo, hi, ratio };
}

/* ---------- saved state ---------- */
export const emptySaved = () => ({ v: 1, q: {} });
const cnt = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
export function sanitizeSaved(raw) {
  const out = emptySaved();
  if (!isRec(raw) || !isRec(raw.q)) return out;
  const ids = new Set(QUESTIONS.map((q) => q.id));
  for (const [id, e] of Object.entries(raw.q)) {
    if (ids.has(id) && isRec(e)) out.q[id] = { hit: cnt(e.hit), miss: cnt(e.miss), ts: Number.isFinite(e.ts) && e.ts > 0 ? e.ts : 0, last: e.last === 1 ? 1 : 0 };
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptySaved(); }
}
export function saveSaved(s, storage = globalThis.localStorage) { safeSetItem(KEY, JSON.stringify(sanitizeSaved(s)), storage); }
export function recordResult(saved, id, success, now = Date.now()) {
  const e = saved.q[id] || (saved.q[id] = { hit: 0, miss: 0, ts: 0, last: 0 });
  if (success) e.hit += 1; else e.miss += 1;
  e.ts = now; e.last = success ? 1 : 0;
  return saved;
}
/** Share of all recorded estimates that were successful, or null before the first one. */
export function hitRate(saved) {
  let hit = 0; let n = 0;
  for (const e of Object.values(saved.q)) { hit += e.hit; n += e.hit + e.miss; }
  return n ? hit / n : null;
}
export function pickSession(saved, n = SESSION_SIZE, seed = 1, group = null) {
  const pool = QUESTIONS.filter((q) => !group || q.group === group);
  const rank = (q) => { const e = saved.q[q.id]; return !e ? 0 : e.last === 0 ? 1 : 2; };
  const sorted = shuffleSeeded(pool, seed).sort((a, b) => rank(a) - rank(b) || ((saved.q[a.id] || {}).ts || 0) - ((saved.q[b.id] || {}).ts || 0));
  return shuffleSeeded(sorted.slice(0, n), seed + 1);
}
