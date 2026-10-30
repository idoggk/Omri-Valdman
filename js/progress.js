// Pure progress state logic (no DOM, no storage). store.js persists it.
//
// state = {
//   v: 2,
//   ex:  { [id]: { outcome: 'alone'|'hinted'|'review', attempts: number, ts: number } },
//   att: { [id]: { tips: number, revealed: boolean } }   // the attempt in progress
// }
// The outcome is that of the LAST completed attempt.

export const OUTCOMES = ['alone', 'hinted', 'review'];

export function emptyState() { return { v: 2, ex: {}, att: {} }; }

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

/** Accepts a v2 state, an old v1 {done, tips} object, or garbage. Always returns a valid v2 state. */
export function migrate(raw) {
  const s = emptyState();
  if (!isObj(raw)) return s;
  if (raw.v === 2) {
    if (isObj(raw.ex)) {
      for (const [id, e] of Object.entries(raw.ex)) {
        if (isObj(e) && OUTCOMES.includes(e.outcome)) {
          s.ex[id] = {
            outcome: e.outcome,
            attempts: Number.isFinite(e.attempts) && e.attempts > 0 ? Math.floor(e.attempts) : 1,
            ts: Number.isFinite(e.ts) ? e.ts : 0,
          };
        }
      }
    }
    if (isObj(raw.att)) {
      for (const [id, a] of Object.entries(raw.att)) {
        if (isObj(a)) s.att[id] = { tips: clampTips(a.tips), revealed: !!a.revealed };
      }
    }
    return s;
  }
  const tips = isObj(raw.tips) ? raw.tips : {};
  const done = isObj(raw.done) ? raw.done : {};
  for (const id of Object.keys(done)) {
    if (!done[id]) continue;
    s.ex[id] = { outcome: clampTips(tips[id]) > 0 ? 'hinted' : 'alone', attempts: 1, ts: 0 };
  }
  for (const id of Object.keys(tips)) {
    if (!done[id] && clampTips(tips[id]) > 0) s.att[id] = { tips: clampTips(tips[id]), revealed: false };
  }
  return s;
}

function clampTips(n) { return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.floor(n))) : 0; }

function attempt(state, id) {
  return state.att[id] || (state.att[id] = { tips: 0, revealed: false });
}

export function tipsUsed(state, id) { return state.att[id] ? state.att[id].tips : 0; }
export function isRevealed(state, id) { return !!(state.att[id] && state.att[id].revealed); }
export function outcomeOf(state, id) { return state.ex[id] ? state.ex[id].outcome : null; }
export function isDone(state, id) { return !!state.ex[id]; }

/** Opening a tip never lowers the count. */
export function openTip(state, id, n) {
  const a = attempt(state, id);
  a.tips = Math.max(a.tips, clampTips(n));
  return state;
}

/** Revealing the solution before solving counts as giving up: outcome 'review' right away. */
export function revealSolution(state, id, now = Date.now()) {
  const prev = state.ex[id];
  if (prev && prev.outcome === 'alone') return state; // already solved alone: never demote
  const a = attempt(state, id);
  if (!a.revealed) {
    a.revealed = true;
    state.ex[id] = { outcome: 'review', attempts: (prev ? prev.attempts : 0) + 1, ts: now };
  }
  return state;
}

/** A correct answer closes the current attempt. */
export function completeCorrect(state, id, now = Date.now()) {
  const a = state.att[id] || { tips: 0, revealed: false };
  const prev = state.ex[id];
  if (a.revealed && prev) {
    state.ex[id] = { outcome: 'review', attempts: prev.attempts, ts: now };
  } else {
    const outcome = a.revealed ? 'review' : a.tips > 0 ? 'hinted' : 'alone';
    state.ex[id] = { outcome, attempts: (prev ? prev.attempts : 0) + 1, ts: now };
  }
  delete state.att[id];
  return state;
}

/** Ids needing review (hinted/review), oldest first; ties keep the given order. */
export function reviewQueue(state, orderedIds) {
  return orderedIds
    .map((id, i) => ({ id, i, e: state.ex[id] }))
    .filter((x) => x.e && x.e.outcome !== 'alone')
    .sort((a, b) => a.e.ts - b.e.ts || a.i - b.i)
    .map((x) => x.id);
}

/** Counts per outcome plus 'none' (not tried) over the given ids. */
export function countOutcomes(state, ids) {
  const c = { alone: 0, hinted: 0, review: 0, none: 0 };
  for (const id of ids) c[outcomeOf(state, id) || 'none']++;
  return c;
}
