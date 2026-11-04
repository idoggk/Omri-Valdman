// Topic list, single exercise, review round and workout views. Moved out of app.js (unchanged) so that the first
// load does not pull exercise-view.js, practice-ui.js, sheet.js and their dependencies; js/routes.js loads this
// module with import() on the first visit to #/topic, #/ex, #/review or #/workout.
// `env` = { ctx, show, notFound }: ctx is app.js's examCtx (exercises, byId, topicOf, ladder, hard ...).
import * as store from './store.js';
import { isolateTitle } from './bidi.js';
import { h, ltr } from './dom.js';
import { examplesSection, formulaButton } from './sheet.js';
import * as practice from './practice-ui.js';
import { hardHref } from './workout.js';
import { renderExercise, OUTCOME_UI, badge } from './exercise-view.js';

const outcomeIcon = (outcome) => {
  const ui = OUTCOME_UI[outcome || 'none'];
  return h('span', { class: `tick o-${outcome || 'none'}`, role: 'img', 'aria-label': ui.label }, ui.icon);
};

let reviewSeen = new Set(); // exercises already visited in the current review round

export function viewTopic(env, topicId, levelFilter = 0) {
  const { ctx, show, notFound } = env;
  const topic = ctx.topicOf(topicId);
  if (!topic) return notFound();
  document.title = `${topic.title} – Brain Gains`;
  const list = ctx.exercises.filter((e) => e.topic === topicId);
  const shown = levelFilter ? list.filter((e) => e.level === levelFilter) : list;

  const suggested = practice.suggestedLevel(list); // a hint only: every level stays open
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'סינון לפי רמה' },
    [[0, 'הכול'], [1, 'רמה 1'], [2, 'רמה 2'], [3, 'רמה 3']].map(([lv, label]) =>
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(lv === levelFilter),
        onclick: () => viewTopic(env, topicId, lv),
      }, lv && lv === suggested ? `${label} · מומלץ` : label)));

  const items = shown.map((e) =>
    h('li', {}, h('a', { class: 'ex-item', href: `#/ex/${e.id}` },
      badge(e.level),
      h('span', { class: 't' }, isolateTitle(e.title || e.id)),
      outcomeIcon(store.outcomeOf(e.id)))));
  const legend = h('ul', { class: 'legend', 'aria-label': 'מקרא' },
    ['alone', 'hinted', 'review', 'none'].map((k) =>
      h('li', {}, h('span', { 'aria-hidden': 'true' }, OUTCOME_UI[k].icon), ' ', OUTCOME_UI[k].label)));

  show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לנושאים')),
    h('h1', {}, topic.title),
    topicId.startsWith('phys-')
      ? h('p', { class: 'notice' }, 'בתרגילי הפיזיקה נקח ', ltr('g = 10 מ/ש²'), '.') : null,
    h('div', { class: 'btn-row' }, formulaButton(topicId)),
    examplesSection(topicId),
    filters,
    legend,
    items.length ? h('ul', { class: 'ex-list' }, items)
      : h('p', { class: 'muted' }, list.length ? 'אין תרגילים ברמה הזו.' : 'עדיין אין תרגילים בנושא הזה.'));
}

export function viewExercise(env, id, reviewMode = false, wk = null) {
  const { ctx } = env;
  const ex = ctx.byId(id);
  if (!ex) return env.notFound();
  if (reviewMode) reviewSeen.add(id);
  renderExercise(ex, {
    ctx, reviewMode, wk, siblings: ctx.exercises.filter((e) => e.topic === ex.topic), reviewNextHref: () => reviewNextHref(env, id),
  });
}

function reviewNextHref(env, currentId) {
  const next = store.reviewQueue(env.ctx.exercises.map((e) => e.id)).find((x) => x !== currentId && !reviewSeen.has(x));
  return next ? `#/review/${next}` : '#/review/done';
}

export function viewReviewDone(env) {
  document.title = 'סיום חזרה – Brain Gains';
  const left = store.reviewQueue(env.ctx.exercises.map((e) => e.id)).length;
  env.show(h('h1', {}, 'סיימנו את סבב החזרה'),
    h('p', {}, left ? `נשארו ${left} תרגילים לחזרה. אפשר להתחיל סבב נוסף.` : 'אין יותר תרגילים לחזרה. כל הכבוד!'),
    h('div', { class: 'btn-row' },
      left ? h('a', { class: 'btn primary', href: '#/review/start' }, 'סבב נוסף') : null,
      h('a', { class: 'btn', href: '#/' }, 'לדף הבית')));
}

export function startReview(env) {
  reviewSeen = new Set();
  const first = store.reviewQueue(env.ctx.exercises.map((e) => e.id))[0];
  location.replace(first ? `#/review/${first}` : '#/review/done');
}

export function viewWorkoutRoute(env, arg) {
  const { ctx } = env;
  if (arg === 'start') {
    location.replace(practice.startWorkout(ctx.exercises, Date.now(), ctx.ladder, ctx.hard) ? '#/workout/1' : '#/');
    return;
  }
  if (arg === 'summary') return practice.viewWorkoutSummary(ctx);
  const w = store.loadWorkout();
  const ids = w ? w.ids.filter((x) => ctx.byId(x) || hardHref(x)) : [];
  const n = Number(arg);
  if (!ids.length || !Number.isInteger(n) || n < 1 || n > ids.length) return location.replace('#/');
  if (!ctx.byId(ids[n - 1])) return practice.viewHardStep(ctx, ids[n - 1], { n, total: ids.length });
  viewExercise(env, ids[n - 1], false, { n, total: ids.length });
}
