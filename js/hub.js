// Practice hub (#/practice-hub): six collapsible groups, one tile per mode, one-line descriptions (the details live on each mode's intro screen).
import { h } from './dom.js';
import * as store from './store.js';
import { dueReviews } from './srs.js';
import { loadFeedback } from './feedback.js';
import { dueCount as notebookDueCount } from './notebook.js';
import { openFormulaSheet } from './sheet.js';

export const DESC_MAX = 80;
export const OPEN_KEY = 'omri-hub-open-v1';

const SHEET = '@sheet'; // the formula-sheet tile is a button, not a link
const TOPICS = '@topics'; // the topic tiles are built from the loaded topics (they carry counts)
const EXAMPLES = '@examples'; // first topic: its worked example is at the top of the page

/** Groups in learning order. tiles: [href, title, one-line description]. */
export const HUB_GROUPS = [
  { id: 'learn', title: 'לימוד', tiles: [
    [SHEET, '📐 דף נוסחאות', 'כל הנוסחאות וטעויות נפוצות במקום אחד'],
    [EXAMPLES, '📖 דוגמאות פתורות', 'בראש עמוד כל נושא: דוגמה פתורה צעד אחר צעד'],
    ['#/fading', '🌓 דוגמאות מתפוגגות', 'אותה דוגמה בארבעה שלבים, מפתרון מלא ועד פתרון עצמאי'],
    ['#/trig', '📐 זהויות טריגונומטריות', 'שלושה עוגנים, גזירה צעד אחר צעד וכרטיסיות זכירה'],
    ['#/logs', '📏 לוגריתמים מהיסוד', '12 שיעורים, כרטיסיות ו־70 תרגילים בחמש רמות'],
    ['#/notes', '📌 דגשים', 'כרטיסי זכירה ותרגילים על מלכודות מבחן וכללי הלוגריתם'],
    ['#/derive', '🧩 גזירה מהזיכרון', '24 גזירות עם חזרות אחרי 1, 3, 7 ו־14 ימים'],
  ] },
  { id: 'practice', title: 'תרגול', tiles: [
    [TOPICS],
    ['#/ladder', '🪜 הסלם לרמת מבחן', 'שישה שלבים בפיזיקה, מנוסחה אחת ועד תרגיל בסגנון מבחן'],
    ['#/mathhard', '🧠 מתמטיקה ברמה גבוהה', 'שורשים, מעריכי, אי־שוויונות, פרמטר ומעגלים, עם כרטיס שיטה'],
    ['#/multipart', '🧮 שאלה בכמה סעיפים', 'שאלות מבחן בפיזיקה עם סעיפים א-ו שנשענים זה על זה'],
    ['#/endless', '♾️ תרגול ללא הגבלה', 'תרגילים חדשים בכל פעם, באותה רמה, עם רמזים ופתרון מלא'],
    ['#/reverse', '🔄 בעיות הפוכות', 'נתונה התוצאה: מוצאים את הפרמטר או הנתון שמוביל אליה'],
    ['#/methods', '🧭 איך מתחילים?', 'בוחרים שיטה או צעד ראשון נכון ומקבלים הסבר לכל תשובה'],
    ['#/order', '🧩 סדרו את שלבי הפתרון', 'שלבים מעורבבים: סדרו אותם נכון וקבלו ציון'],
    ['#/checkpoints', '🎯 נקודות ביניים', 'פתרון צעד אחר צעד עם משוב מיד על כל תוצאת ביניים'],
  ] },
  { id: 'mistakes', title: 'טעויות וחיזוק', due: true, tiles: [
    ['#/repair', '🩹 חיזוק יסודות', 'מיני־שיעור ו־3 שאלות על מיומנות בסיס עם טעויות חוזרות'],
    ['#/hunt', '🔎 מצאו את הטעות', 'פתרון מלא עם טעות אחת: מצאו את השלב השגוי הראשון'],
    ['#/recover', '🩹 תקנו ותמשיכו', 'מוצאים טעות מוקדמת, מתקנים וממשיכים, עם ניקוד חלקי'],
    ['#/edge', '🧪 מקרי קצה ופתרונות מרובים', 'מסמנים אילו פתרונות תקפים: שורש זר, חילוק באפס, אין פתרון'],
    ['#/counter', '🔍 אתגר הדוגמה הנגדית', '20 טענות שנשמעות נכונות: מקלידים מספרים שמפריכים אותן'],
    ['#/drills', '⚡ תרגולים מהירים', 'מלכודות, בדיקות שפיות וכרטיסיות בסשן של 10 פריטים'],
    ['#/notebook', '📓 מחברת טעויות', 'כל טעות נכנסת לבד, עם חזרה אחרי 1, 3, 7 ו־14 ימים'],
    ['#/review/start', '🔁 חזרה על טעויות', 'תרגילים שנפתרו עם רמזים או עם הצגת פתרון'],
  ] },
  { id: 'speed', title: 'מהירות ושפיות', tiles: [
    ['#/sprint', '⏱️ ספרינטים באלגברה', 'סטים של 2 או 5 דקות עם משוב מיד ושיא אישי'],
    ['#/units', '📏 יחידות וניתוח ממדים', '30 שאלות קצרות על יחידות, המרות ותקינות נוסחאות'],
    ['#/estimate', '🎯 קודם מעריכים', '24 שאלות הערכה בסדר גודל לפני שמחשבים'],
    ['#/formulas', '📋 הדף שלי: נוסחאות מהזיכרון', '50 נוסחאות שכותבים מהזיכרון, לדף נוסחאות אישי להדפסה'],
    ['#/calibration', '🎲 כיול הביטחון', 'מעריכים לפני תרגיל קשה כמה סביר שתקבלו ציון מלא'],
  ] },
  { id: 'exam', title: 'מבחן', tiles: [
    ['#/solve', '✍️ פתרון מלא כמו במבחן', 'פותרים על דף בלי רמזים ובודקים מול פתרון רשמי'],
    ['#/exam', '📝 מצב מבחן', 'שאלות מעורבות, שעון ודוח בסוף, אפשר גם מבחן חכם'],
    ['#/writing', '✍️ כתיבת פתרון לניקוד חלקי', '16 משימות: כותבים פתרון מלא ומנקדים את עצמכם'],
    ['#/transfer', '🧊 מבחן העברה', 'שאלות חדשות לגמרי בניסוח לא מוכר, ניסיון ראשון בלי רמזים'],
    ['#/booklet', '📄 חוברת מבחן להדפסה', 'מבחן A4 של 90 דקות עם מפתח ניקוד והזנת ציון'],
    ['#/blind', '🕶️ טורניר חולשות עיוור', '12 שאלות בלי שם נושא, ובסוף שלושת הנושאים החלשים'],
    ['#/recovery', '🛟 התאוששות תחת לחץ', 'מיני־מבחן של 20 דקות עם שאלה קשה ולא מוכרת'],
    ['#/pressure', '🪜 סולם לחץ (רשות)', 'אותה מיומנות ב־100%, 85% ו־70% מהזמן'],
    ['#/examday', '🧘 שגרת יום המבחן', 'חמש דקות של שגרה לפני המבחן, לשבועיים האחרונים'],
    ['#/plan', '🗓️ ספירה לאחור והתוכנית שלי', 'תאריך המבחן, שלב נוכחי ותוכנית שבועית עם קישורים'],
  ] },
  { id: 'settings', title: 'הגדרות ונתונים', tiles: [
    ['#/backup', '💾 גיבוי והעברה', 'שמרו את ההתקדמות או העבירו אותה למכשיר אחר'],
    ['#/feedback', '📊 משוב על קושי', 'דירוגי קושי, ייצוא קובץ לשליחה בוואטסאפ'],
    ['#/summary', '🖨️ סיכום להדפסה', 'דף אחד מהנתונים שלכם: חולשות, נוסחאות ורשימת בדיקה'],
  ] },
];

/** Tiles that do not depend on the loaded topics (link tiles plus the formula-sheet button; examples tile counted). */
export const hubTileCount = () => HUB_GROUPS.reduce((n, g) => n + g.tiles.filter((t) => t[0] !== TOPICS).length, 0);

const tile = (href, title, desc) => h('a', { class: 'card', href }, h('strong', {}, title), h('span', { class: 'muted' }, desc));

/* ---------- open / closed state (localStorage, never throws) ---------- */
export function loadOpen(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(OPEN_KEY));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (e) { return {}; }
}
export function saveOpen(state, storage = globalThis.localStorage) {
  try { storage.setItem(OPEN_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
}

/** Due items for the mistakes group: scheduled reviews plus due notebook entries. 0 when anything is unavailable. */
export function mistakesDue(log, now = Date.now()) {
  let n = 0;
  try { n += dueReviews(log, now).length; } catch (e) { /* optional */ }
  try { n += notebookDueCount(log, loadFeedback(), now); } catch (e) { /* optional */ }
  return n;
}

function group(g, content, open, due, onToggle) {
  const body = h('div', { class: 'cards', id: `hub-body-${g.id}` }, content);
  body.hidden = !open;
  const badge = due > 0 ? h('span', { class: 'badge hub-badge' }, ` ${due} לחזרה`) : null;
  const btn = h('button', { class: 'hub-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': `hub-body-${g.id}`,
    onclick: () => {
      const now = body.hidden; // hidden -> open
      body.hidden = !now;
      btn.setAttribute('aria-expanded', String(now));
      onToggle(g.id, now);
    } }, g.title, badge);
  return h('section', { class: 'hub-group', 'aria-labelledby': `hub-${g.id}` }, h('h2', { id: `hub-${g.id}` }, btn), body);
}

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
  const build = (t) => {
    if (t[0] === TOPICS) return topicTiles;
    if (t[0] === SHEET) {
      return h('button', { class: 'card card-btn', type: 'button', onclick: (ev) => openFormulaSheet(null, ev.currentTarget) },
        h('strong', {}, t[1]), h('span', { class: 'muted' }, t[2]));
    }
    return tile(t[0] === EXAMPLES ? `#/topic/${firstTopic}/examples` : t[0], t[1], t[2]);
  };
  const state = loadOpen();
  const onToggle = (id, open) => { state[id] = open; saveOpen(state); };
  let log = [];
  try { log = store.getAttempts(); } catch (e) { /* the hub works without history */ }
  const dueMistakes = mistakesDue(log);
  ctx.show(
    h('h1', {}, 'תרגול'),
    h('p', { class: 'muted' }, 'כל מצבי התרגול, לפי סדר למידה מומלץ.'),
    HUB_GROUPS.map((g) => group(g, g.tiles.flatMap(build), state[g.id] !== false, g.due ? dueMistakes : 0, onToggle)));
}
