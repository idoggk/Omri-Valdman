// Solution-order trainer: picker (#/order) and one exercise (#/order/<id>).
// The learner rearranges the solution steps (tap a step, then tap where it goes, or use the up/down buttons),
// then checks. Best scores live in their own storage key (store.js) and never touch the review queue.
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import * as store from './store.js';

export const MIN_STEPS = 4;
export const MAX_STEPS = 9;
export const TOPIC_FILTERS = [
  ['all', 'הכול'],
  ['math-3', '3 נעלמים'],
  ['math-4', '4 נעלמים'],
  ['phys-vertical', 'תנועה אנכית'],
  ['phys-horizontal', 'תנועה אופקית'],
];
export const RULE_OF_THUMB = 'כלל אצבע: נתונים ונעלמים ← נוסחה ← הצבה ← חישוב ← בדיקה ומסקנה.';

/* ---------- pure logic ---------- */
function seedFrom(text) { // FNV-1a
  let x = 2166136261;
  for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const isSorted = (a) => a.every((v, i) => v === i);

/** Deterministic permutation of 0..n-1 for (exerciseId, attempt); never the identity (for n >= 2). */
export function shuffleOrder(n, exerciseId, attempt = 0) {
  const rand = rng(seedFrom(`${exerciseId}#${attempt}`));
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (n > 1 && isSorted(a)) a.push(a.shift());
  return a;
}

/** order[i] = original index of the step placed at position i.
    Returns per-position correctness and the percent of steps kept in correct relative order (longest increasing subsequence). */
export function scoreOrder(order) {
  const n = order.length;
  const tails = []; // patience sorting, strictly increasing
  for (const v of order) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    tails[lo] = v;
  }
  const kept = tails.length;
  return {
    correct: order.map((v, i) => v === i),
    kept,
    percent: n ? Math.round((kept / n) * 100) : 0,
    perfect: n > 0 && isSorted(order),
  };
}

/** Moves the item at position `from` so it ends at position `to`. Returns a new array. */
export function moveItem(order, from, to) {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order.slice();
  const a = order.slice();
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export const isEligible = (ex) => !!ex && Array.isArray(ex.solution) && ex.solution.length >= MIN_STEPS && ex.solution.length <= MAX_STEPS &&
  ex.solution.every((s) => typeof s === 'string');

/* ---------- views ---------- */
let filter = { topic: 'all', level: 0 };
const attempts = new Map(); // exerciseId -> attempt number this session

const eligibleFor = (ctx, f) => (ctx.exercises || []).filter((e) => isEligible(e) &&
  (f.topic === 'all' || e.topic === f.topic) && (!f.level || e.level === f.level));

/** One short line for the progress page. */
export function orderSection() {
  const n = store.countOrderPerfect();
  return h('div', { class: 'order-progress' },
    h('h2', {}, '🧩 סידור שלבי פתרון'),
    h('p', n ? {} : { class: 'muted' }, n ? `סודרו בצורה מושלמת: ${n} תרגילים.` : 'עדיין לא סידרתם תרגיל בצורה מושלמת.'),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/order' }, 'לסידור שלבים')));
}

function viewPicker(ctx) {
  document.title = 'סדרו את שלבי הפתרון – Brain Gains';
  const render = () => {
    const best = store.loadOrder().items;
    const list = eligibleFor(ctx, filter);
    const chips = (label, items, current, set) => h('div', { class: 'filters', role: 'group', 'aria-label': label },
      items.map(([id, text]) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(id === current),
        onclick: () => { set(id); render(); },
      }, text)));
    ctx.show(
      h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית')),
      h('h1', {}, '🧩 סדרו את שלבי הפתרון'),
      h('p', { class: 'muted' }, 'שלבי הפתרון מעורבבים. סדרו אותם בסדר הנכון ובדקו את עצמכם.'),
      h('h2', {}, 'נושא'), chips('נושא', TOPIC_FILTERS, filter.topic, (v) => { filter = { ...filter, topic: v }; }),
      h('h2', {}, 'רמה'), chips('רמה', [[0, 'הכול'], [1, 'רמה 1'], [2, 'רמה 2'], [3, 'רמה 3']], filter.level, (v) => { filter = { ...filter, level: v }; }),
      list.length
        ? h('ul', { class: 'ex-list' }, list.map((e) => {
          const b = best[e.id] ? best[e.id].best : null;
          return h('li', {}, h('a', { class: 'ex-item', href: `#/order/${e.id}` },
            h('span', {}, isolateTitle(e.title || e.id)),
            h('span', { class: 'muted' }, b == null ? 'טרם נוסה' : (b === 100 ? '✅ 100%' : `שיא: ${b}%`))));
        }))
        : h('p', { class: 'muted' }, 'אין תרגילים מתאימים לסינון הזה.'));
  };
  render();
}

function viewOrder(ctx, id) {
  const ex = ctx.byId ? ctx.byId(id) : null;
  if (!isEligible(ex)) {
    document.title = 'סדרו את שלבי הפתרון – Brain Gains';
    return ctx.show(h('h1', {}, 'התרגיל לא נמצא'),
      h('p', {}, 'אי אפשר לסדר שלבים בתרגיל הזה.'),
      h('p', {}, h('a', { class: 'btn primary', href: '#/order' }, 'לבחירת תרגיל')));
  }
  document.title = `סידור שלבים – ${ex.title || ex.id} – Brain Gains`;
  const steps = ex.solution;
  const attempt = attempts.get(id) || 0;
  let order = shuffleOrder(steps.length, id, attempt);
  let selected = -1, checked = false;

  const nextId = () => {
    const list = eligibleFor(ctx, filter).filter((e) => e.id !== id);
    const pool = list.length ? list : (ctx.exercises || []).filter((e) => isEligible(e) && e.id !== id);
    if (!pool.length) return null;
    const all = (ctx.exercises || []).filter(isEligible);
    const at = all.findIndex((e) => e.id === id);
    const best = store.loadOrder().items;
    const ranked = pool.map((e) => ({ e, d: (all.indexOf(e) - at + all.length) % all.length }))
      .sort((a, b) => ((best[a.e.id] && best[a.e.id].best === 100) - (best[b.e.id] && best[b.e.id].best === 100)) || a.d - b.d);
    return ranked[0].e.id;
  };

  const status = h('div', { class: 'notice', role: 'status', 'aria-live': 'polite' });
  const listEl = h('ol', { class: 'order-list' });
  const result = h('div');
  const checkBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => check() }, 'בדיקה');

  const place = (pos) => { // tap-to-place: move the selected step to position `pos`
    if (checked) return;
    if (selected === -1) { selected = pos; }
    else if (selected === pos) { selected = -1; }
    else { order = moveItem(order, selected, pos); selected = -1; }
    draw();
  };
  const nudge = (pos, d) => {
    if (checked || pos + d < 0 || pos + d >= order.length) return;
    order = moveItem(order, pos, pos + d);
    selected = -1;
    draw();
    const row = listEl.children[pos + d]; // keep keyboard focus on the same direction button after the redraw
    const moveBox = row && row.children[row.children.length - 1];
    const target = moveBox && moveBox.children[d < 0 ? 0 : 1];
    if (target && !target.disabled) target.focus();
    else if (row && row.children[0]) row.children[0].focus();
  };

  let marks = null;
  function draw() {
    listEl.replaceChildren(...order.map((orig, pos) => {
      const isSel = pos === selected;
      const mark = marks ? (marks.correct[pos] ? 'right' : 'wrong') : null;
      return h('li', { class: `order-step${isSel ? ' selected' : ''}${mark ? ' ' + mark : ''}` },
        h('button', {
          class: 'order-pick', type: 'button', 'data-step': String(orig), 'aria-pressed': String(isSel), disabled: checked,
          'aria-label': `שלב במקום ${pos + 1}${isSel ? ', נבחר' : ''}`,
          onclick: () => place(pos),
        }, h('span', { class: 'order-num' }, `${pos + 1}.`), ' ', h('span', { html: steps[orig] })),
        mark ? h('span', { class: 'order-mark', role: 'img', 'aria-label': mark === 'right' ? 'במקום הנכון' : 'לא במקום הנכון' }, mark === 'right' ? '✅' : '❌') : null,
        h('span', { class: 'order-move' },
          h('button', { class: 'btn', type: 'button', 'data-move': 'up', disabled: checked || pos === 0, 'aria-label': 'הזיזו למעלה', onclick: () => nudge(pos, -1) }, '▲'),
          h('button', { class: 'btn', type: 'button', 'data-move': 'down', disabled: checked || pos === order.length - 1, 'aria-label': 'הזיזו למטה', onclick: () => nudge(pos, 1) }, '▼')));
    }));
    status.textContent = (selected === -1
      ? 'הקישו על שלב כדי לבחור אותו, ואז על המקום שאליו הוא צריך לעבור. אפשר גם להשתמש בחצים.'
      : `נבחר שלב ממקום ${selected + 1}. הקישו על המקום החדש שלו (או עליו שוב לביטול).`);
  }

  function check() {
    if (checked) return;
    checked = true; selected = -1;
    marks = scoreOrder(order);
    store.recordOrder(id, marks.percent);
    checkBtn.disabled = true;
    draw();
    status.textContent = (marks.perfect ? 'מושלם! כל השלבים בסדר הנכון. 🎉'
      : `${marks.percent}% מהשלבים בסדר יחסי נכון (${marks.kept} מתוך ${steps.length}).`);
    const next = nextId();
    result.replaceChildren(...[
      marks.perfect ? null : h('div', { class: 'panel' },
        h('strong', {}, 'הסדר הנכון:'),
        h('ol', {}, steps.map((s) => h('li', {}, h('span', { html: s }))))),
      h('p', { class: 'muted' }, RULE_OF_THUMB),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { attempts.set(id, attempt + 1); viewOrder(ctx, id); } }, 'ערבבו ונסו שוב'),
        next ? h('a', { class: 'btn primary', href: `#/order/${next}` }, 'התרגיל הבא ←') : null,
        h('a', { class: 'btn', href: '#/order' }, 'לבחירת תרגיל'))].filter(Boolean));
  }

  draw();
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/order' }, '→ סידור שלבים')),
    h('h1', {}, isolateTitle(ex.title || ex.id)),
    h('div', { class: 'panel statement', html: ex.statement || '' }),
    ctx.diagramFigure ? ctx.diagramFigure(ex) : null,
    h('h2', {}, 'סדרו את שלבי הפתרון'),
    status, listEl,
    h('div', { class: 'btn-row' }, checkBtn),
    result);
}

export function viewOrderRoute(ctx, id) {
  return id ? viewOrder(ctx, id) : viewPicker(ctx);
}

/** Tests: forget picker choice and attempt counters. */
export function resetOrderState() { filter = { topic: 'all', level: 0 }; attempts.clear(); }
