// Method-choice trainer: list by topic (#/methods), one item (#/methods/<id>) and a quick random round
// (#/methods/round). The learner picks the best first method / the justified next step and sees the
// explanation for every option immediately. Results live in their own storage key.
import { h } from './dom.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';

export const METHODS_KEY = 'omri-study-methods-v1';
export const ROUND_SIZE = 10;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonneg = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/* ---------- storage: { v:1, items: { id: { tries, right, last, ts } } } ---------- */
export function sanitizeMethods(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e)) continue;
    const tries = Math.max(1, nonneg(e.tries));
    out.items[id] = { tries, right: Math.min(tries, nonneg(e.right)), last: e.last === true, ts: Number.isFinite(e.ts) ? e.ts : 0 };
  }
  return out;
}
export function loadMethods() {
  try { return sanitizeMethods(JSON.parse(localStorage.getItem(METHODS_KEY))); } catch (e) { return sanitizeMethods(null); }
}
export function recordMethod(id, ok) {
  const d = loadMethods();
  const p = d.items[id];
  d.items[id] = { tries: (p ? p.tries : 0) + 1, right: (p ? p.right : 0) + (ok ? 1 : 0), last: !!ok, ts: Date.now() };
  try { localStorage.setItem(METHODS_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}

/* ---------- data and helpers ---------- */
let loaded = null;
async function loadItems(ctx) {
  if (Array.isArray(ctx.methods)) return ctx.methods;
  if (!loaded) {
    try {
      const res = await fetch('data/methods.json', { cache: 'no-cache' });
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
export const pickRound = (items, size = ROUND_SIZE, rnd = Math.random) => shuffle(items, rnd).slice(0, size);

export const TOPIC_GROUPS = [
  ['🧮 מערכות משוואות', [['math-choose', 'בחירת שיטה'], ['math-quad', 'משוואה ריבועית אחרי הצבה'], ['math-check', 'מתי בודקים שורשים']]],
  ['🚀 תנועה אנכית ואופקית', [['phys-axis', 'איזה ציר קודם'], ['phys-formula', 'בחירת נוסחה'], ['phys-given', 'נתון ונדרש'], ['phys-next', 'הצעד הבא']]],
];
const KIND_LABEL = { method: 'בחירת שיטה', next: 'הצעד הבא' };

const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };

function viewList(ctx, items) {
  title('בחירת שיטה');
  const done = loadMethods().items;
  const solved = items.filter((it) => done[it.id] && done[it.id].last).length;
  ctx.show(
    crumbs('#/', '→ חזרה לדף הבית'),
    h('h1', {}, '🧭 איך מתחילים?'),
    h('p', { class: 'muted' }, 'בוחרים את השיטה הטובה ביותר או את הצעד הנכון הבא, ומקבלים הסבר מיד, גם למסיחים.'),
    h('div', { class: 'panel' },
      h('strong', {}, `${solved} מתוך ${items.length} פריטים נענו נכון בפעם האחרונה`),
      h('div', { class: 'progress-bar', role: 'img', 'aria-label': `${solved} מתוך ${items.length}` },
        h('span', { style: `width:${items.length ? Math.round((100 * solved) / items.length) : 0}%` })),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/methods/round' }, `סבב מהיר של ${Math.min(ROUND_SIZE, items.length)} שאלות`))),
    TOPIC_GROUPS.flatMap(([group, topics]) => [h('h2', {}, group),
      ...topics.map(([key, label]) => {
        const list = items.filter((it) => it.topic === key);
        if (!list.length) return null;
        const n = list.filter((it) => done[it.id] && done[it.id].last).length;
        return h('div', {},
          h('h3', {}, `${label} (${n}/${list.length})`),
          h('ul', { class: 'ex-list' }, list.map((it) => {
            const d = done[it.id];
            return h('li', {}, h('a', { class: 'ex-item', href: `#/methods/${it.id}` },
              h('span', { class: 't' }, isolateTitle(it.prompt.length > 60 ? it.prompt.slice(0, 60) + '…' : it.prompt)),
              h('span', { class: d ? '' : 'muted' }, d ? (d.last ? '✅ נכון' : '🔁 לחזרה') : 'טרם נוסה')));
          })));
      })]));
}

/** One question. `onDone(ok)` is called after the first answer; `footer(ok)` supplies the next-step controls. */
function questionView(it, rnd, onDone, footer) {
  const order = shuffle(it.options, rnd);
  const out = h('div');
  let answered = false;
  const fb = h('div', { role: 'status', 'aria-live': 'polite' });
  const buttons = order.map((o) => h('button', { class: 'btn option', type: 'button', onclick: () => pick(o) }, isolateFormulas(o.text)));
  function pick(o) {
    if (answered) return;
    answered = true;
    const ok = o.correct === true;
    onDone(ok);
    order.forEach((q, i) => {
      buttons[i].disabled = true;
      // no dedicated styles: mark with an icon (aria-label keeps it readable for screen readers)
      if (q.correct) buttons[i].replaceChildren(document.createTextNode('✅ ' + isolateFormulas(q.text)));
      else if (q === o) buttons[i].replaceChildren(document.createTextNode('❌ ' + isolateFormulas(q.text)));
    });
    const right = it.options.find((q) => q.correct);
    fb.replaceChildren(...[
      h('div', { class: ok ? 'feedback ok' : 'feedback bad' }, ok ? 'נכון! ' : 'לא מדויק. ', isolateFormulas(o.why)),
      ok ? null : h('div', { class: 'panel' }, h('strong', {}, 'התשובה הנכונה: '), isolateFormulas(right.text), h('p', {}, isolateFormulas(right.why))),
      h('div', { class: 'panel' }, h('strong', {}, 'למה כל אפשרות:'),
        h('ul', {}, order.map((q) => h('li', {}, h('strong', {}, q.correct ? 'נכונה: ' : 'שגויה: '), isolateFormulas(q.text), ' — ', isolateFormulas(q.why))))),
      footer(ok)].filter(Boolean));
  }
  out.append(
    h('div', { class: 'panel statement' },
      h('p', {}, isolateFormulas(it.prompt)),
      (it.equations || []).length ? h('div', { class: 'cp-eqs' }, it.equations.map((q) => h('div', { dir: 'ltr' }, ltrIsolate(q)))) : null),
    h('p', {}, h('strong', {}, it.kind === 'next' ? 'מהו הצעד הבא הנכון?' : 'מהי הדרך הטובה ביותר להתחיל?')),
    h('div', { class: 'options' }, buttons), fb);
  return out;
}

function viewItem(ctx, items, id) {
  const it = items.find((x) => x.id === id);
  if (!it) {
    title('בחירת שיטה');
    return ctx.show(h('h1', {}, 'השאלה לא נמצאה'), h('p', {}, h('a', { class: 'btn primary', href: '#/methods' }, 'לרשימה')));
  }
  title(it.id);
  const next = items[(items.indexOf(it) + 1) % items.length];
  ctx.show(crumbs('#/methods', '→ בחירת שיטה'),
    h('h1', {}, KIND_LABEL[it.kind] || 'בחירת שיטה'),
    questionView(it, ctx.rnd || Math.random, (ok) => recordMethod(it.id, ok), () =>
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => viewItem(ctx, items, id) }, 'נסו שוב'),
        next && next.id !== it.id ? h('a', { class: 'btn primary', href: `#/methods/${next.id}` }, 'השאלה הבאה ←') : null,
        h('a', { class: 'btn', href: '#/methods' }, 'לרשימה'))));
}

function viewRound(ctx, items) {
  title('סבב מהיר');
  const picked = pickRound(items, ROUND_SIZE, ctx.rnd || Math.random);
  let i = 0, score = 0;
  const draw = () => {
    if (i >= picked.length) {
      return ctx.show(crumbs('#/methods', '→ בחירת שיטה'), h('h1', {}, 'סיום הסבב'),
        h('div', { class: score === picked.length ? 'feedback ok' : 'feedback bad', role: 'status' }, `${score} מתוך ${picked.length} נכונות.`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => viewRound(ctx, items) }, 'סבב נוסף'),
          h('a', { class: 'btn', href: '#/methods' }, 'לרשימה')));
    }
    const it = picked[i];
    ctx.show(crumbs('#/methods', '→ בחירת שיטה'),
      h('h1', {}, `שאלה ${i + 1} מתוך ${picked.length}`),
      questionView(it, ctx.rnd || Math.random, (ok) => { recordMethod(it.id, ok); if (ok) score++; }, () =>
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => { i++; draw(); } }, i + 1 < picked.length ? 'השאלה הבאה ←' : 'לסיכום'))));
  };
  draw();
}

export async function viewMethodsRoute(ctx, id) {
  const items = await loadItems(ctx);
  if (!items) {
    title('בחירת שיטה');
    return ctx.show(h('h1', {}, 'בחירת שיטה'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את השאלות. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  if (id === 'round') return viewRound(ctx, items);
  return id ? viewItem(ctx, items, id) : viewList(ctx, items);
}
