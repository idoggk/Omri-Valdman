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
/** Drops the in-memory caches so the next access re-reads storage (tests, storage cleared elsewhere). */
export function resetCache() { state = null; attemptLog = null; }
export const getAttempts = () => attempts().all();
export const recordAttempt = (a) => attempts().add({ ts: Date.now(), ...a });
export const setAttemptReason = (rec, reason) => attempts().setReason(rec, reason);

/* quick drills: { v, items: {id: {right, wrong, ts}}, traps: {trapId: {right, wrong}} }.
   Own key, so existing progress is never touched; anything malformed reads as empty. */
const DRILLS_KEY = 'omri-study-drills-v1';
const cnt = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
export function sanitizeDrills(raw) {
  const out = { v: 1, items: {}, traps: {} };
  if (!isRec(raw)) return out;
  for (const [k, src, dst] of [['items', raw.items, out.items], ['traps', raw.traps, out.traps]]) {
    if (!isRec(src)) continue;
    for (const [id, e] of Object.entries(src)) {
      if (!isRec(e)) continue;
      dst[id] = { right: cnt(e.right), wrong: cnt(e.wrong) };
      if (k === 'items') dst[id].ts = Number.isFinite(e.ts) ? e.ts : 0;
    }
  }
  return out;
}
export function loadDrills() {
  try { return sanitizeDrills(JSON.parse(localStorage.getItem(DRILLS_KEY))); } catch (e) { return sanitizeDrills(null); }
}
/** Records one answer. trapId is only passed for trap/sanity items (cards do not count as trap accuracy). */
export function recordDrill(id, trapId, correct) {
  const d = loadDrills();
  const f = correct ? 'right' : 'wrong';
  const it = d.items[id] || (d.items[id] = { right: 0, wrong: 0, ts: 0 });
  it[f]++; it.ts = Date.now();
  if (trapId) { const t = d.traps[trapId] || (d.traps[trapId] = { right: 0, wrong: 0 }); t[f]++; }
  try { localStorage.setItem(DRILLS_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}
/** Trap ids with at least one miss, lowest accuracy first. */
export function weakTraps(limit = 5) {
  return Object.entries(loadDrills().traps)
    .filter(([, t]) => t.wrong > 0)
    .map(([trapId, t]) => ({ trapId, ...t, acc: t.right / (t.right + t.wrong) }))
    .sort((a, b) => a.acc - b.acc || b.wrong - a.wrong || (a.trapId < b.trapId ? -1 : 1))
    .slice(0, limit);
}

/* find the mistake: { v, items: {id: {right, wrong, solved, ts}}, types: {errorType: {right, wrong}} }.
   Own key; anything malformed reads as empty. */
const FM_KEY = 'omri-study-findmistake-v1';
export function sanitizeFindMistake(raw) {
  const out = { v: 1, items: {}, types: {} };
  if (!isRec(raw)) return out;
  if (isRec(raw.items)) {
    for (const [id, e] of Object.entries(raw.items)) {
      if (!isRec(e)) continue;
      out.items[id] = { right: cnt(e.right), wrong: cnt(e.wrong), solved: e.solved === true, ts: Number.isFinite(e.ts) ? e.ts : 0 };
    }
  }
  if (isRec(raw.types)) {
    for (const [t, e] of Object.entries(raw.types)) if (isRec(e)) out.types[t] = { right: cnt(e.right), wrong: cnt(e.wrong) };
  }
  return out;
}
export function loadFindMistake() {
  try { return sanitizeFindMistake(JSON.parse(localStorage.getItem(FM_KEY))); } catch (e) { return sanitizeFindMistake(null); }
}
/** One tap on a step: correct = the learner found the first wrong step. */
export function recordFindMistake(id, errorType, correct) {
  const d = loadFindMistake();
  const f = correct ? 'right' : 'wrong';
  const it = d.items[id] || (d.items[id] = { right: 0, wrong: 0, solved: false, ts: 0 });
  it[f]++; it.ts = Date.now();
  if (correct) it.solved = true;
  if (typeof errorType === 'string' && errorType) { const t = d.types[errorType] || (d.types[errorType] = { right: 0, wrong: 0 }); t[f]++; }
  try { localStorage.setItem(FM_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}
export const countFindMistakeSolved = () => Object.values(loadFindMistake().items).filter((x) => x.solved).length;

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
