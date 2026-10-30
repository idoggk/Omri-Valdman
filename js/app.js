import { checkAll } from './check.js';
import * as store from './store.js';

const TOPICS = [
  { id: 'math-3', title: 'מערכת משוואות עם 3 נעלמים', file: 'math' },
  { id: 'math-4', title: 'מערכת משוואות עם 4 נעלמים', file: 'math' },
  { id: 'phys-vertical', title: 'תנועה אנכית', file: 'physics' },
  { id: 'phys-horizontal', title: 'תנועה אופקית', file: 'physics' },
];
const FILES = ['math', 'physics'];

const app = document.getElementById('app');
let exercises = []; // flat list, file order preserved
let loadErrors = [];

/* ---------- helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}
const topicOf = (id) => TOPICS.find((t) => t.id === id);
const inTopic = (id) => exercises.filter((e) => e.topic === id);
const byId = (id) => exercises.find((e) => e.id === id);
const ltr = (text) => h('span', { dir: 'ltr' }, text);

function show(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function badge(level) {
  return h('span', { class: `badge l${level}` }, `רמה ${level}`);
}

function validExercise(e) {
  return e && typeof e.id === 'string' && typeof e.topic === 'string' &&
    (Array.isArray(e.inputs) || (e.choice && Array.isArray(e.choice.options)));
}

async function loadData() {
  const results = await Promise.all(FILES.map(async (f) => {
    try {
      const res = await fetch(`data/${f}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('not an array');
      return arr.filter(validExercise);
    } catch (err) {
      loadErrors.push(f);
      return [];
    }
  }));
  exercises = results.flat();
}

/* ---------- views ---------- */
function viewHome() {
  document.title = 'תרגול למבחן – מתמטיקה ופיזיקה';
  const cards = TOPICS.map((t) => {
    const list = inTopic(t.id);
    const done = store.countDone(list.map((e) => e.id));
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    return h('a', { class: 'card', href: `#/topic/${t.id}` },
      h('strong', {}, t.title),
      h('span', { class: 'muted' }, `${list.length} תרגילים · הושלמו ${done}`),
      h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` })));
  });
  show(
    h('h1', {}, 'במה נתרגל היום?'),
    h('p', { class: 'muted' }, 'בחרו נושא, פתרו תרגילים ובדקו את עצמכם. רמזים ופתרון מלא זמינים בכל תרגיל.'),
    loadErrors.length ? h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון חלק מקבצי התרגילים. נסו לרענן את הדף.') : null,
    h('div', { class: 'cards' }, cards));
}

function viewTopic(topicId, levelFilter = 0) {
  const topic = topicOf(topicId);
  if (!topic) return viewNotFound();
  document.title = `${topic.title} – תרגול למבחן`;
  const list = inTopic(topicId);
  const shown = levelFilter ? list.filter((e) => e.level === levelFilter) : list;

  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'סינון לפי רמה' },
    [[0, 'הכול'], [1, 'רמה 1'], [2, 'רמה 2'], [3, 'רמה 3']].map(([lv, label]) =>
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(lv === levelFilter),
        onclick: () => viewTopic(topicId, lv),
      }, label)));

  const items = shown.map((e) =>
    h('li', {}, h('a', { class: 'ex-item', href: `#/ex/${e.id}` },
      badge(e.level),
      h('span', { class: 't' }, e.title || e.id),
      store.isDone(e.id)
        ? h('span', { class: 'tick', role: 'img', 'aria-label': 'הושלם' }, '✓')
        : h('span', { class: 'tick', 'aria-hidden': 'true' }))));

  show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לנושאים')),
    h('h1', {}, topic.title),
    topicId.startsWith('phys-')
      ? h('p', { class: 'notice' }, 'בתרגילי הפיזיקה נקח ', ltr('g = 10 m/s²'), '.') : null,
    filters,
    items.length ? h('ul', { class: 'ex-list' }, items)
      : h('p', { class: 'muted' }, list.length ? 'אין תרגילים ברמה הזו.' : 'עדיין אין תרגילים בנושא הזה.'));
}

function viewExercise(id) {
  const ex = byId(id);
  if (!ex) return viewNotFound();
  const topic = topicOf(ex.topic);
  document.title = `${ex.title || ex.id} – תרגול למבחן`;
  const siblings = inTopic(ex.topic);
  const idx = siblings.indexOf(ex);
  const prev = siblings[idx - 1];
  const next = siblings[idx + 1];

  const tips = Array.isArray(ex.tips) ? ex.tips.slice(0, 3) : [];
  const solution = Array.isArray(ex.solution) ? ex.solution : [];
  const isChoice = !!(ex.choice && Array.isArray(ex.choice.options));

  /* answer area */
  let answerArea;
  let readValues;
  const fieldEls = [];
  if (isChoice) {
    const name = 'choice-' + ex.id;
    const radios = ex.choice.options.map((opt, i) => {
      const input = h('input', { type: 'radio', name, value: String(i) });
      return { input, label: h('label', {}, input, h('span', { html: String(opt) })) };
    });
    answerArea = h('fieldset', { class: 'options' },
      h('legend', { class: 'muted' }, 'בחרו תשובה'), radios.map((r) => r.label));
    readValues = () => radios.findIndex((r) => r.input.checked);
  } else {
    const fields = ex.inputs.map((spec, i) => {
      const inputId = `in-${i}`;
      const input = h('input', {
        type: 'text', id: inputId, inputmode: 'decimal', autocomplete: 'off',
        autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
      });
      const wrap = h('div', { class: 'field' },
        h('label', { for: inputId }, ltr(spec.label || `תשובה ${i + 1}`), ' ='),
        h('div', { class: 'row' }, input, spec.unit ? h('span', { class: 'unit' }, spec.unit) : null));
      fieldEls.push({ wrap, input });
      return wrap;
    });
    answerArea = h('div', { class: 'fields' }, fields);
    readValues = () => fieldEls.map((f) => f.input.value);
  }

  /* feedback */
  const feedback = h('div', { 'aria-live': 'polite' });
  const setFeedback = (kind, text) => {
    feedback.replaceChildren(h('div', { class: `feedback ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, text));
  };

  function check() {
    fieldEls.forEach((f) => f.wrap.classList.remove('wrong', 'right'));
    if (isChoice) {
      const v = readValues();
      if (v < 0) return setFeedback('bad', 'בחרו תשובה לפני הבדיקה.');
      if (v === ex.choice.correct) { store.markDone(ex.id); return setFeedback('ok', 'נכון! כל הכבוד 🎉'); }
      return setFeedback('bad', 'לא מדויק. נסו שוב, אפשר להיעזר ברמז.');
    }
    const values = readValues();
    if (values.every((v) => v.trim() === '')) return setFeedback('bad', 'הזינו תשובה לפני הבדיקה.');
    const res = checkAll(values, ex.inputs);
    res.forEach((ok, i) => fieldEls[i].wrap.classList.add(ok ? 'right' : 'wrong'));
    if (res.every(Boolean)) { store.markDone(ex.id); return setFeedback('ok', 'נכון! כל הכבוד 🎉'); }
    const wrongNames = ex.inputs.map((s, i) => (res[i] ? null : (s.label || `תשובה ${i + 1}`))).filter(Boolean);
    feedback.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' },
      'יש טעות ב: ', wrongNames.map((n, i) => [i ? ', ' : '', ltr(n)]), '. בדקו ונסו שוב.'));
  }

  /* tips: must open in order */
  const tipList = h('ul', { class: 'tips', 'aria-live': 'polite' });
  const tipButtons = tips.map((_, i) => h('button', {
    class: 'btn', type: 'button', onclick: () => openTip(i + 1),
  }, `רמז ${i + 1}`));
  function renderTips() {
    const used = Math.min(store.getTipsUsed(ex.id), tips.length);
    tipList.replaceChildren(...tips.slice(0, used).map((t, i) =>
      h('li', {}, h('strong', {}, `רמז ${i + 1}: `), h('span', { html: t }))));
    tipButtons.forEach((b, i) => {
      b.disabled = i !== used; // only the next tip is available
      b.setAttribute('aria-disabled', String(b.disabled));
    });
  }
  function openTip(n) {
    if (n !== Math.min(store.getTipsUsed(ex.id), tips.length) + 1) return;
    store.setTipsUsed(ex.id, n);
    renderTips();
  }

  /* solution with in-page confirmation */
  const solutionBox = h('div');
  function showConfirm() {
    solutionBox.replaceChildren(h('div', { class: 'panel confirm', role: 'alertdialog', 'aria-label': 'אישור הצגת פתרון' },
      h('p', {}, 'בטוחים שרוצים לראות את הפתרון המלא? כדאי קודם לנסות עם הרמזים.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: showSolution }, 'כן, הצג פתרון'),
        h('button', { class: 'btn', type: 'button', onclick: () => { solutionBox.replaceChildren(); solutionBtn.focus(); } }, 'ביטול'))));
    solutionBox.querySelector('button').focus();
  }
  function showSolution() {
    store.setTipsUsed(ex.id, tips.length);
    renderTips();
    solutionBox.replaceChildren(h('div', { class: 'panel' },
      h('h2', {}, 'פתרון מלא'),
      h('ol', { class: 'steps' }, solution.map((s) => h('li', { html: s })))));
  }
  const solutionBtn = h('button', { class: 'btn', type: 'button', onclick: showConfirm }, 'הצג פתרון מלא');

  const form = h('form', { onsubmit: (ev) => { ev.preventDefault(); check(); } },
    answerArea,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'בדוק')),
    feedback);

  renderTips();
  show(
    h('p', { class: 'crumbs' }, h('a', { href: `#/topic/${ex.topic}` }, `→ ${topic ? topic.title : 'חזרה'}`)),
    h('h1', {}, ex.title || ex.id, ' ', badge(ex.level)),
    ex.topic.startsWith('phys-') ? h('p', { class: 'muted' }, 'נקח ', ltr('g = 10 m/s²'), '.') : null,
    h('div', { class: 'panel statement', html: ex.statement || '' }),
    form,
    h('h2', {}, 'עזרה'),
    tips.length ? h('div', { class: 'btn-row' }, tipButtons) : h('p', { class: 'muted' }, 'אין רמזים בתרגיל הזה.'),
    tipList,
    solution.length ? h('div', { class: 'btn-row' }, solutionBtn) : null,
    solutionBox,
    h('nav', { class: 'nav', 'aria-label': 'ניווט בין תרגילים' },
      prev ? h('a', { class: 'btn', href: `#/ex/${prev.id}` }, '→ התרגיל הקודם') : h('span'),
      next ? h('a', { class: 'btn primary', href: `#/ex/${next.id}` }, 'התרגיל הבא ←') : h('span')));
}

function viewNotFound() {
  show(h('h1', {}, 'העמוד לא נמצא'), h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
}

/* ---------- router ---------- */
function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  try {
    if (parts[0] === 'topic' && parts[1]) viewTopic(parts[1]);
    else if (parts[0] === 'ex' && parts[1]) viewExercise(parts[1]);
    else if (parts.length === 0) viewHome();
    else viewNotFound();
  } catch (err) {
    show(h('p', { class: 'error', role: 'alert' }, 'אירעה שגיאה בהצגת העמוד.'),
      h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
    console.error(err);
  }
}

window.addEventListener('hashchange', route);
loadData().then(route);
