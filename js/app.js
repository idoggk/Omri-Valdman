import { h } from './dom.js';
import { loadBootData, droppedNote } from './boot.js';
import * as nav from './nav.js';
import { ROUTES, NEEDS_EXERCISE_VIEW } from './routes.js';

// Static imports here are the eager set (home route); every mode screen is loaded by routes.js on first visit.
// Boot-time data helpers (hard-set loaders, answer validator, formula sheet data, sign keys) are import()ed in
// parallel with the data fetches below, so they are not part of the static graph either.

const TOPICS = [
  { id: 'math-3', title: 'מערכת משוואות עם 3 נעלמים', file: 'math' },
  { id: 'math-4', title: 'מערכת משוואות עם 4 נעלמים', file: 'math' },
  { id: 'math-rad', title: 'שורשים: חישוב ומשוואות', file: 'math' },
  { id: 'math-pow', title: 'חוקי חזקות ומשוואות מעריכיות', file: 'math' },
  { id: 'math-par', title: 'משוואה ריבועית עם פרמטר', file: 'math' },
  { id: 'math-lg', title: 'חישוב לוגריתמים', file: 'math' },
  { id: 'phys-vertical', title: 'תנועה אנכית', file: 'physics' },
  { id: 'phys-horizontal', title: 'תנועה אופקית', file: 'physics' },
];

const app = document.getElementById('app');
let exercises = []; // flat list, file order preserved
let loadErrors = [];
let exerciseView = null; // exercise-view.js, loaded before the few routes whose modes call ctx.renderExercise / ctx.diagramFigure

/* ---------- helpers ---------- */
const topicOf = (id) => TOPICS.find((t) => t.id === id);
const byId = (id) => exercises.find((e) => e.id === id);

function show(...nodes) {
  // null/false entries must be dropped: replaceChildren(null) would insert the text "null"
  app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  window.scrollTo(0, 0);
}

// Footer line when validators dropped items from an incompatible data file (text '' removes it).
function showDataNote(text) {
  let el = document.querySelector('.data-note');
  if (!text) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('p');
    el.className = 'data-note muted';
    el.setAttribute('role', 'status');
    el.style.cssText = 'text-align:center;font-size:.8rem;padding:8px 12px';
    document.body.append(el);
  }
  el.textContent = text;
}

// Which files failed at boot (names from boot.js); the home screen shows a message and a retry button.
async function loadData() {
  let helpers;
  try {
    helpers = await Promise.all([import('./answersets.js'), import('./mathhard.js'), import('./multipart.js'), import('./logs.js')]);
  } catch (err) { // modules missing (stale or half-installed cache): the home screen shows the retry notice
    console.error('boot modules failed to load', err);
    loadErrors = ['math', 'physics', 'ladder', 'mathhard', 'multipart', 'logs'];
    return;
  }
  const [{ validAnswerSets }, mathhard, multipart, logs] = helpers;
  const validExercise = (e) => e && typeof e.id === 'string' && typeof e.topic === 'string' &&
    (Array.isArray(e.inputs) || validAnswerSets(e.answerSets) || (e.choice && Array.isArray(e.choice.options)));
  const r = await loadBootData({
    fetchFn: (u, o) => fetch(u, o),
    validExercise,
    loaders: { mathhard: mathhard.loadMathHardData, multipart: multipart.loadMultipartData, logs: logs.loadLogsData },
    resets: [mathhard.resetMathHardCache, multipart.resetMultipartCache, logs.resetLogsCache],
  });
  loadErrors = r.failed;
  showDataNote(droppedNote(r.dropped));
  exercises = r.exercises;
  examCtx.ladder = r.ladder; // workout simply skips the ladder share when null
  // hard sets feed 4 of the 10 daily items; each loader fails soft (offline without the files = no hard slots)
  examCtx.hard = r.hard;
  const titles = new Map(Object.values(examCtx.hard).flat().map((e) => [e.id, e.title || e.id]));
  examCtx.hardTitle = (id) => titles.get(id) || id;
}

// Formula-sheet data (formulas.json / examples.json) and the sign-key helper load next to the exercise data.
async function loadExtrasAndHelpers() {
  try {
    const [sheet, signkey] = await Promise.all([import('./sheet.js'), import('./signkey.js')]);
    signkey.installSignKeys();
    return await sheet.loadExtras();
  } catch (err) { console.error('boot helpers failed to load', err); }
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
  diagramFigure: (ex) => (exerciseView ? exerciseView.diagramFigure(ex) : null),
  topicOf: (id) => topicOf(id),
  renderExercise: (ex, o) => exerciseView.renderExercise(ex, o),
  ladder: null,
  hard: null,
  hardTitle: (id) => id,
  // home "נסו שוב": reload the data and redraw the route without a full page reload
  retry: async () => { await loadData(); route(); },
};

const env = { ctx: examCtx, show: (...n) => show(...n), notFound: () => viewNotFound() };

/** Hebrew retry screen when a route's module could not be loaded (offline without a cached copy, stale cache, flaky network). */
function showLoadFailure(hash, err) {
  console.error('route module failed to load for', hash, err && err.stack ? err.stack : err);
  if (window.omriSelfHeal) window.omriSelfHeal();
  show(h('p', { class: 'error', role: 'alert' }, 'לא הצלחנו לטעון את המסך הזה. בדקו את החיבור לאינטרנט ונסו שוב.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => route() }, 'נסו שוב'),
      h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
}

function showRouteError(err) {
  console.error('route failed for', location.hash, err && err.stack ? err.stack : err);
  if (window.omriSelfHeal) window.omriSelfHeal();
  show(h('p', { class: 'error', role: 'alert' }, 'אירעה שגיאה בהצגת העמוד.'),
    h('p', { class: 'muted', dir: 'ltr' }, `${location.hash} — ${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : String(err)}`),
    h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
}

let routeSeq = 0; // a slow module load must not draw over a screen the user already navigated away from

async function route() {
  const hash = location.hash;
  const seq = ++routeSeq;
  const { name, args } = nav.resolveRoute(hash);
  nav.renderTabBar(document.getElementById('tabbar'), hash);
  if (name === 'home') {
    try { nav.viewHome(examCtx, loadErrors); } catch (err) { showRouteError(err); }
    return;
  }
  const entry = ROUTES[name];
  if (!entry) { try { viewNotFound(); } catch (err) { showRouteError(err); } return; }
  let mod;
  try {
    const wantsView = NEEDS_EXERCISE_VIEW.includes(name) && !exerciseView;
    [mod, exerciseView] = await Promise.all([entry[0](), wantsView ? import('./exercise-view.js') : exerciseView]);
  } catch (err) {
    if (seq === routeSeq) showLoadFailure(hash, err);
    return;
  }
  if (seq !== routeSeq) return; // a newer navigation took over while the module was loading
  try {
    entry[1](mod, examCtx, args, env);
  } catch (err) {
    showRouteError(err);
  }
}

window.addEventListener('hashchange', route);
Promise.all([loadData(), loadExtrasAndHelpers()]).then(route);
