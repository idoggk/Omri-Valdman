// Endless practice: topic picker (#/endless) and generated variants (#/endless/<templateId>/<seed>).
// The exercise itself is rendered by exercise-view.js (same checking, hints, solution, diagram); this file only
// supplies a progress sink that writes to the separate endless counters, so variants never reach the review or mistakes lists.
import { h } from './dom.js';
import * as store from './store.js';
import { generate, listTemplates } from './variants.js';

export const TOPIC_FILTERS = [
  ['all', 'הכול'],
  ['math-3', '3 נעלמים'],
  ['math-4', '4 נעלמים'],
  ['phys-vertical', 'תנועה אנכית'],
  ['phys-horizontal', 'תנועה אופקית'],
];
const MAX_SEED = 1e12;

let filter = null; // { topic, tpl } chosen in the picker; null until the learner picks or opens a variant

const templatesFor = (topic) => listTemplates().filter((t) => topic === 'all' || t.topic === topic);

/** Fresh seed derived from the clock; kept small so it stays readable in the URL. */
export function newSeed() {
  return (Date.now() + Math.floor(Math.random() * 1e6)) % 1e9;
}

function pickTemplate(f) {
  const list = templatesFor(f.topic);
  if (f.tpl && list.some((t) => t.id === f.tpl)) return f.tpl;
  return list[Math.floor(Math.random() * list.length)].id;
}

const go = (tplId, seed) => { location.hash = `#/endless/${tplId}/${seed}`; };

function endlessSink(tplId) {
  let counted = false, tips = 0, outcome = 'alone';
  const add = (d) => store.recordEndless(tplId, d);
  return {
    attempt(a) {
      const d = { attempts: counted ? 0 : 1 };
      counted = true;
      if (a.outcome === 'alone') d.alone = 1;
      if (a.outcome === 'hinted' || a.outcome === 'solution') d.hinted = 1;
      add(d);
    },
    setReason() {},
    tips: () => tips,
    setTips(n) { tips = Math.max(tips, n); },
    reveal() {},
    correct() { outcome = tips > 0 ? 'hinted' : 'alone'; },
    outcome: () => outcome,
    guided() {},
  };
}

/** Small totals block for the progress page. */
export function endlessSection() {
  const t = store.endlessTotals();
  return h('div', { class: 'endless-progress' },
    h('h2', {}, '♾️ תרגול בלי די'),
    t.attempts
      ? h('p', {}, `ניסיונות: ${t.attempts} · נפתרו לבד: ${t.alone} · נפתרו עם רמזים או פתרון: ${t.hinted}`)
      : h('p', { class: 'muted' }, 'עדיין לא תרגלתם תרגילים חדשים.'),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/endless' }, 'לתרגול בלי די')));
}

function viewPicker(ctx) {
  document.title = 'תרגול בלי די – Brain Gains';
  if (!filter) filter = { topic: 'all', tpl: null };
  const render = () => {
    const list = templatesFor(filter.topic);
    const topicChips = h('div', { class: 'filters', role: 'group', 'aria-label': 'נושא' },
      TOPIC_FILTERS.map(([id, label]) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(id === filter.topic),
        onclick: () => { filter = { topic: id, tpl: null }; render(); },
      }, label)));
    const tplChips = h('div', { class: 'filters', role: 'group', 'aria-label': 'סוג תרגיל' },
      [{ id: null, title: 'כל הסוגים' }, ...list].map((t) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(t.id === filter.tpl),
        onclick: () => { filter = { topic: filter.topic, tpl: t.id }; render(); },
      }, t.title)));
    ctx.show(
      h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית')),
      h('h1', {}, '♾️ תרגול בלי די בריגים'),
      h('p', { class: 'muted' }, 'תרגילים חדשים בכל פעם, עם בדיקת תשובה, שלושה רמזים ופתרון מלא. התוצאות נשמרות בנפרד ולא נכנסות לרשימת החזרה.'),
      h('h2', {}, 'נושא'), topicChips,
      h('h2', {}, 'סוג תרגיל (לא חובה)'), tplChips,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => go(pickTemplate(filter), (ctx.newSeed || newSeed)()) }, 'התחילו לתרגל')),
      endlessSection());
  };
  render();
}

function viewVariant(ctx, tplId, seedStr) {
  const meta = listTemplates().find((t) => t.id === tplId);
  const seed = /^\d+$/.test(seedStr || '') ? Number(seedStr) : NaN;
  let ex = null;
  if (meta && seed <= MAX_SEED) {
    try { ex = generate(tplId, seed); } catch (e) { ex = null; }
  }
  if (!ex) {
    document.title = 'תרגול בלי די – Brain Gains';
    return ctx.show(h('h1', {}, 'התרגיל לא נמצא'),
      h('p', {}, 'הקישור לא תקין. אפשר לבחור תרגיל חדש.'),
      h('p', {}, h('a', { class: 'btn primary', href: '#/endless' }, 'לבחירת נושא')));
  }
  if (!filter) filter = { topic: meta.topic, tpl: null };
  const fresh = (t) => {
    let s = (ctx.newSeed || newSeed)();
    if (t === tplId && s === seed) s = (s + 1) % 1e9;
    go(t, s);
  };
  const nav = h('nav', { class: 'nav', 'aria-label': 'וריאנטים' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => fresh(pickTemplate(filter)) }, 'וריאנט הבא ←'),
    h('button', { class: 'btn', type: 'button', onclick: () => fresh(tplId) }, 'עוד תרגיל מאותו סוג'),
    h('a', { class: 'btn', href: '#/endless' }, 'לבחירת נושא'));
  ctx.renderExercise(ex, {
    ctx, sink: endlessSink(tplId), nav,
    crumbs: h('p', { class: 'crumbs' }, h('a', { href: '#/endless' }, '→ תרגול בלי די')),
  });
}

export function viewEndless(ctx, tplId, seedStr) {
  return tplId ? viewVariant(ctx, tplId, seedStr) : viewPicker(ctx);
}

/** Tests: forget the picker choice. */
export function resetEndlessFilter() { filter = null; }
