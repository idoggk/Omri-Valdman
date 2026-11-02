// Reverse problems: from the result back to the unknown input (#/reverse list, #/reverse/<id> one item).
// The learner enters the unknown values, can reveal two hints and the full solution, and marks the item done.
// Results live in their own storage key. Answers are parsed and compared with check.js.
import { h } from './dom.js';
import { safeSetItem } from './storage.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';
import { isCorrect } from './check.js';

export const REVERSE_KEY = 'omri-study-reverse-v1';
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonneg = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/* ---------- storage: { v:1, items: { id: { done, tries, hints, solution, ts } } } ---------- */
export function sanitizeReverse(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e)) continue;
    out.items[id] = { done: e.done === true, tries: nonneg(e.tries), hints: Math.min(2, nonneg(e.hints)), solution: e.solution === true, ts: Number.isFinite(e.ts) ? e.ts : 0 };
  }
  return out;
}
export function loadReverse() {
  try { return sanitizeReverse(JSON.parse(localStorage.getItem(REVERSE_KEY))); } catch (e) { return sanitizeReverse(null); }
}
/** Merges a patch into one item's record: tries is added, hints/solution only grow, done only turns on. */
export function recordReverse(id, patch) {
  const d = loadReverse();
  const p = d.items[id] || { done: false, tries: 0, hints: 0, solution: false, ts: 0 };
  d.items[id] = {
    done: p.done || patch.done === true,
    tries: p.tries + (patch.tries ? 1 : 0),
    hints: Math.max(p.hints, Math.min(2, nonneg(patch.hints))),
    solution: p.solution || patch.solution === true,
    ts: Date.now(),
  };
  safeSetItem(REVERSE_KEY, JSON.stringify(d));
}

/* ---------- data ---------- */
let loaded = null;
async function loadItems(ctx) {
  if (Array.isArray(ctx.reverse)) return ctx.reverse;
  if (!loaded) {
    try {
      const res = await fetch('data/reverse.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      loaded = Array.isArray(data.items) ? data.items : [];
    } catch (e) { return null; }
  }
  return loaded;
}

export const GROUPS = [
  ['🧮 מתמטיקה', [['math-sys3', 'מערכות עם 3 נעלמים'], ['math-sys4', 'מערכות עם 4 נעלמים'], ['math-quad', 'שורשים ומקדמים']]],
  ['🚀 פיזיקה', [['phys-horiz', 'זריקה אופקית'], ['phys-vert', 'תנועה אנכית'], ['phys-angle', 'זריקה בזווית']]],
];

const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };
const doneMark = (d) => (d && d.done ? '✅ הושלם' : d && d.tries ? '🔁 לחזרה' : 'טרם נוסה');
const fmt = (n) => String(n).replace('-', '−');

function viewList(ctx, items) {
  title('בעיות הפוכות');
  const done = loadReverse().items;
  const count = (list) => list.filter((it) => done[it.id] && done[it.id].done).length;
  ctx.show(
    crumbs('#/practice-hub', '→ חזרה לתרגול'),
    h('h1', {}, '🔄 בעיות הפוכות'),
    h('p', { class: 'muted' }, 'נתונה התוצאה וצריך למצוא את הנתון החסר: פרמטר שמביא למערכת פתרון מסוים, מקדמי משוואה לפי שורשיה, או מהירות וגובה לפי מסלול התנועה.'),
    h('div', { class: 'panel' },
      h('strong', {}, `${count(items)} מתוך ${items.length} הושלמו`),
      h('div', { class: 'progress-bar', role: 'img', 'aria-label': `${count(items)} מתוך ${items.length}` },
        h('span', { style: `width:${items.length ? Math.round((100 * count(items)) / items.length) : 0}%` }))),
    GROUPS.flatMap(([group, topics]) => [h('h2', {}, group),
      ...topics.map(([key, label]) => {
        const list = items.filter((it) => it.topic === key);
        if (!list.length) return null;
        return h('div', {},
          h('h3', {}, `${label} (${count(list)}/${list.length})`),
          h('ul', { class: 'ex-list' }, list.map((it, i) => h('li', {}, h('a', { class: 'ex-item', href: `#/reverse/${it.id}` },
            h('span', { class: 't' }, isolateTitle(`תרגיל ${i + 1} · רמה ${it.level}`)),
            h('span', { class: done[it.id] && done[it.id].done ? '' : 'muted' }, doneMark(done[it.id])))))));
      })]));
}

function viewItem(ctx, items, id) {
  const it = items.find((x) => x.id === id);
  if (!it) {
    title('בעיות הפוכות');
    return ctx.show(h('h1', {}, 'התרגיל לא נמצא'), h('p', {}, h('a', { class: 'btn primary', href: '#/reverse' }, 'לרשימה')));
  }
  title('בעיה הפוכה');
  const next = items[(items.indexOf(it) + 1) % items.length];
  const saved = loadReverse().items[it.id];
  let hintsShown = 0;
  const fields = it.answers.map((a, i) => ({ a, input: h('input', { type: 'text', id: `rv-${i}`, inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }) }));
  const fb = h('div', { role: 'status', 'aria-live': 'polite' });
  const hintBox = h('div', {});
  const solBox = h('div', {});
  const hintBtn = h('button', { class: 'btn', type: 'button', onclick: () => showHint() }, 'רמז');
  const doneBtn = h('button', { class: 'btn', type: 'button', onclick: () => markDone() }, 'סמנו כהושלם');

  function showHint() {
    if (hintsShown >= it.hints.length) return;
    hintBox.append(h('div', { class: 'panel' }, h('strong', {}, `רמז ${hintsShown + 1}: `), isolateFormulas(it.hints[hintsShown])));
    hintsShown++;
    recordReverse(it.id, { hints: hintsShown });
    if (hintsShown >= it.hints.length) { hintBtn.disabled = true; }
  }
  function markDone() {
    recordReverse(it.id, { done: true });
    doneBtn.disabled = true;
    fb.replaceChildren(h('div', { class: 'feedback ok' }, 'התרגיל סומן כהושלם.'));
  }
  function showSolution() {
    recordReverse(it.id, { solution: true });
    solBox.replaceChildren(h('div', { class: 'panel' }, h('strong', {}, 'פתרון מלא'),
      h('ol', {}, it.steps.map((s) => h('li', {}, isolateFormulas(s)))),
      h('p', {}, h('strong', {}, 'תשובה: '), it.answers.map((a, i) => h('span', {}, i ? ' · ' : '', h('span', { dir: 'ltr' }, ltrIsolate(`${a.name} = ${fmt(a.value)}`)))))));
  }
  function check() {
    const res = fields.map((f) => isCorrect(f.input.value, f.a.value, f.a.tolerance));
    const ok = res.every(Boolean);
    const cur = loadReverse().items[it.id];
    recordReverse(it.id, { tries: true, done: ok });
    fb.replaceChildren(...[
      h('div', { class: ok ? 'feedback ok' : 'feedback bad' },
        ok ? ((cur && (cur.hints || cur.solution)) || hintsShown ? 'נכון! (נעזרתם ברמז או בפתרון, כדאי לחזור לתרגיל בהמשך.)' : 'נכון! פתרתם לבד.')
          : `לא מדויק: ${res.filter(Boolean).length} מתוך ${res.length} תשובות נכונות. בדקו שוב, אפשר להיעזר ברמז.`),
      ok ? h('div', { class: 'btn-row' },
        next && next.id !== it.id ? h('a', { class: 'btn primary', href: `#/reverse/${next.id}` }, 'התרגיל הבא ←') : null,
        h('a', { class: 'btn', href: '#/reverse' }, 'לרשימה')) : null,
    ].filter(Boolean));
  }

  ctx.show(crumbs('#/reverse', '→ בעיות הפוכות'),
    h('h1', {}, `בעיה הפוכה · רמה ${it.level}`),
    saved && saved.done ? h('p', { class: 'muted' }, '✅ כבר הושלם בעבר') : null,
    h('div', { class: 'panel statement' },
      h('p', {}, isolateFormulas(it.statement)),
      it.kind === 'math' ? h('div', { class: 'cp-eqs' }, it.equations.map((q) => h('div', { dir: 'ltr' }, ltrIsolate(q)))) : null),
    h('div', {}, fields.map((f, i) => h('div', { class: 'field' },
      h('label', { for: `rv-${i}` }, isolateFormulas(f.a.label), ' ='), h('div', { class: 'row' }, f.input)))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', onclick: check }, 'בדיקה'),
      hintBtn,
      h('button', { class: 'btn', type: 'button', onclick: showSolution }, 'הצגת פתרון'),
      doneBtn),
    fb, hintBox, solBox);
}

export async function viewReverseRoute(ctx, id) {
  const items = await loadItems(ctx);
  if (!items) {
    title('בעיות הפוכות');
    return ctx.show(h('h1', {}, 'בעיות הפוכות'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  return id ? viewItem(ctx, items, id) : viewList(ctx, items);
}
