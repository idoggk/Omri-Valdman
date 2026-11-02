// Exam ladder: pure logic (no DOM). Stage status from outcomes, unlock rule and the per-stage "skip anyway" flag.
// A stage opens when >= 70% (rounded up) of the items of the nearest previous non-empty stage were solved 'alone'.
// Empty stages never block: they are skipped by the rule and shown as "coming soon".
// A stage item is either { ref } (an exercise of data/physics.json, progress in the main store) or an INLINE exercise
// object with its own id (progress in this module's key, under "items", in the shape of progress.js).
import * as P from './progress.js';
import { safeSetItem } from './storage.js';

export const LADDER_KEY = 'omri-study-ladder-v1';
export const UNLOCK_RATIO = 0.7;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/**
 * Storage shape: { v:1, skip: { [stageId]: true }, items?: progress state of inline items }.
 * "items" is only present once an inline item was touched, so older files and readers are unaffected.
 * Garbage reads as empty.
 */
export function sanitizeLadder(raw) {
  const out = { v: 1, skip: {} };
  if (isRec(raw) && isRec(raw.skip)) for (const [id, on] of Object.entries(raw.skip)) if (on === true) out.skip[id] = true;
  if (isRec(raw) && isRec(raw.items)) {
    const st = P.migrate({ ...raw.items, v: 2 });
    if (Object.keys(st.ex).length || Object.keys(st.att).length) out.items = st;
  }
  return out;
}
export function loadLadder() {
  try { return sanitizeLadder(JSON.parse(localStorage.getItem(LADDER_KEY))); } catch (e) { return sanitizeLadder(null); }
}
const save = (d) => { safeSetItem(LADDER_KEY, JSON.stringify(d)); };
export function setSkip(stageId, on = true) {
  const d = loadLadder();
  if (on) d.skip[stageId] = true; else delete d.skip[stageId];
  save(d);
}

/**
 * Subjects of the ladder. Both share the storage key above: stage ids are unique across subjects (S1-S6, M1-M6), so the "skip"
 * flags and the inline-item progress of one subject never touch the other one (physics files written before the math ladder
 * existed keep working unchanged).
 */
export const SUBJECTS = [
  { id: 'physics', label: 'פיזיקה', file: 'data/ladder.json', base: '#/ladder', ctxKey: 'ladder' },
  { id: 'math', label: 'מתמטיקה', file: 'data/ladder-math.json', base: '#/ladder/math', ctxKey: 'ladderMath' },
];
export const subjectOf = (id) => SUBJECTS.find((s) => s.id === id) || SUBJECTS[0];
/** Route args after "ladder": ['math','M2','3'] and ['S2','3'] -> { subject, stageId, itemNo }. Physics stays the default. */
export function parseLadderArgs(args = []) {
  const a = args.filter((x) => x != null && x !== '');
  const subject = a.length && SUBJECTS.some((s) => s.id === a[0]) ? a.shift() : 'physics';
  return { subject, stageId: a[0], itemNo: a[1] };
}

/** Id of a stage item: the ref of a physics exercise, or the id of an inline exercise. */
export const itemId = (it) => it.ref || it.id;
export const isInline = (it) => !it.ref;

/** Outcome of an inline item ('alone'|'hinted'|'review'|null), from the ladder's own key. */
export const inlineOutcome = (id) => P.outcomeOf(loadLadder().items || P.emptyState(), id);
function update(fn) {
  const d = loadLadder();
  const st = d.items || P.emptyState();
  fn(st);
  d.items = st;
  save(d);
}
/** Progress sink for exercise-view.js renderExercise, writing to the ladder key (same rules as the main store). */
export function inlineSink(id) {
  const st = () => loadLadder().items || P.emptyState();
  return {
    attempt: () => null, // the main attempt log only knows physics.json exercises
    setReason: () => {},
    tips: () => P.tipsUsed(st(), id),
    setTips: (n) => update((s) => P.openTip(s, id, n)),
    reveal: () => update((s) => P.revealSolution(s, id)),
    correct: () => update((s) => P.completeCorrect(s, id)),
    outcome: () => P.outcomeOf(st(), id),
    guided: () => update((s) => P.markGuided(s, id)),
  };
}
/** Outcome lookup for a stage list: inline ids from the ladder key, refs from `refOutcome` (the main store). */
export function outcomeLookup(stages, refOutcome) {
  const inline = new Set(stages.flatMap((s) => s.items.filter(isInline).map(itemId)));
  const items = loadLadder().items || P.emptyState();
  return (id) => (inline.has(id) ? P.outcomeOf(items, id) : refOutcome(id));
}

/** Items needed 'alone' to pass a stage with n items. */
export const needed = (n) => (n > 0 ? Math.ceil(n * UNLOCK_RATIO - 1e-9) : 0);

/** How many of a stage's items are solved alone / attempted. outcome(id) -> 'alone'|'hinted'|'review'|null (store.outcomeOf, or progress.outcomeOf bound to a state). */
export function stageCounts(stage, outcome) {
  const ids = stage.items.map(itemId);
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

/** Flat list of every item id in the ladder (refs and inline ids, for validation). */
export const allRefs = (stages) => stages.flatMap((s) => s.items.map(itemId));
