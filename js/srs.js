// Spaced repetition, mastery, streaks and error reasons. Pure logic: no DOM, storage is injected.
// Additive module: progress.js / store.js keep working untouched.
//
// attempt = { exerciseId, ts, outcome: 'alone'|'hinted'|'solution'|'wrong', hintsUsed, seconds, errorReason? }

export const OUTCOMES = ['alone', 'hinted', 'solution', 'wrong'];
export const DAY_MS = 86400000;
export const INTERVAL_DAYS = [1, 3, 7, 14];
export const MASTERED_STREAK = 3;
export const UNLOCK_SOLVES = 3;

export const ERROR_REASONS = [
  { id: 'algebra', label: 'טעות באלגברה' },
  { id: 'sign', label: 'טעות בסימן' },
  { id: 'formula', label: 'נוסחה לא נכונה' },
  { id: 'units', label: 'יחידות' },
  { id: 'concept', label: 'אי הבנת הרעיון' },
  { id: 'arithmetic', label: 'טעות חישוב' },
  { id: 'other', label: 'אחר' },
];
const REASON_IDS = ERROR_REASONS.map((r) => r.id);
export const reasonLabel = (id) => (ERROR_REASONS.find((r) => r.id === id) || { label: id }).label;

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (n, d = 0) => (Number.isFinite(n) && n >= 0 ? n : d);

/* ---------- attempt records ---------- */

/** Returns a clean attempt record or null when the input is unusable. */
export function makeAttempt(a) {
  if (!isObj(a) || typeof a.exerciseId !== 'string' || !a.exerciseId) return null;
  if (!OUTCOMES.includes(a.outcome)) return null;
  const r = {
    exerciseId: a.exerciseId,
    ts: num(a.ts),
    outcome: a.outcome,
    hintsUsed: Math.floor(num(a.hintsUsed)),
    seconds: num(a.seconds),
  };
  if (REASON_IDS.includes(a.errorReason)) r.errorReason = a.errorReason;
  if (a.migrated) r.migrated = true;
  if (typeof a.topic === 'string' && a.topic && a.topic.length <= 60) r.topic = a.topic;
  return r;
}

/**
 * Exercises that live outside the data/*.json lists (hard math, multipart, trig, logs) are recorded with their own
 * `topic`. This turns such attempts into pseudo-exercises {id, topic, level} so topic stats and weak topics see them.
 */
export function withVirtual(exercises, log) {
  const known = new Set(exercises.map((e) => e.id));
  const extra = new Map();
  // reserved transfer-test questions stay out of every topic list, weak-topic list and review schedule
  for (const a of log) if (a.topic && !a.topic.startsWith('transfer-') && !known.has(a.exerciseId)) extra.set(a.exerciseId, { id: a.exerciseId, topic: a.topic, level: 1, virtual: true });
  return extra.size ? exercises.concat([...extra.values()]) : exercises;
}

export function cleanLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(makeAttempt).filter(Boolean);
}

const byTime = (log) => log.map((a, i) => ({ a, i })).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i).map((x) => x.a);

/* ---------- scheduling ---------- */

/**
 * Review state of one exercise from its attempts (any order).
 * streak: independent successes in a row at spaced intervals. An 'alone' solve made before the
 * previous due time (cramming) is recorded but does not extend the streak.
 * Returns null when there are no attempts.
 */
export function scheduleOf(attempts) {
  const list = byTime(attempts);
  if (!list.length) return null;
  let streak = 0, due = 0, last = null;
  for (const a of list) {
    if (a.outcome === 'alone') {
      if (last === null || streak === 0 || a.ts >= due) streak++;
      due = a.ts + INTERVAL_DAYS[Math.min(streak, INTERVAL_DAYS.length) - 1] * DAY_MS;
    } else {
      streak = 0;
      due = a.ts + DAY_MS;
    }
    last = a;
  }
  return { due, streak, mastered: streak >= MASTERED_STREAK, lastOutcome: last.outcome, lastTs: last.ts, attempts: list.length };
}

export function groupByExercise(log) {
  const m = new Map();
  for (const a of log) {
    if (!m.has(a.exerciseId)) m.set(a.exerciseId, []);
    m.get(a.exerciseId).push(a);
  }
  return m;
}

/** Schedules for every attempted exercise: Map id -> schedule. */
export function schedules(log) {
  const out = new Map();
  for (const [id, list] of groupByExercise(log)) out.set(id, scheduleOf(list));
  return out;
}

/** Ids due at `now`, most overdue first (ties by id). Mastered exercises are due too once their interval passed. */
export function dueReviews(log, now) {
  return [...schedules(log.filter((a) => !(a.topic && a.topic.startsWith('transfer-'))))].filter(([, s]) => s.due <= now)
    .sort((a, b) => a[1].due - b[1].due || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}

/* ---------- mastery ---------- */

function emptyStats() { return { attempts: 0, correct: 0, alone: 0, accuracy: 0, aloneRate: 0, exercises: 0, mastered: 0 }; }

function statsFor(attempts, scheds) {
  const s = emptyStats();
  for (const a of attempts) {
    s.attempts++;
    if (a.outcome === 'alone' || a.outcome === 'hinted') s.correct++;
    if (a.outcome === 'alone') s.alone++;
  }
  s.accuracy = s.attempts ? s.correct / s.attempts : 0;
  s.aloneRate = s.attempts ? s.alone / s.attempts : 0;
  s.exercises = scheds.length;
  s.mastered = scheds.filter((x) => x.mastered).length;
  return s;
}

function bucketStats(log, exercises, keyOf) {
  const info = new Map(exercises.map((e) => [e.id, e]));
  const sch = schedules(log);
  const att = {}, scs = {};
  for (const a of log) {
    const e = info.get(a.exerciseId);
    if (!e) continue;
    const k = keyOf(e);
    (att[k] || (att[k] = [])).push(a);
  }
  for (const [id, s] of sch) {
    const e = info.get(id);
    if (!e) continue;
    const k = keyOf(e);
    (scs[k] || (scs[k] = [])).push(s);
  }
  const out = {};
  for (const k of Object.keys(att)) out[k] = statsFor(att[k], scs[k] || []);
  return out;
}

/** { [topic]: {attempts, correct, alone, accuracy, aloneRate, exercises, mastered} } for attempted topics. */
export const topicStats = (log, exercises) => bucketStats(log, exercises, (e) => e.topic);
export const levelStats = (log, exercises) => bucketStats(log, exercises, (e) => e.level);

/** Attempted topics, weakest first. Score blends independent-solve rate and accuracy; ties by topic id. */
export function weakTopics(log, exercises) {
  const st = topicStats(log, exercises);
  return Object.keys(st)
    .map((t) => ({ topic: t, score: 0.6 * st[t].aloneRate + 0.4 * st[t].accuracy, ...st[t] }))
    .sort((a, b) => a.score - b.score || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
}

/**
 * Level unlocking. The lowest level is always unlocked; level N+1 unlocks after UNLOCK_SOLVES
 * distinct exercises solved alone at level N. Only drives suggestions: every level stays selectable.
 * Returns { levels, unlocked, suggested, progress: {[level]: soloSolvedCount} }.
 */
export function levelInfo(log, exercises) {
  const levels = [...new Set(exercises.map((e) => e.level))].sort((a, b) => a - b);
  const lvl = new Map(exercises.map((e) => [e.id, e.level]));
  const solved = {};
  const seen = new Set();
  for (const a of log) {
    if (a.outcome !== 'alone' || seen.has(a.exerciseId) || !lvl.has(a.exerciseId)) continue;
    seen.add(a.exerciseId);
    solved[lvl.get(a.exerciseId)] = (solved[lvl.get(a.exerciseId)] || 0) + 1;
  }
  const unlocked = [];
  levels.forEach((l, i) => { if (i === 0 || (solved[levels[i - 1]] || 0) >= UNLOCK_SOLVES) unlocked.push(l); });
  // contiguous unlocking: stop at first locked level
  const contiguous = [];
  for (const l of levels) { if (unlocked.includes(l)) contiguous.push(l); else break; }
  return { levels, unlocked: contiguous, suggested: contiguous.length ? contiguous[contiguous.length - 1] : null, progress: solved };
}

/* ---------- error reasons ---------- */

/** [{reason, count}] sorted by count desc then ERROR_REASONS order; only attempts with a reason. */
export function countReasons(log, { since = 0 } = {}) {
  const c = {};
  for (const a of log) if (a.errorReason && a.ts >= since) c[a.errorReason] = (c[a.errorReason] || 0) + 1;
  return Object.keys(c)
    .map((reason) => ({ reason, count: c[reason], label: reasonLabel(reason) }))
    .sort((a, b) => b.count - a.count || REASON_IDS.indexOf(a.reason) - REASON_IDS.indexOf(b.reason));
}
export const recurringReasons = (log, min = 2, opts) => countReasons(log, opts).filter((r) => r.count >= min);

/* ---------- streak and activity (local days) ---------- */

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }

const realAttempts = (log) => log.filter((a) => a.ts > 0 && !a.migrated);

/** Consecutive active days ending today; if nothing yet today, the run ending yesterday still counts. */
export function currentStreak(log, now) {
  const days = new Set(realAttempts(log).map((a) => dayKey(a.ts)));
  let t = now;
  if (!days.has(dayKey(t))) t = addDays(t, -1);
  let n = 0;
  while (days.has(dayKey(t))) { n++; t = addDays(t, -1); }
  return n;
}

/** Last 7 days (oldest first, today last): [{day, attempts, correct}]. */
export function last7Days(log, now) {
  const real = realAttempts(log);
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(addDays(now, -i));
    const day = real.filter((a) => dayKey(a.ts) === key);
    out.push({ day: key, attempts: day.length, correct: day.filter((a) => a.outcome === 'alone' || a.outcome === 'hinted').length });
  }
  return out;
}

/* ---------- migration from progress.js state ---------- */

const FROM_OLD = { alone: 'alone', hinted: 'hinted', review: 'solution' };

/** Attempt records for exercises in an old progress state (v2 or v1) that have no record in `log` yet. */
export function recordsFromProgress(progressState, log = []) {
  if (!isObj(progressState) || !isObj(progressState.ex)) return [];
  const have = new Set(log.map((a) => a.exerciseId));
  const out = [];
  for (const id of Object.keys(progressState.ex).sort()) {
    const e = progressState.ex[id];
    if (have.has(id) || !isObj(e) || !FROM_OLD[e.outcome]) continue;
    out.push(makeAttempt({
      exerciseId: id, ts: e.ts, outcome: FROM_OLD[e.outcome],
      hintsUsed: e.outcome === 'hinted' ? 1 : 0, seconds: 0, migrated: true,
    }));
  }
  return out.filter(Boolean);
}

/* ---------- persistence (storage injected: getItem/setItem) ---------- */

export const LOG_KEY = 'omri-study-attempts-v1';

export const MAX_LOG_ROWS = 5000;

/**
 * Keeps the log under `max` rows. The oldest rows are compacted to the single latest row of each exercise that has no
 * newer row (so its review schedule survives); only if that is still too many are the oldest rows dropped. Order kept.
 */
export function compactLog(log, max = MAX_LOG_ROWS) {
  if (log.length <= max) return log;
  const order = log.map((a, i) => ({ a, i })).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i);
  const keepN = Math.floor(max * 0.9);
  const recent = order.slice(order.length - keepN);
  const seen = new Set(recent.map((x) => x.a.exerciseId));
  const lastOld = new Map();
  for (const x of order.slice(0, order.length - keepN)) if (!seen.has(x.a.exerciseId)) lastOld.set(x.a.exerciseId, x);
  const out = [...lastOld.values(), ...recent].sort((x, y) => x.i - y.i).map((x) => x.a);
  return out.length > max ? out.slice(out.length - max) : out;
}

export function createLog(storage, key = LOG_KEY) {
  let log = null;
  const load = () => {
    if (log) return log;
    log = [];
    try { const raw = storage.getItem(key); if (raw) log = cleanLog(JSON.parse(raw)); } catch (e) { /* in-memory */ }
    return log;
  };
  const save = () => {
    if (log.length > MAX_LOG_ROWS) log.splice(0, log.length, ...compactLog(log));
    try { storage.setItem(key, JSON.stringify(log)); } catch (e) { /* ignore */ }
  };
  return {
    all: () => load().slice(),
    add(a) { const r = makeAttempt(a); if (r) { load().push(r); save(); } return r; },
    /** Sets the error reason on a record previously returned by add(). */
    setReason(rec, reason) {
      if (!REASON_IDS.includes(reason) || !load().includes(rec)) return false;
      rec.errorReason = reason; save(); return true;
    },
    /** Idempotent: merges legacy progress outcomes, never touching exercises that already have records. */
    migrateFrom(progressState) {
      const recs = recordsFromProgress(progressState, load());
      if (recs.length) { log.push(...recs); save(); }
      return recs.length;
    },
  };
}
