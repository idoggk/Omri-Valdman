// Reserved transfer test (#/transfer): 24 unseen questions (12 math, 12 physics) that appear nowhere else in the app.
// First attempt only, no hints, no solution until the session is finished, a suggested time per question.
// This file is the pure part (data loading, validation, deterministic session picker, grading, saved state, result data);
// js/transfer-ui.js draws it. Results go to the attempt log under topic 'transfer-math' / 'transfer-physics' (see attemptFor),
// which feeds signal 5 of the ceiling detector (js/ceiling.js).
import { safeSetItem } from './storage.js';
import { canonSpec, studentCanon, sameCanon } from './mathhard.js';
import { parseNumber, TOL } from './multipart.js';
import { topicTitle, topicHref } from './engine.js';

export const KEY = 'omri-study-transfer-v1';
export const DATA_FILE = 'data/transfer.json';
export const ID_PREFIX = 'tr-';
export const SESSION_SIZE = 6;
export const PER_SUBJECT = 3;
export const SUBJECTS = [
  { id: 'math', label: 'מתמטיקה' },
  { id: 'physics', label: 'פיזיקה' },
];
export const subjectLabel = (id) => (SUBJECTS.find((s) => s.id === id) || { label: id }).label;
export const transferTopic = (subject) => `transfer-${subject}`;
export const PHYSICS_LETTERS = { a: 'א', b: 'ב', c: 'ג', d: 'ד', e: 'ה', f: 'ו' };

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/* ---------- data ---------- */
export function validItem(q) {
  if (!isRec(q) || typeof q.id !== 'string' || !q.id.startsWith(ID_PREFIX) || !SUBJECTS.some((s) => s.id === q.subject)) return false;
  if (typeof q.title !== 'string' || !Number.isFinite(q.budget) || q.budget <= 0 || !Array.isArray(q.covers) || !q.covers.length) return false;
  if (q.subject === 'math') {
    const a = q.answer;
    return typeof q.ask === 'string' && Array.isArray(q.eq) && q.eq.length > 0 && Array.isArray(q.steps) && q.steps.length > 0
      && isRec(a) && ['set', 'number', 'points', 'interval'].includes(a.kind);
  }
  return typeof q.stem === 'string' && Array.isArray(q.parts) && q.parts.length >= 3
    && q.parts.every((p) => isRec(p) && typeof p.id === 'string' && typeof p.ask === 'string' && Number.isFinite(p.answer) && typeof p.solution === 'string');
}

let cache = null;
export const resetTransferCache = () => { cache = null; };
export async function loadTransferData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn(DATA_FILE, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!Array.isArray(d)) throw new Error('not an array');
    cache = d.filter(validItem);
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}

/** exerciseId -> topics the question covers (for signal 5 of the ceiling detector). */
export const coversMap = (items) => new Map(items.map((q) => [q.id, q.covers]));

/* ---------- saved state: { v, seen: {id: result}, session: {ids, startedAt, results, finishedAt} | null, history: [...] } ---------- */
const cleanResult = (r) => (isRec(r) ? {
  correct: r.correct === true, score: nn(r.score), total: nn(r.total) || 1, seconds: nn(r.seconds), ts: Number.isFinite(r.ts) ? r.ts : 0,
} : null);

export function sanitizeSaved(raw) {
  const out = { v: 1, seen: {}, session: null, history: [] };
  if (!isRec(raw)) return out;
  if (isRec(raw.seen)) for (const [id, r] of Object.entries(raw.seen)) { const c = cleanResult(r); if (c && id.startsWith(ID_PREFIX)) out.seen[id] = c; }
  const s = raw.session;
  if (isRec(s) && Array.isArray(s.ids) && s.ids.length && s.ids.every((x) => typeof x === 'string' && x.startsWith(ID_PREFIX))) {
    const results = {};
    if (isRec(s.results)) for (const id of s.ids) { const c = cleanResult(s.results[id]); if (c) results[id] = c; }
    out.session = { ids: s.ids.slice(0, SESSION_SIZE), startedAt: Number.isFinite(s.startedAt) ? s.startedAt : 0, results, finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : null };
  }
  if (Array.isArray(raw.history)) {
    out.history = raw.history.filter(isRec).slice(-20).map((h) => ({
      ts: Number.isFinite(h.ts) ? h.ts : 0, math: nn(h.math), physics: nn(h.physics), mathTotal: nn(h.mathTotal), physicsTotal: nn(h.physicsTotal), seconds: nn(h.seconds),
    }));
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return sanitizeSaved(null); }
}
const store = (d, storage) => safeSetItem(KEY, JSON.stringify(d), storage);

/* ---------- session picker ---------- */

/**
 * Deterministic: from the questions not yet seen, in file order, 3 math + 3 physics (interleaved math, physics, ...).
 * If one subject has fewer than 3 left, the other fills the session up to 6; with fewer than 6 left it takes what remains.
 */
export function pickSession(items, seen = {}) {
  const unseen = items.filter((q) => !seen[q.id]);
  const by = (s) => unseen.filter((q) => q.subject === s).map((q) => q.id);
  const m = by('math');
  const p = by('physics');
  let nm = Math.min(m.length, PER_SUBJECT);
  let np = Math.min(p.length, PER_SUBJECT);
  let free = SESSION_SIZE - nm - np;
  const moreM = Math.min(free, m.length - nm); nm += moreM; free -= moreM;
  np += Math.min(free, p.length - np);
  const mm = m.slice(0, nm);
  const pp = p.slice(0, np);
  const out = [];
  for (let i = 0; i < Math.max(mm.length, pp.length); i++) { if (i < mm.length) out.push(mm[i]); if (i < pp.length) out.push(pp[i]); }
  return out.slice(0, SESSION_SIZE);
}

/** The unfinished session, a new one when there is none (saved), or null when nothing unseen is left. */
export function startSession(items, storage = globalThis.localStorage, now = Date.now()) {
  const d = loadSaved(storage);
  if (d.session && !d.session.finishedAt && d.session.ids.every((id) => items.some((q) => q.id === id))) return d.session;
  const ids = pickSession(items, d.seen);
  if (!ids.length) return null;
  d.session = { ids, startedAt: now, results: {}, finishedAt: null };
  store(d, storage);
  return d.session;
}

/** First unanswered question id of a session, or null when all are answered. */
export const nextQuestionId = (session) => (session ? session.ids.find((id) => !session.results[id]) || null : null);

/* ---------- grading ---------- */

/**
 * Math: input = answerWidget(...).read(). Unreadable input is { valid:false, error } and does not use up the attempt.
 * Physics: input = { partId: typed text }. A blank or unreadable part is wrong. Returns { valid, correct, score, total, parts }.
 */
export function gradeItem(item, input) {
  if (item.subject === 'math') {
    const r = studentCanon(item.answer.kind, input);
    if (!r.ok) return { valid: false, error: r.error };
    const ok = sameCanon(r.canon, canonSpec(item.answer));
    return { valid: true, correct: ok, score: ok ? 1 : 0, total: 1, parts: { main: ok } };
  }
  const parts = {};
  for (const p of item.parts) {
    const v = parseNumber(isRec(input) ? input[p.id] : '');
    parts[p.id] = Number.isFinite(v) && Math.abs(v - p.answer) <= TOL + 1e-9;
  }
  const score = Object.values(parts).filter(Boolean).length;
  return { valid: true, correct: score === item.parts.length, score, total: item.parts.length, parts };
}

/** Attempt-log record for one answered question: hint-free first try that is fully right = 'alone', anything else 'wrong'. */
export const attemptFor = (item, grade, seconds) => ({
  exerciseId: item.id, topic: transferTopic(item.subject), outcome: grade.skipped ? 'solution' : grade.correct ? 'alone' : 'wrong', hintsUsed: 0, seconds: nn(seconds),
});

/** "I have no answer": counts as missed (0 points) and is logged as abandoned, never as mastery. */
export const skipGrade = (item) => ({ valid: true, correct: false, skipped: true, score: 0, total: item.subject === 'math' ? 1 : item.parts.length, parts: {} });

/**
 * Stores the first answer to a question. Returns false (and changes nothing) when it was already answered:
 * the test counts the first attempt only. When the last question of the session is answered the session is finished.
 */
export function submitResult(items, id, grade, seconds, storage = globalThis.localStorage, now = Date.now()) {
  const d = loadSaved(storage);
  const s = d.session;
  if (!s || s.finishedAt || !s.ids.includes(id) || d.seen[id] || s.results[id]) return false;
  const r = { correct: grade.correct, score: grade.score, total: grade.total, seconds: nn(seconds), ts: now };
  d.seen[id] = r;
  s.results[id] = r;
  if (s.ids.every((x) => s.results[x])) {
    s.finishedAt = now;
    const sum = resultData(items, s);
    d.history = [...d.history, {
      ts: now, math: sum.perSubject.math.score, physics: sum.perSubject.physics.score,
      mathTotal: sum.perSubject.math.total, physicsTotal: sum.perSubject.physics.total, seconds: sum.seconds,
    }].slice(-20);
  }
  return store(d, storage) !== false;
}

/* ---------- result screen data ---------- */

/** Next step from what was missed: the most frequent primary topic among missed questions. titleOf/hrefOf are injectable. */
export function nextStep(missed, titleOf = (t) => topicTitle(t) || t, hrefOf = (t) => topicHref(t) || `#/topic/${t}`) {
  if (!missed.length) return { text: 'כל השאלות נפתרו נכון בניסיון ראשון. המשיכו לאימון היומי ולשאלות הקשות ביותר, ופתחו מבחן העברה חדש כשיהיה.', href: '#/workout/start', topic: null };
  const count = new Map();
  for (const m of missed) { const t = m.covers[0]; count.set(t, (count.get(t) || 0) + (m.total - m.score || 1)); }
  const top = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  return { text: `כדאי לחזור על "${titleOf(top)}" ואז לפתור שוב שאלה דומה: שם הוחמצו הכי הרבה סעיפים.`, href: hrefOf(top), topic: top };
}

/**
 * Pure data of the result screen for a session: score per subject, time, what was missed (with solutions to show),
 * and the recommended next step. Unanswered questions count as missed with 0 points.
 */
export function resultData(items, session, helpers = {}) {
  const byId = new Map(items.map((q) => [q.id, q]));
  const per = Object.fromEntries(SUBJECTS.map((s) => [s.id, { questions: 0, correct: 0, score: 0, total: 0, seconds: 0 }]));
  const missed = [];
  let seconds = 0;
  let budget = 0;
  for (const id of session.ids) {
    const q = byId.get(id);
    if (!q) continue;
    const r = session.results[id] || { correct: false, score: 0, total: q.subject === 'math' ? 1 : q.parts.length, seconds: 0 };
    const sub = per[q.subject];
    sub.questions++; sub.score += r.score; sub.total += r.total; sub.seconds += r.seconds;
    if (r.correct) sub.correct++;
    seconds += r.seconds; budget += q.budget;
    if (!r.correct) missed.push({ id, title: q.title, subject: q.subject, score: r.score, total: r.total, seconds: r.seconds, budget: q.budget, overBudget: r.seconds > q.budget, covers: q.covers });
  }
  return { perSubject: per, seconds, budget, questions: session.ids.length, missed, next: nextStep(missed, helpers.titleOf, helpers.hrefOf) };
}

export const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
