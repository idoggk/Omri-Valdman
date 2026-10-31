import { checkAll } from './check.js';
import * as store from './store.js';
import { matchSets, validAnswerSets } from './answersets.js';
import { sanitizeSvgSafe as sanitizeSvg } from './sanitize.js';
import { isolateTitle } from './bidi.js';
import { h, ltr } from './dom.js';
import { loadExtras, openFormulaSheet, formulaButton, examplesSection, guidedStepper } from './sheet.js';
import { viewExam } from './exam-ui.js';
import * as practice from './practice-ui.js';
import * as drills from './drills-ui.js';
import * as hunt from './findmistake-ui.js';
import * as backup from './backup.js';

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
const OUTCOME_UI = {
  alone: { icon: '✓', label: 'נפתר לבד' },
  hinted: { icon: '💡', label: 'נפתר עם רמזים' },
  review: { icon: '🔁', label: 'דורש חזרה' },
  none: { icon: '○', label: 'טרם נוסה' },
};
let reviewSeen = new Set(); // exercises already visited in the current review round
const topicOf = (id) => TOPICS.find((t) => t.id === id);
const inTopic = (id) => exercises.filter((e) => e.topic === id);
const byId = (id) => exercises.find((e) => e.id === id);

function show(...nodes) {
  // null/false entries must be dropped: replaceChildren(null) would insert the text "null"
  app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
  window.scrollTo(0, 0);
}

function outcomeIcon(outcome) {
  const ui = OUTCOME_UI[outcome || 'none'];
  return h('span', { class: `tick o-${outcome || 'none'}`, role: 'img', 'aria-label': ui.label }, ui.icon);
}

function badge(level) {
  return h('span', { class: `badge l${level}` }, `רמה ${level}`);
}

function validExercise(e) {
  return e && typeof e.id === 'string' && typeof e.topic === 'string' &&
    (Array.isArray(e.inputs) || validAnswerSets(e.answerSets) || (e.choice && Array.isArray(e.choice.options)));
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
const openSheet = openFormulaSheet;

function viewHome() {
  document.title = 'Brain Gains – תרגול למבחן';
  const cards = TOPICS.map((t) => {
    const list = inTopic(t.id);
    const done = store.countDone(list.map((e) => e.id));
    const pct = list.length ? Math.round((done / list.length) * 100) : 0;
    return h('a', { class: 'card', href: `#/topic/${t.id}` },
      h('strong', {}, t.title),
      h('span', { class: 'muted' }, `${list.length} תרגילים · הושלמו ${done}`),
      h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` })));
  });
  const queue = store.reviewQueue(exercises.map((e) => e.id));
  const reviewCard = h('section', { class: 'card review-card', 'aria-labelledby': 'review-h' },
    h('strong', { id: 'review-h' }, 'חזרה על טעויות'),
    queue.length
      ? [h('span', { class: 'muted' }, `${queue.length} תרגילים לחזרה (נפתרו עם רמזים או עם הצגת פתרון)`),
        h('ul', { class: 'review-list' }, queue.slice(0, 5).map((id) => {
          const ex = byId(id);
          return h('li', {}, h('span', { 'aria-hidden': 'true' }, OUTCOME_UI[store.outcomeOf(id)].icon), ' ', isolateTitle(ex.title || ex.id));
        })),
        queue.length > 5 ? h('span', { class: 'muted' }, `ועוד ${queue.length - 5}…`) : null,
        h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/review/start' }, 'התחל חזרה'))]
      : h('span', { class: 'muted' }, 'אין תרגילים לחזרה כרגע. תרגילים שנפתרו עם רמזים או עם פתרון יופיעו כאן.'));
  show(
    h('h1', {}, 'במה נתרגל היום?'),
    h('p', { class: 'muted' }, 'בחרו נושא, פתרו תרגילים ובדקו את עצמכם. רמזים ופתרון מלא זמינים בכל תרגיל.'),
    loadErrors.length ? h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון חלק מקבצי התרגילים. נסו לרענן את הדף.') : null,
    exercises.length ? practice.homeCard(examCtx) : null,
    exercises.length ? reviewCard : null,
    h('div', { class: 'cards' }, cards),
    h('h2', {}, 'כלים'),
    h('div', { class: 'cards' },
      h('a', { class: 'card', href: '#/drills' }, h('strong', {}, '⚡ תרגולים מהירים'), h('span', { class: 'muted' }, 'מלכודות, בדיקות שפיות וכרטיסיות בסשן של 10 פריטים')),
      h('a', { class: 'card', href: '#/hunt' }, h('strong', {}, '🔎 מצאו את הטעות'), h('span', { class: 'muted' }, 'פתרון מלא עם טעות אחת: מצאו את השלב הראשון השגוי')),
      h('a', { class: 'card', href: '#/backup' }, h('strong', {}, '💾 גיבוי והעברה'), h('span', { class: 'muted' }, 'שמרו את ההתקדמות או העבירו אותה למכשיר אחר')),
      h('a', { class: 'card', href: '#/exam' }, h('strong', {}, '📝 מצב מבחן'), h('span', { class: 'muted' }, 'שאלות מעורבות, שעון, בלי רמזים ועם דוח בסוף')),
      h('button', { class: 'card card-btn', type: 'button', onclick: (ev) => openSheet(null, ev.currentTarget) }, h('strong', {}, '📐 דף נוסחאות'), h('span', { class: 'muted' }, 'כל הנוסחאות וטעויות נפוצות במקום אחד'))));
}

function viewTopic(topicId, levelFilter = 0) {
  const topic = topicOf(topicId);
  if (!topic) return viewNotFound();
  document.title = `${topic.title} – Brain Gains`;
  const list = inTopic(topicId);
  const shown = levelFilter ? list.filter((e) => e.level === levelFilter) : list;

  const suggested = practice.suggestedLevel(list); // a hint only: every level stays open
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'סינון לפי רמה' },
    [[0, 'הכול'], [1, 'רמה 1'], [2, 'רמה 2'], [3, 'רמה 3']].map(([lv, label]) =>
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(lv === levelFilter),
        onclick: () => viewTopic(topicId, lv),
      }, lv && lv === suggested ? `${label} · מומלץ` : label)));

  const items = shown.map((e) =>
    h('li', {}, h('a', { class: 'ex-item', href: `#/ex/${e.id}` },
      badge(e.level),
      h('span', { class: 't' }, isolateTitle(e.title || e.id)),
      outcomeIcon(store.outcomeOf(e.id)))));
  const legend = h('ul', { class: 'legend', 'aria-label': 'מקרא' },
    ['alone', 'hinted', 'review', 'none'].map((k) =>
      h('li', {}, h('span', { 'aria-hidden': 'true' }, OUTCOME_UI[k].icon), ' ', OUTCOME_UI[k].label)));

  show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לנושאים')),
    h('h1', {}, topic.title),
    topicId.startsWith('phys-')
      ? h('p', { class: 'notice' }, 'בתרגילי הפיזיקה נקח ', ltr('g = 10 m/s²'), '.') : null,
    h('div', { class: 'btn-row' }, formulaButton(topicId)),
    examplesSection(topicId),
    filters,
    legend,
    items.length ? h('ul', { class: 'ex-list' }, items)
      : h('p', { class: 'muted' }, list.length ? 'אין תרגילים ברמה הזו.' : 'עדיין אין תרגילים בנושא הזה.'));
}

function viewExercise(id, reviewMode = false, wk = null) {
  const ex = byId(id);
  if (!ex) return viewNotFound();
  if (reviewMode) reviewSeen.add(id);
  const topic = topicOf(ex.topic);
  document.title = `${isolateTitle(ex.title || ex.id)} – Brain Gains`;
  const siblings = inTopic(ex.topic);
  const idx = siblings.indexOf(ex);
  const prev = siblings[idx - 1];
  const next = siblings[idx + 1];

  const tips = Array.isArray(ex.tips) ? ex.tips.slice(0, 3) : [];
  const solution = Array.isArray(ex.solution) ? ex.solution : [];
  const sets = validAnswerSets(ex.answerSets) ? ex.answerSets : null;
  const isChoice = !sets && !!(ex.choice && Array.isArray(ex.choice.options));

  /* answer area */
  let answerArea;
  let readValues;
  const fieldEls = [];
  const rowEls = []; // answerSets: { wrap, inputs }
  if (sets) {
    const rows = Array.from({ length: sets.count }, (_, r) => {
      const inputs = sets.labels.map((label, c) => {
        const input = h('input', {
          type: 'text', id: `in-${r}-${c}`, inputmode: 'decimal', autocomplete: 'off',
          autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done',
        });
        return { input, node: h('div', { class: 'field' },
          h('label', { for: `in-${r}-${c}` }, ltr(label), ' ='), h('div', { class: 'row' }, input)) };
      });
      const wrap = h('fieldset', { class: 'solution-row' },
        h('legend', {}, `פתרון ${r + 1}`), inputs.map((x) => x.node));
      rowEls.push({ wrap, inputs: inputs.map((x) => x.input) });
      return wrap;
    });
    answerArea = h('div', { class: 'fields' },
      h('p', { class: 'muted' }, `למערכת יש כמה פתרונות. מלאו פתרון בכל שורה (עד ${sets.count} שורות); אפשר להשאיר שורות ריקות, והסדר לא משנה.`),
      rows);
    readValues = () => rowEls.map((r) => r.inputs.map((i) => i.value));
  } else if (isChoice) {
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

  const reasonBox = h('div', { 'aria-live': 'polite' });
  const t0 = Date.now();
  let wrongNoted = false, solutionNoted = false;
  const note = (outcome) => store.recordAttempt({
    exerciseId: ex.id, outcome, hintsUsed: shownTips, seconds: Math.round((Date.now() - t0) / 1000),
  });
  const askReason = (rec) => {
    if (rec) reasonBox.replaceChildren(practice.reasonChips((r) => store.setAttemptReason(rec, r)));
  };
  function noteWrong() {
    if (closed || wrongNoted || solutionNoted) return;
    wrongNoted = true;
    askReason(note('wrong'));
  }
  const outcomeLine = h('p', { class: 'muted', 'aria-live': 'polite' });
  let closed = false; // attempt already recorded as correct in this visit
  let shownTips = Math.min(store.getTipsUsed(ex.id), tips.length);
  function solved() {
    if (closed) return;
    closed = true;
    if (!solutionNoted) note(shownTips > 0 ? 'hinted' : 'alone');
    store.markCorrect(ex.id);
    const ui = OUTCOME_UI[store.outcomeOf(ex.id)];
    outcomeLine.replaceChildren(`${ui.icon} ${ui.label}`);
  }

  function check() {
    fieldEls.forEach((f) => f.wrap.classList.remove('wrong', 'right'));
    rowEls.forEach((r) => r.wrap.classList.remove('wrong', 'right'));
    if (sets) {
      const rows = readValues();
      if (rows.every((r) => r.every((v) => v.trim() === ''))) return setFeedback('bad', 'הזינו לפחות פתרון אחד לפני הבדיקה.');
      const res = matchSets(rows, sets.sets, sets.tolerance ?? 0.01);
      res.right.forEach((i) => rowEls[i].wrap.classList.add('right'));
      res.wrong.forEach((i) => rowEls[i].wrap.classList.add('wrong'));
      if (res.solved) { solved(); return setFeedback('ok', 'נכון! מצאתם את כל הפתרונות 🎉'); }
      const parts = [`${res.right.length} פתרונות נכונים מתוך ${res.expected}.`];
      if (res.wrong.length) parts.push(`${res.wrong.length > 1 ? 'שורות' : 'שורה'} שנראות שגויות: ${res.wrong.map((i) => i + 1).join(', ')}.`);
      else parts.push('עוד יש פתרונות לחפש.');
      noteWrong();
      return setFeedback('bad', parts.join(' '));
    }
    if (isChoice) {
      const v = readValues();
      if (v < 0) return setFeedback('bad', 'בחרו תשובה לפני הבדיקה.');
      if (v === ex.choice.correct) { solved(); return setFeedback('ok', 'נכון! כל הכבוד 🎉'); }
      noteWrong();
      return setFeedback('bad', 'לא מדויק. נסו שוב, אפשר להיעזר ברמז.');
    }
    const values = readValues();
    if (values.every((v) => v.trim() === '')) return setFeedback('bad', 'הזינו תשובה לפני הבדיקה.');
    const res = checkAll(values, ex.inputs);
    res.forEach((ok, i) => fieldEls[i].wrap.classList.add(ok ? 'right' : 'wrong'));
    if (res.every(Boolean)) { solved(); return setFeedback('ok', 'נכון! כל הכבוד 🎉'); }
    noteWrong();
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
    const used = shownTips;
    tipList.replaceChildren(...tips.slice(0, used).map((t, i) =>
      h('li', {}, h('strong', {}, `רמז ${i + 1}: `), h('span', { html: t }))));
    tipButtons.forEach((b, i) => {
      b.disabled = i !== used; // only the next tip is available
      b.setAttribute('aria-disabled', String(b.disabled));
    });
  }
  function openTip(n) {
    if (n !== shownTips + 1) return;
    shownTips = n;
    if (!closed) store.setTipsUsed(ex.id, n);
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
    shownTips = tips.length;
    if (!closed) {
      store.setTipsUsed(ex.id, tips.length); store.revealSolution(ex.id);
      if (!solutionNoted) { solutionNoted = true; askReason(note('solution')); }
    }
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
    feedback,
    reasonBox);

  renderTips();
  show(
    h('p', { class: 'crumbs' }, h('a', { href: `#/topic/${ex.topic}` }, `→ ${topic ? topic.title : 'חזרה'}`)),
    h('h1', {}, isolateTitle(ex.title || ex.id), ' ', badge(ex.level)),
    ex.topic.startsWith('phys-') ? h('p', { class: 'muted' }, 'נקח ', ltr('g = 10 m/s²'), '.') : null,
    wk ? practice.workoutBar(wk.n, wk.total) : null,
    reviewMode ? h('p', { class: 'notice' }, 'מצב חזרה על טעויות. פתרו לבד, בלי רמזים, כדי להוריד את התרגיל מהרשימה.') : null,
    h('div', { class: 'panel statement', html: ex.statement || '' }),
    diagramFigure(ex),
    form,
    outcomeLine,
    h('h2', {}, 'עזרה'),
    h('div', { class: 'btn-row' }, formulaButton(ex.topic)),
    guidedStepper(ex.guided, () => store.markGuided(ex.id)),
    tips.length ? h('div', { class: 'btn-row' }, tipButtons) : h('p', { class: 'muted' }, 'אין רמזים בתרגיל הזה.'),
    tipList,
    solution.length ? h('div', { class: 'btn-row' }, solutionBtn) : null,
    solutionBox,
    reviewMode ? h('nav', { class: 'nav', 'aria-label': 'ניווט בחזרה' },
      h('a', { class: 'btn', href: '#/' }, 'סיום החזרה'),
      h('a', { class: 'btn primary', href: reviewNextHref(id) }, 'התרגיל הבא לחזרה ←'))
    : wk ? h('nav', { class: 'nav', 'aria-label': 'ניווט באימון' },
      wk.n > 1 ? h('a', { class: 'btn', href: `#/workout/${wk.n - 1}` }, '→ השאלה הקודמת') : h('a', { class: 'btn', href: '#/' }, 'יציאה'),
      h('a', { class: 'btn primary', href: wk.n < wk.total ? `#/workout/${wk.n + 1}` : '#/workout/summary' }, wk.n < wk.total ? 'השאלה הבאה ←' : 'סיום וסיכום ←'))
    : h('nav', { class: 'nav', 'aria-label': 'ניווט בין תרגילים' },
      prev ? h('a', { class: 'btn', href: `#/ex/${prev.id}` }, '→ התרגיל הקודם') : h('span'),
      next ? h('a', { class: 'btn primary', href: `#/ex/${next.id}` }, 'התרגיל הבא ←') : h('span')));
}

/** Exercise diagram: sanitized inline SVG inside <figure role="img">, or null. */
function diagramFigure(ex) {
  const svg = typeof ex.diagram === 'string' ? sanitizeSvg(ex.diagram) : '';
  if (!svg) return null;
  return h('figure', { class: 'diagram', role: 'img', 'aria-label': ex.title || ex.id, html: svg });
}

function reviewNextHref(currentId) {
  const next = store.reviewQueue(exercises.map((e) => e.id)).find((x) => x !== currentId && !reviewSeen.has(x));
  return next ? `#/review/${next}` : '#/review/done';
}

function viewReviewDone() {
  document.title = 'סיום חזרה – Brain Gains';
  const left = store.reviewQueue(exercises.map((e) => e.id)).length;
  show(h('h1', {}, 'סיימנו את סבב החזרה'),
    h('p', {}, left ? `נשארו ${left} תרגילים לחזרה. אפשר להתחיל סבב נוסף.` : 'אין יותר תרגילים לחזרה. כל הכבוד!'),
    h('div', { class: 'btn-row' },
      left ? h('a', { class: 'btn primary', href: '#/review/start' }, 'סבב נוסף') : null,
      h('a', { class: 'btn', href: '#/' }, 'לדף הבית')));
}

function viewNotFound() {
  if (window.omriSelfHeal) window.omriSelfHeal(); // maybe a stale cached app that predates this route
  show(h('h1', {}, 'העמוד לא נמצא'), h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
}

/* ---------- router ---------- */
const examCtx = {
  topics: TOPICS,
  get exercises() { return exercises; },
  byId: (id) => byId(id),
  show: (...n) => show(...n),
  diagramFigure: (ex) => diagramFigure(ex),
};

function viewWorkoutRoute(arg) {
  if (arg === 'start') {
    location.replace(practice.startWorkout(exercises) ? '#/workout/1' : '#/');
    return;
  }
  if (arg === 'summary') return practice.viewWorkoutSummary(examCtx);
  const w = store.loadWorkout();
  const ids = w ? w.ids.filter((x) => byId(x)) : [];
  const n = Number(arg);
  if (!ids.length || !Number.isInteger(n) || n < 1 || n > ids.length) return location.replace('#/');
  viewExercise(ids[n - 1], false, { n, total: ids.length });
}

function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  try {
    if (parts[0] === 'topic' && parts[1]) viewTopic(parts[1]);
    else if (parts[0] === 'ex' && parts[1]) viewExercise(parts[1]);
    else if (parts[0] === 'progress') { practice.viewProgress(examCtx); const r = backup.reminderLine(); if (r) app.append(r); }
    else if (parts[0] === 'backup') backup.viewBackup(examCtx);
    else if (parts[0] === 'drills') drills.viewDrills(examCtx);
    else if (parts[0] === 'hunt') hunt.viewHunt(examCtx, parts[1]);
    else if (parts[0] === 'workout') viewWorkoutRoute(parts[1]);
    else if (parts[0] === 'exam') viewExam(examCtx, parts[1]);
    else if (parts[0] === 'review' && parts[1] === 'start') {
      reviewSeen = new Set();
      const first = store.reviewQueue(exercises.map((e) => e.id))[0];
      location.replace(first ? `#/review/${first}` : '#/review/done');
    } else if (parts[0] === 'review' && parts[1] === 'done') viewReviewDone();
    else if (parts[0] === 'review' && parts[1]) viewExercise(parts[1], true);
    else if (parts.length === 0) viewHome();
    else viewNotFound();
  } catch (err) {
    console.error('route failed for', location.hash, err && err.stack ? err.stack : err);
    if (window.omriSelfHeal) window.omriSelfHeal();
    show(h('p', { class: 'error', role: 'alert' }, 'אירעה שגיאה בהצגת העמוד.'),
      h('p', { class: 'muted', dir: 'ltr' }, `${location.hash} — ${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : String(err)}`),
      h('p', {}, h('a', { href: '#/' }, 'חזרה לדף הבית')));
  }
}

window.addEventListener('hashchange', route);
Promise.all([loadData(), loadExtras()]).then(route);
