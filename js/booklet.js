// Printable mock-exam booklet (#/booklet). Pure logic: a SEPARATE pool of 12 original long questions (data/booklet.json:
// 6 math, 6 physics, 4-6 lettered parts each, 25 nominal marks per question), a deterministic paper builder
// (subject + question count + seed -> same paper every time, always 100 marks), and the self-marked results history.
// Handwritten work is never auto-graded: the student enters the points he gave himself per part (js/booklet-ui.js).
// Results go to the attempt log under topic 'booklet-<subject>' (reserved: kept out of topic stats and the review
// schedule, see srs.isReservedTopic) with the score fraction, and to a small history list in omri-study-booklet-v1.
import { safeSetItem } from './storage.js';

export const KEY = 'omri-study-booklet-v1';
export const DATA_FILE = 'data/booklet.json';
export const SUBJECTS = [
  { id: 'math', label: 'מתמטיקה' },
  { id: 'physics', label: 'פיזיקה' },
];
export const subjectLabel = (id) => (SUBJECTS.find((s) => s.id === id) || { label: id }).label;
export const bookletTopic = (subject) => `booklet-${subject}`;
export const COUNTS = [3, 4];
export const TOTAL = 100;
export const MINUTES = 90;
export const PAGE_LINES = 40; // rough number of text lines on one A4 page; questions longer than this start on a fresh page
export const MAX_HISTORY = 30;
export const SEED_MAX = 999999;
export const LETTERS = { a: 'א', b: 'ב', c: 'ג', d: 'ד', e: 'ה', f: 'ו' };
export const GOOD_FRACTION = 0.6; // at or above this the mock counts as a pass for the attempt log

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

/* ---------- data ---------- */
export function validQuestion(q) {
  if (!isRec(q) || typeof q.id !== 'string' || !q.id.startsWith('bk-') || !SUBJECTS.some((s) => s.id === q.subject)) return false;
  if (typeof q.title !== 'string' || typeof q.stem !== 'string' || !Array.isArray(q.parts) || q.parts.length < 4 || q.parts.length > 6) return false;
  return q.parts.every((p) => isRec(p) && typeof p.id === 'string' && Number.isInteger(p.marks) && p.marks > 0 && typeof p.ask === 'string'
    && typeof p.answer === 'string' && Array.isArray(p.solution) && Array.isArray(p.rubric) && p.rubric.length > 0
    && p.rubric.every((r) => Array.isArray(r) && Number.isInteger(r[0]) && r[0] > 0 && typeof r[1] === 'string')
    && p.rubric.reduce((s, r) => s + r[0], 0) === p.marks)
    && q.parts.reduce((s, p) => s + p.marks, 0) === 25;
}

let cache = null;
export const resetBookletCache = () => { cache = null; };
export async function loadBookletData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn(DATA_FILE, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!isRec(d) || !Array.isArray(d.questions)) throw new Error('bad shape');
    const questions = d.questions.filter(validQuestion);
    if (!SUBJECTS.every((s) => questions.filter((q) => q.subject === s.id).length >= Math.max(...COUNTS))) throw new Error('pool too small');
    cache = questions;
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}

/* ---------- deterministic paper ---------- */
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Largest-remainder split of `total` into integers proportional to `weights` (sums exactly to total, ties to the earlier index). */
export function allocate(weights, total) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (w * total) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i] += 1;
  return out;
}

/** Blank answer lines under a part: more marks, more room. */
export const answerLines = (marks) => Math.max(3, Math.round(marks * 0.9) + 1);
/** Rough line count of a whole question block (stem, equations, asks and the answer space). */
export const estimateLines = (q) => 3 + (q.eq ? q.eq.length : 0) + q.parts.reduce((s, p) => s + 2 + answerLines(p.marks), 0);

export const paperKey = (subject, count, seed) => `${subject}-${count}-${seed}`;
export const validSeed = (s) => Number.isInteger(s) && s >= 1 && s <= SEED_MAX;
export const parseSeed = (x) => { const n = Number(x); return validSeed(n) ? n : null; };

/**
 * buildPaper(questions, subject, count, seed) -> paper { key, subject, count, seed, minutes, total, questions:[...] }.
 * The same arguments always give the same paper. Question totals add up to exactly 100 (25 each for 4 questions;
 * 34 / 33 / 33 for 3, the 34 going to a seed-chosen question); part marks and rubric lines are scaled by largest remainder.
 */
export function buildPaper(questions, subject, count, seed) {
  if (!SUBJECTS.some((s) => s.id === subject) || !COUNTS.includes(count) || !validSeed(seed)) return null;
  const pool = questions.filter((q) => q.subject === subject);
  if (pool.length < count) return null;
  const rnd = mulberry32(seed * 7919 + count);
  const order = pool.map((q, i) => ({ q, k: rnd(), i })).sort((a, b) => a.k - b.k || a.i - b.i).slice(0, count).map((x) => x.q);
  const totals = allocate(order.map(() => 1), TOTAL);
  const rot = Math.floor(rnd() * count); // which question receives the extra mark when 100 does not divide evenly
  const shifted = totals.map((_, i) => totals[(i + rot) % count]);
  const qs = order.map((q, qi) => {
    const marks = allocate(q.parts.map((p) => p.marks), shifted[qi]);
    const parts = q.parts.map((p, pi) => ({
      id: p.id, letter: LETTERS[p.id] || p.id, ask: p.ask, marks: marks[pi], lines: answerLines(marks[pi]), answer: p.answer, solution: p.solution, unit: p.unit || '',
      rubric: allocate(p.rubric.map((r) => r[0]), marks[pi]).map((pts, ri) => [pts, p.rubric[ri][1]]).filter((r) => r[0] > 0),
    }));
    const lines = estimateLines({ eq: q.eq, parts });
    return { id: q.id, n: qi + 1, title: q.title, stem: q.stem, eq: q.eq || [], total: shifted[qi], parts, lines, fits: lines <= PAGE_LINES };
  });
  return { key: paperKey(subject, count, seed), subject, count, seed, minutes: MINUTES, total: qs.reduce((s, q) => s + q.total, 0), questions: qs };
}

/** Part ids of a paper as ['bk-m1.a', ...] with their max marks, in paper order. */
export const paperParts = (paper) => paper.questions.flatMap((q) => q.parts.map((p) => ({ key: `${q.id}.${p.id}`, qn: q.n, letter: p.letter, max: p.marks })));

/* ---------- saved results ---------- */
const cleanResult = (r) => {
  if (!isRec(r) || typeof r.key !== 'string' || !SUBJECTS.some((s) => s.id === r.subject)) return null;
  const parts = {};
  if (isRec(r.parts)) for (const [k, v] of Object.entries(r.parts)) if (k.length <= 20 && Number.isFinite(v) && v >= 0 && v <= TOTAL) parts[k] = Math.floor(v);
  const total = Math.min(TOTAL, Math.floor(nn(r.total)));
  return {
    key: r.key.slice(0, 40), subject: r.subject, count: COUNTS.includes(r.count) ? r.count : 4, seed: validSeed(r.seed) ? r.seed : 1,
    ts: nn(r.ts), total, max: TOTAL, fraction: Math.round(Math.min(1, total / TOTAL) * 100) / 100, minutes: Math.min(600, Math.floor(nn(r.minutes))), parts,
  };
};
export const emptySaved = () => ({ v: 1, results: [] });
export function sanitizeSaved(raw) {
  const out = emptySaved();
  if (isRec(raw) && Array.isArray(raw.results)) out.results = raw.results.map(cleanResult).filter(Boolean).slice(-MAX_HISTORY);
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptySaved(); }
}
export function saveSaved(state, storage = globalThis.localStorage) {
  return safeSetItem(KEY, JSON.stringify(state), storage);
}

/**
 * Validates self-marked points: scores = { 'bk-m1.a': 3, ... } against the paper. Blank part = 0. Returns
 * { ok, error?, parts, total } where every part is an integer in 0..max.
 */
export function checkScores(paper, scores) {
  const parts = {};
  let total = 0;
  for (const p of paperParts(paper)) {
    const raw = isRec(scores) ? scores[p.key] : undefined;
    const v = raw === '' || raw == null ? 0 : Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > p.max) return { ok: false, error: `בסעיף ${p.letter} של שאלה ${p.qn} אפשר להזין מספר שלם בין 0 ל־${p.max}.` };
    parts[p.key] = v;
    total += v;
  }
  return { ok: true, parts, total };
}

/**
 * Stores the result (mutates and returns { state, entry, isNew }). A paper entered again updates its entry
 * instead of adding a second one, so the history shows one line per paper.
 */
export function recordResult(state, paper, scores, minutes = 0, now = Date.now()) {
  const c = checkScores(paper, scores);
  if (!c.ok) return { ok: false, error: c.error };
  const entry = cleanResult({ key: paper.key, subject: paper.subject, count: paper.count, seed: paper.seed, ts: now, total: c.total, minutes, parts: c.parts });
  const i = state.results.findIndex((r) => r.key === paper.key);
  if (i >= 0) state.results[i] = entry; else state.results.push(entry);
  state.results = state.results.slice(-MAX_HISTORY);
  return { ok: true, state, entry, isNew: i < 0 };
}

/** Attempt-log record for a mock result: self-marked, so never 'alone'; the fraction travels in `score`. */
export const attemptFor = (entry) => ({
  exerciseId: `mock-${entry.key}`, topic: bookletTopic(entry.subject), outcome: entry.fraction >= GOOD_FRACTION ? 'hinted' : 'wrong', hintsUsed: 0,
  seconds: entry.minutes * 60, score: entry.fraction,
});

/** Per subject: { n, avg, last, best } over the history list; null for a subject with no results. */
export function historySummary(state) {
  return Object.fromEntries(SUBJECTS.map((s) => {
    const rs = state.results.filter((r) => r.subject === s.id);
    if (!rs.length) return [s.id, null];
    const avg = rs.reduce((x, r) => x + r.fraction, 0) / rs.length;
    return [s.id, { n: rs.length, avg: Math.round(avg * 100) / 100, last: rs[rs.length - 1].fraction, best: Math.max(...rs.map((r) => r.fraction)) }];
  }));
}

/** Compact data for the feedback export from the attempt log (booklet topics only). null when there are none. */
export function bookletSummary(log) {
  const rows = (Array.isArray(log) ? log : []).filter((a) => a && typeof a.topic === 'string' && a.topic.startsWith('booklet-') && Number.isFinite(a.score));
  if (!rows.length) return null;
  const out = {};
  for (const s of SUBJECTS) {
    const rs = rows.filter((a) => a.topic === bookletTopic(s.id));
    if (rs.length) out[s.id] = { mocks: rs.length, avgScore: Math.round((rs.reduce((x, a) => x + a.score, 0) / rs.length) * 100) / 100, lastScore: rs[rs.length - 1].score };
  }
  return out;
}
