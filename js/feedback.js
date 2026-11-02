// Difficulty feedback: pure record logic, local storage and the export JSON. No DOM, nothing leaves the device
// unless the learner shares the exported file themselves. Malformed storage always reads as empty.
import { topicStats, weakTopics, countReasons } from './srs.js';

export const FEEDBACK_KEY = 'omri-study-feedback-v1';
export const FEEDBACK_CAP = 2000;
export const NOTE_MAX = 200;
export const EXPORT_APP = 'brain-gains';
export const EXPORT_VERSION = 1;

export const HARD_TAGS = [
  { id: 'understand', label: 'להבין את השאלה' },
  { id: 'method', label: 'לבחור שיטה' },
  { id: 'start', label: 'להתחיל' },
  { id: 'algebra', label: 'אלגברה / מניפולציה' },
  { id: 'calc', label: 'חישובים' },
  { id: 'signs', label: 'סימנים (פלוס/מינוס)' },
  { id: 'quartic', label: 'משוואות רביעיות' },
  { id: 'diagram', label: 'להבין את השרטוט / הדיאגרמה' },
  { id: 'formula', label: 'נוסחה שלא זוכר' },
  { id: 'units', label: 'יחידות / צירים' },
  { id: 'time', label: 'עניין הזמן' },
  { id: 'long', label: 'היה ארוך מדי' },
  { id: 'other', label: 'אחר' },
];
const TAG_IDS = HARD_TAGS.map((t) => t.id);
export const tagLabel = (id) => (HARD_TAGS.find((t) => t.id === id) || { label: id }).label;

export const MODES = ['exercise', 'workout', 'solve', 'endless', 'checkpoints', 'methods', 'order', 'edge', 'reverse', 'fading', 'review', 'multipart', 'trig', 'mathhard', 'logs'];

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const cnt = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

/** Clean record or null. Rating is rounded and clamped to 1..10; unknown tags/modes are dropped. */
export function sanitizeRecord(raw, now = Date.now()) {
  if (!isRec(raw) || typeof raw.exerciseId !== 'string' || !raw.exerciseId) return null;
  const rating = Number(raw.rating);
  if (raw.rating == null || raw.rating === '' || !Number.isFinite(rating)) return null;
  const tags = Array.isArray(raw.hardTags) ? [...new Set(raw.hardTags.filter((t) => TAG_IDS.includes(t)))] : [];
  const rec = {
    id: str(raw.id, 120) || `${raw.exerciseId}:${now}`,
    ts: Number.isFinite(raw.ts) && raw.ts > 0 ? raw.ts : now,
    exerciseId: raw.exerciseId.slice(0, 120),
    mode: MODES.includes(raw.mode) ? raw.mode : 'exercise',
    topic: str(raw.topic, 60),
    level: Number.isFinite(raw.level) ? raw.level : null,
    rating: Math.min(10, Math.max(1, Math.round(rating))),
    hardTags: tags,
    correct: typeof raw.correct === 'boolean' ? raw.correct : null,
    hintsUsed: cnt(raw.hintsUsed),
    solutionViewed: raw.solutionViewed === true,
    secondsSpent: Number.isFinite(raw.secondsSpent) && raw.secondsSpent >= 0 ? Math.round(raw.secondsSpent) : null,
  };
  const note = str(raw.note, NOTE_MAX).trim();
  if (note) rec.note = note;
  return rec;
}

/** Replaces the record with the same id (an edit) or appends it; keeps only the newest `cap`. */
export function upsert(list, rec, cap = FEEDBACK_CAP) {
  const out = list.filter((r) => r.id !== rec.id);
  const i = list.findIndex((r) => r.id === rec.id);
  if (i >= 0) out.splice(i, 0, rec); else out.push(rec);
  return out.slice(-cap);
}

export function cleanList(raw) {
  const arr = isRec(raw) && Array.isArray(raw.records) ? raw.records : [];
  const out = [];
  for (const r of arr) { const c = sanitizeRecord(r, 0); if (c && c.ts > 0) out.push(c); }
  return out.slice(-FEEDBACK_CAP);
}

export function loadFeedback() {
  try { return cleanList(JSON.parse(localStorage.getItem(FEEDBACK_KEY))); } catch (e) { return []; }
}

/** Validates and stores one record (insert or update by id). Returns the clean record, or null when invalid/unsaved. */
export function saveFeedback(raw, now = Date.now()) {
  const rec = sanitizeRecord(raw, now);
  if (!rec) return null;
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify({ v: 1, records: upsert(loadFeedback(), rec) }));
  } catch (e) { return null; }
  return rec;
}

/* ---------- aggregation ---------- */
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

export function averageByTopic(records) {
  const g = {};
  for (const r of records) (g[r.topic || '?'] ||= []).push(r.rating);
  return Object.keys(g).sort().map((topic) => ({ topic, count: g[topic].length, avgRating: avg(g[topic]) }));
}

export function tagCounts(records) {
  const c = {};
  for (const r of records) for (const t of r.hardTags) c[t] = (c[t] || 0) + 1;
  return TAG_IDS.filter((t) => c[t]).map((tag) => ({ tag, label: tagLabel(tag), count: c[tag] }))
    .sort((a, b) => b.count - a.count);
}

export function hardestExercises(records, limit = 10) {
  const g = {};
  for (const r of records) (g[r.exerciseId] ||= []).push(r.rating);
  return Object.keys(g).map((exerciseId) => ({ exerciseId, count: g[exerciseId].length, avgRating: avg(g[exerciseId]) }))
    .sort((a, b) => b.avgRating - a.avgRating || b.count - a.count || (a.exerciseId < b.exerciseId ? -1 : 1))
    .slice(0, limit);
}

/** Compact learning summary. log = attempt log, exercises = exercise list (for topics); both read-only. */
export function buildSummary(records, log = [], exercises = []) {
  const st = topicStats(log, exercises);
  const rated = Object.fromEntries(averageByTopic(records).map((t) => [t.topic, t]));
  const topics = [...new Set([...Object.keys(st), ...Object.keys(rated)])].sort().map((topic) => ({
    topic,
    attempts: st[topic] ? st[topic].attempts : 0,
    accuracy: st[topic] ? Math.round(st[topic].accuracy * 100) / 100 : null,
    avgRating: rated[topic] ? rated[topic].avgRating : null,
    ratings: rated[topic] ? rated[topic].count : 0,
  }));
  return {
    ratings: records.length,
    avgRating: avg(records.map((r) => r.rating)),
    topics,
    hardTags: tagCounts(records).map(({ tag, count }) => ({ tag, count })),
    hardestExercises: hardestExercises(records),
    mistakeReasons: countReasons(log).map(({ reason, count }) => ({ reason, count })),
    weakTopics: weakTopics(log, exercises).slice(0, 3).map((t) => ({
      topic: t.topic, score: Math.round(t.score * 100) / 100, mastered: t.mastered, exercises: t.exercises,
    })),
  };
}

/** The shareable file content (an object). Contains no personal identifiers. */
export function buildExport(records, log = [], exercises = [], now = Date.now()) {
  return {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    summary: buildSummary(records, log, exercises),
    records,
  };
}

export const exportFilename = (now = Date.now()) => `brain-gains-feedback-${new Date(now).toISOString().slice(0, 10)}.json`;
