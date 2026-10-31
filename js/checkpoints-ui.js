// Intermediate-step checkpoints: list (#/checkpoints) and one exercise (#/checkpoints/<id>).
// The learner enters each intermediate result in order (immediate right/wrong, hint after the first miss),
// then the final answer, then sees which steps were missed. Attempts live in their own storage key and
// are kept separate from the review queue / mastery data (progress.js has no per-step API).
import { h } from './dom.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';
import { isCorrect } from './check.js';

export const CP_KEY = 'omri-study-checkpoints-v1';
export const REVEAL_AFTER = 2; // misses before "show the answer and continue" appears
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/* ---------- storage: { v:1, items: { id: { runs, perfect, missed:[stepIndex], ts } } } ---------- */
export function sanitizeCheckpoints(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e)) continue;
    out.items[id] = {
      runs: Number.isFinite(e.runs) && e.runs > 0 ? Math.floor(e.runs) : 1,
      perfect: e.perfect === true,
      missed: Array.isArray(e.missed) ? e.missed.filter((n) => Number.isInteger(n) && n >= 0 && n < 10) : [],
      ts: Number.isFinite(e.ts) ? e.ts : 0,
    };
  }
  return out;
}
export function loadCheckpoints() {
  try { return sanitizeCheckpoints(JSON.parse(localStorage.getItem(CP_KEY))); } catch (e) { return sanitizeCheckpoints(null); }
}
/** `missed` = indices of steps (final = last) with a wrong try or a revealed answer in this run. */
export function recordCheckpoints(id, missed) {
  const d = loadCheckpoints();
  const prev = d.items[id];
  d.items[id] = {
    runs: (prev ? prev.runs : 0) + 1,
    perfect: missed.length === 0 || !!(prev && prev.perfect),
    missed,
    ts: Date.now(),
  };
  try { localStorage.setItem(CP_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}

/* ---------- data ---------- */
let loaded = null;
async function loadItems(ctx) {
  if (Array.isArray(ctx.checkpoints)) return ctx.checkpoints;
  if (!loaded) {
    try {
      const res = await fetch('data/checkpoints.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      loaded = Array.isArray(data.items) ? data.items : [];
    } catch (e) { return null; }
  }
  return loaded;
}

const GROUPS = [['math', '🧮 מערכות משוואות'], ['phys', '🚀 תנועה אנכית ואופקית']];
const stepsOf = (it) => [...it.checkpoints, { ...it.final, isFinal: true }];

function viewList(ctx, items) {
  document.title = 'נקודות ביניים – Brain Gains';
  const done = loadCheckpoints().items;
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית')),
    h('h1', {}, '🎯 נקודות ביניים'),
    h('p', { class: 'muted' }, 'פותרים תרגיל צעד אחר צעד: בכל שלב מזינים תוצאת ביניים ומקבלים משוב מיד. בסוף רואים באילו שלבים נתקעתם.'),
    GROUPS.flatMap(([prefix, title]) => {
      const list = items.filter((it) => String(it.topic).startsWith(prefix));
      return [h('h2', {}, title),
        h('ul', { class: 'ex-list' }, list.map((it) => {
          const d = done[it.id];
          return h('li', {}, h('a', { class: 'ex-item', href: `#/checkpoints/${it.id}` },
            h('span', {}, isolateTitle(it.title || it.id)),
            h('span', { class: d ? '' : 'muted' }, d ? (d.missed.length ? '✔ הושלם' : '✅ בלי טעויות') : 'טרם נוסה')));
        }))];
    }));
}

function viewItem(ctx, items, id) {
  const it = items.find((x) => x.id === id);
  if (!it) {
    document.title = 'נקודות ביניים – Brain Gains';
    return ctx.show(h('h1', {}, 'התרגיל לא נמצא'),
      h('p', {}, h('a', { class: 'btn primary', href: '#/checkpoints' }, 'לרשימת התרגילים')));
  }
  document.title = `${it.title || it.id} – נקודות ביניים – Brain Gains`;
  const steps = stepsOf(it);
  const state = steps.map(() => ({ misses: 0, revealed: false, passed: false }));
  let idx = 0;
  const body = h('div');

  const missedList = () => state.map((s, i) => (s.misses > 0 || s.revealed ? i : -1)).filter((i) => i >= 0);

  function draw() {
    const rows = steps.slice(0, idx).map((st, i) => {
      const s = state[i];
      return h('li', { class: `solution-row ${s.revealed || s.misses ? 'wrong' : 'right'}` },
        h('span', {}, st.label), ' ',
        h('strong', {}, ltrIsolate(String(st.answer))), ' ',
        h('span', { role: 'img', 'aria-label': s.revealed ? 'הוצגה התשובה' : s.misses ? 'נכון אחרי טעויות' : 'נכון בניסיון ראשון' },
          s.revealed ? '👀' : s.misses ? '✔' : '✅'));
    });
    const parts = [rows.length ? h('ol', { class: 'cp-done' }, rows) : null];
    if (idx < steps.length) parts.push(stepForm(idx));
    else parts.push(summary());
    body.replaceChildren(...parts.filter(Boolean));
  }

  function stepForm(i) {
    const st = steps[i], s = state[i];
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', id: 'cp-input', 'aria-label': st.label });
    const msg = h('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    const hint = h('div', { class: 'notice' }, h('strong', {}, 'רמז: '), st.hint || '');
    hint.hidden = s.misses < 1;
    const reveal = h('button', { class: 'btn', type: 'button', onclick: () => { s.revealed = true; idx++; draw(); } }, 'הציגו תשובה והמשיכו');
    reveal.hidden = s.misses < REVEAL_AFTER;
    const form = h('form', {
      class: 'field', novalidate: true,
      onsubmit: (ev) => {
        ev.preventDefault();
        if (isCorrect(input.value, st.answer, st.tolerance)) { s.passed = true; idx++; draw(); return; }
        s.misses++;
        msg.className = 'feedback bad';
        msg.textContent = 'לא מדויק. בדקו את החישוב ונסו שוב.';
        form.classList.toggle('wrong', true);
        hint.hidden = false;
        reveal.hidden = s.misses < REVEAL_AFTER;
      },
    },
    h('label', { for: 'cp-input' }, st.isFinal ? `תשובה סופית: ${st.label}` : `שלב ${i + 1} מתוך ${steps.length - 1}: ${st.label}`),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'בדיקה')),
    msg, hint, h('div', { class: 'btn-row' }, reveal));
    return form;
  }

  function summary() {
    const missed = missedList();
    recordCheckpoints(id, missed);
    const list = missed.length
      ? h('div', { class: 'panel' }, h('strong', {}, 'שלבים שדרשו חזרה:'),
        h('ul', {}, missed.map((i) => h('li', {}, `${steps[i].isFinal ? 'תשובה סופית' : 'שלב ' + (i + 1)}: ${steps[i].label}`,
          state[i].revealed ? ' (הוצגה התשובה)' : ` (${state[i].misses} ניסיונות שגויים)`))))
      : null;
    const pos = items.findIndex((x) => x.id === id);
    const next = items[(pos + 1) % items.length];
    return h('div', {},
      h('div', { class: missed.length ? 'feedback bad' : 'feedback ok', role: 'status' },
        missed.length ? `סיימתם. ${missed.length} מתוך ${steps.length} שלבים דרשו חזרה.` : 'מושלם! כל השלבים נכונים בניסיון הראשון. 🎉'),
      list,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => viewItem(ctx, items, id) }, 'נסו שוב'),
        next && next.id !== id ? h('a', { class: 'btn primary', href: `#/checkpoints/${next.id}` }, 'התרגיל הבא ←') : null,
        h('a', { class: 'btn', href: '#/checkpoints' }, 'לרשימת התרגילים')));
  }

  draw();
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/checkpoints' }, '→ נקודות ביניים')),
    h('h1', {}, isolateTitle(it.title || it.id)),
    h('div', { class: 'panel statement' },
      h('p', {}, isolateFormulas(it.statement)),
      (it.equations || []).length ? h('div', { class: 'cp-eqs' }, it.equations.map((q) => h('div', { dir: 'ltr' }, ltrIsolate(q)))) : null),
    body);
}

export async function viewCheckpointsRoute(ctx, id) {
  const items = await loadItems(ctx);
  if (!items) {
    document.title = 'נקודות ביניים – Brain Gains';
    return ctx.show(h('h1', {}, 'נקודות ביניים'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  return id ? viewItem(ctx, items, id) : viewList(ctx, items);
}
