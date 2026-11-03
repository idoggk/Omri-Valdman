// Confidence betting UI: the optional "how likely are you to get full marks?" chips shown before solving (confidenceBar),
// and #/calibration (viewCalibration): setting, calibration table, Brier score, verdict and the confident-but-wrong list.
import { h } from './dom.js';
import * as store from './store.js';
import { isolateTitle } from './bidi.js';
import { topicTitle } from './engine.js';
import { isReservedTopic } from './srs.js';
import { reopenHref } from './notebook.js';
import {
  CHIPS, MIN_VERDICT, loadOn, saveOn, buckets, brier, brierText, BRIER_EXPLAIN, verdict, VERDICT_TEXT, confidentWrongItems,
} from './calibration.js';

const BTN = 'min-height:44px;';
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * The pre-solve control. Returns { node, value(), take(), lock() }. node is null when the setting is off (nothing is shown and
 * nothing is stored). The chips are optional and can be tapped again to clear. take() returns the prediction once and locks
 * the chips (so one visit stores one prediction, on its first attempt record); `opts.on` is for tests.
 */
export function confidenceBar(opts = {}) {
  const on = opts.on !== undefined ? !!opts.on : loadOn();
  if (!on) return { node: null, value: () => undefined, take: () => undefined, lock: () => {} };
  let value = null;
  let locked = false;
  let taken = false;
  const chips = CHIPS.map((c) => {
    const b = h('button', { class: 'chip', type: 'button', style: BTN, 'aria-pressed': 'false', 'aria-label': `${c} אחוז` }, `${c}%`);
    b.addEventListener('click', () => {
      if (locked) return;
      value = value === c ? null : c;
      chips.forEach((x, i) => x.setAttribute('aria-pressed', String(value === CHIPS[i])));
    });
    return b;
  });
  const node = h('div', { class: 'panel', role: 'group', 'aria-label': 'הערכת סיכוי לציון מלא' },
    h('p', {}, h('strong', {}, 'לפני שפותרים: ')),
    h('p', {}, 'כמה סביר שתקבלו ציון מלא (פתרון נכון לבד, בלי רמזים)? אפשר לדלג.'),
    h('div', { class: 'btn-row' }, chips),
    h('p', { class: 'muted' }, h('a', { href: '#/calibration' }, 'איך מעריכים את עצמכם? לטבלת הכיול')));
  const lock = () => { locked = true; chips.forEach((b) => { b.disabled = true; }); };
  return {
    node, value: () => (value === null ? undefined : value),
    take() { if (taken) return undefined; taken = true; lock(); return value === null ? undefined : value; },
    lock,
  };
}

/** Spread into store.recordAttempt: { predicted } only the first time and only when a chip was chosen. */
export const predExtra = (bar) => {
  const v = bar && bar.take ? bar.take() : undefined;
  return v === undefined ? {} : { predicted: v };
};

const crumbs = () => h('p', { class: 'crumbs' }, h('a', { href: '#/progress' }, '→ להתקדמות'));

/** Pure render of the calibration page for a log (used by the tests). */
export function renderCalibration(log, { on = false, onToggle = () => {}, titleOf = () => null } = {}) {
  const rows = buckets(log);
  const total = rows.reduce((s, r) => s + r.n, 0);
  const b = brier(log);
  const v = verdict(log);
  const wrong = confidentWrongItems(log);
  const toggle = h('button', { class: 'chip', type: 'button', style: BTN, 'aria-pressed': String(on), onclick: onToggle }, on ? 'הימור על ביטחון: דלוק' : 'הימור על ביטחון: כבוי');
  return [
    crumbs(), h('h1', {}, '🎲 כיול: כמה אתם יודעים שאתם יודעים'),
    h('section', { class: 'panel' },
      h('p', {}, 'לפני פתרון של תרגיל קשה אפשר להגיד כמה סביר שתקבלו ציון מלא: 50, 70, 90 או 100 אחוז. אחר כך משווים להצלחה בפועל. מי שמעריך נכון את עצמו יודע איפה לבדוק פעם נוספת במבחן.'),
      h('p', { class: 'muted' }, 'הבקרה מופיעה בתרגילי מתמטיקה ברמה גבוהה, לוגריתמים, סולם המתמטיקה, שאלות בכמה סעיפים, מבחני העברה, תקנו ותמשיכו וחוברות מבחן. היא לא מופיעה בספרינטים עם שעון. כבויה כברירת מחדל.'),
      h('div', { class: 'btn-row' }, toggle)),
    h('h2', {}, 'טבלת כיול'),
    total ? h('table', { class: 'bk-table', 'aria-label': 'טבלת כיול' }, h('tbody', {},
      h('tr', {}, h('th', {}, 'אמרתם'), h('th', {}, 'ניסיונות'), h('th', {}, 'ציון מלא'), h('th', {}, 'בפועל')),
      rows.map((r) => h('tr', {}, h('td', {}, `${r.chip}%`), h('td', {}, String(r.n)), h('td', {}, String(r.full)), h('td', {}, r.rate === null ? '—' : pct(r.rate))))))
      : h('p', { class: 'muted' }, 'עוד אין נתונים. הדליקו את ההימור ופתרו כמה תרגילים קשים.'),
    h('h2', {}, 'ציון בריאר'),
    h('p', { role: 'status' }, b === null ? 'עוד אין נתונים.' : [h('strong', { dir: 'ltr' }, String(b)), ` · ${brierText(b)}`]),
    h('p', { class: 'muted' }, BRIER_EXPLAIN),
    h('h2', {}, 'ביטחון יתר או נמוך'),
    h('p', { role: 'status', class: v.kind === 'over' ? 'notice' : v.kind === 'nodata' ? 'muted' : 'feedback ok' },
      v.kind === 'nodata' ? `עוד אין נתונים לפסק דין: ${v.n} מתוך ${MIN_VERDICT} הערכות. ` : `בממוצע אמרתם ${pct(v.predictedMean)} והצלחתם ${pct(v.actualRate)} (${v.n} הערכות). `, VERDICT_TEXT[v.kind]),
    h('h2', {}, 'בטוחים וטעיתם'),
    wrong.length ? [
      h('p', { class: 'muted' }, 'פריטים שהערכתם ב־90% או 100% ולא קיבלתם ציון מלא. הפריטים הרגילים נכנסו למחברת הטעויות עם התגית ״ביטחון יתר״; מבחני העברה וחוברות נשארים מחוץ למחברת.'),
      h('ul', { class: 'ex-list' }, wrong.map((a) => h('li', {}, h('a', { class: 'ex-item', href: reopenHref(a.exerciseId, a.topic || '') },
        h('span', { class: 't' }, isolateTitle(titleOf(a) || (a.topic && topicTitle(a.topic)) || a.exerciseId)),
        h('span', { class: 'muted' }, `אמרתם ${a.predicted}%${isReservedTopic(a.topic) ? '' : ' · במחברת'}`)))))]
      : h('p', { class: 'muted' }, 'אין עדיין פריטים כאלה.'),
  ];
}

export function viewCalibration(ctx) {
  document.title = 'כיול – Brain Gains';
  const draw = () => {
    const log = store.getAttempts();
    ctx.show(...renderCalibration(log, {
      on: loadOn(),
      onToggle: () => { saveOn(!loadOn()); draw(); },
      titleOf: (a) => { const e = ctx.byId && ctx.byId(a.exerciseId); return e && (e.title || null); },
    }));
  };
  draw();
}
