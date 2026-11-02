// Fading worked examples: the same worked solution in four stages, from fully shown to fully hidden.
// #/fading lists the examples with a 4-stage mark, #/fading/<exampleId> runs one example.
//   1 read the full solution and tap "understood"; 2 one key step is hidden; 3 about half of the key steps are hidden;
//   4 only the question is shown and every key value is entered in order.
// Examples come from data/examples.json (unchanged); data/fading.json says which steps are key steps and what
// checkable value each one has. Stage completion lives in its own storage key.
import { h } from './dom.js';
import { safeSetItem } from './storage.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';
import { isCorrect } from './check.js';
import { sanitizeHtml } from './sanitize.js';
import { cleanExamples } from './examples.js';

export const FADING_KEY = 'omri-study-fading-v1';
export const STAGES = [1, 2, 3, 4];
const MISSES_TO_REVEAL = 2;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonneg = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Indexes (into the keyed-step list) hidden at a stage: none, the middle one, every second one, all. */
export function hiddenKeys(keys, stage) {
  const n = keys.length;
  const all = keys.map((_, i) => i);
  if (stage === 1) return [];
  if (stage === 2) return n ? [Math.floor((n - 1) / 2)] : [];
  if (stage === 3) return all.filter((i) => i % 2 === 0);
  return all;
}

/* ---------- storage: { v:1, items: { id: { done:[b,b,b,b], revealed:[n,n,n,n], ts } } } ---------- */
const blank = () => ({ done: [false, false, false, false], revealed: [0, 0, 0, 0], ts: 0 });
export function sanitizeFading(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e)) continue;
    const rec = blank();
    for (let i = 0; i < 4; i++) {
      // a stage only counts when every earlier stage is done (stages unlock in order)
      rec.done[i] = Array.isArray(e.done) && e.done[i] === true && (i === 0 || rec.done[i - 1]);
      rec.revealed[i] = Array.isArray(e.revealed) ? nonneg(e.revealed[i]) : 0;
    }
    rec.ts = Number.isFinite(e.ts) ? e.ts : 0;
    out.items[id] = rec;
  }
  return out;
}
export function loadFading() {
  try { return sanitizeFading(JSON.parse(localStorage.getItem(FADING_KEY))); } catch (e) { return sanitizeFading(null); }
}
/** Marks one stage (1..4) of an example done; `revealed` counts the answers shown instead of typed. */
export function recordStage(id, stage, revealed = 0) {
  const d = loadFading();
  const rec = d.items[id] || blank();
  const i = stage - 1;
  if (i < 0 || i > 3 || (i > 0 && !rec.done[i - 1])) return;
  rec.done[i] = true;
  rec.revealed[i] = nonneg(revealed);
  rec.ts = Date.now();
  d.items[id] = rec;
  safeSetItem(FADING_KEY, JSON.stringify(d));
}
const doneCount = (rec) => (rec ? rec.done.filter(Boolean).length : 0);

/* ---------- data ---------- */
let loaded = null;
async function loadData(ctx) {
  if (ctx.fading && Array.isArray(ctx.fadingExamples)) return { keys: ctx.fading, examples: ctx.fadingExamples };
  if (!loaded) {
    try {
      const get = async (f) => { const r = await fetch(f, { cache: 'no-cache' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
      const [ex, fd] = await Promise.all([get('data/examples.json'), get('data/fading.json')]);
      loaded = { keys: isRec(fd.examples) ? fd.examples : {}, examples: cleanExamples(ex) };
    } catch (e) { return null; }
  }
  return loaded;
}

const safe = (html) => ({ rawhtml: sanitizeHtml(String(html ?? '')) });
const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };
const fmt = (n) => String(n).replace('-', '−');
const STAGE_NAMES = ['פתרון מלא', 'מוסתר שלב מרכזי אחד', 'מוסתרים כחצי מהשלבים', 'רק השאלה'];
const marks = (rec) => STAGES.map((s) => (rec && rec.done[s - 1] ? '●' : '○')).join(' ');

function viewList(ctx, data) {
  title('דוגמאות מתפוגגות');
  const recs = loadFading().items;
  const list = data.examples.filter((e) => Array.isArray(data.keys[e.id]));
  const total = list.reduce((n, e) => n + doneCount(recs[e.id]), 0);
  ctx.show(
    crumbs('#/practice-hub', '→ חזרה לתרגול'),
    h('h1', {}, '🌓 דוגמאות מתפוגגות'),
    h('p', { class: 'muted' }, 'אותה דוגמה פתורה בארבעה שלבים: קוראים פתרון מלא, ואז מסתירים בהדרגה שלבים עד שפותרים לבד. כל שלב נפתח אחרי השלמת הקודם.'),
    h('div', { class: 'panel' }, h('strong', {}, `${total} מתוך ${list.length * 4} שלבים הושלמו`)),
    h('ul', { class: 'ex-list' }, list.map((e) => h('li', {}, h('a', { class: 'ex-item', href: `#/fading/${e.id}` },
      h('span', { class: 't' }, isolateTitle(e.title)),
      h('span', { class: doneCount(recs[e.id]) ? '' : 'muted', dir: 'ltr', role: 'img', 'aria-label': `${doneCount(recs[e.id])} מתוך 4 שלבים` }, ltrIsolate(marks(recs[e.id]))))))));
}

/** One typed key value: immediate feedback, reveal after two misses. onResolve(revealed) fires once. */
function askWidget(ask, idx, onResolve) {
  let misses = 0;
  let resolved = false;
  const input = h('input', { type: 'text', id: `fd-${idx}`, inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const fb = h('div', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const reveal = h('button', { class: 'btn', type: 'button', onclick: () => finish(true) }, 'הצגת התשובה');
  reveal.hidden = true;
  const check = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, 'בדיקה');
  const box = h('div', { class: 'field' },
    h('label', { for: `fd-${idx}` }, isolateFormulas(ask.label), ' ='),
    h('div', { class: 'row' }, input, check, reveal), fb);
  function finish(revealed) {
    if (resolved) return;
    resolved = true;
    input.value = fmt(ask.value);
    input.disabled = true; check.disabled = true; reveal.hidden = true;
    box.className = revealed ? 'field wrong' : 'field right';
    fb.replaceChildren(document.createTextNode(revealed ? `התשובה: ${ltrIsolate(fmt(ask.value))}` : '✓ נכון'));
    onResolve(revealed);
  }
  function submit() {
    if (resolved) return;
    if (isCorrect(input.value, ask.value, ask.tolerance ?? 0.01)) return finish(false);
    misses++;
    fb.replaceChildren(document.createTextNode(misses >= MISSES_TO_REVEAL ? 'לא מדויק. אפשר לנסות שוב או להציג את התשובה.' : 'לא מדויק, נסו שוב.'));
    reveal.hidden = misses < MISSES_TO_REVEAL;
  }
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
  return { box, input, setEnabled(on) { if (!resolved) { input.disabled = !on; check.disabled = !on; } }, get resolved() { return resolved; } };
}

function viewExample(ctx, data, id) {
  const ex = data.examples.find((e) => e.id === id);
  const keys = ex && data.keys[id];
  if (!ex || !Array.isArray(keys)) {
    title('דוגמאות מתפוגגות');
    return ctx.show(h('h1', {}, 'הדוגמה לא נמצאה'), h('p', {}, h('a', { class: 'btn primary', href: '#/fading' }, 'לרשימה')));
  }
  title(ex.title);
  const rec0 = loadFading().items[id] || blank();
  let stage = Math.min(4, doneCount(rec0) + 1); // first unfinished stage
  const tabs = h('div', { class: 'btn-row', role: 'tablist' });
  const body = h('div', {});

  function renderTabs() {
    const rec = loadFading().items[id] || blank();
    tabs.replaceChildren(...STAGES.map((s) => {
      const unlocked = s === 1 || rec.done[s - 2];
      return h('button', {
        class: s === stage ? 'btn primary' : 'btn', type: 'button', role: 'tab', 'aria-selected': s === stage ? 'true' : 'false', disabled: !unlocked,
        onclick: () => { stage = s; renderTabs(); renderStage(); },
      }, `${rec.done[s - 1] ? '✅ ' : unlocked ? '' : '🔒 '}שלב ${s}`);
    }));
  }

  function renderStage() {
    const hidden = new Set(hiddenKeys(keys, stage));
    const hiddenSteps = new Map(); // step index -> key index
    hidden.forEach((ki) => hiddenSteps.set(keys[ki].step, ki));
    const widgets = [];
    let revealedCount = 0;
    const done = h('div', {});

    const finishStage = () => {
      recordStage(id, stage, revealedCount);
      renderTabs();
      done.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, `שלב ${stage} הושלם${revealedCount ? ' (חלק מהתשובות הוצגו, כדאי לחזור לשלב הזה)' : ''}.`),
        h('div', { class: 'btn-row' },
          stage < 4 ? h('button', { class: 'btn primary', type: 'button', onclick: () => { stage++; renderTabs(); renderStage(); } }, `לשלב ${stage + 1} ←`)
            : h('a', { class: 'btn primary', href: '#/fading' }, 'סיימתם את כל השלבים · לרשימה'),
          h('a', { class: 'btn', href: '#/fading' }, 'לרשימה')));
    };
    const onResolve = (revealed) => {
      if (revealed) revealedCount++;
      const next = widgets.find((w) => !w.resolved);
      if (next) next.setEnabled(true); else finishStage();
    };
    const mkAsk = (a) => { const w = askWidget(a, widgets.length, onResolve); widgets.push(w); return w; };

    const head = [h('p', { class: 'muted' }, `${STAGE_NAMES[stage - 1]}.`), h('div', { class: 'panel example-problem', ...safe(ex.problem) })];
    let content;
    if (stage === 1) {
      content = [h('ol', { class: 'steps' }, ex.steps.map((s) => h('li', { steps: s }))),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: finishStage }, 'הבנתי'))];
    } else if (stage < 4) {
      content = [h('ol', { class: 'steps' }, ex.steps.map((s, i) => {
        if (!hiddenSteps.has(i)) return h('li', { steps: s });
        const ki = hiddenSteps.get(i);
        return h('li', {}, h('div', { class: 'panel' }, h('strong', {}, 'שלב מוסתר: '), 'חשבו את התוצאה והזינו אותה.',
          keys[ki].asks.map(mkAsk).map((w) => w.box)));
      }))];
    } else {
      content = [h('p', {}, 'הזינו את תוצאות הביניים המרכזיות לפי סדר הפתרון, ובסוף את התשובה הסופית.'),
        keys.map((k, ki) => h('div', { class: 'panel' },
          h('strong', {}, k.final ? 'תשובה סופית' : `תוצאת ביניים ${ki + 1}`), k.asks.map(mkAsk).map((w) => w.box)))];
      widgets.forEach((w, i) => { if (i > 0) w.setEnabled(false); });
    }
    body.replaceChildren(...head, ...content.flat(), done);
  }

  renderTabs();
  renderStage();
  ctx.show(crumbs('#/fading', '→ דוגמאות מתפוגגות'), h('h1', {}, isolateTitle(ex.title)), tabs, body);
}

export async function viewFadingRoute(ctx, id) {
  const data = await loadData(ctx);
  if (!data) {
    title('דוגמאות מתפוגגות');
    return ctx.show(h('h1', {}, 'דוגמאות מתפוגגות'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את הדוגמאות. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  return id ? viewExample(ctx, data, id) : viewList(ctx, data);
}
