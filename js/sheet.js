// Formula sheet overlay, worked examples and the guided stepper (DOM part).
import { h } from './dom.js';
import { sanitizeHtml } from './sanitize.js';
import { cleanExamples, cleanFormulas, revealNext } from './examples.js';
import { validGuided, startGuided, pick, feedback, next, retry, progress, answered } from './guided.js';

let formulas = {};
let examples = [];

async function getJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

/** Both files may be missing or empty: the views then show a "coming soon" note. */
export async function loadExtras() {
  const [f, e] = await Promise.all([getJson('data/formulas.json'), getJson('data/examples.json')]);
  formulas = cleanFormulas(f);
  examples = cleanExamples(e);
}

const safe = (html) => ({ rawhtml: sanitizeHtml(String(html ?? '')) });

/* ---------- formula sheet ---------- */
function topicSheet(id, t) {
  return h('section', { class: 'sheet-topic' },
    h('h3', {}, t.title),
    t.sections.map((s) => h('div', { class: 'sheet-section' },
      s.heading ? h('h4', {}, s.heading) : null,
      h('ul', { class: 'sheet-items' }, s.items.map((it) => h('li', {},
        it.label ? h('span', { class: 'sheet-label' }, it.label, ' ') : null,
        h('span', { class: 'sheet-formula', dir: 'ltr', ...safe(it.formula) }),
        it.note ? h('div', { class: 'muted sheet-note', ...safe(it.note) }) : null))))),
    t.mistakes.length ? h('details', { class: 'sheet-mistakes' },
      h('summary', {}, 'טעויות נפוצות'),
      h('ul', {}, t.mistakes.map((m) => h('li', { ...safe(m) })))) : null);
}

export function openFormulaSheet(topicId, opener) {
  const ids = Object.keys(formulas);
  const order = topicId && formulas[topicId] ? [topicId, ...ids.filter((i) => i !== topicId)] : ids;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (opener && opener.focus) opener.focus();
  };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const closeBtn = h('button', { class: 'btn', type: 'button', onclick: close }, 'סגור');
  const panel = h('div', { class: 'overlay-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-h' },
    h('div', { class: 'overlay-head' }, h('h2', { id: 'sheet-h' }, 'דף נוסחאות'), closeBtn),
    order.length ? order.map((id) => topicSheet(id, formulas[id]))
      : h('p', { class: 'muted' }, 'דף הנוסחאות יתווסף בקרוב.'));
  const overlay = h('div', { class: 'overlay', onclick: (ev) => { if (ev.target === overlay) close(); } }, panel);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  closeBtn.focus();
}

export function formulaButton(topicId) {
  const btn = h('button', { class: 'btn', type: 'button', onclick: () => openFormulaSheet(topicId, btn) }, '📐 דף נוסחאות');
  return btn;
}

/* ---------- worked examples ---------- */
export function examplesSection(topicId) {
  const list = examples.filter((e) => e.topic === topicId);
  const box = h('div', { class: 'examples-list' });
  let openId = null;
  const shownSteps = {};
  function render() {
    box.replaceChildren(...list.map((ex) => {
      const open = openId === ex.id;
      const head = h('button', {
        class: 'btn example-head', type: 'button', 'aria-expanded': String(open),
        onclick: () => { openId = open ? null : ex.id; render(); },
      }, ex.title);
      if (!open) return h('div', { class: 'example' }, head);
      const shown = shownSteps[ex.id] || 0;
      return h('div', { class: 'example open' }, head,
        h('div', { class: 'panel' },
          h('div', { class: 'example-problem', ...safe(ex.problem) }),
          h('ol', { class: 'steps' }, ex.steps.slice(0, shown).map((s) => h('li', { steps: s }))),
          shown < ex.steps.length
            ? h('button', {
              class: 'btn primary', type: 'button',
              onclick: () => { shownSteps[ex.id] = revealNext(shown, ex.steps.length); render(); },
            }, shown === 0 ? 'הצג צעד ראשון' : 'הצעד הבא')
            : (ex.takeaway ? h('p', { class: 'notice' }, h('strong', {}, 'לזכור: '), h('span', { ...safe(ex.takeaway) })) : null)));
    }));
  }
  render();
  return h('details', { class: 'examples' },
    h('summary', {}, 'דוגמאות פתורות'),
    list.length ? box : h('p', { class: 'muted' }, 'דוגמאות פתורות יתווספו בקרוב.'));
}

/* ---------- guided stepper ---------- */
/** Returns null when the exercise has no valid guided steps. onUse() fires when the stepper is first opened. */
export function guidedStepper(steps, onUse) {
  if (!validGuided(steps)) return null;
  const box = h('div', { class: 'guided' });
  let state = null;
  function render() {
    if (!state) {
      box.replaceChildren(h('button', {
        class: 'btn', type: 'button',
        onclick: () => { state = startGuided(); onUse(); render(); box.querySelector('button, .guided-opt')?.focus(); },
      }, '🧭 פתרו אותי צעד צעד'));
      return;
    }
    const close = h('button', { class: 'btn', type: 'button', onclick: () => { state = null; render(); } }, 'סגור');
    if (state.done) {
      box.replaceChildren(h('div', { class: 'panel' },
        h('h2', {}, 'סיימתם את המדריך'),
        h('p', {}, state.mistakes ? `היו ${state.mistakes} טעויות בדרך, וזה בסדר.` : 'כל השלבים נכונים!'),
        h('p', { class: 'muted' }, 'סיום המדריך לא נחשב כפתרון. הזינו את התשובה בשדות למעלה ולחצו ״בדוק״.'),
        close));
      return;
    }
    const step = steps[state.i];
    const fb = feedback(state, steps);
    const p = progress(state, steps);
    const opts = step.options.map((o, i) => {
      const cls = fb ? (i === fb.correct ? ' right' : i === fb.choice ? ' wrong' : '') : '';
      return h('button', {
        class: 'btn guided-opt' + cls, type: 'button', disabled: !!fb,
        onclick: () => { state = pick(state, steps, i); render(); box.querySelector('.guided-fb')?.focus(); },
      }, h('span', { ...safe(o) }));
    });
    const fbNode = fb ? h('div', { class: `feedback guided-fb ${fb.ok ? 'ok' : 'bad'}`, tabindex: '-1', role: 'status' },
      fb.ok ? 'נכון! ' : 'לא מדויק. ',
      fb.why ? h('div', { steps: fb.why }) : null,
      !fb.ok && fb.explain ? h('div', {}, h('span', { ...safe('התשובה הנכונה: ' + step.options[fb.correct]) }), ' – ', h('div', { steps: fb.explain })) : null) : null;
    box.replaceChildren(h('div', { class: 'panel' },
      h('div', { class: 'muted' }, `צעד ${p.current} מתוך ${p.total}`),
      h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round(((state.i + (fb ? 1 : 0)) / p.total) * 100)}%` })),
      h('h3', {}, h('span', { ...safe(step.q) })),
      h('div', { class: 'guided-opts' }, opts),
      fbNode,
      h('div', { class: 'btn-row' },
        fb && !fb.ok ? h('button', { class: 'btn', type: 'button', onclick: () => { state = retry(state, steps); render(); } }, 'נסו שוב') : null,
        fb ? h('button', { class: 'btn primary', type: 'button', onclick: () => { state = next(state, steps); render(); } },
          state.i + 1 >= steps.length ? 'סיום' : 'לצעד הבא') : null,
        close)));
  }
  render();
  return box;
}
