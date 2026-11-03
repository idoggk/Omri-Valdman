// Exam-day routine (#/examday): a 5-minute rehearsal checklist done the day before and on the morning of the exam.
// Pure logic: the timer (clock injected), picking 5 random formulas, the time allocation computed from marks, the saved
// completion record and its restore merge. js/examday-ui.js draws the page.
import { safeSetItem } from './storage.js';

export const KEY = 'omri-study-examday-v1';
export const DURATION_MS = 5 * 60 * 1000;
export const WINDOW_DAYS = 14; // the plan screen offers the routine during the last two weeks
export const FORMULA_COUNT = 5;

/** Is the exam within the last two weeks (today counts)? `daysLeft` comes from plan.js (null without a date). */
export const inWindow = (daysLeft) => Number.isFinite(daysLeft) && daysLeft >= 0 && daysLeft <= WINDOW_DAYS;

/* ---------- the checklist texts (Hebrew) ---------- */
export const MATERIALS = [
  'תעודת זהות או כרטיס סטודנט',
  'שני עטים כחולים או שחורים ועט רזרבי',
  'עיפרון, מחק וסרגל',
  'מחשבון מותר, עם סוללות תקינות',
  'דף נוסחאות מותר (אם מותר) ושעון יד',
  'בקבוק מים וחטיף קטן',
];
export const SIGN_REMINDERS = [
  'בפיזיקה g = 10 מ/ש². כתבו את זה בראש הדף.',
  'לפני החישוב קבעו כיוון חיובי לציר, ורשמו אותו בשרטוט (למשל y כלפי מעלה).',
  'מהירות, תאוצה והעתק הם וקטורים: סימן שלילי אומר כיוון הפוך, ואינו טעות.',
  'עם ציר y כלפי מעלה, תאוצת הכובד היא a = −g.',
  'כפל או חילוק באי־שוויון במספר שלילי הופך את הכיוון.',
  'שורש ריבועי הוא אי־שלילי, וחזקה זוגית אי־שלילית.',
];
export const ANSWER_CHECKS = [
  'הציבו את התשובה בחזרה במשוואה המקורית.',
  'בדקו תחום הגדרה: מכנה שונה מאפס, מה שבתוך שורש אי־שלילי, מה שבתוך לוגריתם חיובי.',
  'בדקו יחידות: האם התוצאה יוצאת במ׳, בש׳ או במ/ש כמו שצריך?',
  'שאלו אם הסדר גודל הגיוני (מכונית במהירות 3000 מ/ש היא סימן לטעות).',
  'ודאו שענו על מה שנשאל: ערך אחד, כל הפתרונות, או תחום.',
];
export const READ_PAPER = [
  'קראו את כל המבחן לפני שמתחילים, כולל כל הסעיפים.',
  'סמנו את השאלות שנראות קלות והתחילו מהן.',
  'ליד כל שאלה כתבו בקצרה כמה דקות היא מקבלת (לפי הנקודות).',
  'השאירו לעצמכם כמה דקות לבדיקה בסוף.',
];
export const BREATHING = {
  intro: 'שלושה סבבים של נשימה איטית: שאיפה דרך האף, עצירה קצרה, ונשיפה ארוכה מהפה. כתפיים רפויות.',
  phases: [{ label: 'שאפו', seconds: 4 }, { label: 'עצרו', seconds: 4 }, { label: 'נשפו', seconds: 6 }],
  cycles: 3,
};

/* ---------- timer with an injected clock ---------- */
/**
 * createTimer({ now, total }) -> { start, pause, resume, reset, remainingMs, elapsedMs, running, started, finished }.
 * `now` is a function returning milliseconds (injected, so the tests never wait).
 */
export function createTimer({ now = () => Date.now(), total = DURATION_MS } = {}) {
  let acc = 0; // elapsed while paused or finished
  let t0 = null; // start of the current running stretch
  const elapsed = () => Math.min(total, acc + (t0 === null ? 0 : Math.max(0, now() - t0)));
  return {
    start() { if (t0 === null && acc < total) t0 = now(); },
    pause() { if (t0 !== null) { acc = elapsed(); t0 = null; } },
    resume() { if (t0 === null && acc < total) t0 = now(); },
    reset() { acc = 0; t0 = null; },
    elapsedMs: elapsed,
    remainingMs: () => total - elapsed(),
    running: () => t0 !== null && elapsed() < total,
    started: () => t0 !== null || acc > 0,
    finished: () => elapsed() >= total,
  };
}
export const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* ---------- 5 random formulas of the catalogue ---------- */
/** Picks `n` distinct formulas of kind 'expr' (the equivalence-checked ones), spreading over topics first. `rnd` is injected. */
export function pickFormulas(items, rnd = Math.random, n = FORMULA_COUNT) {
  const pool = (Array.isArray(items) ? items : []).filter((q) => q && q.kind === 'expr');
  const shuffle = (list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const byTopic = new Map();
  for (const q of shuffle(pool)) { if (!byTopic.has(q.topic)) byTopic.set(q.topic, []); byTopic.get(q.topic).push(q); }
  const lists = shuffle([...byTopic.values()]);
  const out = [];
  for (let round = 0; out.length < n && lists.some((l) => l.length > round); round++) {
    for (const l of lists) { if (out.length < n && l[round]) out.push(l[round]); }
  }
  return out;
}

/* ---------- time allocation from marks ---------- */
/** "25, 25 20 30" -> [25,25,20,30]; null when empty or not positive numbers (at most 20 questions). */
export function parseMarks(text) {
  const parts = String(text == null ? '' : text).split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || parts.length > 20) return null;
  const nums = parts.map(Number);
  return nums.every((x) => Number.isFinite(x) && x > 0) ? nums : null;
}
/**
 * Splits the exam time by marks. First `readMinutes` for reading the whole paper and `reviewShare` of the time for the final check;
 * the rest is divided in proportion to the marks, in whole minutes that add up exactly (largest remainder).
 * Returns { ok, read, review, perQuestion: [{ n, marks, minutes }] } or { ok:false, error }.
 */
export function allocateTime(totalMinutes, marks, { readMinutes = 5, reviewShare = 0.1 } = {}) {
  const T = Number(totalMinutes);
  if (!Number.isFinite(T) || T < 10 || T > 600 || !Array.isArray(marks) || !marks.length) return { ok: false, error: 'הזינו זמן מבחן בדקות (10 עד 600) ונקודות לכל שאלה.' };
  const read = Math.min(readMinutes, Math.floor(T / 5));
  const review = Math.round(T * reviewShare);
  const work = T - read - review;
  const sum = marks.reduce((s, m) => s + m, 0);
  const exact = marks.map((m) => (work * m) / sum);
  const mins = exact.map(Math.floor);
  let left = work - mins.reduce((s, m) => s + m, 0);
  exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i).forEach(({ i }) => { if (left > 0) { mins[i]++; left--; } });
  return { ok: true, read, review, perQuestion: marks.map((m, i) => ({ n: i + 1, marks: m, minutes: mins[i] })) };
}

/* ---------- saved record: { v, count, last, lastSeconds, lastFormulas: { ok, n } | null } ---------- */
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
export const emptyState = () => ({ v: 1, count: 0, last: null, lastSeconds: 0, lastFormulas: null });
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw)) return out;
  out.count = nn(raw.count);
  out.last = Number.isFinite(raw.last) && raw.last > 0 ? raw.last : null;
  out.lastSeconds = nn(raw.lastSeconds);
  if (isRec(raw.lastFormulas) && Number.isFinite(raw.lastFormulas.n) && raw.lastFormulas.n >= 0) {
    const n = Math.min(FORMULA_COUNT, nn(raw.lastFormulas.n));
    out.lastFormulas = { ok: Math.min(n, nn(raw.lastFormulas.ok)), n };
  }
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export function save(state, storage = globalThis.localStorage) { return safeSetItem(KEY, JSON.stringify(state), storage); }

/** Records one finished rehearsal (count + last date). Mutates and returns the state. */
export function recordCompletion(state, { now = Date.now(), seconds = 0, formulas = null } = {}) {
  state.count += 1;
  state.last = now;
  state.lastSeconds = nn(seconds);
  state.lastFormulas = formulas ? sanitize({ lastFormulas: formulas }).lastFormulas : state.lastFormulas;
  return state;
}
/** Hebrew line for the saved record. */
export function statusText(state, now = Date.now()) {
  if (!state.count) return 'עוד לא עשיתם את החזרה.';
  const days = Math.floor((now - state.last) / 86400000);
  const when = days <= 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
  return `עשיתם ${state.count} ${state.count === 1 ? 'פעם אחת' : 'פעמים'}. הפעם האחרונה: ${when}.`;
}
/** Restore merge (strings in, string out): the larger count, the later date (with that date's details). */
export function mergeExamday(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return emptyState(); } };
  const a = parse(localRaw), b = parse(backupRaw);
  const later = (b.last || 0) > (a.last || 0) ? b : a;
  return JSON.stringify({ ...later, count: Math.max(a.count, b.count) });
}
