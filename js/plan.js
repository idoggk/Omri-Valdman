// Exam countdown and study plan (#/plan). Pure logic: no DOM, no storage reads (the load/save helpers take an injected storage),
// "now" is always passed in. The exam date is entered by hand; nothing here guesses it. Phases come from the weeks left, the
// weekday list from the phase plus the learner's own data (weak topics, topics with contentCeilingReached), and every number on
// the progress panel is computed from independent hint-free first attempts, mock results and transfer results only.
import { safeSetItem } from './storage.js';
import { weakTopics, withVirtual, isReservedTopic, dayKey, dueReviews } from './srs.js';
import { analyzeTopics, isIndependent, subjectOf } from './ceiling.js';
import { topicHref, topicTitle } from './engine.js';

export const KEY = 'omri-study-plan-v1';
export const DEFAULT_DAYS = 6;
export const DEFAULT_MINUTES = 40;
export const DEFAULT_WEEKS = 8; // neutral horizon when no exam date was entered
export const MAX_TICK_DAYS = 28;
export const WEAK_SCORE = 0.8; // same line the home screen uses for "weak topic"
export const WEAK_MIN_ATTEMPTS = 3;
export const MIN_READY = 5; // independent-practice rate needs at least this many first attempts
export const READY_WINDOW_DAYS = 28;
export const MOCK_MINUTES = 90;
const DAY_MS = 86400000;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/* ---------- dates ---------- */
/** 'YYYY-MM-DD' -> true only for a real calendar date. */
export function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return y >= 2000 && y <= 2100 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}
const utcDay = (y, m, d) => Date.UTC(y, m, d);
/** Whole local days from `now`'s date to the date string (negative when it has passed); null for no/invalid date. */
export function daysUntil(dateStr, now) {
  if (!validDate(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const n = new Date(now);
  return Math.round((utcDay(y, m - 1, d) - utcDay(n.getFullYear(), n.getMonth(), n.getDate())) / DAY_MS);
}
export const weeksLeftOf = (days) => (days <= 0 ? 0 : Math.ceil(days / 7));
/** Local midnight of the Sunday that starts the week containing `now`. */
export function weekStart(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
}
const addDays = (ts, n) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const dayStart = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/* ---------- settings: { v, examDate, physicsDate, days, minutes, ticks: { 'YYYY-MM-DD': [slotKey] } } ---------- */
export const emptySettings = () => ({ v: 1, examDate: null, physicsDate: null, days: DEFAULT_DAYS, minutes: DEFAULT_MINUTES, ticks: {} });
const clampInt = (n, lo, hi, dflt) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= lo && x <= hi ? x : dflt; };
export function sanitizeSettings(raw) {
  const out = emptySettings();
  if (!isRec(raw)) return out;
  if (validDate(raw.examDate)) out.examDate = raw.examDate;
  if (validDate(raw.physicsDate)) out.physicsDate = raw.physicsDate;
  out.days = clampInt(raw.days, 1, 7, DEFAULT_DAYS);
  out.minutes = clampInt(raw.minutes, 10, 240, DEFAULT_MINUTES);
  if (isRec(raw.ticks)) {
    const keys = Object.keys(raw.ticks).filter(validDate).sort().slice(-MAX_TICK_DAYS);
    for (const k of keys) {
      const list = Array.isArray(raw.ticks[k]) ? [...new Set(raw.ticks[k].filter((s) => typeof s === 'string' && s.length <= 60))].slice(0, 12) : [];
      if (list.length) out.ticks[k] = list;
    }
  }
  return out;
}
export function loadSettings(storage = globalThis.localStorage) {
  try { return sanitizeSettings(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptySettings(); }
}
export function saveSettings(s, storage = globalThis.localStorage) {
  return safeSetItem(KEY, JSON.stringify(sanitizeSettings(s)), storage);
}
/** Returns a new settings object with the slot ticked / unticked on the given local day. */
export function toggleTick(settings, dKey, slotKey, on) {
  const s = sanitizeSettings(settings);
  const list = new Set(s.ticks[dKey] || []);
  if (on) list.add(slotKey); else list.delete(slotKey);
  if (list.size) s.ticks[dKey] = [...list]; else delete s.ticks[dKey];
  return sanitizeSettings(s);
}

/* ---------- phases ---------- */
export const PHASES = [
  { id: 'foundation', title: 'שלב הבסיס', range: 'יותר מ־8 שבועות', min: 9, max: Infinity,
    focus: 'יש זמן: בונים בסיס יציב, סוגרים חורים ומתרגלים את כל הנושאים בקצב רגוע לפני שנכנסים לעבודה עצימה.',
    goals: { hard: 2, notebook: true } },
  { id: 'repair', title: 'תיקון ודחיפת הקושי', range: 'שבועות 8–7', min: 7, max: 8,
    focus: 'מתקנים את הנושאים החלשים ומעלים רמה: תרגילים קשים, אי־שוויונות, טריגונומטריה ולוגריתמים.',
    goals: { hard: 3, notebook: true } },
  { id: 'mixed', title: 'בעיות קשות מעורבות', range: 'שבועות 6–5', min: 5, max: 6,
    focus: 'בעיות קשות מעורבות עם פתרון כתוב מלא על דף, וחזרה מושהית על מה שנלמד לפני שבוע ויותר.',
    goals: { hard: 3, writing: 2, notebook: true } },
  { id: 'transfer', title: 'שאלות חדשות בזמן מוגבל', range: 'שבועות 4–3', min: 3, max: 4,
    focus: 'שאלות ברמת מבחן שלא ראיתם: מבחן העברה ומבחני חוברת, עם הגבלת זמן קפדנית וללא רמזים.',
    goals: { transfer: 1, mocks: 1, notebook: true } },
  { id: 'mocks', title: 'שבוע המבחנים המלאים', range: 'שבוע 2', min: 2, max: 2,
    focus: 'שני מבחנים מלאים בימים נפרדים, בתנאי מבחן, ואחריהם ניתוח של כל נקודה שאבדה.',
    goals: { mocks: 2, notebook: true } },
  { id: 'final', title: 'שבוע אחרון: איחוד', range: 'שבוע 1', min: 0, max: 1,
    focus: 'מאחדים: דף נוסחאות, מחברת טעויות וחזרה קלה. בלי חומר קשה חדש, ומשאירים כוחות ליום המבחן.',
    goals: { notebook: true } },
];
export const phaseFor = (weeksLeft) => PHASES.find((p) => weeksLeft >= p.min && weeksLeft <= p.max) || PHASES[PHASES.length - 1];

/** Which date drives the phase: the earliest exam that has not passed; if all passed, the latest one. null when none set. */
export function primaryExam(settings, now) {
  const list = [['math', settings.examDate], ['physics', settings.physicsDate || settings.examDate]]
    .filter(([, d]) => validDate(d)).map(([subject, date]) => ({ subject, date, days: daysUntil(date, now) }));
  if (!list.length) return null;
  const upcoming = list.filter((x) => x.days >= 0).sort((a, b) => a.days - b.days);
  return upcoming[0] || list.sort((a, b) => b.days - a.days)[0];
}

/** Horizon summary. Without a date: neutral 8 weeks (manual: false). */
export function horizon(settings, now) {
  const exam = primaryExam(settings, now);
  if (!exam) return { hasDate: false, past: false, days: null, weeks: DEFAULT_WEEKS, phase: phaseFor(DEFAULT_WEEKS), compressed: false, foundationWeeks: 0 };
  const weeks = weeksLeftOf(exam.days);
  return {
    hasDate: true, past: exam.days < 0, days: exam.days, weeks, phase: phaseFor(weeks), subject: exam.subject, date: exam.date,
    compressed: weeks > 0 && weeks < DEFAULT_WEEKS, foundationWeeks: Math.max(0, weeks - DEFAULT_WEEKS),
  };
}

/** The whole timeline for display: [{ ...phase, active }] (the foundation phase only when there are more than 8 weeks). */
export function timeline(hz) {
  return PHASES.filter((p) => p.id !== 'foundation' || hz.weeks > DEFAULT_WEEKS).map((p) => ({ ...p, active: p.id === hz.phase.id }));
}

/* ---------- activities (real modes of the app) ---------- */
const topicIn = (a, topicOf) => a.topic || (topicOf ? topicOf(a.exerciseId) : null) || '';
const isHardMath = (t, a) => t.startsWith('math-hard-') || /^mh-/.test(a.exerciseId);
const isMulti = (t, a) => t === 'multipart' || /^mp-/.test(a.exerciseId);
const isLogs = (t, a) => t === 'logs' || /^lg-/.test(a.exerciseId);
const isHardAttempt = (t, a) => isHardMath(t, a) || isMulti(t, a) || isLogs(t, a);

export const WORKOUT_MIN = 5; // attempts on ordinary (non-hard, non-trainer) exercises that count as a finished workout
/**
 * id -> { label, href, kind, minutes(m), match(topic, attempt) | null }. match === null: no stored signal, only a manual tick.
 * kind: 'routine' | 'hard' | 'transfer' | 'mock' | 'review' | 'light'.
 */
export const ACTIVITIES = {
  workout: { label: 'האימון של היום', href: '#/workout/start', kind: 'routine', minutes: (m) => m, need: WORKOUT_MIN,
    match: (t, a) => !isReservedTopic(t) && !isHardAttempt(t, a) && !['units', 'estimate', 'trig', 'formulas'].includes(t) },
  mathhard: { label: 'מתמטיקה ברמה גבוהה', href: '#/mathhard', kind: 'hard', minutes: (m) => m, match: isHardMath },
  multipart: { label: 'שאלת מבחן בפיזיקה בכמה סעיפים', href: '#/multipart', kind: 'hard', minutes: (m) => m, match: isMulti },
  trig: { label: 'זהויות טריגונומטריות', href: '#/trig', kind: 'hard', minutes: (m) => m, match: (t) => t === 'trig' },
  logs: { label: 'לוגריתמים', href: '#/logs', kind: 'hard', minutes: (m) => m, match: isLogs },
  writing: { label: 'כתיבת פתרון מלא לניקוד חלקי', href: '#/writing', kind: 'hard', minutes: (m) => m, match: (t) => t === 'writing' },
  sprint: { label: 'ספרינט באלגברה', href: '#/sprint', kind: 'routine', minutes: (m) => Math.min(m, 20), match: (t) => t.startsWith('sprint-') },
  units: { label: 'יחידות וניתוח ממדים', href: '#/units', kind: 'routine', minutes: (m) => Math.min(m, 20), match: (t) => t === 'units' },
  estimate: { label: 'קודם מעריכים', href: '#/estimate', kind: 'routine', minutes: (m) => Math.min(m, 20), match: (t) => t === 'estimate' },
  transfer: { label: 'מבחן העברה: שאלות חדשות בלי רמזים', href: '#/transfer', kind: 'transfer', minutes: (m) => Math.max(m, 45), match: (t) => t.startsWith('transfer-') },
  booklet: { label: 'מבחן מלא מהחוברת (90 דקות, בלי רמזים)', href: '#/booklet', kind: 'mock', minutes: () => MOCK_MINUTES, match: (t) => t.startsWith('booklet-') },
  analysis: { label: 'ניתוח המבחן האחרון: איפה אבדו נקודות ולמה', href: '#/booklet', kind: 'review', minutes: (m) => Math.min(m, 45), match: null },
  notebook: { label: 'מחברת טעויות: חזרה על רשומות מתוזמנות', href: '#/notebook', kind: 'review', minutes: (m) => Math.min(m, 30), match: null },
  review: { label: 'חזרה קלה על טעויות', href: '#/review/start', kind: 'light', minutes: (m) => Math.min(m, 25), match: null },
  formulas: { label: 'דף הנוסחאות שלי מהזיכרון', href: '#/formulas', kind: 'light', minutes: (m) => Math.min(m, 30), match: (t) => t === 'formulas' },
  repair: { label: 'תיקון נושא חלש', href: '#/repair', kind: 'repair', minutes: (m) => m, match: null }, // match is per weak topic
};
const ROUTINE = ['workout', 'sprint', 'units', 'estimate'];

/** Study-day order of slots per phase (most important first, so a short week keeps the key sessions). 7 entries each. */
export const SEQUENCES = {
  foundation: ['workout', 'mathhard', 'repair', 'multipart', 'sprint', 'notebook', 'writing'],
  repair: ['repair', 'mathhard', 'trig', 'repair', 'logs', 'multipart', 'notebook'],
  mixed: ['mathhard', 'writing', 'multipart', 'notebook', 'mathhard', 'repair', 'workout'],
  transfer: ['transfer', 'booklet', 'repair', 'analysis', 'multipart', 'transfer', 'notebook'],
  mocks: ['booklet', 'booklet', 'analysis', 'repair', 'notebook', 'formulas', 'writing'],
  final: ['formulas', 'notebook', 'review', 'estimate', 'units', 'sprint', 'review'],
};

/** Rest weekdays (0 = Sunday) dropped first when fewer than 7 study days are available: Saturday, Friday, then midweek. */
const REST_ORDER = [6, 5, 3, 1, 4, 2];
export function studyWeekdays(days) {
  const n = clampInt(days, 1, 7, DEFAULT_DAYS);
  const rest = new Set(REST_ORDER.slice(0, 7 - n));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !rest.has(d));
}

/* ---------- learner data: weak skills and topics at their ceiling ---------- */
/**
 * Weakest topics (at most 3, score under WEAK_SCORE, at least WEAK_MIN_ATTEMPTS attempts), reserved topics excluded.
 * -> [{ topic, title, href, score (0-100), attempts }]
 */
export function weakSkills(log, exercises, titleOf = (t) => topicTitle(t) || t, hrefOf = (t) => topicHref(t) || `#/topic/${t}`, limit = 3) {
  const list = Array.isArray(log) ? log : [];
  return weakTopics(list, withVirtual(Array.isArray(exercises) ? exercises : [], list))
    .filter((t) => t.score < WEAK_SCORE && t.attempts >= WEAK_MIN_ATTEMPTS && !isReservedTopic(t.topic))
    .slice(0, limit).map((t) => ({ topic: t.topic, title: titleOf(t.topic), href: hrefOf(t.topic), score: Math.round(t.score * 100), attempts: t.attempts }));
}

/** Topics whose detector verdict is contentCeilingReached (the practice is too easy now). -> [{ topic, title }] */
export function ceilingTopics(log, feedback, exercises, titleOf = (t) => topicTitle(t) || t, transferCovers = null) {
  const byId = new Map((Array.isArray(exercises) ? exercises : []).map((e) => [e.id, e.topic]));
  const verdicts = analyzeTopics(Array.isArray(log) ? log : [], Array.isArray(feedback) ? feedback : [], { topicOf: (a) => byId.get(a.exerciseId) || a.topic, transferCovers });
  return [...verdicts.values()].filter((v) => v.contentCeilingReached).map((v) => ({ topic: v.topic, title: titleOf(v.topic) }));
}

/* ---------- weekday plan ---------- */
const slotKey = (s) => (s.topic ? `${s.act}:${s.topic}` : s.act);

/** Slots for the study days of one week, adapted to the learner's data. [{ act, topic?, label, href, minutes, kind, note?, key }] */
export function adaptSlots(phaseId, nStudyDays, { weak = [], ceiling = [], minutes = DEFAULT_MINUTES } = {}) {
  let acts = (SEQUENCES[phaseId] || SEQUENCES.repair).slice(0, nStudyDays);
  // 1. repair slots go to the weakest skills in order; a repair slot without a weak topic becomes a routine workout
  let w = 0;
  const slots = acts.map((act) => {
    if (act !== 'repair') return { act };
    const t = weak[w++];
    return t ? { act: 'repair', topic: t.topic, title: t.title, href: t.href } : { act: phaseId === 'final' ? 'review' : 'workout' };
  });
  // 2. topics at their ceiling: fewer routine items (always keep one), more transfer / hard items in their place
  if (phaseId !== 'final' && ceiling.length) {
    const routineIdx = slots.map((s, i) => (ROUTINE.includes(s.act) ? i : -1)).filter((i) => i >= 0);
    const replace = Math.min(ceiling.length, Math.max(0, routineIdx.length - 1));
    const swaps = ['transfer', 'mathhard'];
    const names = ceiling.map((c) => c.title).slice(0, 2).join(', ');
    routineIdx.slice(routineIdx.length - replace).reverse().forEach((i, k) => {
      slots[i] = { act: swaps[k % swaps.length], note: `אתם כבר חזקים ב־${names}: במקום תרגול שגרתי, אתגר ברמה גבוהה.` };
    });
  }
  return slots.map((s) => {
    const a = ACTIVITIES[s.act];
    const out = { act: s.act, kind: a.kind, label: s.act === 'repair' ? `${a.label}: ${s.title}` : a.label, href: s.href || a.href, minutes: phaseId === 'final' ? Math.max(10, Math.round((a.minutes(minutes) * 0.75) / 5) * 5) : a.minutes(minutes) };
    if (s.topic) out.topic = s.topic;
    if (s.note) out.note = s.note;
    out.key = slotKey(out);
    return out;
  });
}

/** Does the attempt list of one day complete this slot? Automatic when the mode stores attempts, else only by a manual tick. */
export function slotDone(slot, dayAttempts, topicOf, ticked = []) {
  if (ticked.includes(slot.key)) return true;
  const a = ACTIVITIES[slot.act];
  const mine = dayAttempts.filter((x) => x.ts > 0 && !x.migrated);
  if (slot.act === 'repair') return mine.some((x) => topicIn(x, topicOf) === slot.topic);
  if (!a.match) return false;
  const hits = mine.filter((x) => a.match(topicIn(x, topicOf), x));
  return hits.length >= (a.need || 1);
}

/**
 * Seven days of the current week (Sunday first): { date (local midnight ts), dayKey, weekday, today, rest, slot?, done }.
 * Past days are marked from their own stored attempts; rest days carry no slot.
 */
export function weekDays(settings, hz, log, now, { weak = [], ceiling = [], topicOf = null } = {}) {
  const start = weekStart(now);
  const study = studyWeekdays(settings.days);
  const slots = adaptSlots(hz.phase.id, study.length, { weak, ceiling, minutes: settings.minutes });
  const today = dayKey(now);
  const list = Array.isArray(log) ? log : [];
  return [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(start, i);
    const k = dayKey(date);
    const si = study.indexOf(i);
    const day = { date, dayKey: k, weekday: i, today: k === today, rest: si < 0 };
    if (si >= 0) {
      const slot = slots[si];
      const dayAttempts = list.filter((a) => a && dayKey(a.ts) === k);
      day.slot = slot;
      day.done = slotDone(slot, dayAttempts, topicOf, (settings.ticks || {})[k] || []);
    } else day.done = false;
    return day;
  });
}

/* ---------- progress ---------- */
/** First attempt of every exercise, chronological; migrated (timing-less) rows skipped. */
function firstAttempts(log) {
  const seen = new Set();
  const out = [];
  for (const { a } of log.map((a, i) => ({ a, i })).filter((x) => isRec(x.a)).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i)) {
    if (a.migrated || seen.has(a.exerciseId)) continue;
    seen.add(a.exerciseId);
    out.push(a);
  }
  return out;
}

/**
 * Readiness inputs per subject. Nothing is combined or extrapolated; each part is null (-> "no data yet") when it has no data.
 *  practice: independent hint-free share of first attempts in the last 28 days (needs MIN_READY of them)
 *  transfer: { ok, n } over the first attempts of reserved transfer questions
 *  mock: { last, history: [{ ts, pct }] } from self-marked mock results (booklet history)
 */
export function readiness(log, now, { topicOf = null, mocks = [] } = {}) {
  const list = Array.isArray(log) ? log : [];
  const firsts = firstAttempts(list);
  const since = now - READY_WINDOW_DAYS * DAY_MS;
  const out = {};
  for (const subject of ['math', 'physics']) {
    const mine = firsts.filter((a) => a.ts >= since && !isReservedTopic(topicIn(a, topicOf)) && subjectOf(topicIn(a, topicOf)) === subject);
    const tr = firsts.filter((a) => typeof a.topic === 'string' && a.topic === `transfer-${subject}`);
    const rs = (Array.isArray(mocks) ? mocks : []).filter((r) => isRec(r) && r.subject === subject && Number.isFinite(r.fraction)).sort((a, b) => a.ts - b.ts);
    out[subject] = {
      practice: mine.length >= MIN_READY ? { rate: mine.filter((a) => isIndependent(a, null)).length / mine.length, n: mine.length } : null,
      transfer: tr.length ? { ok: tr.filter((a) => isIndependent(a, null)).length, n: tr.length } : null,
      mock: rs.length ? { last: Math.round(rs[rs.length - 1].fraction * 100), history: rs.slice(-5).map((r) => ({ ts: r.ts, pct: Math.round(r.fraction * 100) })) } : null,
    };
  }
  return out;
}

const GOAL_LABELS = {
  hard: (n) => `${n} תרגילים קשים בלי רמזים`,
  writing: (n) => `${n} פתרונות כתובים מלאים`,
  transfer: (n) => (n === 1 ? 'מבחן העברה אחד' : `${n} מבחני העברה`),
  mocks: (n) => (n === 1 ? 'מבחן מלא אחד בזמן' : `${n} מבחנים מלאים בזמן, בימים נפרדים`),
  notebook: () => 'מחברת הטעויות ריקה מרשומות לחזרה',
};

/**
 * Weekly goals of the phase with this week's counts, from stored data only:
 * hard = distinct hard exercises solved alone with no hints this week; writing / transfer = attempts this week;
 * mocks = mock results this week; notebook = no due entries (null while the notebook state is unknown).
 */
export function weeklyGoals(phase, log, now, { mocks = [], dueNotebook = null } = {}) {
  const start = weekStart(now);
  const end = addDays(start, 7);
  const week = (Array.isArray(log) ? log : []).filter((a) => isRec(a) && a.ts >= start && a.ts < end && !a.migrated);
  const have = {
    hard: new Set(week.filter((a) => isHardAttempt(a.topic || '', a) && isIndependent(a, null)).map((a) => a.exerciseId)).size,
    writing: new Set(week.filter((a) => a.topic === 'writing').map((a) => a.exerciseId)).size,
    transfer: Math.floor(new Set(week.filter((a) => typeof a.topic === 'string' && a.topic.startsWith('transfer-')).map((a) => a.exerciseId)).size / 6),
    mocks: (Array.isArray(mocks) ? mocks : []).filter((r) => isRec(r) && r.ts >= start && r.ts < end).length,
  };
  return Object.entries(phase.goals).map(([id, target]) => (id === 'notebook'
    ? { id, label: GOAL_LABELS.notebook(), known: dueNotebook !== null, done: dueNotebook === 0, have: dueNotebook === null ? 0 : dueNotebook === 0 ? 1 : 0, target: 1 }
    : { id, label: GOAL_LABELS[id](target), known: true, done: have[id] >= target, have: Math.min(have[id], target), target }));
}

/** Study sessions this week: local days (Sunday up to today) with at least one stored attempt or a manual tick, against the days target. */
export function weeklySessions(settings, log, now) {
  const start = weekStart(now);
  const active = new Set();
  for (let i = 0; i < 7; i++) if (addDays(start, i) <= dayStart(now)) active.add(dayKey(addDays(start, i)));
  const done = new Set();
  for (const a of Array.isArray(log) ? log : []) if (isRec(a) && a.ts > 0 && !a.migrated && active.has(dayKey(a.ts))) done.add(dayKey(a.ts));
  for (const [k, list] of Object.entries(settings.ticks || {})) if (active.has(k) && list.length) done.add(k);
  return { done: done.size, target: settings.days };
}

/**
 * Everything the screen shows, from the learner's data. input: { settings, log, now, exercises, feedback, mocks, dueNotebook,
 * topicOf, titleOf, hrefOf, transferCovers }. Missing pieces degrade to null / empty lists, never to invented numbers.
 */
export function buildPlan(input) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const settings = sanitizeSettings(input.settings);
  const log = Array.isArray(input.log) ? input.log : [];
  const exercises = Array.isArray(input.exercises) ? input.exercises : [];
  const hz = horizon(settings, now);
  const weak = weakSkills(log, exercises, input.titleOf, input.hrefOf);
  const ceiling = ceilingTopics(log, input.feedback, exercises, input.titleOf, input.transferCovers);
  const topicOf = input.topicOf || ((() => { const m = new Map(exercises.map((e) => [e.id, e.topic])); return (id) => m.get(id) || null; })());
  const mocks = Array.isArray(input.mocks) ? input.mocks : [];
  const dueNotebook = Number.isFinite(input.dueNotebook) ? input.dueNotebook : null;
  const exams = [['math', settings.examDate], ['physics', settings.physicsDate || settings.examDate]]
    .map(([subject, date]) => ({ subject, date, days: date ? daysUntil(date, now) : null }));
  return {
    settings, hz, timeline: timeline(hz), weak, ceiling, exams,
    days: weekDays(settings, hz, log, now, { weak, ceiling, topicOf }),
    due: { reviews: dueReviews(log.filter(isRec), now).length, notebook: dueNotebook },
    goals: weeklyGoals(hz.phase, log, now, { mocks, dueNotebook }),
    sessions: weeklySessions(settings, log, now),
    readiness: readiness(log, now, { topicOf, mocks }),
  };
}

/** Compact data for the home card: days left, phase, sessions this week. */
export function homeSummary(settings, log, now) {
  const s = sanitizeSettings(settings);
  const hz = horizon(s, now);
  return { hasDate: hz.hasDate, past: hz.past, days: hz.days, weeks: hz.weeks, phase: hz.phase, sessions: weeklySessions(s, log, now) };
}
