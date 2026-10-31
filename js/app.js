import * as store from './store.js';
import { validAnswerSets } from './answersets.js';
import { isolateTitle } from './bidi.js';
import { h, ltr } from './dom.js';
import { loadExtras, openFormulaSheet, formulaButton, examplesSection } from './sheet.js';
import { viewExam } from './exam-ui.js';
import * as practice from './practice-ui.js';
import * as drills from './drills-ui.js';
import * as hunt from './findmistake-ui.js';
import * as backup from './backup.js';
import * as summary from './summary.js';
import * as endless from './endless-ui.js';
import * as order from './order-ui.js';
import * as checkpoints from './checkpoints-ui.js';
import * as methods from './methods-ui.js';
import * as repair from './skills-ui.js';
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
}

/* ---------- views ---------- */
const openSheet = openFormulaSheet;

function viewHome() {
  document.title = 'Brain Gains – תרגול למבחן';
  const cards = TOPICS.map((t) => {
    const list = inTopic(t.id);
    const done = store.countDone(list.map((e) => e.id));
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    return h('a', { class: 'card', href: `#/topic/${t.id}` },
      h('strong', {}, t.title),
      h('span', { class: 'muted' }, `${list.length} תרגילים · הושלמו ${done}`),
      h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` })));
  });
  const queue = store.reviewQueue(exercises.map((e) => e.id));
  const reviewCard = h('section', { class: 'card review-card', 'aria-labelledby': 'review-h' },
    h('strong', { id: 'review-h' }, 'חזרה על טעויות'),
    queue.length
      ? [h('span', { class: 'muted' }, `${queue.length} תרגילים לחזרה (נפתרו עם רמזים או עם הצגת פתרון)`),
        h('ul', { class: 'review-list' }, queue.slice(0, 5).map((id) => {
          const ex = byId(id);
          return h('li', {}, h('span', { 'aria-hidden': 'true' }, OUTCOME_UI[store.outcomeOf(id)].icon), ' ', isolateTitle(ex.title || ex.id));
        })),
        queue.length > 5 ? h('span', { class: 'muted' }, `ועוד ${queue.length - 5}…`) : null,
        h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/review/start' }, 'התחל חזרה'))]
      : h('span', { class: 'muted' }, 'אין תרגילים לחזרה כרגע. תרגילים שנפתרו עם רמזים או עם פתרון יופיעו כאן.'));
  show(
    h('h1', {}, 'במה נתרגל היום?'),
    h('p', { class: 'muted' }, 'בחרו נושא, פתרו תרגילים ובדקו את עצמכם. רמזים ופתרון מלא זמינים בכל תרגיל.'),
    loadErrors.length ? h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון חלק מקבצי התרגילים. נסו לרענן את הדף.') : null,
    exercises.length ? practice.homeCard(examCtx) : null,
    exercises.length ? reviewCard : null,
    exercises.length ? repair.homeCard(examCtx) : null,
    h('div', { class: 'cards' }, cards),
    h('h2', {}, 'כלים'),
    h('div', { class: 'cards' },
      h('a', { class: 'card', href: '#/drills' }, h('strong', {}, '⚡ תרגולים מהירים'), h('span', { class: 'muted' }, 'מלכודות, בדיקות שפיות וכרטיסיות בסשן של 10 פריטים')),
      h('a', { class: 'card', href: '#/hunt' }, h('strong', {}, '🔎 מצאו את הטעות'), h('span', { class: 'muted' }, 'פתרון מלא עם טעות אחת: מצאו את השלב הראשון השגוי')),
      h('a', { class: 'card', href: '#/order' }, h('strong', {}, '🧩 סדרו את שלבי הפתרון'), h('span', { class: 'muted' }, 'שלבי פתרון מעורבבים: סדרו אותם נכון וקבלו ציון')),
      h('a', { class: 'card', href: '#/checkpoints' }, h('strong', {}, '🎯 נקודות ביניים'), h('span', { class: 'muted' }, 'פתרון צעד אחר צעד: מזינים כל תוצאת ביניים ומקבלים משוב מיד')),
      h('a', { class: 'card', href: '#/methods' }, h('strong', {}, '🧭 איך מתחילים?'), h('span', { class: 'muted' }, 'בוחרים שיטה או צעד הבא נכון, ומקבלים הסבר לכל תשובה')),
      h('a', { class: 'card', href: '#/repair' }, h('strong', {}, '🩹 חיזוק יסודות'), h('span', { class: 'muted' }, 'מיני־שיעור ו־3 שאלות על מיומנות בסיס שבה יש טעויות חוזרות')),
      h('a', { class: 'card', href: '#/endless' }, h('strong', {}, '♾️ תרגול ללא הגבלה'), h('span', { class: 'muted' }, 'תרגילים חדשים בכל פעם, באותה רמה ועם רמזים ופתרון מלא')),
      h('a', { class: 'card', href: '#/summary' }, h('strong', {}, '🖨️ סיכום להדפסה'), h('span', { class: 'muted' }, 'דף אחד מהנתונים שלכם: חולשות, נוסחאות ורשימת בדיקה לפני המבחן')),
      h('a', { class: 'card', href: '#/backup' }, h('strong', {}, '💾 גיבוי והעברה'), h('span', { class: 'muted' }, 'שמרו את ההתקדמות או העבירו אותה למכשיר אחר')),
      h('a', { class: 'card', href: '#/exam' }, h('strong', {}, '📝 מצב מבחן'), h('span', { class: 'muted' }, 'שאלות מעורבות, שעון, בלי רמזים ועם דוח בסוף')),
      h('button', { class: 'card card-btn', type: 'button', onclick: (ev) => openSheet(null, ev.currentTarget) }, h('strong', {}, '📐 דף נוסחאות'), h('span', { class: 'muted' }, 'כל הנוסחאות וטעויות נפוצות במקום אחד'))));
}

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
};

function viewWorkoutRoute(arg) {
  if (arg === 'start') {
    location.replace(practice.startWorkout(exercises) ? '#/workout/1' : '#/');
    return;
  }
  if (arg === 'summary') return practice.viewWorkoutSummary(examCtx);
  const w = store.loadWorkout();
  const ids = w ? w.ids.filter((x) => byId(x)) : [];
  const n = Number(arg);
  if (!ids.length || !Number.isInteger(n) || n < 1 || n > ids.length) return location.replace('#/');
  viewExercise(ids[n - 1], false, { n, total: ids.length });
}

function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  try {
    if (parts[0] === 'topic' && parts[1]) viewTopic(parts[1]);
    else if (parts[0] === 'ex' && parts[1]) viewExercise(parts[1]);
    else if (parts[0] === 'progress') { practice.viewProgress(examCtx); const r = backup.reminderLine(); if (r) app.append(r); }
    else if (parts[0] === 'backup') backup.viewBackup(examCtx);
    else if (parts[0] === 'summary') summary.viewSummary(examCtx);
    else if (parts[0] === 'drills') drills.viewDrills(examCtx);
    else if (parts[0] === 'endless') endless.viewEndless(examCtx, parts[1], parts[2]);
    else if (parts[0] === 'order') order.viewOrderRoute(examCtx, parts[1]);
    else if (parts[0] === 'methods') methods.viewMethodsRoute(examCtx, parts[1]);
    else if (parts[0] === 'repair') repair.viewRepairRoute(examCtx, parts[1]);
    else if (parts[0] === 'checkpoints') checkpoints.viewCheckpointsRoute(examCtx, parts[1]);
    else if (parts[0] === 'hunt') hunt.viewHunt(examCtx, parts[1]);
    else if (parts[0] === 'workout') viewWorkoutRoute(parts[1]);
    else if (parts[0] === 'exam') viewExam(examCtx, parts[1]);
    else if (parts[0] === 'review' && parts[1] === 'start') {
      reviewSeen = new Set();
      const first = store.reviewQueue(exercises.map((e) => e.id))[0];
      location.replace(first ? `#/review/${first}` : '#/review/done');
    } else if (parts[0] === 'review' && parts[1] === 'done') viewReviewDone();
    else if (parts[0] === 'review' && parts[1]) viewExercise(parts[1], true);
    else if (parts.length === 0) viewHome();
    else viewNotFound();
  } catch (err) {
    console.error('route failed for', location.hash, err && err.stack ? err.stack : err);
    if (window.omriSelfHeal) window.omriSelfHeal();
    show(h('p', { class: 'error', role: 'alert' }, 'אירעה שגיאה בהצגת העמוד.'),
      h('p', { class: 'muted', dir: 'ltr' }, `${location.hash} — ${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : String(err)}`),
      h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
  }
}

window.addEventListener('hashchange', route);
Promise.all([loadData(), loadExtras()]).then(route);
