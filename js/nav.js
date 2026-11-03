// Navigation: route table, bottom tab bar and the home / practice-hub screens.
// Pure helpers (resolveRoute, activeTab, tabsHidden) are testable without the DOM.
import { h } from './dom.js';
import * as store from './store.js';
import { weakTopics, withVirtual } from './srs.js';
import { workoutMix, workoutResults, workoutOpts, WORKOUT_SIZE } from './practice-ui.js';
import { pickWorkout, levelLine, pickHard, hardHref } from './workout.js';
import { loadFeedback } from './feedback.js';
import { onlyHardFailed } from './boot.js';
import { openFormulaSheet } from './sheet.js';
import * as repair from './skills-ui.js';
import { homeReminder } from './backup.js';
import { dueCount } from './notebook.js';

export const TABS = [
  { id: 'today', href: '#/', label: 'היום', icon: '🏠' },
  { id: 'practice', href: '#/practice-hub', label: 'תרגול', icon: '✏️' },
  { id: 'progress', href: '#/progress', label: 'התקדמות', icon: '📈' },
];

/** Routes whose first segment alone is enough to resolve (the rest are optional arguments). */
const SIMPLE = ['progress', 'practice-hub', 'backup', 'summary', 'drills', 'endless', 'order', 'methods', 'edge', 'reverse', 'fading', 'solve',
  'repair', 'checkpoints', 'hunt', 'workout', 'exam', 'feedback', 'ladder', 'multipart', 'trig', 'mathhard', 'logs', 'transfer', 'recover', 'notebook', 'writing', 'booklet', 'formulas', 'sprint', 'units', 'estimate'];

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
  if (name === 'transfer') return args[0] === 'run';
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

const dayStart = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isMathTopic = (a) => (typeof a.topic === 'string' && (a.topic.startsWith('math-hard-') || a.topic === 'logs')) || /^(mh|lg)-/.test(String(a.exerciseId));
const isPhysTopic = (a) => a.topic === 'multipart' || /^mp-/.test(String(a.exerciseId));

/**
 * "המסלול של היום": 3 ordered steps -> [{ id, label, href, done }]. 1 today's workout (done when every question of a
 * workout started today has an attempt), 2 a hard-math or logs item (done when one was attempted today), 3 a multipart
 * exam question (physics; done when one was attempted today). Done marks come from the stored attempts only.
 */
export function dailyPath({ log = [], hard = null, now = Date.now(), workout = null, title = (id) => id, workoutExists = () => true, notebookDue = 0 } = {}) {
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
  return steps;
}

const MORE_LINKS = [
  ['#/multipart', '🧮 שאלות מבחן בכמה סעיפים'],
  ['#/ladder', '🪜 סולם הקושי בפיזיקה'],
  ['#/mathhard', '🧠 מתמטיקה ברמה גבוהה: שורשים, מעריכי, אי־שוויונות, פרמטר ומעגלים'],
  ['#/logs', '📏 לוגריתמים: 12 שיעורים מהיסוד, כרטיסיות ו־70 תרגילים'],
  ['#/trig', '📐 זהויות טריגונומטריות: שלושה עוגנים וכל השאר נגזר'],
];

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
  const path = dailyPath({ log, hard: ctx.hard, now, workout: store.loadWorkout(), title: ctx.hardTitle || ((id) => id), workoutExists: exists, notebookDue });
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
    h('section', { class: 'card path-card', 'aria-labelledby': 'path-h' },
      h('strong', { id: 'path-h' }, 'המסלול של היום'),
      h('ol', { class: 'path-steps' }, path.map((s, i) => h('li', { class: s.done ? 'done' : '' },
        h('span', { class: `tick o-${s.done ? 'alone' : 'none'}`, role: 'img', 'aria-label': s.done ? 'הושלם' : 'טרם הושלם' }, s.done ? '✓' : '○'), ' ',
        i === 0 && ids.length
          ? h('a', { class: 'btn primary cta', href: s.href }, 'מתחילים אימון')
          : i === 0 ? h('span', { class: 'muted' }, s.label)
            : h('a', { href: s.href }, s.label))))),
    ctx.exercises.length ? repair.homeCard(ctx) : null,
    h('section', { class: 'card', 'aria-labelledby': 'more-h' },
      h('strong', { id: 'more-h' }, 'עוד'),
      h('ul', { class: 'more-links' }, MORE_LINKS.filter(([href]) => !path.some((s) => s.href === href)).map(([href, text]) => h('li', {}, h('a', { href }, text))))));
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
  { id: 'more', title: 'עוד: מהירות, יחידות והערכה' },
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
      tile('#/logs', '📏 לוגריתמים מהיסוד', '12 שיעורים מפורטים עם דוגמאות פתורות ומבחן עצמי, כרטיסיות זכירה לעשרה כללים, ו־70 תרגילים בחמש רמות עם תחום, מלכודות וכרטיס שיטה'),
      tile('#/mathhard', '🧠 מתמטיקה ברמה גבוהה', '42 תרגילים בחמישה נושאים ושלוש רמות: משוואות שורש, מעריכי, אי־שוויונות רציונליים, פרמטר ומעגלים. תשובות מדויקות וכרטיס שיטה'),
      tile('#/formulas', '📋 הדף שלי: נוסחאות מהזיכרון', '50 נוסחאות במתמטיקה ובפיזיקה: כותבים כל אחת מהזיכרון, הבדיקה מספרית ולא לפי צורה, וכך נבנה דף נוסחאות אישי להדפסה. טעויות חוזרות בכרטיסיות ובמחברת הטעויות'),
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
      tile('#/recover', '🩹 תקנו ותמשיכו', '24 פתרונות עם טעות אחת בשלב מוקדם: מוצאים אותה, מתקנים את הערך וממשיכים עד הסוף מהערך הנכון, עם ניקוד חלקי'),
      tile('#/notebook', '📓 מחברת טעויות', 'כל תרגיל שטעיתם בו נכנס לכאן לבד, עם הצעד המרכזי, הערה אישית וחזרה אחרי 1, 3, 7 ו־14 ימים'),
      tile('#/review/start', '🔁 חזרה על טעויות', 'תרגילים שנפתרו עם רמזים או עם הצגת פתרון'),
    ],
    endless: [tile('#/endless', '♾️ תרגול ללא הגבלה', 'תרגילים חדשים בכל פעם, באותה רמה ועם רמזים ופתרון מלא')],
    exams: [
      tile('#/solve', '✍️ פתרון מלא כמו במבחן', 'פותרים על דף, בלי רמזים: תשובה, רמת ביטחון, פתרון רשמי ורשימת בדיקה עצמית'),
      tile('#/exam', '📝 מצב מבחן', 'שאלות מעורבות, שעון, בלי רמזים ועם דוח בסוף. במסך ההגדרות אפשר לסמן "מבחן חכם", שנבנה לפי החולשות שלכם'),
      tile('#/writing', '✍️ כתיבת פתרון לניקוד חלקי', '16 משימות: כותבים על דף נתונים, נוסחאות, הצבה, חישוב ומסקנה עם יחידות, ומנקדים את עצמכם מול פתרון מודל ורשימת בדיקה'),
      tile('#/transfer', '🧊 מבחן העברה', '24 שאלות חדשות לגמרי שלא מופיעות בשום מקום אחר, בניסוח לא מוכר. מבחן של 6 שאלות, ניסיון ראשון בלבד, בלי רמזים ועם הערכת זמן'),
      tile('#/booklet', '📄 חוברת מבחן להדפסה', 'מבחן A4 של 90 דקות ו־100 נקודות במתמטיקה או בפיזיקה, שאלות ארוכות חדשות עם מקום לפתרון, מפתח ניקוד בדפים נפרדים והזנת הציון שנתתם לעצמכם'),
      tile('#/summary', '🖨️ סיכום להדפסה', 'דף אחד מהנתונים שלכם: חולשות, נוסחאות ורשימת בדיקה לפני המבחן'),
    ],
    more: [
      tile('#/sprint', '⏱️ ספרינטים באלגברה', 'סטים של 2 או 5 דקות: פירוק לגורמים, שברים, חזקות ושורשים, משוואות, בידוד משתנה, אי־שוויונות ולוגריתמים. משוב מיד, נכונות לדקה, שיא אישי וקושי שמתאים את עצמו לכל נושא'),
      tile('#/units', '📏 יחידות וניתוח ממדים', '30 שאלות קצרות: יחידות SI, המרות, האם נוסחה תקינה מבחינת יחידות, סקלר מול וקטור, שיפוע ושטח בגרף ודוגמאות הנדסיות'),
      tile('#/estimate', '🎯 קודם מעריכים', '24 שאלות שבהן בוחרים טווח או הערכה בסדר גודל לפני שמחשבים, ואז רואים את החישוב המדויק ואם ההערכה תפסה אותו'),
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
