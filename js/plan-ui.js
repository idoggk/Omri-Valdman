// #/plan: exam countdown and study plan. Setup form, phase timeline, weekday list, progress panel. Logic: js/plan.js.
import { h } from './dom.js';
import * as store from './store.js';
import { loadFeedback } from './feedback.js';
import { dueCount } from './notebook.js';
import { dueCount as deriveDueCount } from './derive.js';
import { loadSaved as loadBooklet } from './booklet.js';
import { topicTitle, topicHref } from './engine.js';
import {
  buildPlan, loadSettings, saveSettings, toggleTick, validDate, DEFAULT_WEEKS,
} from './plan.js';

const BTN = 'min-height:44px;';
export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const NO_DATA = 'אין עדיין נתונים';
const dateText = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const pct = (x) => `${Math.round(x * 100)}%`;

/** "עוד 12 ימים", "מחר", "היום", "עבר לפני 3 ימים". */
export function daysText(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === 2) return 'מחרתיים';
  if (days > 0) return `עוד ${days} ימים`;
  return days === -1 ? 'עבר אתמול' : `עבר לפני ${-days} ימים`;
}

function setupForm(settings, onSave) {
  const date = h('input', { type: 'date', id: 'plan-date', value: settings.examDate || '', dir: 'ltr', style: BTN });
  const phys = h('input', { type: 'date', id: 'plan-phys', value: settings.physicsDate || '', dir: 'ltr', style: BTN });
  const days = h('input', { type: 'number', id: 'plan-days', min: '1', max: '7', step: '1', inputmode: 'numeric', value: String(settings.days), dir: 'ltr', style: `${BTN}width:5em` });
  const mins = h('input', { type: 'number', id: 'plan-min', min: '10', max: '240', step: '5', inputmode: 'numeric', value: String(settings.minutes), dir: 'ltr', style: `${BTN}width:6em` });
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const submit = () => {
    const d = date.value || null;
    const p = phys.value || null;
    if ((d && !validDate(d)) || (p && !validDate(p))) { err.hidden = false; err.textContent = 'תאריך לא תקין. בחרו תאריך מהלוח.'; return; }
    const nd = Number(days.value);
    const nm = Number(mins.value);
    if (!Number.isInteger(nd) || nd < 1 || nd > 7) { err.hidden = false; err.textContent = 'ימי לימוד בשבוע: מספר שלם בין 1 ל־7.'; return; }
    if (!Number.isInteger(nm) || nm < 10 || nm > 240) { err.hidden = false; err.textContent = 'דקות ביום: מספר שלם בין 10 ל־240.'; return; }
    err.hidden = true;
    onSave({ ...settings, examDate: d, physicsDate: p && p !== d ? p : null, days: nd, minutes: nm });
  };
  return h('section', { class: 'card', 'aria-labelledby': 'plan-setup-h' },
    h('strong', { id: 'plan-setup-h' }, 'ההגדרות שלכם'),
    h('p', { class: 'muted' }, 'התאריך מוזן ידנית, והאפליקציה לא מנחשת אותו. אפשר לשנות בכל רגע.'),
    h('div', { class: 'fields' },
      h('div', { class: 'field' }, h('label', { for: 'plan-date' }, 'תאריך המבחן'), date),
      h('div', { class: 'field' }, h('label', { for: 'plan-phys' }, 'תאריך מבחן הפיזיקה, אם הוא שונה (לא חובה)'), phys),
      h('div', { class: 'field' }, h('label', { for: 'plan-days' }, 'ימי לימוד בשבוע'), days),
      h('div', { class: 'field' }, h('label', { for: 'plan-min' }, 'דקות לימוד ביום'), mins)),
    err,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: submit }, 'שמירה'),
      settings.examDate || settings.physicsDate
        ? h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => onSave({ ...settings, examDate: null, physicsDate: null, days: settings.days, minutes: settings.minutes }) }, 'ניקוי התאריך') : null));
}

function headerBlock(plan) {
  const { hz, exams } = plan;
  if (!hz.hasDate) {
    return h('section', { class: 'card plan-head', 'aria-labelledby': 'plan-head-h' },
      h('strong', { id: 'plan-head-h' }, 'עוד לא קבעתם תאריך מבחן'),
      h('p', {}, `הזינו את תאריך המבחן בהגדרות למטה, ונבנה לכם תוכנית לפי מספר השבועות שנשארו. עד אז מוצגת תוכנית ברירת מחדל של ${DEFAULT_WEEKS} שבועות.`),
      h('p', { class: 'muted' }, 'שימו לב: התאריך מוזן ידנית, ולכן תוכנית ברירת המחדל לא קשורה למועד אמיתי.'));
  }
  const lines = exams.filter((e) => e.date).map((e) => `${e.subject === 'math' ? 'מתמטיקה' : 'פיזיקה'}: ${dateText(Date.parse(`${e.date}T12:00:00`))} (${daysText(e.days)})`);
  return h('section', { class: 'card plan-head', 'aria-labelledby': 'plan-head-h' },
    h('strong', { id: 'plan-head-h' }, hz.past ? 'תאריך המבחן עבר' : `נשארו ${hz.days} ${hz.days === 1 ? 'יום' : 'ימים'} למבחן`),
    hz.past ? h('p', {}, 'עדכנו את תאריך המבחן בהגדרות כדי לקבל תוכנית חדשה. עד אז מוצג שלב האיחוד.') : h('p', { class: 'muted' }, `${hz.weeks} ${hz.weeks === 1 ? 'שבוע' : 'שבועות'} עד המבחן`),
    h('ul', { class: 'plan-exams' }, lines.map((t) => h('li', {}, t))));
}

function phaseBlock(plan) {
  const { hz } = plan;
  const p = hz.phase;
  const notes = [];
  if (hz.compressed) notes.push(`נשארו פחות מ־${DEFAULT_WEEKS} שבועות, ולכן התוכנית דחוסה ומתחילה מהשלב הזה.`);
  if (hz.foundationWeeks > 0) notes.push(`עוד ${hz.foundationWeeks} ${hz.foundationWeeks === 1 ? 'שבוע' : 'שבועות'} של שלב הבסיס לפני שמתחילים לספור ${DEFAULT_WEEKS} שבועות אחרונים.`);
  return h('section', { class: 'card', 'aria-labelledby': 'plan-phase-h' },
    h('strong', { id: 'plan-phase-h' }, `השלב עכשיו: ${p.title}`),
    h('p', { class: 'muted' }, p.range),
    h('p', {}, p.focus),
    notes.map((n) => h('p', { class: 'notice' }, n)),
    h('p', {}, h('strong', {}, 'יעד השבוע')),
    h('ul', { class: 'plan-goals' }, plan.goals.map((g) => h('li', { class: g.done ? 'done' : '' },
      h('span', { class: `tick o-${g.done ? 'alone' : 'none'}`, role: 'img', 'aria-label': g.done ? 'הושלם' : 'טרם הושלם' }, g.done ? '✓' : '○'), ' ',
      g.label, g.known && g.id !== 'notebook' ? ` (${g.have} מתוך ${g.target})` : '',
      g.known ? '' : ' (אין עדיין נתונים)'))),
    h('details', { class: 'plan-timeline' }, h('summary', {}, 'כל השלבים'),
      h('ol', {}, plan.timeline.map((t) => h('li', { class: t.active ? 'active' : '' },
        h('strong', {}, t.title), ` · ${t.range}`, t.active ? ' · כאן אתם' : '')))));
}

function weekBlock(plan, onTick) {
  return h('section', { class: 'card', 'aria-labelledby': 'plan-week-h' },
    h('strong', { id: 'plan-week-h' }, 'התוכנית לשבוע'),
    h('p', { class: 'muted' }, `${plan.settings.days} ימי לימוד, כ־${plan.settings.minutes} דקות ביום. הסימון ✓ מגיע מהתרגולים ששמרתם, ובפעילויות בלי תיעוד אוטומטי אפשר לסמן בעצמכם.`),
    h('ol', { class: 'plan-days' }, plan.days.map((d) => {
      const name = `יום ${WEEKDAYS[d.weekday]} · ${dateText(d.date)}`;
      if (d.rest) return h('li', { class: 'plan-day rest' }, h('strong', {}, name), ' ', h('span', { class: 'muted' }, 'יום מנוחה'));
      const s = d.slot;
      const auto = d.done && !((plan.settings.ticks || {})[d.dayKey] || []).includes(s.key);
      return h('li', { class: `plan-day${d.today ? ' today' : ''}${d.done ? ' done' : ''}`, 'aria-current': d.today ? 'date' : null },
        h('strong', {}, name), d.today ? h('span', { class: 'muted' }, ' · היום') : null,
        h('div', {}, h('span', { class: `tick o-${d.done ? 'alone' : 'none'}`, role: 'img', 'aria-label': d.done ? 'הושלם' : 'טרם הושלם' }, d.done ? '✓' : '○'), ' ',
          h('a', { href: s.href }, s.label), h('span', { class: 'muted' }, ` · ${s.minutes} דקות`)),
        s.note ? h('p', { class: 'muted' }, s.note) : null,
        auto ? null : h('label', { class: 'plan-tick' },
          h('input', { type: 'checkbox', checked: d.done, onchange: (ev) => onTick(d.dayKey, s.key, !!ev.target.checked) }), ' סימנתי שעשיתי'));
    })));
}

function dueBlock(plan) {
  const { due, weak } = plan;
  return h('section', { class: 'card', 'aria-labelledby': 'plan-due-h' },
    h('strong', { id: 'plan-due-h' }, 'מה מחכה לכם'),
    h('ul', { class: 'more-links' },
      h('li', {}, h('a', { href: '#/review/start' }, `חזרות מתוזמנות: ${due.reviews}`)),
      h('li', {}, h('a', { href: '#/notebook' }, due.notebook === null ? 'מחברת טעויות' : `רשומות במחברת הטעויות לחזרה: ${due.notebook}`)),
      h('li', {}, h('a', { href: '#/derive' }, `גזירות מהזיכרון לחזרה: ${due.derive || 0}`))),
    h('p', {}, h('strong', {}, 'שלושת הנושאים החלשים ביותר')),
    weak.length ? h('ul', { class: 'more-links' }, weak.map((w) => h('li', {}, h('a', { href: w.href }, w.title), h('span', { class: 'muted' }, ` · ${w.score}% (${w.attempts} ניסיונות)`))))
      : h('p', { class: 'muted' }, `${NO_DATA}, או שאין כרגע נושא חלש.`),
    plan.ceiling.length ? h('p', { class: 'muted' }, `נושאים שכבר קלים לכם: ${plan.ceiling.map((c) => c.title).join(', ')}. יש בתוכנית פחות שגרה ויותר אתגר.`) : null);
}

function progressBlock(plan) {
  const r = plan.readiness;
  const row = (label, sub) => h('li', {}, h('strong', {}, label), ': ', sub);
  const subject = (id, label) => {
    const x = r[id];
    return h('div', {},
      h('p', {}, h('strong', {}, label)),
      h('ul', { class: 'plan-ready' },
        row('תרגול עצמאי בלי רמזים (28 ימים אחרונים)', x.practice ? `${pct(x.practice.rate)} מתוך ${x.practice.n} תרגילים` : NO_DATA),
        row('מבחן העברה', x.transfer ? `${x.transfer.ok} מתוך ${x.transfer.n} נפתרו בניסיון ראשון, בלי רמזים` : NO_DATA),
        row('מבחן מלא אחרון', x.mock ? `${x.mock.last} מתוך 100` : NO_DATA),
        x.mock && x.mock.history.length > 1 ? row('היסטוריית ציונים', x.mock.history.map((m) => `${m.pct}`).join(' ← ')) : null));
  };
  return h('section', { class: 'card', 'aria-labelledby': 'plan-prog-h' },
    h('strong', { id: 'plan-prog-h' }, 'התקדמות'),
    h('p', {}, `השבוע: ${plan.sessions.done} מתוך ${plan.sessions.target} ימי לימוד`),
    plan.hz.hasDate ? h('p', {}, `עד המבחן: ${daysText(plan.hz.days)}`) : null,
    subject('math', 'מתמטיקה'), subject('physics', 'פיזיקה'),
    h('p', { class: 'muted' }, 'אלה הערכות בלבד ולא תחזית. הן נבנות רק מתרגילים שפתרתם לבד בלי רמזים, ממבחני העברה ומציוני מבחנים מלאים שהזנתם.'));
}

/** Pure render of a built plan (also used by the tests). */
export function renderPlan(plan, { onSave = () => {}, onTick = () => {} } = {}) {
  return [
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה להיום')),
    h('h1', {}, 'ספירה לאחור והתוכנית שלי'),
    headerBlock(plan), phaseBlock(plan), weekBlock(plan, onTick), dueBlock(plan), progressBlock(plan), setupForm(plan.settings, onSave),
  ];
}

export function collectPlan(ctx, now = Date.now()) {
  const log = store.getAttempts();
  const titles = new Map((ctx.topics || []).map((t) => [t.id, t.title]));
  const feedback = loadFeedback();
  let dueNotebook = null;
  try { dueNotebook = dueCount(log, feedback, now); } catch (e) { /* optional */ }
  let dueDerive = 0;
  try { dueDerive = deriveDueCount(globalThis.localStorage, now); } catch (e) { /* optional */ }
  return buildPlan({
    settings: loadSettings(), log, now, exercises: ctx.exercises || [], feedback, mocks: loadBooklet().results, dueNotebook, dueDerive,
    titleOf: (t) => titles.get(t) || topicTitle(t) || t, hrefOf: (t) => topicHref(t) || `#/topic/${t}`,
  });
}

export function viewPlan(ctx) {
  document.title = 'תוכנית ללמידה – Brain Gains';
  const draw = () => {
    const plan = collectPlan(ctx);
    ctx.show(...renderPlan(plan, {
      onSave: (s) => { saveSettings(s); draw(); },
      onTick: (k, key, on) => { saveSettings(toggleTick(loadSettings(), k, key, on)); draw(); },
    }));
  };
  draw();
}
