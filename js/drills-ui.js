// Quick drills: traps, sanity checks and flashcards from data/drills.json.
// All text goes through h() (text nodes). Results persist via store.recordDrill.
import { h, ltr } from './dom.js';
import * as store from './store.js';
import { isolateFormulas } from './bidi.js';

export const SESSION_SIZE = 10;
const MODES = {
  traps: { key: 'traps', title: 'מלכודות נפוצות', hint: 'שאלות על טעויות שחוזרות במבחנים', kind: 'trap' },
  sanity: { key: 'sanity', title: 'בדיקות שפיות', hint: 'איך יודעים שהתשובה לא הגיונית', kind: 'sanity' },
  cards: { key: 'cards', title: 'כרטיסיות', hint: 'הפכו כרטיס ובדקו אם ידעתם', kind: 'card' },
};
const FILTERS = [['all', 'הכול'], ['math', 'מתמטיקה'], ['physics', 'פיזיקה']];

let cache = null;
/** Lazy fetch, cached after success. Resolves to {ok, data} and never throws. */
export async function loadDrillData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn('data/drills.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    const arr = (k) => (Array.isArray(d && d[k]) ? d[k].filter((x) => x && typeof x.id === 'string') : []);
    cache = {
      traps: arr('traps').filter((x) => Array.isArray(x.options) && Number.isInteger(x.correct)),
      sanity: arr('sanity').filter((x) => Array.isArray(x.options) && Number.isInteger(x.correct)),
      cards: arr('cards').filter((x) => typeof x.front === 'string' && typeof x.back === 'string'),
    };
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}
export const resetDrillCache = () => { cache = null; };

const topicMatch = (topic, filter) => filter === 'all'
  || (filter === 'math' ? String(topic).startsWith('math') : String(topic).startsWith('phys'));

export function pickSession(items, filter, size = SESSION_SIZE, rnd = Math.random) {
  const pool = items.filter((x) => topicMatch(x.topic, filter));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, size);
}

const crumbs = () => h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית'));
const backToMenu = (ctx) => h('button', { class: 'btn', type: 'button', onclick: () => viewDrills(ctx) }, 'לתפריט התרגולים');

export async function viewDrills(ctx) {
  document.title = 'תרגולים מהירים – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, '⚡ תרגולים מהירים'), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadDrillData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, '⚡ תרגולים מהירים'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגולים. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewDrills(ctx) }, 'נסו שוב')));
  }
  menu(ctx, res.data, 'all');
}

function menu(ctx, data, filter) {
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'סינון לפי נושא' },
    FILTERS.map(([k, label]) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(k === filter), onclick: () => menu(ctx, data, k),
    }, label)));
  const cards = Object.values(MODES).map((m) => {
    const n = Math.min(SESSION_SIZE, pickSession(data[m.key], filter).length);
    return h('button', {
      class: 'card card-btn', type: 'button', disabled: n === 0 || null,
      onclick: () => (m.key === 'cards' ? runCards(ctx, data, filter) : runQuiz(ctx, data, m, filter)),
    }, h('strong', {}, m.title), h('span', { class: 'muted' }, n ? `${m.hint} · ${n} פריטים` : 'אין פריטים בנושא הזה'));
  });
  ctx.show(crumbs(), h('h1', {}, '⚡ תרגולים מהירים'),
    h('p', { class: 'muted' }, 'סשן קצר של עד 10 פריטים. בחרו נושא ואופן תרגול.'),
    chips, h('div', { class: 'cards' }, cards));
}

function summary(ctx, data, filter, title, score, total, missed, again) {
  const ids = [...new Set(missed.map((x) => x.trapId).filter(Boolean))];
  ctx.show(crumbs(), h('h1', {}, `סיכום: ${title}`),
    h('div', { class: 'panel' }, h('strong', {}, `ציון: ${score} מתוך ${total}`)),
    missed.length
      ? h('div', {}, h('h2', {}, 'כדאי לחזור על'), h('ul', { class: 'reasons' }, ids.map((t) => h('li', {}, ltr(t)))))
      : h('p', { class: 'feedback ok' }, 'בלי טעויות. כל הכבוד!'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', onclick: again }, 'סשן נוסף'),
      backToMenu(ctx), h('a', { class: 'btn', href: '#/progress' }, 'ההתקדמות שלי')));
}

function runQuiz(ctx, data, mode, filter) {
  const items = pickSession(data[mode.key], filter);
  const missed = [];
  let score = 0;
  const again = () => runQuiz(ctx, data, mode, filter);
  const step = (i) => {
    if (i >= items.length) return summary(ctx, data, filter, mode.title, score, items.length, missed, again);
    const it = items[i];
    const feedback = h('div', { 'aria-live': 'polite' });
    const buttons = [];
    const choose = (k) => {
      if (feedback.children.length) return;
      const ok = k === it.correct;
      if (ok) score++; else missed.push(it);
      store.recordDrill(it.id, it.trapId, ok);
      buttons.forEach((b, bi) => {
        b.disabled = true;
        b.classList.toggle('right', bi === it.correct);
        b.classList.toggle('wrong', bi === k && !ok);
      });
      feedback.replaceChildren(
        h('div', { class: `feedback ${ok ? 'ok' : 'bad'}`, role: ok ? 'status' : 'alert' }, ok ? 'נכון!' : 'לא מדויק.', ' ', isolateFormulas(it.explain || '')),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => step(i + 1) },
          i + 1 < items.length ? 'הבא ←' : 'לסיכום ←')));
    };
    it.options.forEach((o, k) => buttons.push(h('button', { class: 'btn drill-opt', type: 'button', onclick: () => choose(k) }, isolateFormulas(String(o)))));
    ctx.show(crumbs(), h('h1', {}, mode.title),
      h('p', { class: 'muted', role: 'status' }, `שאלה ${i + 1} מתוך ${items.length}`),
      h('div', { class: 'panel statement' }, isolateFormulas(it.question)),
      h('div', { class: 'drill-options' }, buttons), feedback);
  };
  if (!items.length) return menu(ctx, data, filter);
  step(0);
}

function runCards(ctx, data, filter) {
  const first = pickSession(data.cards, filter);
  if (!first.length) return menu(ctx, data, filter);
  const queue = first.slice();
  const missed = [];
  const seen = new Set(); // cards already counted once (repeats do not change the stored result)
  let score = 0;
  const again = () => runCards(ctx, data, filter);
  const step = () => {
    if (!queue.length) return summary(ctx, data, filter, 'כרטיסיות', score, first.length, missed, again);
    const c = queue.shift();
    let flipped = false;
    const face = h('button', { class: 'card card-btn flashcard', type: 'button', 'aria-live': 'polite' }, h('strong', {}, isolateFormulas(c.front)));
    const actions = h('div', { class: 'btn-row' });
    const answer = (knew) => {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        if (knew) score++; else missed.push(c);
        store.recordDrill(c.id, null, knew);
      }
      if (!knew) queue.push(c);
      step();
    };
    face.addEventListener('click', () => {
      flipped = !flipped;
      face.replaceChildren(h('strong', {}, isolateFormulas(flipped ? c.back : c.front)));
      face.setAttribute('aria-label', flipped ? 'גב הכרטיס' : 'חזית הכרטיס');
      actions.replaceChildren(...(flipped ? [
        h('button', { class: 'btn primary', type: 'button', onclick: () => answer(true) }, 'ידעתי'),
        h('button', { class: 'btn', type: 'button', onclick: () => answer(false) }, 'שוב'),
      ] : []));
    });
    ctx.show(crumbs(), h('h1', {}, 'כרטיסיות'),
      h('p', { class: 'muted', role: 'status' }, `נותרו ${queue.length + 1} כרטיסים`),
      h('p', { class: 'muted' }, 'הקישו על הכרטיס כדי להפוך אותו'), face, actions);
  };
  step();
}

/** Short "trap accuracy" block for the progress page. */
export function trapAccuracySection() {
  const weak = store.weakTraps(5);
  return h('section', { 'aria-labelledby': 'trap-h' },
    h('h2', { id: 'trap-h' }, 'דיוק במלכודות'),
    weak.length
      ? h('ul', { class: 'reasons' }, weak.map((w) => h('li', {}, ltr(w.trapId), ` · ${Math.round(w.acc * 100)}% (${w.right} מתוך ${w.right + w.wrong})`)))
      : h('p', { class: 'muted' }, 'עדיין אין מלכודות שחוזרות על עצמן. נסו את התרגולים המהירים.'),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/drills' }, '⚡ תרגולים מהירים')));
}
