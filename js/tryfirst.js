// "Try first" mode: on the hard modes, hints stay hidden until the learner has entered an attempt or waited a minute.
// Pure part: saved toggle, the unlock state machine, and the median time-to-first-attempt over the attempt log.
// js/tryfirst-ui.js draws the toggle and the prompt and hides / shows the hint controls.
import { safeSetItem } from './storage.js';

export const KEY = 'omri-study-tryfirst-v1';
export const WAIT_MS = 60000;
export const PROMPT = 'קודם כותבים על הנייר את ההכנה (נתונים, ציר, משוואה), ואז מנסים. הרמזים ייפתחו ברגע שתכניסו ניסיון, או אחרי דקה.';

/* ---------- saved toggle: { v: 1, on: boolean } ---------- */
export const sanitizeSaved = (raw) => ({ v: 1, on: !!raw && typeof raw === 'object' && raw.on === true });
export function loadOn(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))).on; } catch (e) { return false; }
}
export function saveOn(on, storage = globalThis.localStorage) {
  safeSetItem(KEY, JSON.stringify({ v: 1, on: !!on }), storage);
}

/**
 * One visit to an exercise. Hints are locked while the mode is on, no attempt was entered, and the wait has not passed.
 * The first-attempt time is measured whether or not the mode is on (it is the baseline the median compares with).
 */
export function createGate({ on = false, now = Date.now, waitMs = WAIT_MS } = {}) {
  const start = now();
  let enabled = !!on;
  let attemptAt = null;
  const elapsed = () => Math.max(0, now() - start);
  return {
    isOn: () => enabled,
    setOn(v) { enabled = !!v; },
    /** Call on the first typed value or the first press of the check button. Later calls change nothing. */
    attempt() { if (attemptAt === null) attemptAt = elapsed(); },
    attempted: () => attemptAt !== null,
    locked: () => enabled && attemptAt === null && elapsed() < waitMs,
    remainingMs: () => (enabled && attemptAt === null ? Math.max(0, waitMs - elapsed()) : 0),
    /** Whole seconds from opening the exercise to the first attempt, or undefined when the learner never attempted. */
    timeToFirstAttempt: () => (attemptAt === null ? undefined : Math.round(attemptAt / 1000)),
  };
}

/** Spread into a store.recordAttempt record: { timeToFirstAttempt } only when it is known. */
export const attemptExtra = (gate) => {
  const t = gate ? gate.timeToFirstAttempt() : undefined;
  return t === undefined ? {} : { timeToFirstAttempt: t };
};

/* ---------- progress screen ---------- */
export function median(nums) {
  const s = nums.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** { count, median } over attempts that carry a timeToFirstAttempt; median is null with no data. */
export function firstAttemptStats(log) {
  const times = (Array.isArray(log) ? log : []).map((a) => a && a.timeToFirstAttempt).filter((n) => Number.isFinite(n) && n >= 0);
  return { count: times.length, median: median(times) };
}

/** "45 שניות" / "2 דקות ו־5 שניות". */
export function formatSeconds(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} שניות`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m === 1 ? 'דקה' : `${m} דקות`}${r ? ` ו־${r} שניות` : ''}`;
}
