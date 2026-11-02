// UI for the practice engine: today's workout, progress screen, error-reason chips.
// All dynamic text goes through h() (text nodes), never innerHTML.
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import * as store from './store.js';
import {
  ERROR_REASONS, dueReviews, schedules, weakTopics, levelInfo, topicStats,
  recurringReasons, currentStreak, last7Days, reasonLabel, withVirtual,
} from './srs.js';
import { pickWorkout } from './workout.js';
import { topicsWithEngine, topicTitle, itemHref } from './engine.js';
import { loadFeedback } from './feedback.js';
import { loadLadder } from './ladder.js';
import { trapAccuracySection } from './drills-ui.js';
import { findMistakeSection } from './findmistake-ui.js';
import { endlessSection } from './endless-ui.js';
import { orderSection } from './order-ui.js';

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
export function workoutOpts(ladder) {
  return { feedback: loadFeedback(), ladder: Array.isArray(ladder) ? ladder : null, skip: loadLadder().skip };
}

export function startWorkout(exercises, now = Date.now(), ladder = null) {
  const ids = pickWorkout(store.getAttempts(), exercises, now, WORKOUT_SIZE, workoutOpts(ladder));
  if (!ids.length) return false;
  store.saveWorkout({ ids, startedAt: now });
  return true;
}

/** Latest outcome of each workout exercise recorded since the workout started (undefined = skipped). */
export function workoutResults(workout, log) {
  const res = {};
  for (const a of log) if (a.ts >= workout.startedAt && workout.ids.includes(a.exerciseId)) res[a.exerciseId] = a;
  return res;
}

/* ---------- home card ---------- */
export function homeCard(ctx) {
  const exercises = ctx.exercises;
  const now = Date.now();
  const ids = pickWorkout(store.getAttempts(), exercises, now, WORKOUT_SIZE, workoutOpts(ctx.ladder));
  const mix = workoutMix(store.getAttempts(), exercises, now, ids);
  const stat = (n, label) => h('li', {}, h('strong', {}, String(n)), ' ', label);
  return h('section', { class: 'card workout-card', 'aria-labelledby': 'workout-h' },
    h('strong', { id: 'workout-h' }, 'האימון של היום'),
    ids.length
      ? [h('ul', { class: 'mix' }, stat(mix.due, 'חזרות מתוזמנות'), stat(mix.weak, 'נושאים חלשים'), stat(mix.fresh, 'חדשים')),
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn primary', href: '#/workout/start' }, `התחל אימון (${ids.length} שאלות)`),
          h('a', { class: 'btn', href: '#/progress' }, 'ההתקדמות שלי'))]
      : h('span', { class: 'muted' }, 'אין תרגילים זמינים לאימון.'));
}

/* ---------- workout ---------- */
export function workoutBar(n, total) {
  return h('div', { class: 'workout-bar', role: 'status' },
    h('strong', {}, `שאלה ${n} מתוך ${total}`),
    h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((n / total) * 100)}%` })));
}

export function viewWorkoutSummary(ctx) {
  document.title = 'סיכום אימון – Brain Gains';
  const w = store.loadWorkout();
  if (!w) return ctx.show(h('h1', {}, 'אין אימון פעיל'), h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
  const res = workoutResults(w, store.getAttempts());
  const count = (f) => Object.values(res).filter(f).length;
  const alone = count((a) => a.outcome === 'alone');
  const hinted = count((a) => a.outcome === 'hinted');
  const review = count((a) => a.outcome === 'wrong' || a.outcome === 'solution');
  const skipped = w.ids.length - Object.keys(res).length;
  const items = w.ids.map((id, i) => {
    const ex = ctx.byId(id);
    const a = res[id];
    const mark = !a ? '○' : a.outcome === 'alone' ? '✓' : a.outcome === 'hinted' ? '💡' : '🔁';
    return h('li', {}, h('a', { class: 'ex-item', href: `#/workout/${i + 1}` },
      h('span', { class: 't' }, isolateTitle(ex ? (ex.title || ex.id) : id)), h('span', { 'aria-hidden': 'true' }, mark)));
  });
  ctx.show(
    h('h1', {}, 'סיכום האימון'),
    h('ul', { class: 'mix' },
      h('li', {}, h('strong', {}, String(alone)), ' נפתרו לבד'),
      h('li', {}, h('strong', {}, String(hinted)), ' עם רמזים'),
      h('li', {}, h('strong', {}, String(review)), ' לחזרה'),
      h('li', {}, h('strong', {}, String(skipped)), ' דולגו')),
    h('ul', { class: 'ex-list' }, items),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn primary', href: '#/workout/start' }, 'אימון נוסף'),
      h('a', { class: 'btn', href: '#/progress' }, 'ההתקדמות שלי'),
      h('a', { class: 'btn', href: '#/' }, 'לדף הבית')));
}

/* ---------- error reason chips ---------- */
/** Skippable one-tap row. onPick(reasonId) is called once; skipping just removes the row. */
export function reasonChips(onPick) {
  const box = h('div', { class: 'reason-box' });
  const done = (text) => box.replaceChildren(h('p', { class: 'muted', role: 'status' }, text));
  box.append(
    h('p', { class: 'muted' }, 'מה הייתה הסיבה? (אפשר לדלג)'),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'סיבת הטעות' },
      ERROR_REASONS.map((r) => h('button', {
        class: 'chip', type: 'button',
        onclick: () => { onPick(r.id); done(`נשמר: ${r.label}`); },
      }, r.label)),
      h('button', { class: 'chip skip', type: 'button', onclick: () => box.replaceChildren() }, 'דלג')));
  return box;
}

/* ---------- topic level chips ---------- */
/** Level suggested for a topic (null when unknown). Informational only: nothing is locked. */
export function suggestedLevel(topicExercises) {
  return levelInfo(store.getAttempts(), topicExercises).suggested;
}

/* ---------- progress screen ---------- */
export function viewProgress(ctx) {
  document.title = 'ההתקדמות שלי – Brain Gains';
  const log = store.getAttempts();
  const now = Date.now();
  const exercises = ctx.exercises;
  const streak = currentStreak(log, now);
  const week = last7Days(log, now);
  const max = Math.max(1, ...week.map((d) => d.attempts));
  const all = withVirtual(exercises, log);
  const stats = topicStats(log, all);
  const allTopics = topicsWithEngine(ctx.topics, log);

  const bars = h('div', { class: 'week', role: 'img', 'aria-label': `פעילות ב-7 הימים האחרונים: ${week.map((d) => d.attempts).join(', ')}` },
    week.map((d) => h('div', { class: 'day' },
      h('span', { class: 'n' }, String(d.attempts)),
      h('span', { class: 'bar', style: `height:${Math.round((d.attempts / max) * 100)}%` }),
      h('span', { class: 'd' }, d.day.slice(8) + '/' + d.day.slice(5, 7)))));

  const topicRows = ctx.topics.map((t) => {
    const total = exercises.filter((e) => e.topic === t.id).length;
    const s = stats[t.id];
    const mastered = s ? s.mastered : 0;
    const pct = total ? Math.round((mastered / total) * 100) : 0;
    return h('li', { class: 'topic-row' },
      h('strong', {}, isolateTitle(t.title)),
      h('span', { class: 'muted' }, s ? `שולטים ב-${mastered} מתוך ${total} · נפתרו לבד ${Math.round(s.aloneRate * 100)}%` : `${total} תרגילים · טרם נוסו`),
      h('div', { class: 'progress-bar', role: 'img', 'aria-label': `שליטה ${pct}%` }, h('span', { style: `width:${pct}%` })));
  });

  // standalone modes (hard math, multipart, trig, logs): no fixed exercise list, so show what was practiced
  for (const t of allTopics.slice(ctx.topics.length)) {
    const s = stats[t.id];
    if (s) topicRows.push(h('li', { class: 'topic-row' }, h('strong', {}, isolateTitle(t.title)),
      h('span', { class: 'muted' }, `${s.exercises} פריטים · נפתרו לבד ${Math.round(s.aloneRate * 100)}% · דיוק ${Math.round(s.accuracy * 100)}%`)));
  }
  const known = new Set(exercises.map((e) => e.id));
  const topicOfId = new Map(log.filter((a) => a.topic).map((a) => [a.exerciseId, a.topic]));
  const dueExtra = dueReviews(log, now).filter((id) => !known.has(id) && itemHref(id, topicOfId.get(id))).slice(0, 8);

  const reasons = recurringReasons(log);
  const weakest = weakTopics(log, all)[0];
  let target;
  if (weakest) {
    const t = allTopics.find((x) => x.id === weakest.topic);
    const lvl = levelInfo(log, exercises.filter((e) => e.topic === weakest.topic)).suggested;
    target = `כדאי להמשיך עם "${t ? t.title : weakest.topic}"${lvl ? `, רמה ${lvl}` : ''}.`;
  } else target = 'התחילו אימון ראשון כדי לקבל המלצה.';

  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית')),
    h('h1', {}, 'ההתקדמות שלי'),
    h('div', { class: 'panel' }, h('strong', {}, `🔥 רצף: ${streak} ${streak === 1 ? 'יום' : 'ימים'}`)),
    h('h2', {}, '7 הימים האחרונים'), bars,
    h('h2', {}, 'שליטה לפי נושא'), h('ul', { class: 'topic-list' }, topicRows),
    dueExtra.length ? h('section', { 'aria-label': 'חזרות מתוזמנות' },
      h('h2', {}, 'חזרות שהגיע זמנן'),
      h('ul', { class: 'ex-list' }, dueExtra.map((id) => h('li', {}, h('a', { class: 'ex-item', href: itemHref(id, topicOfId.get(id)) },
        h('span', { class: 't' }, isolateTitle(topicTitle(topicOfId.get(id)) || id)), h('span', { class: 'muted' }, id)))))) : null,
    h('h2', {}, 'סיבות חוזרות לטעויות'),
    reasons.length
      ? h('ul', { class: 'reasons' }, reasons.map((r) => h('li', {}, `${reasonLabel(r.reason)}: ${r.count}`)))
      : h('p', { class: 'muted' }, 'עדיין אין סיבה שחוזרת על עצמה.'),
    trapAccuracySection(),
    findMistakeSection(),
    endlessSection(),
    orderSection(),
    h('h2', {}, 'היעד הבא'),
    h('div', { class: 'notice' }, target),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/workout/start' }, 'התחל אימון')));
}
