// Exam strategy replay. During a booklet mock and the transfer test the student's moves are logged with timestamps
// (opened, answered, skipped, revisited, finished); afterwards a timeline shows the order attempted, the time per question
// against the marks it was worth, what was skipped and returned to, and 2-3 plain Hebrew lessons. Pure logic: the clock and the
// storage are injected. js/replay-ui.js draws it.
//
// log = { key, kind: 'booklet'|'transfer', startedAt, finishedAt|null, events: [ { t, type, q } ] }   (t = ms timestamp)
//   type: 'open' (first time a question is opened) | 'revisit' (opened again) | 'answer' | 'skip' | 'finish'
// Time between two events belongs to the question that was open; a gap longer than IDLE_MS is a break and counts for nothing,
// so the per-question seconds always add up to the active session time.
import { safeSetItem } from './storage.js';

export const KEY = 'omri-study-replay-v1';
export const KINDS = ['booklet', 'transfer', 'recovery'];
export const TYPES = ['open', 'revisit', 'answer', 'skip', 'finish'];
export const IDLE_MS = 20 * 60000;
export const MAX_LOGS = 12;
export const MAX_EVENTS = 400;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

/* ---------- recorder (mutates a log) ---------- */
export const newLog = (kind, key, now) => ({ key: str(key, 60), kind, startedAt: nn(now), finishedAt: null, events: [] });

/** Adds an event. `open` of a question opened before becomes `revisit`. Returns the stored event, or null when the log is finished / unusable. */
export function logEvent(log, type, q, now) {
  if (!isRec(log) || log.finishedAt || !TYPES.includes(type) || log.events.length >= MAX_EVENTS) return null;
  let kind = type;
  if (type === 'open' && log.events.some((e) => e.q === q && (e.type === 'open' || e.type === 'revisit'))) kind = 'revisit';
  const last = log.events[log.events.length - 1];
  if (last && (kind === 'open' || kind === 'revisit') && last.q === q && last.type !== 'answer' && last.type !== 'skip') return null; // already there
  const ev = { t: Math.max(nn(now), last ? last.t : 0), type: kind, q: kind === 'finish' ? '' : str(q, 40) };
  log.events.push(ev);
  if (kind === 'finish') log.finishedAt = ev.t;
  return ev;
}

/* ---------- timeline ---------- */
/**
 * questions = [{ key, label, marks, earned? }] (marks available, marks earned when known).
 * Returns { seconds (active), perQuestion: [...], order: [keys], lessons: [...] }.
 */
export function buildTimeline(log, questions, endT = null) {
  const evs = log && Array.isArray(log.events) ? log.events : [];
  const end = Math.max(nn(endT ?? (log && log.finishedAt) ?? 0), evs.length ? evs[evs.length - 1].t : 0);
  const per = new Map(questions.map((q) => [q.key, {
    key: q.key, label: q.label, marks: nn(q.marks), earned: Number.isFinite(q.earned) ? q.earned : null,
    seconds: 0, visits: 0, answered: false, skipped: false, returned: false, firstOpen: null,
  }]));
  const order = [];
  let cur = null; // question key currently open
  let from = log ? log.startedAt : 0;
  let active = 0;
  const spend = (to) => {
    const gap = to - from;
    if (gap > 0 && gap <= IDLE_MS) { active += gap; if (cur && per.has(cur)) per.get(cur).seconds += gap; }
    from = Math.max(from, to);
  };
  for (const e of evs) {
    spend(e.t);
    const p = per.get(e.q);
    if (e.type === 'open' || e.type === 'revisit') {
      if (!p) { cur = null; continue; }
      cur = e.q; p.visits += 1;
      if (p.firstOpen == null) { p.firstOpen = e.t; order.push(e.q); }
      if (e.type === 'revisit' && p.skipped) p.returned = true;
    } else if (e.type === 'answer' && p) p.answered = true;
    else if (e.type === 'skip' && p) { p.skipped = true; p.answered = false; }
    else if (e.type === 'finish') cur = null;
  }
  if (!log || !log.finishedAt) spend(end);
  const rows = [...per.values()].map((p) => ({ ...p, seconds: Math.round(p.seconds / 1000) }));
  const totalSeconds = Math.round(active / 1000);
  return { seconds: totalSeconds, activeMs: active, perQuestion: rows, order, lessons: lessonsOf(rows, totalSeconds) };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const marksWord = (n) => `${n} ${n === 1 ? 'נקודה' : 'נקודות'}`;

/** 2-3 plain Hebrew lessons from the per-question rows. Never more than 3, never empty when something was logged. */
export function lessonsOf(rows, totalSeconds) {
  const out = [];
  const totalMarks = rows.reduce((s, r) => s + r.marks, 0);
  if (!totalSeconds || !totalMarks) return out;
  const share = (r) => r.seconds / totalSeconds;
  const worth = (r) => r.marks / totalMarks;
  // 1. the biggest overspend relative to the marks the question was worth
  const over = rows.filter((r) => r.seconds > 0).map((r) => ({ r, gap: share(r) - worth(r) })).sort((a, b) => b.gap - a.gap)[0];
  if (over && over.gap >= 0.1) {
    const r = over.r;
    const lost = r.earned != null && r.earned < r.marks ? ` וקיבלתם ${r.earned} מתוך ${r.marks}` : '';
    out.push(`הקדשתם ${pct(share(r))} מהזמן ל${r.label}, שהיא שווה ${marksWord(r.marks)} (${pct(worth(r))} מהניקוד)${lost}. כשמשהו לוקח הרבה יותר זמן ממה שהוא שווה, כדאי לעבור הלאה ולחזור אליו בסוף.`);
  } else {
    out.push('חלוקת הזמן שלכם הייתה קרובה למשקל הניקוד של השאלות: אף שאלה לא אכלה זמן גדול בהרבה ממה שהיא שווה.');
  }
  // 2. skipping behaviour
  const skipped = rows.filter((r) => r.skipped);
  const back = skipped.filter((r) => r.returned);
  const never = rows.filter((r) => r.visits === 0 && r.marks > 0);
  if (back.length) out.push(`דילגתם על ${back.map((r) => r.label).join(', ')} וחזרתם אליה${back.length > 1 ? ' בהמשך' : ''}: זה בדיוק מה שעושים במבחן אמיתי.`);
  else if (skipped.length) out.push(`דילגתם על ${skipped.map((r) => r.label).join(', ')} ולא חזרתם. אם נשאר זמן, חזרה לשאלה שדילגתם עליה היא הדרך הזולה ביותר להוסיף נקודות.`);
  else if (never.length) out.push(`לא פתחתם את ${never.map((r) => r.label).join(', ')} (${marksWord(never.reduce((s, r) => s + r.marks, 0))}). עברו על כל השאלות בתחילת המבחן, כדי שלא תפספסו נקודות קלות.`);
  else out.push('לא דילגתם על אף שאלה. אם הייתה שאלה שנתקעתם בה, בפעם הבאה נסו לסמן אותה, לעבור הלאה ולחזור.');
  // 3. points per minute, when marks earned are known
  const scored = rows.filter((r) => r.earned != null && r.seconds >= 30);
  if (scored.length >= 2) {
    const rate = (r) => r.earned / (r.seconds / 60);
    const best = [...scored].sort((a, b) => rate(b) - rate(a))[0];
    const worst = [...scored].sort((a, b) => rate(a) - rate(b))[0];
    if (best !== worst) out.push(`הנקודות לדקה הכי גבוהות היו ב${best.label} (${(Math.round(rate(best) * 10) / 10)}), והכי נמוכות ב${worst.label} (${(Math.round(rate(worst) * 10) / 10)}). התחילו בשאלות מהסוג הראשון.`);
  }
  return out.slice(0, 3);
}

/** Short one-line summary of a finished log for the journal comparison. */
export function summaryLine(tl) {
  if (!tl || !tl.perQuestion.length || !tl.seconds) return '';
  const top = [...tl.perQuestion].sort((a, b) => b.seconds - a.seconds)[0];
  const skipped = tl.perQuestion.filter((r) => r.skipped).length;
  return `סדר הפתרון: ${tl.order.length ? tl.order.map((k) => tl.perQuestion.find((r) => r.key === k).label).join(' ← ') : 'לא נרשם'}. הכי הרבה זמן: ${top.label} (${pct(top.seconds / tl.seconds)}). ${skipped ? `דילגתם על ${skipped}.` : 'בלי דילוגים.'}`;
}

/* ---------- saved state: { v: 1, logs: { [key]: log } } ---------- */
export function cleanLog(l, key) {
  if (!isRec(l) || !KINDS.includes(l.kind) || !Array.isArray(l.events)) return null;
  const events = l.events.filter((e) => isRec(e) && TYPES.includes(e.type) && Number.isFinite(e.t) && e.t >= 0)
    .slice(0, MAX_EVENTS).map((e) => ({ t: e.t, type: e.type, q: str(e.q, 40) }));
  return { key: str(key || l.key, 60), kind: l.kind, startedAt: nn(l.startedAt), finishedAt: Number.isFinite(l.finishedAt) ? l.finishedAt : null, events };
}
export const emptyState = () => ({ v: 1, logs: {} });
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw) || !isRec(raw.logs)) return out;
  const rows = Object.entries(raw.logs).filter(([k]) => k && k.length <= 60).map(([k, l]) => cleanLog(l, k)).filter(Boolean);
  rows.sort((a, b) => a.startedAt - b.startedAt);
  for (const l of rows.slice(-MAX_LOGS)) out.logs[l.key] = l;
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export function save(state, storage = globalThis.localStorage) { return safeSetItem(KEY, JSON.stringify(state), storage); }

/** Restore merge (strings in, string out), by log key: the finished log wins, then the one with more events, then the local one. */
export function mergeReplay(localRaw, backupRaw) {
  const a = (() => { try { return sanitize(JSON.parse(localRaw)); } catch (e) { return emptyState(); } })();
  const b = (() => { try { return sanitize(JSON.parse(backupRaw)); } catch (e) { return emptyState(); } })();
  const all = { ...b.logs };
  for (const [k, x] of Object.entries(a.logs)) {
    const y = all[k];
    if (!y) { all[k] = x; continue; }
    const better = (!!x.finishedAt !== !!y.finishedAt) ? (x.finishedAt ? x : y) : x.events.length >= y.events.length ? x : y;
    all[k] = better;
  }
  return JSON.stringify(sanitize({ v: 1, logs: all }));
}
