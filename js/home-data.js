// Data helpers of the home screen (today's workout split, the plan snapshot). They used to live in practice-ui.js
// and plan-ui.js; they sit here so that the home route loads a handful of modules instead of every mode screen.
// practice-ui.js and plan-ui.js re-export these names, so existing imports keep working.
import * as store from './store.js';
import { dueReviews, schedules } from './srs.js';
import { loadFeedback } from './feedback.js';
import { loadLadder } from './ladder.js';
import { dueCount } from './notebook.js';
import { dueCount as deriveDueCount } from './derive-state.js';
import { loadSaved as loadBooklet } from './booklet.js';
import { planLines } from './journal.js';
import { load as loadExamday } from './examday.js';
import { topicTitle, topicHref } from './engine.js';
import { buildPlan, loadSettings } from './plan.js';

export const WORKOUT_SIZE = 10;

/** How the picked ids split: scheduled reviews due now, practice in weak topics, brand-new exercises. */
export function workoutMix(log, exercises, now, ids) {
  const due = new Set(dueReviews(log, now));
  const seen = schedules(log);
  const mix = { due: 0, weak: 0, fresh: 0 };
  for (const id of ids) {
    if (due.has(id)) mix.due++;
    else if (seen.has(id)) mix.weak++;
    else mix.fresh++;
  }
  return mix;
}

/** Inputs of the workout picker that live outside the attempt log: difficulty feedback and the ladder stages. */
export function workoutOpts(ladder, hard = null) {
  return { feedback: loadFeedback(), ladder: Array.isArray(ladder) ? ladder : null, skip: loadLadder().skip, hard };
}

/** Latest outcome of each workout exercise recorded since the workout started (undefined = skipped). */
export function workoutResults(workout, log) {
  const res = {};
  for (const a of log) if (a.ts >= workout.startedAt && workout.ids.includes(a.exerciseId)) res[a.exerciseId] = a;
  return res;
}

export function collectPlan(ctx, now = Date.now()) {
  const log = store.getAttempts();
  const titles = new Map((ctx.topics || []).map((t) => [t.id, t.title]));
  const feedback = loadFeedback();
  let dueNotebook = null;
  try { dueNotebook = dueCount(log, feedback, now); } catch (e) { /* optional */ }
  let dueDerive = 0;
  try { dueDerive = deriveDueCount(globalThis.localStorage, now); } catch (e) { /* optional */ }
  return buildPlan({
    settings: loadSettings(), log, now, exercises: ctx.exercises || [], feedback, mocks: loadBooklet().results, dueNotebook, dueDerive,
    journal: planLines(), examday: loadExamday(),
    titleOf: (t) => titles.get(t) || topicTitle(t) || t, hrefOf: (t) => topicHref(t) || `#/topic/${t}`,
  });
}
