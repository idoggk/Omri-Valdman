// Persists progress state in localStorage; every access is guarded (private mode, disabled storage).
import * as P from './progress.js';

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
