// "Find the mistake": a worked solution with one flawed step; the learner taps the FIRST wrong step.
// Data text is our own HTML, passed through sanitizeHtml. Results persist via store.recordFindMistake.
import { h } from './dom.js';
import { sanitizeHtml } from './sanitize.js';
import { isolateTitle } from './bidi.js';
import * as store from './store.js';

const TOPIC_TITLES = [
  ['math-3', 'מערכת משוואות עם 3 נעלמים'],
  ['math-4', 'מערכת משוואות עם 4 נעלמים'],
  ['vertical', 'תנועה אנכית'],
  ['horizontal', 'תנועה אופקית'],
];
export const ERROR_LABELS = {
  sign: 'טעות סימן', 'division-by-zero': 'חילוק באפס', 'lost-root': 'שורש שאבד', extraneous: 'פתרון זר',
  arithmetic: 'טעות חישוב', 'wrong-formula': 'נוסחה שגויה', 'wrong-axis': 'ציר שגוי', units: 'יחידות',
  'gravity-sign': 'סימן התאוצה', 'mixed-components': 'ערבוב רכיבים', 'wrong-reference': 'ראשית ציר שגויה', 'total-time': 'זמן כולל',
};

let cache = null;
const validItem = (x) => x && typeof x.id === 'string' && typeof x.statement === 'string' && Array.isArray(x.steps)
  && x.steps.length > 0 && x.steps.every((s) => s && typeof s.text === 'string')
  && Number.isInteger(x.firstWrong) && x.firstWrong >= 0 && x.firstWrong < x.steps.length;

/** Lazy fetch, cached after success. Resolves to {ok, data} and never throws. */
export async function loadFindMistakeData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn('data/findmistake.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!Array.isArray(d)) throw new Error('not an array');
    cache = d.filter(validItem);
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}
export const resetFindMistakeCache = () => { cache = null; };

const safe = (html) => sanitizeHtml(typeof html === 'string' ? html : '');
const rich = (tag, html, attrs = {}) => h(tag, { ...attrs, rawhtml: safe(html) });
const crumbs = (href = '#/', label = '→ חזרה לדף הבית') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const TITLE = '🔎 מצאו את הטעות';

export async function viewHunt(ctx, id) {
  document.title = 'מצאו את הטעות – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadFindMistakeData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewHunt(ctx, id) }, 'נסו שוב')));
  }
  const item = id ? res.data.find((x) => x.id === id) : null;
  if (id && !item) return list(ctx, res.data);
  if (item) return runItem(ctx, res.data, item);
  list(ctx, res.data);
}

function list(ctx, data) {
  const saved = store.loadFindMistake().items;
  const groups = TOPIC_TITLES.map(([topic, title]) => {
    const items = data.filter((x) => x.topic === topic);
    if (!items.length) return null;
    return h('section', { 'aria-label': title },
      h('h2', {}, title),
      h('ul', { class: 'ex-list' }, items.map((x) => {
        const s = saved[x.id];
        return h('li', {}, h('a', { class: 'ex-item', href: `#/hunt/${x.id}` },
          h('span', { class: 't' }, isolateTitle(x.title || x.id)),
          h('span', { class: `tick o-${s && s.solved ? 'alone' : 'none'}`, role: 'img', 'aria-label': s && s.solved ? 'נמצאה הטעות' : 'טרם נפתר' }, s && s.solved ? '✓' : '○')));
      })));
  }).filter(Boolean);
  const solved = data.filter((x) => saved[x.id] && saved[x.id].solved).length;
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', { class: 'muted' }, 'בכל תרגיל יש פתרון מלא עם טעות אחת. הקישו על השלב הראשון שבו נפלה הטעות.'),
    h('p', { class: 'muted', role: 'status' }, `נמצאו ${solved} מתוך ${data.length}`),
    groups.length ? groups : h('p', { class: 'muted' }, 'עדיין אין תרגילים.'));
}

function runItem(ctx, data, it) {
  document.title = `${isolateTitle(it.title || it.id)} – Brain Gains`;
  const idx = data.indexOf(it);
  const next = data[idx + 1];
  const feedback = h('div', { 'aria-live': 'polite' });
  let solved = false;
  const buttons = it.steps.map((s, i) => h('button', {
    class: 'btn drill-opt', type: 'button', 'aria-label': `שלב ${i + 1}`, onclick: () => choose(i),
  }, h('strong', {}, `${i + 1}. `), rich('span', s.text)));

  const finish = (ok) => {
    const answer = it.correctFinal;
    const finals = Array.isArray(answer) ? answer.filter((a) => a && a.label != null) : [];
    const nav = h('div', { class: 'btn-row' },
      next ? h('a', { class: 'btn primary', href: `#/hunt/${next.id}` }, 'התרגיל הבא ←') : null,
      h('a', { class: 'btn', href: '#/hunt' }, 'לרשימת התרגילים'));
    feedback.replaceChildren(
      h('div', { class: `feedback ${ok ? 'ok' : 'bad'}`, role: ok ? 'status' : 'alert' },
        ok ? `נכון! הטעות הראשונה היא בשלב ${it.firstWrong + 1}.` : `לא נכון. הטעות הראשונה היא בשלב ${it.firstWrong + 1}.`),
      h('div', { class: 'panel' },
        h('strong', {}, 'מה השתבש: '), rich('span', it.whyWrong),
        h('h2', {}, 'השלב המתוקן'), rich('p', it.correctedStep),
        finals.length ? h('p', {}, h('strong', {}, 'התשובה הנכונה: '),
          finals.map((a, k) => h('span', { dir: 'ltr' }, `${k ? ', ' : ''}${a.label} = ${a.answer}${a.unit ? ' ' + a.unit : ''}`))) : null),
      nav);
  };

  function choose(i) {
    if (solved) return;
    const ok = i === it.firstWrong;
    store.recordFindMistake(it.id, it.errorType, ok);
    buttons.forEach((b, bi) => {
      b.classList.toggle('right', ok && bi === i);
      b.classList.toggle('wrong', !ok && bi === i);
    });
    if (ok) {
      solved = true;
      buttons.forEach((b) => { b.disabled = true; });
      return finish(true);
    }
    feedback.replaceChildren(
      h('div', { class: 'feedback bad', role: 'alert' }, `שלב ${i + 1} לא מכיל את הטעות הראשונה. נסו שוב: הטעות מוקדמת יותר או מאוחרת יותר?`),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { solved = true; buttons.forEach((b) => { b.disabled = true; }); finish(false); } }, 'הצג תשובה')));
  }

  ctx.show(crumbs('#/hunt', '→ חזרה לרשימה'), h('h1', {}, isolateTitle(it.title || it.id)),
    h('p', { class: 'muted', role: 'status' }, `תרגיל ${idx + 1} מתוך ${data.length}`),
    rich('div', it.statement, { class: 'panel statement' }),
    h('h2', {}, 'הפתרון (יש בו טעות אחת)'),
    h('p', { class: 'muted' }, 'הקישו על השלב הראשון השגוי.'),
    h('div', { class: 'drill-options' }, buttons), feedback);
}

/** Short "find the mistake" block for the progress page. Reads storage only (no fetch). */
export function findMistakeSection() {
  const d = store.loadFindMistake();
  const solved = Object.values(d.items).filter((x) => x.solved).length;
  const weak = Object.entries(d.types).filter(([, t]) => t.wrong > 0)
    .map(([k, t]) => ({ k, acc: t.right / (t.right + t.wrong), n: t.right + t.wrong }))
    .sort((a, b) => a.acc - b.acc || b.n - a.n)[0];
  return h('section', { 'aria-labelledby': 'fm-h' },
    h('h2', { id: 'fm-h' }, 'מצאו את הטעות'),
    h('p', { class: solved ? '' : 'muted' }, solved ? `פתרתם ${solved} תרגילים.` : 'עדיין לא פתרתם תרגיל בכלי הזה.'),
    weak ? h('p', { class: 'muted' }, `הכי קשה: ${ERROR_LABELS[weak.k] || weak.k} (${Math.round(weak.acc * 100)}% הצלחה)`) : null,
    h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/hunt' }, '🔎 מצאו את הטעות')));
}
