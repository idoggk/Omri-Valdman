// Navigation: route table, bottom tab bar and the home / practice-hub screens.
// Pure helpers (resolveRoute, activeTab, tabsHidden) are testable without the DOM.
import './runroutes.js';
import { h } from './dom.js';
import * as store from './store.js';
import { weakTopics, withVirtual } from './srs.js';
import { workoutMix, workoutResults, workoutOpts, WORKOUT_SIZE } from './practice-ui.js';
import { pickWorkout, levelLine, pickHard, hardHref } from './workout.js';
import { loadFeedback } from './feedback.js';
import { onlyHardFailed } from './boot.js';
import * as repair from './skills-ui.js';
import { homeReminder } from './backup.js';
import { dueCount } from './notebook.js';
import { collectPlan } from './plan-ui.js';
import { dueCount as deriveDueCount } from './derive.js';

export const TABS = [
  { id: 'today', href: '#/', label: 'היום', icon: '🏠' },
  { id: 'practice', href: '#/practice-hub', label: 'תרגול', icon: '✏️' },
  { id: 'progress', href: '#/progress', label: 'התקדמות', icon: '📈' },
];

/** Routes whose first segment alone is enough to resolve (the rest are optional arguments). */
const SIMPLE = ['progress', 'practice-hub', 'backup', 'summary', 'drills', 'endless', 'order', 'methods', 'edge', 'reverse', 'fading', 'solve',
  'repair', 'checkpoints', 'hunt', 'workout', 'exam', 'feedback', 'ladder', 'multipart', 'trig', 'mathhard', 'logs', 'transfer', 'recover', 'notebook', 'writing', 'booklet', 'formulas', 'sprint', 'units', 'estimate', 'plan', 'notes', 'derive', 'calibration', 'examday', 'counter', 'blind', 'recovery', 'pressure'];

/** hash -> { name, args } or { name: 'notfound' }. One parser shared by app.js and the tests. */
export function resolveRoute(hash) {
  let parts;
  try { parts = decodeURIComponent(String(hash || '').replace(/^#\/?/, '')).split('/').filter(Boolean); } catch (e) { parts = ['?']; }
  const [a, b] = parts;
  if (!parts.length) return { name: 'home', args: [] };
  if ((a === 'topic' || a === 'ex') && b) return { name: a, args: parts.slice(1) };
  if (a === 'review' && b) return { name: b === 'start' ? 'review-start' : b === 'done' ? 'review-done' : 'review', args: parts.slice(1) };
  if (SIMPLE.includes(a)) return { name: a, args: parts.slice(1) };
  return { name: 'notfound', args: parts };
}

/** Which tab is highlighted for a hash. Home and today's workout belong to "today"; progress screens to "progress". */
export function activeTab(hash) {
  const { name } = resolveRoute(hash);
  if (name === 'home' || name === 'workout' || name === 'plan') return 'today';
  if (name === 'progress' || name === 'summary' || name === 'backup') return 'progress';
  return 'practice';
}

/** Distraction-free screens: a running exam and the questions of a workout. */
export function tabsHidden(hash) {
  const r = globalThis.omriRunScreen(hash); // shared with js/pwa.js (reload deferral), see runroutes.js
  return !!(r && r.hideTabs);
}

/** Fills the <nav> element for the current hash (hidden attribute when distraction-free). */
export function renderTabBar(nav, hash) {
  if (!nav) return;
  const hidden = tabsHidden(hash);
  nav.hidden = hidden;
  nav.setAttribute('aria-hidden', String(hidden));
  if (document.body && document.body.classList) document.body.classList.toggle('no-tabs', hidden);
  const active = activeTab(hash);
  nav.replaceChildren(...TABS.map((t) => h('a', {
    class: 'tab' + (t.id === active ? ' active' : ''), href: t.href,
    'aria-current': t.id === active ? 'page' : null,
  }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon), h('span', { class: 'tab-label' }, t.label))));
}

/* ---------- home (היום) ---------- */
export function planLine(mix, weakCount) {
  const bits = [];
  if (mix.due) bits.push(`${mix.due} חזרות מתוזמנות`);
  if (weakCount) bits.push(weakCount === 1 ? 'נושא חלש אחד' : `${weakCount} נושאים חלשים`);
  if (mix.fresh) bits.push(`${mix.fresh} תרגילים חדשים`);
  return bits.length ? `האימון של היום: ${bits.join(' · ')}.` : 'האימון של היום מוכן.';
}

/** First unanswered question of the active workout, or null when none / finished. */
export function continueHref(workout, log, exists = () => true) {
  if (!workout) return null;
  const ids = workout.ids.filter(exists);
  const done = workoutResults(workout, log);
  const i = ids.findIndex((id) => !done[id]);
  return i < 0 || (i === 0 && !Object.keys(done).length) ? null : `#/workout/${i + 1}`;
}

const dayStart = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isMathTopic = (a) => (typeof a.topic === 'string' && (a.topic.startsWith('math-hard-') || a.topic === 'logs')) || /^(mh|lg)-/.test(String(a.exerciseId));
const isPhysTopic = (a) => a.topic === 'multipart' || /^mp-/.test(String(a.exerciseId));

/**
 * "המסלול של היום": 3 ordered steps -> [{ id, label, href, done }]. 1 today's workout (done when every question of a
 * workout started today has an attempt), 2 a hard-math or logs item (done when one was attempted today), 3 a multipart
 * exam question (physics; done when one was attempted today). Done marks come from the stored attempts only.
 */
export function dailyPath({ log = [], hard = null, now = Date.now(), workout = null, title = (id) => id, workoutExists = () => true, notebookDue = 0, deriveDue = 0 } = {}) {
  const start = dayStart(now);
  const today = log.filter((a) => a && a.ts >= start);
  const picks = pickHard(log, hard, now);
  const lastToday = (pred) => [...today].reverse().find(pred);
  const step = (id, label, pred, pick, listHref) => {
    const a = lastToday(pred);
    const itemId = a ? a.exerciseId : pick ? pick.id : null;
    return { id, label: itemId ? `${label}: ${title(itemId)}` : label, href: itemId ? (hardHref(itemId) || listHref) : listHref, done: !!a };
  };
  let wDone = false;
  if (workout && workout.startedAt >= start) {
    const ids = workout.ids.filter(workoutExists);
    const res = workoutResults(workout, log);
    wDone = ids.length > 0 && ids.every((id) => res[id]);
  }
  const steps = [
    { id: 'workout', label: 'האימון של היום', href: '#/workout/start', done: wDone },
    step('math', 'מתמטיקה ברמה גבוהה', isMathTopic, picks.find((p) => p.kind === 'mathhard') || picks.find((p) => p.kind === 'logs'), '#/mathhard'),
    step('physics', 'שאלת מבחן בפיזיקה', isPhysTopic, picks.find((p) => p.kind === 'multipart'), '#/multipart'),
  ];
  // due entries of the error notebook (only listed when there are some; the notebook sync is what clears them)
  if (notebookDue > 0) steps.push({ id: 'notebook', label: `מחברת טעויות: ${notebookDue} ${notebookDue === 1 ? 'רשומה' : 'רשומות'} לחזרה`, href: '#/notebook', done: false });
  // derivations whose spaced recall is due (the schedule of #/derive is what clears them)
  if (deriveDue > 0) steps.push({ id: 'derive', label: `גזירה מהזיכרון: ${deriveDue} ${deriveDue === 1 ? 'גזירה' : 'גזירות'} לחזרה`, href: '#/derive', done: false });
  return steps;
}

/** Compact home card text for the exam countdown: { title, line }. No date -> an invitation, never a made-up countdown. */
export function planCardText(s) {
  if (!s.hasDate) return { title: 'ספירה לאחור למבחן', line: 'קבעו תאריך מבחן וקבלו תוכנית שבועית לפי השבועות שנשארו.' };
  if (s.past) return { title: 'תאריך המבחן עבר', line: 'עדכנו את התאריך כדי לקבל תוכנית חדשה.' };
  const left = s.days === 0 ? 'המבחן היום' : s.days === 1 ? 'נשאר יום אחד למבחן' : `נשארו ${s.days} ימים למבחן`;
  return { title: left, line: `${s.phase.title} · השבוע: ${s.sessions.done} מתוך ${s.sessions.target} ימי לימוד` };
}

/**
 * "ההמשך המומלץ": one target for the home button -> { label, href, source: 'plan' | 'path' | 'repair' }.
 * 1. exam date set: today's slot of the weekly plan (plan.days, the same list #/plan shows) when it is not done yet;
 * 2. else (or when today's slot is done / a rest day): the first undone step of dailyPath;
 * 3. else repair of the weakest topic (plan.weak[0]), or the plain workout. A missing or corrupt plan counts as "no exam date".
 */
export function recommendedNext({ log = [], hard = null, plan = null, now = Date.now(), ...pathOpts } = {}) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const hasDate = !!(p.hz && p.hz.hasDate && !p.hz.past);
  if (hasDate && Array.isArray(p.days)) {
    const today = p.days.find((d) => d && d.today && d.slot && !d.done);
    if (today) return { label: today.slot.label, href: today.slot.href, source: 'plan' };
  }
  const step = dailyPath({ log, hard, now, ...pathOpts }).find((s) => !s.done);
  if (step) return { label: step.label, href: step.href, source: 'path' };
  const weak = Array.isArray(p.weak) ? p.weak[0] : null;
  if (weak && weak.href) return { label: `תיקון נושא חלש: ${weak.title}`, href: weak.href, source: 'repair' };
  return { label: 'תיקון נושא חלש', href: '#/repair', source: 'repair' };
}

/** Three short status lines for the home strip: [{ text, href }] (exam countdown, reviews due, weekly goal). */
export function statusStrip(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const hz = p.hz || {};
  const t = planCardText({ hasDate: !!hz.hasDate, past: !!hz.past, days: hz.days, phase: hz.phase || { title: '' }, sessions: p.sessions || { done: 0, target: 0 } });
  const d = p.due || {};
  const n = (x) => (Number.isFinite(x) ? x : 0);
  const reviews = n(d.reviews) + n(d.notebook) + n(d.derive);
  const goals = Array.isArray(p.goals) ? p.goals.filter((g) => g && g.known) : [];
  const done = goals.filter((g) => g.done).length;
  const sess = p.sessions ? `, ${p.sessions.done} מתוך ${p.sessions.target} ימי לימוד` : '';
  return [
    { text: hz.hasDate ? t.title : 'לא נקבע תאריך מבחן', href: '#/plan' },
    { text: reviews ? `חזרות לפי מועד: ${reviews}` : 'אין חזרות שמחכות', href: n(d.reviews) ? '#/review/start' : n(d.notebook) ? '#/notebook' : n(d.derive) ? '#/derive' : null },
    { text: goals.length ? `יעד שבועי: ${done} מתוך ${goals.length}${sess}` : `יעד שבועי: אין נתונים${sess}`, href: null },
  ];
}

/** Plain message plus a retry button when boot data failed; a one-line notice when only hard sets are missing. */
export function bootNotice(failed, retry) {
  if (!failed || !failed.length) return null;
  const hardOnly = onlyHardFailed(failed);
  const btn = typeof retry === 'function'
    ? h('button', { class: 'btn', type: 'button', onclick: () => { retry(); } }, 'נסו שוב') : null;
  return h('p', { class: hardOnly ? 'notice' : 'error', role: 'alert' },
    hardOnly ? 'התרגילים הקשים לא נטענו, ולכן באימון של היום אין סעיפים קשים.'
      : 'לא הצלחנו לטעון חלק מהתרגילים. בדקו את החיבור לאינטרנט ונסו שוב.',
    ' ', btn);
}

/** The plan as #/plan shows it (one source for the home button, the status strip and the plan screen); null if it cannot be built. */
function homePlan(ctx, log, now) {
  try { return collectPlan(ctx, now); } catch (e) { return null; }
}

function statusCard(plan) {
  const lines = statusStrip(plan);
  return h('section', { class: 'card status-strip', 'aria-label': 'מצב נוכחי' },
    h('ul', { class: 'more-links' }, lines.map((l) => h('li', {}, l.href ? h('a', { href: l.href }, l.text) : l.text))));
}

export function viewHome(ctx, loadErrors = []) {
  document.title = 'Brain Gains – היום';
  const log = store.getAttempts();
  const now = Date.now();
  const fb = loadFeedback();
  const ids = ctx.exercises.length ? pickWorkout(log, ctx.exercises, now, WORKOUT_SIZE, workoutOpts(ctx.ladder, ctx.hard)) : [];
  const title = (t) => (ctx.topics.find((x) => x.id === t) || { title: t }).title;
  const lvlLine = ctx.exercises.length ? levelLine(log, ctx.exercises, fb, title) : '';
  const mix = workoutMix(log, ctx.exercises, now, ids);
  const weak = ctx.exercises.length ? weakTopics(log, withVirtual(ctx.exercises, log)).filter((t) => t.score < 0.8).length : 0;
  const exists = (id) => ctx.byId(id) || hardHref(id);
  const cont = ids.length ? continueHref(store.loadWorkout(), log, exists) : null;
  let notebookDue = 0;
  try { notebookDue = dueCount(log, fb, now); } catch (e) { /* the notebook is optional on the home screen */ }
  let deriveDue = 0;
  try { deriveDue = deriveDueCount(globalThis.localStorage, now); } catch (e) { /* optional on the home screen */ }
  const plan = homePlan(ctx, log, now);
  const next = recommendedNext({ log, hard: ctx.hard, plan, now, workout: store.loadWorkout(), title: ctx.hardTitle || ((id) => id), workoutExists: exists, notebookDue, deriveDue });
  ctx.show(
    h('h1', {}, 'היום'),
    bootNotice(loadErrors, ctx.retry),
    homeReminder(),
    h('section', { class: 'card today-card', 'aria-labelledby': 'today-h' },
      h('strong', { id: 'today-h' }, 'האימון של היום'),
      ids.length
        ? [h('p', { class: 'muted' }, planLine(mix, weak)),
          lvlLine ? h('p', { class: 'muted workout-level' }, lvlLine) : null,
          cont ? h('p', {}, h('a', { href: cont }, 'להמשיך מאיפה שעצרתם')) : null]
        : h('span', { class: 'muted' }, 'אין תרגילים זמינים לאימון.')),
    h('section', { class: 'card path-card', 'aria-labelledby': 'next-h' },
      h('strong', { id: 'next-h' }, 'ההמשך המומלץ'),
      h('p', { class: 'muted' }, next.label),
      h('a', { class: 'btn primary cta', href: next.href }, 'ההמשך המומלץ')),
    statusCard(plan),
    ctx.exercises.length ? repair.homeCard(ctx) : null,
    h('p', {}, h('a', { href: '#/practice-hub' }, 'כל המצבים')));
}

export { HUB_GROUPS, viewHub, hubTileCount } from './hub.js';
