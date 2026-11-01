// Navigation: route table, bottom tab bar and the home / practice-hub screens.
// Pure helpers (resolveRoute, activeTab, tabsHidden) are testable without the DOM.
import { h } from './dom.js';
import * as store from './store.js';
import { weakTopics } from './srs.js';
import { workoutMix, workoutResults, workoutOpts, WORKOUT_SIZE } from './practice-ui.js';
import { pickWorkout, levelLine } from './workout.js';
import { loadFeedback } from './feedback.js';
import { openFormulaSheet } from './sheet.js';
import * as repair from './skills-ui.js';

export const TABS = [
  { id: 'today', href: '#/', label: 'היום', icon: '🏠' },
  { id: 'practice', href: '#/practice-hub', label: 'תרגול', icon: '✏️' },
  { id: 'progress', href: '#/progress', label: 'התקדמות', icon: '📈' },
];

/** Routes whose first segment alone is enough to resolve (the rest are optional arguments). */
const SIMPLE = ['progress', 'practice-hub', 'backup', 'summary', 'drills', 'endless', 'order', 'methods', 'edge', 'reverse', 'fading', 'solve',
  'repair', 'checkpoints', 'hunt', 'workout', 'exam', 'feedback', 'ladder', 'multipart', 'trig'];

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
  if (name === 'home' || name === 'workout') return 'today';
  if (name === 'progress' || name === 'summary' || name === 'backup') return 'progress';
  return 'practice';
}

/** Distraction-free screens: a running exam and the questions of a workout. */
export function tabsHidden(hash) {
  const { name, args } = resolveRoute(hash);
  if (name === 'exam') return args[0] === 'run';
  if (name === 'workout') return /^\d+$/.test(args[0] || '');
  return false;
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

export function viewHome(ctx, loadErrors = []) {
  document.title = 'Brain Gains – היום';
  const log = store.getAttempts();
  const now = Date.now();
  const fb = loadFeedback();
  const ids = ctx.exercises.length ? pickWorkout(log, ctx.exercises, now, WORKOUT_SIZE, workoutOpts(ctx.ladder)) : [];
  const title = (t) => (ctx.topics.find((x) => x.id === t) || { title: t }).title;
  const lvlLine = ctx.exercises.length ? levelLine(log, ctx.exercises, fb, title) : '';
  const mix = workoutMix(log, ctx.exercises, now, ids);
  const weak = ctx.exercises.length ? weakTopics(log, ctx.exercises).filter((t) => t.score < 0.8).length : 0;
  const cont = ids.length ? continueHref(store.loadWorkout(), log, (id) => ctx.byId(id)) : null;
  ctx.show(
    h('h1', {}, 'היום'),
    loadErrors.length ? h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון חלק מקבצי התרגילים. נסו לרענן את הדף.') : null,
    h('section', { class: 'card today-card', 'aria-labelledby': 'today-h' },
      h('strong', { id: 'today-h' }, 'האימון של היום'),
      ids.length
        ? [h('p', { class: 'muted' }, planLine(mix, weak)),
          lvlLine ? h('p', { class: 'muted workout-level' }, lvlLine) : null,
          h('a', { class: 'btn primary cta', href: '#/workout/start' }, 'מתחילים אימון'),
          cont ? h('p', {}, h('a', { href: cont }, 'להמשיך מאיפה שעצרתם')) : null]
        : h('span', { class: 'muted' }, 'אין תרגילים זמינים לאימון.')),
    ctx.exercises.length ? repair.homeCard(ctx) : null,
    h('div', { class: 'cards' }, tile('#/trig', '📐 זהויות טריגונומטריות', 'שלושה עוגנים וכל השאר נגזר: שיעורים, כרטיסיות זכירה, תרגול ומאמן הוכחות')));
}

/* ---------- practice hub (תרגול) ---------- */
const tile = (href, title, desc) => h('a', { class: 'card', href }, h('strong', {}, title), h('span', { class: 'muted' }, desc));

/** Groups in learning order. Topic tiles are built separately because they carry counts. */
export const HUB_GROUPS = [
  { id: 'learn', title: 'לימוד' },
  { id: 'repair', title: 'חיזוק יסודות' },
  { id: 'guided', title: 'תרגול מונחה' },
  { id: 'traps', title: 'מלכודות וטעויות' },
  { id: 'endless', title: 'תרגול ללא הגבלה' },
  { id: 'exams', title: 'מבחנים' },
  { id: 'backup', title: 'גיבוי' },
];

export function viewHub(ctx) {
  document.title = 'תרגול – Brain Gains';
  const topicTiles = ctx.topics.map((t) => {
    const list = ctx.exercises.filter((e) => e.topic === t.id);
    const done = store.countDone(list.map((e) => e.id));
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    return h('a', { class: 'card', href: `#/topic/${t.id}` },
      h('strong', {}, t.title),
      h('span', { class: 'muted' }, `${list.length} תרגילים · הושלמו ${done}`),
      h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` })));
  });
  const firstTopic = ctx.topics[0] ? ctx.topics[0].id : 'math-3';
  const content = {
    learn: [
      h('button', { class: 'card card-btn', type: 'button', onclick: (ev) => openFormulaSheet(null, ev.currentTarget) },
        h('strong', {}, '📐 דף נוסחאות'), h('span', { class: 'muted' }, 'כל הנוסחאות וטעויות נפוצות במקום אחד')),
      tile(`#/topic/${firstTopic}`, '📖 דוגמאות פתורות', 'בראש עמוד כל נושא: דוגמה פתורה צעד אחר צעד'),
      tile('#/trig', '📐 זהויות טריגונומטריות', 'שלושה עוגנים, גזירה צעד אחר צעד, כרטיסיות זכירה, תרגול ומאמן הוכחות'),
      tile('#/fading', '🌓 דוגמאות מתפוגגות', 'אותה דוגמה בארבעה שלבים: מפתרון מלא ועד פתרון עצמאי, עם הסתרה הדרגתית'),
    ],
    repair: [tile('#/repair', '🩹 חיזוק יסודות', 'מיני־שיעור ו־3 שאלות על מיומנות בסיס שבה יש טעויות חוזרות')],
    guided: [
      ...topicTiles,
      tile('#/checkpoints', '🎯 נקודות ביניים', 'פתרון צעד אחר צעד: מזינים כל תוצאת ביניים ומקבלים משוב מיד'),
      tile('#/methods', '🧭 איך מתחילים?', 'בוחרים שיטה או צעד הבא נכון, ומקבלים הסבר לכל תשובה'),
      tile('#/order', '🧩 סדרו את שלבי הפתרון', 'שלבי פתרון מעורבבים: סדרו אותם נכון וקבלו ציון'),
      tile('#/edge', '🧪 מקרי קצה ופתרונות מרובים', 'מסמנים אילו פתרונות תקפים ואילו נפסלים: שורש זר, חילוק באפס, זמן שלילי או אין פתרון'),
      tile('#/reverse', '🔄 בעיות הפוכות', 'נתונה התוצאה: מוצאים פרמטר, מקדמים או מהירות התחלתית שמובילים אליה'),
      tile('#/multipart', '🧮 שאלה בכמה סעיפים', '22 שאלות מבחן: 8 חימום ו־14 ברמת מבחן, סעיפים א-ו שנשענים זה על זה, עם קרדיט על שיטה כשהטעות עברה מסעיף קודם'),
    ],
    traps: [
      tile('#/drills', '⚡ תרגולים מהירים', 'מלכודות, בדיקות שפיות וכרטיסיות בסשן של 10 פריטים'),
      tile('#/hunt', '🔎 מצאו את הטעות', 'פתרון מלא עם טעות אחת: מצאו את השלב הראשון השגוי'),
      tile('#/review/start', '🔁 חזרה על טעויות', 'תרגילים שנפתרו עם רמזים או עם הצגת פתרון'),
    ],
    endless: [tile('#/endless', '♾️ תרגול ללא הגבלה', 'תרגילים חדשים בכל פעם, באותה רמה ועם רמזים ופתרון מלא')],
    exams: [
      tile('#/solve', '✍️ פתרון מלא כמו במבחן', 'פותרים על דף, בלי רמזים: תשובה, רמת ביטחון, פתרון רשמי ורשימת בדיקה עצמית'),
      tile('#/exam', '📝 מצב מבחן', 'שאלות מעורבות, שעון, בלי רמזים ועם דוח בסוף'),
      tile('#/exam', '🎯 מבחן חכם', 'מבחן שנבנה לפי החולשות שלכם (מסמנים במסך ההגדרות)'),
      tile('#/summary', '🖨️ סיכום להדפסה', 'דף אחד מהנתונים שלכם: חולשות, נוסחאות ורשימת בדיקה לפני המבחן'),
    ],
    backup: [
      tile('#/backup', '💾 גיבוי והעברה', 'שמרו את ההתקדמות או העבירו אותה למכשיר אחר'),
      tile('#/feedback', '📊 משוב על קושי', 'דירוגי קושי, מה היה קשה, וייצוא קובץ לשליחה בוואטסאפ'),
    ],
  };
  ctx.show(
    h('h1', {}, 'תרגול'),
    h('p', { class: 'muted' }, 'כל מצבי התרגול, לפי סדר למידה מומלץ.'),
    h('div', { class: 'cards hub-ladder' }, tile('#/ladder', '🪜 הסלם לרמת מבחן', 'שישה שלבים בפיזיקה: מנוסחה אחת ועד תרגיל מלא בסגנון מבחן, כל שלב נפתח אחרי שפותרים לבד 70% מהקודם')),
    HUB_GROUPS.map((g) => h('section', { class: 'hub-group', 'aria-labelledby': `hub-${g.id}` },
      h('h2', { id: `hub-${g.id}` }, g.title),
      h('div', { class: 'cards' }, content[g.id]))));
}
