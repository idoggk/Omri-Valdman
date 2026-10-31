// #/summary: one printable page built from the learner's own data. Safe with empty or corrupted storage.
import { h, ltr } from './dom.js';
import { sanitizeHtml } from './sanitize.js';
import { cleanFormulas } from './examples.js';
import { cleanLog, weakTopics, countReasons } from './srs.js';
import * as store from './store.js';

export const CHECKLIST = [
  'יחידות: לפני ההצבה ממירים הכול ליחידות אחידות: מטר (מ\'), שנייה (ש\'), מטר לשנייה (מ/ש) ומטר לשנייה בריבוע (מ/ש²).',
  'סימנים: קובעים כיוון חיובי אחד ושומרים עליו לכל אורך הפתרון (מהירות, תאוצה והעתק).',
  'בדיקה: מציבים את התשובות בכל המשוואות המקוריות, ולא רק באחרונה שפתרתם.',
  'פיזיקה: משתמשים ב־g = 10 מ/ש² ולא ב־9.8.',
  'זריקה אנכית: הזמן שעד השיא (v = 0) אינו זמן התנועה הכולל.',
  'מערכת משוואות: בודקים כל פתרון אפשרי, ופוסלים פתרון רק מסיבה מנומקת, למשל זמן שלילי או שורש שאינו מקיים את אחת המשוואות המקוריות.',
  'התשובה הסופית: מספר ממשי, מעוגל לכל היותר לשתי ספרות אחרי הנקודה.',
];

const MAX_ITEMS = 6;

/** Pure data for the page. attempts/traps/formulas may be anything: they are sanitized here. */
export function buildSummary({ attempts, exercises, topics, traps, formulas }) {
  const log = cleanLog(attempts);
  const exs = Array.isArray(exercises) ? exercises : [];
  const title = (id) => ((Array.isArray(topics) ? topics : []).find((t) => t.id === id) || { title: id }).title;
  const weak = weakTopics(log, exs).filter((t) => t.score < 0.8).slice(0, 3)
    .map((t) => ({ topic: t.topic, title: title(t.topic), score: Math.round(t.score * 100), attempts: t.attempts }));
  const reasons = countReasons(log).slice(0, 4);
  const missedTraps = (Array.isArray(traps) ? traps : [])
    .filter((t) => t && typeof t.trapId === 'string' && t.wrong > 0).slice(0, 8)
    .map((t) => ({ trapId: t.trapId, wrong: t.wrong, right: t.right || 0 }));
  const fm = cleanFormulas(formulas);
  // formulas for the weak topics; with no history, every topic gets a short list
  const wanted = weak.length ? weak.map((w) => w.topic) : Object.keys(fm);
  const formulaTopics = wanted.filter((id) => fm[id]).map((id) => ({
    topic: id, title: fm[id].title,
    items: fm[id].sections.flatMap((s) => s.items).filter((it) => it && typeof it.formula === 'string').slice(0, MAX_ITEMS),
  })).filter((f) => f.items.length);
  return { hasHistory: log.length > 0, weak, reasons, missedTraps, formulaTopics };
}

const safe = (html) => ({ rawhtml: sanitizeHtml(String(html ?? '')) });

async function fetchFormulas() {
  try {
    const res = await fetch('data/formulas.json', { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

function formulaSection(list) {
  return list.length ? list.map((f) => h('div', { class: 'sum-formulas' },
    h('h3', {}, f.title),
    h('ul', { class: 'sheet-items' }, f.items.map((it) => h('li', {},
      it.label ? h('span', { class: 'sheet-label' }, it.label, ' ') : null,
      h('span', { class: 'sheet-formula', dir: 'ltr', ...safe(it.formula) })))))) : h('p', { class: 'muted' }, 'דף הנוסחאות לא נטען. אפשר לפתוח אותו מדף הבית.');
}

/** ctx: { topics, exercises, show }; opts.loadFormulas (tests) returns raw formulas JSON. */
export function viewSummary(ctx, opts = {}) {
  document.title = 'סיכום לפני המבחן – Brain Gains';
  let attempts = [], traps = [];
  try { attempts = store.getAttempts(); } catch (e) { /* empty */ }
  try { traps = store.weakTraps(8); } catch (e) { /* empty */ }
  const build = (formulas) => buildSummary({ attempts, exercises: ctx.exercises, topics: ctx.topics, traps, formulas });
  const d0 = build(null);
  const formulasBox = h('div', { class: 'sum-formulas-box' }, h('p', { class: 'muted' }, 'טוען נוסחאות…'));

  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית')),
    h('h1', {}, 'סיכום לפני המבחן'),
    h('p', { class: 'muted' }, 'נבנה מהנתונים שלכם: חולשות, טעויות חוזרות ונוסחאות רלוונטיות.'),
    h('div', { class: 'btn-row no-print' },
      h('button', { class: 'btn primary', id: 'print-btn', type: 'button', onclick: () => window.print() }, 'הדפסה / שמירה כ-PDF')),
    h('h2', {}, 'נושאים חלשים'),
    d0.weak.length
      ? h('ol', { class: 'sum-weak' }, d0.weak.map((w) => h('li', {},
        h('a', { href: `#/topic/${w.topic}` }, w.title), ` · ציון ${w.score}% · ${w.attempts} ניסיונות`)))
      : h('p', { class: 'muted' }, d0.hasHistory ? 'אין כרגע נושא חלש. המשיכו לתרגל.' : 'עדיין אין היסטוריית תרגול. פתרו כמה תרגילים והסיכום יתמלא.'),
    h('h2', {}, 'סיבות טעות חוזרות'),
    d0.reasons.length
      ? h('ul', { class: 'sum-reasons' }, d0.reasons.map((r) => h('li', {}, `${r.label}: ${r.count}`)))
      : h('p', { class: 'muted' }, 'עדיין לא סומנו סיבות טעות.'),
    h('h2', {}, 'מלכודות שהוחמצו'),
    d0.missedTraps.length
      ? h('ul', { class: 'sum-traps' }, d0.missedTraps.map((t) => h('li', {}, ltr(t.trapId), ` · טעויות: ${t.wrong}`)))
      : h('p', { class: 'muted' }, 'אין מלכודות שהוחמצו.'),
    h('h2', {}, 'נוסחאות רלוונטיות'),
    formulasBox,
    h('h2', {}, 'רשימת בדיקה לפני המבחן'),
    h('ul', { class: 'sum-checklist' }, CHECKLIST.map((c) => h('li', {}, '☐ ', c))));

  const fill = (raw) => { if (formulasBox.isConnected !== false) formulasBox.replaceChildren(...[].concat(formulaSection(build(raw).formulaTopics))); };
  return Promise.resolve((opts.loadFormulas || fetchFormulas)()).then(fill, () => fill(null));
}
