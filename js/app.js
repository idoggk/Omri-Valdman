import * as store from './store.js';
import { validAnswerSets } from './answersets.js';
import { isolateTitle } from './bidi.js';
import { h, ltr } from './dom.js';
import { loadExtras, openFormulaSheet, formulaButton, examplesSection } from './sheet.js';
import { viewExam } from './exam-ui.js';
import * as practice from './practice-ui.js';
import * as drills from './drills-ui.js';
import * as hunt from './findmistake-ui.js';
import * as multipart from './multipart.js';
import * as backup from './backup.js';
import * as summary from './summary.js';
import * as endless from './endless-ui.js';
import * as order from './order-ui.js';
import * as checkpoints from './checkpoints-ui.js';
import * as methods from './methods-ui.js';
import * as edge from './edgecases-ui.js';
import * as reverse from './reverse-ui.js';
import * as fading from './fading-ui.js';
import * as ladder from './ladder-ui.js';
import * as solve from './fullsolve-ui.js';
import * as repair from './skills-ui.js';
import * as trig from './trig-ui.js';
import * as mathhard from './mathhard-ui.js';
import * as logs from './logs-ui.js';
import { loadMathHardData } from './mathhard.js';
import { loadLogsData } from './logs.js';
import { hardHref } from './workout.js';
import * as nav from './nav.js';
import * as feedbackUi from './feedback-ui.js';
import { installSignKeys } from './signkey.js';
import { renderExercise, diagramFigure, OUTCOME_UI, badge } from './exercise-view.js';

const TOPICS = [
  { id: 'math-3', title: 'מערכת משוואות עם 3 נעלמים', file: 'math' },
  { id: 'math-4', title: 'מערכת משוואות עם 4 נעלמים', file: 'math' },
  { id: 'phys-vertical', title: 'תנועה אנכית', file: 'physics' },
  { id: 'phys-horizontal', title: 'תנועה אופקית', file: 'physics' },
];
const FILES = ['math', 'physics'];

const app = document.getElementById('app');
let exercises = []; // flat list, file order preserved
let loadErrors = [];

/* ---------- helpers ---------- */
let reviewSeen = new Set(); // exercises already visited in the current review round
const topicOf = (id) => TOPICS.find((t) => t.id === id);
const inTopic = (id) => exercises.filter((e) => e.topic === id);
const byId = (id) => exercises.find((e) => e.id === id);

function show(...nodes) {
  // null/false entries must be dropped: replaceChildren(null) would insert the text "null"
  app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  window.scrollTo(0, 0);
}

function outcomeIcon(outcome) {
  const ui = OUTCOME_UI[outcome || 'none'];
  return h('span', { class: `tick o-${outcome || 'none'}`, role: 'img', 'aria-label': ui.label }, ui.icon);
}

function validExercise(e) {
  return e && typeof e.id === 'string' && typeof e.topic === 'string' &&
    (Array.isArray(e.inputs) || validAnswerSets(e.answerSets) || (e.choice && Array.isArray(e.choice.options)));
}

async function loadData() {
  const results = await Promise.all(FILES.map(async (f) => {
    try {
      const res = await fetch(`data/${f}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('not an array');
      return arr.filter(validExercise);
    } catch (err) {
      loadErrors.push(f);
      return [];
    }
  }));
  exercises = results.flat();
  try { // ladder stages feed a share of the daily workout; the app works without them
    const res = await fetch('data/ladder.json', { cache: 'no-cache' });
    const data = res.ok ? await res.json() : null;
    if (data && Array.isArray(data.stages)) examCtx.ladder = data.stages;
  } catch (err) { /* offline without the file: workout simply skips the ladder share */ }
  // hard sets feed 4 of the 10 daily items; each loader fails soft (offline without the files = no hard slots)
  const [mh, mp, lg] = await Promise.all([loadMathHardData(), multipart.loadMultipartData(), loadLogsData()]);
  examCtx.hard = { mathhard: mh.ok ? mh.data : [], multipart: mp.ok ? mp.data : [], logs: lg.ok ? lg.exercises : [] };
  const titles = new Map(Object.values(examCtx.hard).flat().map((e) => [e.id, e.title || e.id]));
  examCtx.hardTitle = (id) => titles.get(id) || id;
}

/* ---------- views ---------- */
const openSheet = openFormulaSheet;

function viewTopic(topicId, levelFilter = 0) {
  const topic = topicOf(topicId);
  if (!topic) return viewNotFound();
  document.title = `${topic.title} – Brain Gains`;
  const list = inTopic(topicId);
  const shown = levelFilter ? list.filter((e) => e.level === levelFilter) : list;

  const suggested = practice.suggestedLevel(list); // a hint only: every level stays open
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'סינון לפי רמה' },
    [[0, 'הכול'], [1, 'רמה 1'], [2, 'רמה 2'], [3, 'רמה 3']].map(([lv, label]) =>
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(lv === levelFilter),
        onclick: () => viewTopic(topicId, lv),
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

function viewExercise(id, reviewMode = false, wk = null) {
  const ex = byId(id);
  if (!ex) return viewNotFound();
  if (reviewMode) reviewSeen.add(id);
  renderExercise(ex, {
    ctx: examCtx, reviewMode, wk, siblings: inTopic(ex.topic), reviewNextHref: () => reviewNextHref(id),
  });
}

function reviewNextHref(currentId) {
  const next = store.reviewQueue(exercises.map((e) => e.id)).find((x) => x !== currentId && !reviewSeen.has(x));
  return next ? `#/review/${next}` : '#/review/done';
}

function viewReviewDone() {
  document.title = 'סיום חזרה – Brain Gains';
  const left = store.reviewQueue(exercises.map((e) => e.id)).length;
  show(h('h1', {}, 'סיימנו את סבב החזרה'),
    h('p', {}, left ? `נשארו ${left} תרגילים לחזרה. אפשר להתחיל סבב נוסף.` : 'אין יותר תרגילים לחזרה. כל הכבוד!'),
    h('div', { class: 'btn-row' },
      left ? h('a', { class: 'btn primary', href: '#/review/start' }, 'סבב נוסף') : null,
      h('a', { class: 'btn', href: '#/' }, 'לדף הבית')));
}

function viewNotFound() {
  if (window.omriSelfHeal) window.omriSelfHeal(); // maybe a stale cached app that predates this route
  show(h('h1', {}, 'העמוד לא נמצא'), h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
}

/* ---------- router ---------- */
const examCtx = {
  topics: TOPICS,
  get exercises() { return exercises; },
  byId: (id) => byId(id),
  show: (...n) => show(...n),
  diagramFigure: (ex) => diagramFigure(ex),
  topicOf: (id) => topicOf(id),
  renderExercise: (ex, o) => renderExercise(ex, o),
  ladder: null,
  hard: null,
  hardTitle: (id) => id,
};

function viewWorkoutRoute(arg) {
  if (arg === 'start') {
    location.replace(practice.startWorkout(exercises, Date.now(), examCtx.ladder, examCtx.hard) ? '#/workout/1' : '#/');
    return;
  }
  if (arg === 'summary') return practice.viewWorkoutSummary(examCtx);
  const w = store.loadWorkout();
  const ids = w ? w.ids.filter((x) => byId(x) || hardHref(x)) : [];
  const n = Number(arg);
  if (!ids.length || !Number.isInteger(n) || n < 1 || n > ids.length) return location.replace('#/');
  if (!byId(ids[n - 1])) return practice.viewHardStep(examCtx, ids[n - 1], { n, total: ids.length });
  viewExercise(ids[n - 1], false, { n, total: ids.length });
}

function progressLinks() {
  return h('div', { class: 'btn-row' },
    h('a', { class: 'btn', href: '#/summary' }, '🖨️ סיכום להדפסה'),
    h('a', { class: 'btn', href: '#/backup' }, '💾 גיבוי והעברה'),
    h('a', { class: 'btn', href: '#/feedback' }, '📊 משוב על קושי'));
}

function route() {
  const { name, args } = nav.resolveRoute(location.hash);
  nav.renderTabBar(document.getElementById('tabbar'), location.hash);
  try {
    if (name === 'topic') viewTopic(args[0]);
    else if (name === 'ex') viewExercise(args[0]);
    else if (name === 'progress') { practice.viewProgress(examCtx); app.append(progressLinks()); const cal = solve.calibrationLine(); if (cal) app.append(cal); const r = backup.reminderLine(); if (r) app.append(r); }
    else if (name === 'practice-hub') nav.viewHub(examCtx);
    else if (name === 'backup') backup.viewBackup(examCtx);
    else if (name === 'feedback') feedbackUi.viewFeedback(examCtx);
    else if (name === 'summary') summary.viewSummary(examCtx);
    else if (name === 'drills') drills.viewDrills(examCtx);
    else if (name === 'endless') endless.viewEndless(examCtx, args[0], args[1]);
    else if (name === 'order') order.viewOrderRoute(examCtx, args[0]);
    else if (name === 'methods') methods.viewMethodsRoute(examCtx, args[0]);
    else if (name === 'solve') solve.viewSolveRoute(examCtx, args[0]);
    else if (name === 'edge') edge.viewEdgeRoute(examCtx, args[0]);
    else if (name === 'fading') fading.viewFadingRoute(examCtx, args[0]);
    else if (name === 'ladder') ladder.viewLadderRoute(examCtx, ...args);
    else if (name === 'reverse') reverse.viewReverseRoute(examCtx, args[0]);
    else if (name === 'repair') repair.viewRepairRoute(examCtx, args[0]);
    else if (name === 'checkpoints') checkpoints.viewCheckpointsRoute(examCtx, args[0]);
    else if (name === 'hunt') hunt.viewHunt(examCtx, args[0]);
    else if (name === 'multipart') multipart.viewMultipart(examCtx, args[0]);
    else if (name === 'trig') trig.viewTrigRoute(examCtx, args[0], args[1]);
    else if (name === 'logs') logs.viewLogsRoute(examCtx, args[0], args[1]);
    else if (name === 'mathhard') mathhard.viewMathHard(examCtx, args[0]);
    else if (name === 'workout') viewWorkoutRoute(args[0]);
    else if (name === 'exam') viewExam(examCtx, args[0]);
    else if (name === 'review-start') {
      reviewSeen = new Set();
      const first = store.reviewQueue(exercises.map((e) => e.id))[0];
      location.replace(first ? `#/review/${first}` : '#/review/done');
    } else if (name === 'review-done') viewReviewDone();
    else if (name === 'review') viewExercise(args[0], true);
    else if (name === 'home') nav.viewHome(examCtx, loadErrors);
    else viewNotFound();
  } catch (err) {
    console.error('route failed for', location.hash, err && err.stack ? err.stack : err);
    if (window.omriSelfHeal) window.omriSelfHeal();
    show(h('p', { class: 'error', role: 'alert' }, 'אירעה שגיאה בהצגת העמוד.'),
      h('p', { class: 'muted', dir: 'ltr' }, `${location.hash} — ${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : String(err)}`),
      h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
  }
}

installSignKeys();
window.addEventListener('hashchange', route);
Promise.all([loadData(), loadExtras()]).then(route);
