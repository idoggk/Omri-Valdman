// Edge-case lab: list (#/edge), one item (#/edge/<id>) and a result summary (#/edge/summary).
// The learner ticks which candidate answers are really valid (none ticked = "no solution") and gets immediate
// feedback: a reason for every candidate and a full explanation. Results live in their own storage key.
import { h } from './dom.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';

export const EDGE_KEY = 'omri-study-edgecases-v1';
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonneg = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/* ---------- storage: { v:1, items: { id: { tries, right, last, ts } } } ---------- */
export function sanitizeEdge(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e)) continue;
    const tries = Math.max(1, nonneg(e.tries));
    out.items[id] = { tries, right: Math.min(tries, nonneg(e.right)), last: e.last === true, ts: Number.isFinite(e.ts) ? e.ts : 0 };
  }
  return out;
}
export function loadEdge() {
  try { return sanitizeEdge(JSON.parse(localStorage.getItem(EDGE_KEY))); } catch (e) { return sanitizeEdge(null); }
}
export function recordEdge(id, ok) {
  const d = loadEdge();
  const p = d.items[id];
  d.items[id] = { tries: (p ? p.tries : 0) + 1, right: (p ? p.right : 0) + (ok ? 1 : 0), last: !!ok, ts: Date.now() };
  try { localStorage.setItem(EDGE_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}

/* ---------- data and helpers ---------- */
let loaded = null;
async function loadItems(ctx) {
  if (Array.isArray(ctx.edgecases)) return ctx.edgecases;
  if (!loaded) {
    try {
      const res = await fetch('data/edgecases.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      loaded = Array.isArray(data.items) ? data.items : [];
    } catch (e) { return null; }
  }
  return loaded;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** "x = 1, y = 2" (or "t = 1.5") for a candidate tuple. */
export function labelOf(it, c) {
  return it.vars.map((n, i) => `${n} = ${String(c.v[i]).replace('-', '−')}`).join(', ');
}

/** Compares the ticked candidates with the valid ones. picked: array of booleans parallel to it.candidates. */
export function grade(it, picked) {
  const rows = it.candidates.map((c, i) => ({ c, picked: !!picked[i], right: !!picked[i] === c.ok }));
  return { ok: rows.every((r) => r.right), rows };
}

export const GROUPS = [
  ['🧮 מערכות משוואות', [['math-quad', 'ריבועים וריבוי פתרונות'], ['math-extra', 'פתרון זר אחרי העלאה בריבוע'], ['math-div', 'חילוק ומכנה שמתאפס'], ['math-zero', 'מקדם אפס']]],
  ['🚀 תנועה אנכית ואופקית', [['phys-vert', 'תנועה אנכית: שני זמנים ושורש שלילי'], ['phys-horiz', 'תנועה אופקית וזריקה אופקית'], ['phys-none', 'כשאין פתרון']]],
];

const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };
const doneMark = (d) => (d ? (d.last ? '✅ נכון' : '🔁 לחזרה') : 'טרם נוסה');

function viewList(ctx, items) {
  title('מקרי קצה');
  const done = loadEdge().items;
  const solved = items.filter((it) => done[it.id] && done[it.id].last).length;
  ctx.show(
    crumbs('#/practice-hub', '→ חזרה לתרגול'),
    h('h1', {}, '🧪 מקרי קצה ופתרונות מרובים'),
    h('p', { class: 'muted' }, 'לא כל שורש של משוואה הוא פתרון של הבעיה. מסמנים אילו מהמועמדים תקפים (ואם אין אף אחד, לא מסמנים כלום), ומקבלים הסבר לכל מועמד.'),
    h('div', { class: 'panel' },
      h('strong', {}, `${solved} מתוך ${items.length} נענו נכון בפעם האחרונה`),
      h('div', { class: 'progress-bar', role: 'img', 'aria-label': `${solved} מתוך ${items.length}` },
        h('span', { style: `width:${items.length ? Math.round((100 * solved) / items.length) : 0}%` })),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/edge/summary' }, 'סיכום תוצאות'))),
    GROUPS.flatMap(([group, topics]) => [h('h2', {}, group),
      ...topics.map(([key, label]) => {
        const list = items.filter((it) => it.topic === key);
        if (!list.length) return null;
        const n = list.filter((it) => done[it.id] && done[it.id].last).length;
        return h('div', {},
          h('h3', {}, `${label} (${n}/${list.length})`),
          h('ul', { class: 'ex-list' }, list.map((it) => h('li', {}, h('a', { class: 'ex-item', href: `#/edge/${it.id}` },
            h('span', { class: 't' }, isolateTitle(it.title)),
            h('span', { class: done[it.id] ? '' : 'muted' }, doneMark(done[it.id])))))));
      })]));
}

function viewSummary(ctx, items) {
  title('סיכום מקרי קצה');
  const done = loadEdge().items;
  const tried = items.filter((it) => done[it.id]);
  const solved = items.filter((it) => done[it.id] && done[it.id].last);
  const redo = tried.filter((it) => !done[it.id].last);
  const part = (kind, label) => {
    const list = items.filter((it) => it.kind === kind);
    return h('li', {}, `${label}: ${list.filter((it) => done[it.id] && done[it.id].last).length} מתוך ${list.length} נכונות`);
  };
  ctx.show(
    crumbs('#/edge', '→ מקרי קצה'),
    h('h1', {}, 'סיכום תוצאות'),
    h('div', { class: solved.length === items.length ? 'feedback ok' : 'panel', role: 'status' },
      `נוסו ${tried.length} מתוך ${items.length}; ${solved.length} נענו נכון בפעם האחרונה.`),
    h('ul', {}, part('math', 'מתמטיקה'), part('phys', 'פיזיקה')),
    redo.length ? h('div', { class: 'panel' }, h('strong', {}, 'לחזרה:'),
      h('ul', {}, redo.map((it) => h('li', {}, h('a', { href: `#/edge/${it.id}` }, isolateTitle(it.title)))))) : null,
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/edge' }, 'לרשימה')));
}

function viewItem(ctx, items, id) {
  const it = items.find((x) => x.id === id);
  if (!it) {
    title('מקרי קצה');
    return ctx.show(h('h1', {}, 'התרגיל לא נמצא'), h('p', {}, h('a', { class: 'btn primary', href: '#/edge' }, 'לרשימה')));
  }
  title(it.title);
  const next = items[(items.indexOf(it) + 1) % items.length];
  const order = shuffle(it.candidates, ctx.rnd || Math.random);
  const boxes = order.map(() => h('input', { type: 'checkbox' }));
  const fb = h('div', { role: 'status', 'aria-live': 'polite' });
  const rows = order.map((c, i) => h('label', { class: 'panel', style: 'display:flex;gap:.6rem;align-items:center' }, boxes[i],
    h('span', { dir: 'ltr' }, ltrIsolate(labelOf(it, c)))));
  const check = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, 'בדיקה');
  let answered = false;
  function submit() {
    if (answered) return;
    answered = true;
    const g = grade({ candidates: order }, boxes.map((b) => b.checked === true));
    recordEdge(it.id, g.ok);
    check.disabled = true;
    boxes.forEach((b) => { b.disabled = true; });
    const none = it.answers.length === 0;
    fb.replaceChildren(
      h('div', { class: g.ok ? 'feedback ok' : 'feedback bad' },
        g.ok ? (none ? 'נכון! אין פתרון, ולכן לא סימנתם כלום.' : 'נכון! זיהיתם בדיוק את הפתרונות התקפים.')
          : (none ? 'לא מדויק. במקרה הזה אין אף פתרון תקף.' : `לא מדויק. יש ${it.answers.length} פתרונות תקפים; בדקו שוב כל מועמד.`)),
      h('div', { class: 'panel' }, h('strong', {}, 'מועמד אחרי מועמד:'),
        h('ul', {}, g.rows.map((r) => h('li', {},
          h('span', { dir: 'ltr' }, ltrIsolate(labelOf(it, r.c))), ' — ',
          h('strong', {}, r.c.ok ? 'תקף' : 'נפסל'), r.right ? ' ✅' : (r.picked ? ' (סימנתם בטעות ❌)' : ' (לא סימנתם ❌)'), ': ',
          isolateFormulas(r.c.why))))),
      h('div', { class: 'panel' }, h('strong', {}, 'הסבר מלא'), h('p', {}, isolateFormulas(it.explanation))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => viewItem(ctx, items, id) }, 'נסו שוב'),
        next && next.id !== it.id ? h('a', { class: 'btn primary', href: `#/edge/${next.id}` }, 'התרגיל הבא ←') : null,
        h('a', { class: 'btn', href: '#/edge' }, 'לרשימה')));
  }
  ctx.show(crumbs('#/edge', '→ מקרי קצה'),
    h('h1', {}, it.title),
    h('div', { class: 'panel statement' },
      h('p', {}, isolateFormulas(it.prompt)),
      h('div', { class: 'cp-eqs' }, it.equations.map((q) => h('div', { dir: 'ltr' }, ltrIsolate(q)))),
      it.domainNote ? h('p', { class: 'muted' }, isolateFormulas(it.domainNote)) : null),
    h('p', {}, h('strong', {}, 'סמנו את כל המועמדים התקפים. אם אין אף אחד, השאירו הכול לא מסומן.')),
    h('div', { class: 'options' }, rows), check, fb);
}

export async function viewEdgeRoute(ctx, id) {
  const items = await loadItems(ctx);
  if (!items) {
    title('מקרי קצה');
    return ctx.show(h('h1', {}, 'מקרי קצה'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  if (id === 'summary') return viewSummary(ctx, items);
  return id ? viewItem(ctx, items, id) : viewList(ctx, items);
}
