// #/notebook: the error notebook. Entries are collected automatically from the attempt log (wrong, solution shown or
// hint-heavy attempts); this screen lists them by due date, lets him add a note, and reopens the exercise for a re-solve.
// A clean independent re-solve (found in the attempt log on the next visit) moves the entry up the 1/3/7/14 day ladder,
// a wrong re-solve puts it back to day 1. Logic is in js/notebook.js.
import { h } from './dom.js';
import * as store from './store.js';
import { loadFeedback, tagLabel } from './feedback.js';
import { reasonLabel, INTERVAL_DAYS } from './srs.js';
import { topicTitle } from './engine.js';
import { isolateTitle } from './bidi.js';
import { describeFormula } from './fbuilder.js';
import { describeUnits } from './units.js';
import {
  load, save, syncNotebook, sortedEntries, topicsOf, setNote, markUnderstood, isDue, reopenHref, STATUS_LABELS, NOTE_MAX, KEY_MAX,
} from './notebook.js';

const TITLE = '📓 מחברת טעויות';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const plainText = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** (id, topic) -> { title, key, href } from the loaded exercise data (the first worked step, or the answers) */
export function describer(ctx) {
  const hard = new Map(Object.values((ctx && ctx.hard) || {}).flat().map((e) => [e.id, e]));
  return (id, topic) => {
    if (topic === 'formulas') { const f = describeFormula(id); if (f) return { ...f, key: f.key.slice(0, KEY_MAX) }; }
    if (topic === 'units') { const u = describeUnits(id); if (u) return { ...u, key: u.key.slice(0, KEY_MAX) }; }
    const ex = ctx && ctx.byId ? ctx.byId(id) : null;
    const it = ex || hard.get(id) || null;
    const steps = it ? (Array.isArray(it.solution) ? it.solution : Array.isArray(it.steps) ? it.steps : []) : [];
    let key = steps.length ? plainText(steps[0]) : '';
    if (!key && it && Array.isArray(it.inputs)) key = it.inputs.map((i) => `${i.label} = ${i.answer}${i.unit ? ' ' + i.unit : ''}`).join(', ');
    const title = plainText((it && it.title) || (ctx && ctx.hardTitle && ctx.hardTitle(id) !== id ? ctx.hardTitle(id) : '')) || `${topicTitle(topic) || topic || ''} · ${id}`;
    return { title, key: key.slice(0, KEY_MAX), href: reopenHref(id, topic) };
  };
}

const topicName = (ctx, t) => {
  const own = ctx && ctx.topics ? ctx.topics.find((x) => x.id === t) : null;
  return (own && own.title) || topicTitle(t) || t || 'אחר';
};
const dateText = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });

export function viewNotebook(ctx) {
  document.title = 'מחברת טעויות – Brain Gains';
  const state = load();
  const now = Date.now();
  if (syncNotebook(state, store.getAttempts(), loadFeedback(), describer(ctx), now)) save(state);
  let filter = '';

  const render = () => {
    const all = sortedEntries(state, Date.now());
    const shown = filter ? all.filter((e) => e.topic === filter) : all;
    const dueNow = all.filter((e) => isDue(e, Date.now())).length;
    const topics = topicsOf(state);
    const chips = topics.length > 1 ? h('div', { class: 'filters', role: 'group', 'aria-label': 'סינון לפי נושא' },
      [['', 'הכול'], ...topics.map((t) => [t, topicName(ctx, t)])].map(([t, label]) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(t === filter), onclick: () => { filter = t; render(); } }, label))) : null;
    ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'muted' }, `כל תרגיל שנפתר לא נכון, עם פתרון גלוי או עם הרבה רמזים, נכנס לכאן לבד. חוזרים אליו אחרי ${INTERVAL_DAYS.join(' / ')} ימים. פתרון נקי ובלי רמזים מקדם את התאריך, וטעות חדשה מחזירה ליום אחד.`),
      all.length ? h('p', { role: 'status' }, dueNow ? `${dueNow} רשומות מחכות לחזרה עכשיו מתוך ${all.length}.` : `אין חזרות להיום. ${all.length} רשומות במחברת.`)
        : h('p', { class: 'notice' }, 'המחברת ריקה. תרגילים שתפספסו יופיעו כאן אוטומטית.'),
      chips,
      shown.length ? h('ul', { class: 'nb-list', style: 'list-style:none;padding:0' }, shown.map((e) => card(e))) : null);
  };

  const card = (e) => {
    const due = isDue(e, Date.now());
    const note = h('textarea', { rows: '2', maxlength: String(NOTE_MAX), 'aria-label': `הערה אישית: ${e.title}`, style: 'width:100%;font:inherit', placeholder: 'מה הטעות שלי ומה לזכור בפעם הבאה' });
    note.value = e.note;
    note.addEventListener('change', () => { if (setNote(state, e.id, note.value)) save(state); });
    const understood = h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { if (markUnderstood(state, e.id)) { save(state); render(); } } }, 'הבנתי את הטעות');
    return h('li', { class: 'card nb-entry', 'aria-label': e.title },
      h('strong', {}, isolateTitle(e.title)),
      h('p', { class: 'muted' }, `${topicName(ctx, e.topic)} · טעיתי ${e.count} ${e.count === 1 ? 'פעם' : 'פעמים'} · ${e.seconds} ש`),
      h('p', {},
        h('span', { class: 'chip', 'aria-label': 'סטטוס' }, STATUS_LABELS[e.status]), ' ',
        e.reason ? h('span', { class: 'chip', 'aria-label': 'סוג הטעות' }, reasonLabel(e.reason)) : null, ' ',
        e.tags.map((t) => h('span', { class: 'chip', 'aria-label': 'מה היה קשה' }, tagLabel(t))), ' ',
        h('span', { class: due ? 'error' : 'muted' }, e.due == null ? 'נשלט' : due ? 'לחזרה עכשיו' : `חזרה ב־${dateText(e.due)}`)),
      e.key ? h('div', { class: 'panel' }, h('strong', {}, 'הצעד המרכזי: '), isolateTitle(e.key)) : h('p', { class: 'muted' }, 'אין פתרון שמור לתרגיל הזה. פתחו אותו מחדש כדי לראות אותו.'),
      note,
      h('div', { class: 'btn-row' },
        h('a', { class: due ? 'btn primary' : 'btn', href: e.href }, 'פתרו שוב עכשיו'),
        e.status === 'open' ? understood : null));
  };
  render();
}
