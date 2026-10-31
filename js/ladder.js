// Exam ladder: pure logic (no DOM). Stage status from outcomes, unlock rule and the per-stage "skip anyway" flag.
// A stage opens when >= 70% (rounded up) of the items of the nearest previous non-empty stage were solved 'alone'.
// Empty stages never block: they are skipped by the rule and shown as "coming soon".
export const LADDER_KEY = 'omri-study-ladder-v1';
export const UNLOCK_RATIO = 0.7;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/** Storage shape: { v:1, skip: { [stageId]: true } }. Garbage reads as empty. */
export function sanitizeLadder(raw) {
  const out = { v: 1, skip: {} };
  if (isRec(raw) && isRec(raw.skip)) for (const [id, on] of Object.entries(raw.skip)) if (on === true) out.skip[id] = true;
  return out;
}
export function loadLadder() {
  try { return sanitizeLadder(JSON.parse(localStorage.getItem(LADDER_KEY))); } catch (e) { return sanitizeLadder(null); }
}
export function setSkip(stageId, on = true) {
  const d = loadLadder();
  if (on) d.skip[stageId] = true; else delete d.skip[stageId];
  try { localStorage.setItem(LADDER_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}

/** Items needed 'alone' to pass a stage with n items. */
export const needed = (n) => (n > 0 ? Math.ceil(n * UNLOCK_RATIO - 1e-9) : 0);

/** How many of a stage's items are solved alone / attempted. outcome(id) -> 'alone'|'hinted'|'review'|null (store.outcomeOf, or progress.outcomeOf bound to a state). */
export function stageCounts(stage, outcome) {
  const ids = stage.items.map((it) => it.ref);
  return {
    total: ids.length,
    alone: ids.filter((id) => outcome(id) === 'alone').length,
    attempted: ids.filter((id) => outcome(id) != null).length,
  };
}

/**
 * Status of every stage, in order: { id, status: 'locked'|'unlocked'|'done'|'soon', alone, total, need, skipped }.
 * - empty stage: 'soon' (never blocks the next one)
 * - done: needed items solved alone
 * - unlocked: first non-empty stage, or the nearest previous non-empty stage is done, or the skip flag is set
 */
export function ladderStatus(stages, outcome, skip = {}) {
  const out = [];
  let prev = null; // nearest previous non-empty stage's entry
  for (const st of stages) {
    const c = stageCounts(st, outcome);
    const need = needed(c.total);
    if (!c.total) { out.push({ id: st.id, status: 'soon', alone: 0, total: 0, need: 0, skipped: false }); continue; }
    const open = !prev || prev.status === 'done' || skip[st.id] === true;
    const status = open ? (c.alone >= need ? 'done' : 'unlocked') : 'locked';
    // a stage that was solved while still "locked" cannot happen via the UI, but counts as done for the chain
    const entry = { id: st.id, status, alone: c.alone, total: c.total, need, skipped: open && !(!prev || prev.status === 'done') };
    out.push(entry);
    prev = entry;
  }
  return out;
}

/** True when the stage's items may be opened (not locked). */
export const isOpen = (entry) => !!entry && entry.status !== 'locked';

/** Flat list of every ref in the ladder (for validation). */
export const allRefs = (stages) => stages.flatMap((s) => s.items.map((it) => it.ref));
