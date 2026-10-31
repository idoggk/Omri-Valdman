// Persists progress state in localStorage; every access is guarded (private mode, disabled storage).
import * as P from './progress.js';
import { createLog } from './srs.js';

const KEY = 'omri-study-progress-v2';
const OLD_KEY = 'omri-study-progress-v1';
let state = null;

function load() {
  if (state) return state;
  state = P.emptyState();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = P.migrate(JSON.parse(raw));
    else {
      const old = localStorage.getItem(OLD_KEY);
      if (old) { state = P.migrate(JSON.parse(old)); save(); }
    }
  } catch (e) { /* use in-memory */ }
  return state;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export const isDone = (id) => P.isDone(load(), id);
export const outcomeOf = (id) => P.outcomeOf(load(), id);
export const getTipsUsed = (id) => P.tipsUsed(load(), id);
export const isRevealed = (id) => P.isRevealed(load(), id);
export const countDone = (ids) => ids.filter((id) => P.isDone(load(), id)).length;
export const countOutcomes = (ids) => P.countOutcomes(load(), ids);
export const reviewQueue = (ids) => P.reviewQueue(load(), ids);

export function setTipsUsed(id, n) { P.openTip(load(), id, n); save(); }
export function revealSolution(id) { P.revealSolution(load(), id); save(); }
export function markCorrect(id) { P.completeCorrect(load(), id); save(); }
export const usedGuided = (id) => P.usedGuided(load(), id);
export function markGuided(id) { P.markGuided(load(), id); save(); }
export function recordExamResults(results) { // [{id, correct}]
  for (const r of results) P.recordExamResult(load(), r.id, r.correct);
  save();
}

/* running exam, autosaved so a refresh can resume it */
const EXAM_KEY = 'omri-study-exam-v1';
export function loadExam() {
  try { const raw = localStorage.getItem(EXAM_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
export function saveExam(exam) {
  try { localStorage.setItem(EXAM_KEY, JSON.stringify(exam)); } catch (e) { /* ignore */ }
}
export function clearExam() {
  try { localStorage.removeItem(EXAM_KEY); } catch (e) { /* ignore */ }
}

/* attempt log (spaced repetition engine); legacy outcomes are merged in on first use */
let attemptLog = null;
function attempts() {
  if (!attemptLog) {
    attemptLog = createLog({
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
    });
    try { attemptLog.migrateFrom(load()); } catch (e) { /* ignore */ }
  }
  return attemptLog;
}
export const getAttempts = () => attempts().all();
export const recordAttempt = (a) => attempts().add({ ts: Date.now(), ...a });
export const setAttemptReason = (rec, reason) => attempts().setReason(rec, reason);

/* running workout: { ids, startedAt } */
const WORKOUT_KEY = 'omri-study-workout-v1';
export function loadWorkout() {
  try {
    const w = JSON.parse(localStorage.getItem(WORKOUT_KEY));
    return w && Array.isArray(w.ids) && w.ids.every((x) => typeof x === 'string') && Number.isFinite(w.startedAt) ? w : null;
  } catch (e) { return null; }
}
export function saveWorkout(w) {
  try { localStorage.setItem(WORKOUT_KEY, JSON.stringify(w)); } catch (e) { /* ignore */ }
}
