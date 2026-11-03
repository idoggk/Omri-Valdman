// #/notes logic: "דגשים", the points Omri wrote down as exam traps (exponentials are always positive, when you may multiply
// an inequality, the basic log rules). 12 memory cards (Leitner boxes, same scheme as trig/logs cards) and 16 drill questions
// that use the #/logs answer machinery. Shared by js/notes-ui.js, tools/verify-notes.mjs and tests/notes.test.mjs. No DOM.
import { safeSetItem } from './storage.js';
import { validExercise } from './logs.js';
import {
  emptyState, sanitizeState, gradeCard, dueCards, requeueGap, boxCounts, recordDrill, pickDrills, MAX_BOX, BOX_DAYS, DAY_MS,
} from './trig.js';

export const NOTES_KEY = 'omri-study-notes-v1';
export const NOTES_TOPIC = 'notes';
export const NOTES_FILE = 'data/notes.json';
export const GROUPS = [
  { id: 'exp', label: 'חזקות חיוביות תמיד' },
  { id: 'mul', label: 'כפל וחילוק באי־שוויון ובמשוואה' },
  { id: 'log', label: 'כללי הלוגריתם' },
];
export { gradeCard, dueCards, requeueGap, boxCounts, recordDrill, pickDrills, MAX_BOX, BOX_DAYS, DAY_MS };

const isArr = Array.isArray;
const isStr = (s) => typeof s === 'string' && s.length > 0;

/** A card: one-line rule, why, trap, plus a mini check question (an exercise-shaped record with an exact answer). */
export function validCard(c) {
  return !!c && isStr(c.id) && GROUPS.some((g) => g.id === c.group) && isStr(c.name) && isStr(c.rule) && isStr(c.why) &&
    !!c.trap && isStr(c.trap.wrong) && isStr(c.trap.right) && !!c.mini && isStr(c.mini.ask) && isArr(c.mini.eq) && c.mini.eq.length > 0 &&
    isArr(c.mini.steps) && c.mini.steps.length >= 2 && isArr(c.mini.hints) && c.mini.hints.length === 2 &&
    !!c.mini.answer && !!c.mini.check;
}
export const validQuestion = validExercise;

let cache = null;
export const resetNotesCache = () => { cache = null; };

/** { ok, cards, questions }. */
export async function loadNotesData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, ...cache };
  try {
    const res = await fetchFn(NOTES_FILE, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!d || !isArr(d.cards) || !isArr(d.questions)) throw new Error('bad notes file');
    cache = { cards: d.cards.filter(validCard), questions: d.questions.filter(validQuestion) };
    return { ok: true, ...cache };
  } catch (e) {
    return { ok: false };
  }
}

export function loadNotes(storage = globalThis.localStorage) {
  try { return sanitizeState(JSON.parse(storage.getItem(NOTES_KEY))); } catch (e) { return emptyState(); }
}
export function saveNotes(state, storage = globalThis.localStorage) {
  return safeSetItem(NOTES_KEY, JSON.stringify(state), storage);
}

/** Card session result: the Leitner grade is "solved the mini question without a hint, wrong try or peeking at the rule". */
export const cardKnown = ({ solved, hints = 0, wrongs = 0, peeked = false }) => !!solved && !hints && !wrongs && !peeked;

/** Attempt outcome for the attempts log: alone / hinted / wrong. */
export const cardOutcome = (r) => (cardKnown(r) ? 'alone' : r.solved ? 'hinted' : 'wrong');

/** Cards per group, for the hub. */
export const groupCounts = (cards) => GROUPS.map((g) => cards.filter((c) => c.group === g.id).length);
