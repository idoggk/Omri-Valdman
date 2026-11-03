// One-error recovery (#/recover): a worked solution of 5-7 steps with ONE early error. The learner (1) taps the first
// wrong step, (2) states the corrected value, (3) finishes the remaining parts that depend on the correction.
// This file is the pure part (data validation, grading with carry-forward detection, credit, saved results);
// js/recover-ui.js draws it. Answers reuse the #/mathhard answer specs (number / set / interval / points).
// Attempts go to the attempt log under topic 'recover-math' / 'recover-physics' (see engine.js).
import { safeSetItem } from './storage.js';
import { canonSpec, studentCanon, sameCanon } from './mathhard.js';

export const KEY = 'omri-study-recover-v1';
export const DATA_FILE = 'data/recover.json';
export const ID_PREFIX = 'rc-';
export const SUBJECTS = [
  { id: 'math', label: 'מתמטיקה' },
  { id: 'physics', label: 'פיזיקה' },
];
export const recoverTopic = (subject) => `recover-${subject}`;
export const MAX_POINTS = 3; // found the step + corrected it + finished the remaining parts

export const ERROR_LABELS = {
  'lost-root': 'שורש שאבד', 'sign-flip': 'היפוך סימן באי־שוויון', extraneous: 'פתרון זר (העלאה בריבוע בלי בדיקה)',
  'log-domain': 'תחום הלוגריתם', 'dropped-case': 'מקרה שלא נבדק (פרמטר)', 'wrong-identity': 'זהות שגויה', 'sqrt-abs': 'שורש בלי ערך מוחלט',
  'gravity-sign': 'סימן התאוצה', 'initial-sign': 'סימן המהירות ההתחלתית', 'mixed-components': 'ערבוב בין רכיב אופקי לאנכי',
  'wrong-component': 'רכיב שגוי בזווית', 'forgot-initial-height': 'שכחו את הגובה ההתחלתי', 'meeting-equation': 'משוואת מפגש שגויה',
};
export const errorLabel = (t) => ERROR_LABELS[t] || t;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const validSpec = (a) => {
  if (!isRec(a)) return false;
  try { canonSpec(a); return true; } catch (e) { return false; }
};

/* ---------- data ---------- */
export function validItem(q) {
  if (!isRec(q) || typeof q.id !== 'string' || !q.id.startsWith(ID_PREFIX) || !SUBJECTS.some((s) => s.id === q.subject)) return false;
  if (typeof q.title !== 'string' || typeof q.statement !== 'string' || typeof q.errorType !== 'string') return false;
  if (!Array.isArray(q.steps) || q.steps.length < 4 || q.steps.length > 8 || !q.steps.every((s) => typeof s === 'string')) return false;
  if (!Number.isInteger(q.firstWrong) || q.firstWrong < 0 || q.firstWrong >= q.steps.length) return false;
  if (typeof q.whyWrong !== 'string' || typeof q.correctedStep !== 'string') return false;
  if (!Array.isArray(q.hints) || q.hints.length !== 2 || !q.hints.every((x) => typeof x === 'string')) return false;
  if (!isRec(q.fix) || typeof q.fix.ask !== 'string' || !validSpec(q.fix.answer)) return false;
  return Array.isArray(q.finish) && q.finish.length >= 2
    && q.finish.every((p) => isRec(p) && typeof p.id === 'string' && typeof p.ask === 'string' && typeof p.solution === 'string'
      && validSpec(p.answer) && (p.ifError === undefined || (validSpec(p.ifError) && p.ifError.kind === p.answer.kind)));
}

let cache = null;
export const resetRecoverCache = () => { cache = null; };
export async function loadRecoverData(fetchFn = (u, o) => fetch(u, o)) {
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

/* ---------- grading ---------- */
/**
 * Grades one typed answer (input as read by the mathhard answer widget) against `part` = { answer, ifError? }.
 * -> { ok:false, error } unreadable | { ok:true, result:'correct' } | { ok:true, result:'from-error' } (it is what the erroneous
 * solution would give: the learner kept using the wrong step instead of the corrected value) | { ok:true, result:'wrong' }.
 */
export function gradeAnswer(part, input) {
  const r = studentCanon(part.answer.kind, input);
  if (!r.ok) return { ok: false, error: r.error };
  if (sameCanon(r.canon, canonSpec(part.answer))) return { ok: true, result: 'correct' };
  if (part.ifError && sameCanon(r.canon, canonSpec(part.ifError))) return { ok: true, result: 'from-error' };
  return { ok: true, result: 'wrong' };
}

/** Result of a whole visit: { found, fixed, finished, total, hints, wrongs } -> points 0..3 (the last third is the share of finished parts). */
export function pointsOf(r) {
  const total = Math.max(1, nn(r.total));
  return (r.found ? 1 : 0) + (r.fixed ? 1 : 0) + Math.min(1, nn(r.finished) / total);
}
/** 'alone' = every stage right with no hints and no wrong tries; 'hinted' = every stage right; otherwise 'wrong'. */
export function outcomeOf(r) {
  const full = !!r.found && !!r.fixed && nn(r.finished) >= Math.max(1, nn(r.total));
  if (!full) return 'wrong';
  return !nn(r.hints) && !nn(r.wrongs) ? 'alone' : 'hinted';
}
/** One line per stage for the summary: [{ key, label, done }]. */
export function creditLines(r) {
  return [
    { key: 'found', label: 'מצאתם את השלב השגוי', done: !!r.found },
    { key: 'fixed', label: 'תיקנתם את הערך', done: !!r.fixed },
    { key: 'finished', label: `השלמתם את ההמשך: ${nn(r.finished)} מתוך ${nn(r.total)} סעיפים`, done: nn(r.finished) >= nn(r.total) && nn(r.total) > 0 },
  ];
}

/* ---------- saved results: { v, items: { id: { attempts, best, found, fixed, finished, total, ts } } } ---------- */
export function sanitizeSaved(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e) || id.length > 80 || !id.startsWith(ID_PREFIX)) continue;
    out.items[id] = {
      attempts: nn(e.attempts), best: Number.isFinite(e.best) && e.best > 0 ? Math.min(MAX_POINTS, e.best) : 0,
      found: e.found === true, fixed: e.fixed === true, finished: nn(e.finished), total: nn(e.total), ts: Number.isFinite(e.ts) ? e.ts : 0,
    };
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return sanitizeSaved(null); }
}
export function recordResult(id, r, storage = globalThis.localStorage, now = Date.now()) {
  const d = loadSaved(storage);
  const it = d.items[id] || (d.items[id] = { attempts: 0, best: 0, found: false, fixed: false, finished: 0, total: 0, ts: 0 });
  const pts = pointsOf(r);
  it.attempts += 1;
  if (pts >= it.best) { it.best = pts; it.found = !!r.found; it.fixed = !!r.fixed; it.finished = nn(r.finished); it.total = nn(r.total); }
  it.ts = now;
  safeSetItem(KEY, JSON.stringify(d), storage);
  return it;
}
