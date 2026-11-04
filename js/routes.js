// Route table: route name (from nav.resolveRoute) -> [loader, run]. The loader is a dynamic import() of the module (or
// modules) behind the screen, so a mode's code is only fetched and evaluated on the first visit to its route. Every
// module stays in sw.js PRECACHE, so a lazy route works offline. `run(mod, ctx, args, env)` draws the screen.
// The home route is not here: nav.js is loaded eagerly. tests/lazy-routes.test.mjs checks that every route name in
// nav.js has an entry and that each loader names an existing, precached module.
// `env` = { ctx, show, notFound } as in js/core-views.js.

import { h } from './dom.js';

const core = () => import('./core-views.js');

export const ROUTES = {
  topic: [core, (m, c, a, env) => m.viewTopic(env, a[0])],
  ex: [core, (m, c, a, env) => m.viewExercise(env, a[0])],
  review: [core, (m, c, a, env) => m.viewExercise(env, a[0], true)],
  'review-start': [core, (m, c, a, env) => m.startReview(env)],
  'review-done': [core, (m, c, a, env) => m.viewReviewDone(env)],
  workout: [core, (m, c, a, env) => m.viewWorkoutRoute(env, a[0])],
  progress: [
    () => Promise.all([import('./practice-ui.js'), import('./fullsolve-ui.js'), import('./backup-lite.js')]),
    ([practice, solve, backup], c, a, env) => {
      practice.viewProgress(c);
      const app = document.getElementById('app');
      app.append(progressLinks());
      const cal = solve.calibrationLine(); if (cal) app.append(cal);
      const r = backup.reminderLine(); if (r) app.append(r);
    },
  ],
  'practice-hub': [() => import('./hub.js'), (m, c) => m.viewHub(c)],
  backup: [() => import('./backup.js'), (m, c) => m.viewBackup(c)],
  feedback: [() => import('./feedback-ui.js'), (m, c) => m.viewFeedback(c)],
  summary: [() => import('./summary.js'), (m, c) => m.viewSummary(c)],
  drills: [() => import('./drills-ui.js'), (m, c) => m.viewDrills(c)],
  endless: [() => import('./endless-ui.js'), (m, c, a) => m.viewEndless(c, a[0], a[1])],
  order: [() => import('./order-ui.js'), (m, c, a) => m.viewOrderRoute(c, a[0])],
  methods: [() => import('./methods-ui.js'), (m, c, a) => m.viewMethodsRoute(c, a[0])],
  solve: [() => import('./fullsolve-ui.js'), (m, c, a) => m.viewSolveRoute(c, a[0])],
  edge: [() => import('./edgecases-ui.js'), (m, c, a) => m.viewEdgeRoute(c, a[0])],
  fading: [() => import('./fading-ui.js'), (m, c, a) => m.viewFadingRoute(c, a[0])],
  ladder: [() => import('./ladder-ui.js'), (m, c, a) => m.viewLadderRoute(c, ...a)],
  reverse: [() => import('./reverse-ui.js'), (m, c, a) => m.viewReverseRoute(c, a[0])],
  repair: [() => import('./skills-ui.js'), (m, c, a) => m.viewRepairRoute(c, a[0])],
  checkpoints: [() => import('./checkpoints-ui.js'), (m, c, a) => m.viewCheckpointsRoute(c, a[0])],
  hunt: [() => import('./findmistake-ui.js'), (m, c, a) => m.viewHunt(c, a[0])],
  multipart: [() => import('./multipart.js'), (m, c, a) => m.viewMultipart(c, a[0])],
  trig: [() => import('./trig-ui.js'), (m, c, a) => m.viewTrigRoute(c, a[0], a[1])],
  logs: [() => import('./logs-ui.js'), (m, c, a) => m.viewLogsRoute(c, a[0], a[1])],
  mathhard: [() => import('./mathhard-ui.js'), (m, c, a) => m.viewMathHard(c, a[0])],
  transfer: [() => import('./transfer-ui.js'), (m, c, a) => m.viewTransfer(c, a[0])],
  recover: [() => import('./recover-ui.js'), (m, c, a) => m.viewRecover(c, a[0])],
  notebook: [() => import('./notebook-ui.js'), (m, c) => m.viewNotebook(c)],
  writing: [() => import('./writing-ui.js'), (m, c, a) => m.viewWriting(c, a[0])],
  booklet: [() => import('./booklet-ui.js'), (m, c, a) => m.viewBooklet(c, ...a)],
  formulas: [() => import('./fbuilder-ui.js'), (m, c, a) => m.viewFormulas(c, a[0], a[1])],
  sprint: [() => import('./sprint-ui.js'), (m, c, a) => m.viewSprint(c, a[0], a[1], a[2])],
  units: [() => import('./units-ui.js'), (m, c, a) => m.viewUnits(c, a[0], a[1])],
  estimate: [() => import('./estimate-ui.js'), (m, c, a) => m.viewEstimate(c, a[0], a[1])],
  notes: [() => import('./notes-ui.js'), (m, c, a) => m.viewNotesRoute(c, a[0], a[1])],
  derive: [() => import('./derive-ui.js'), (m, c, a) => m.viewDeriveRoute(c, a[0], a[1])],
  counter: [() => import('./counter-ui.js'), (m, c, a) => m.viewCounter(c, a[0], a[1])],
  calibration: [() => import('./calibration-ui.js'), (m, c) => m.viewCalibration(c)],
  examday: [() => import('./examday-ui.js'), (m, c) => m.viewExamDay(c)],
  plan: [() => import('./plan-ui.js'), (m, c) => m.viewPlan(c)],
  blind: [() => import('./blind-ui.js'), (m, c, a) => m.viewBlind(c, a[0])],
  recovery: [() => import('./recovery-ui.js'), (m, c, a) => m.viewRecovery(c, a[0])],
  pressure: [() => import('./pressure-ui.js'), (m, c, a) => m.viewPressure(c, a[0])],
  exam: [() => import('./exam-ui.js'), (m, c, a) => m.viewExam(c, a[0])],
};

/** Routes whose mode calls ctx.renderExercise / ctx.diagramFigure: app.js loads exercise-view.js before drawing them. */
export const NEEDS_EXERCISE_VIEW = ['endless', 'ladder', 'exam', 'order'];

function progressLinks() {
  return h('div', { class: 'btn-row' },
    h('a', { class: 'btn', href: '#/summary' }, '🖨️ סיכום להדפסה'),
    h('a', { class: 'btn', href: '#/backup' }, '💾 גיבוי והעברה'),
    h('a', { class: 'btn', href: '#/feedback' }, '📊 משוב על קושי'));
}
