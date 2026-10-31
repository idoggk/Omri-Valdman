import { checkAll } from './check.js';
import * as store from './store.js';
import { matchSets, validAnswerSets } from './answersets.js';
import { sanitizeSvgSafe as sanitizeSvg } from './sanitize.js';
import { isolateTitle } from './bidi.js';
import { h, ltr } from './dom.js';
import { formulaButton, guidedStepper } from './sheet.js';
import * as practice from './practice-ui.js';
import { feedbackCard } from './feedback-ui.js';

export const OUTCOME_UI = {
  alone: { icon: '✓', label: 'נפתר לבד' },
  hinted: { icon: '💡', label: 'נפתר עם רמזים' },
  review: { icon: '🔁', label: 'דורש חזרה' },
  none: { icon: '○', label: 'טרם נוסה' },
};

export function badge(level) {
  return h('span', { class: `badge l${level}` }, `רמה ${level}`);
}

/** Default progress sink: the main progress store and attempt log. */
export function storeSink(id) {
  return {
    attempt: (a) => store.recordAttempt(a),
    setReason: (rec, r) => store.setAttemptReason(rec, r),
    tips: () => store.getTipsUsed(id),
    setTips: (n) => store.setTipsUsed(id, n),
    reveal: () => store.revealSolution(id),
    correct: () => store.markCorrect(id),
    outcome: () => store.outcomeOf(id),
    guided: () => store.markGuided(id),
  };
}

// Renders one exercise: answer widget, 3-tier hints, guided stepper, full solution, diagram.
// o.ctx: { show, topicOf }. o.sink: progress sink (default: the main store). o.crumbs / o.nav: nodes replacing the
// default breadcrumb and navigation. o.reviewMode, o.wk, o.reviewNextHref(), o.siblings serve the normal views.
export function renderExercise(ex, o) {
  const { show, topicOf } = o.ctx;
  const sink = o.sink || storeSink(ex.id);
  const { reviewMode = false, wk = null } = o;
  const topic = topicOf(ex.topic);
  document.title = `${isolateTitle(ex.title || ex.id)} – Brain Gains`;
  const siblings = o.siblings || [];
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
  const note = (outcome) => sink.attempt({
    exerciseId: ex.id, outcome, hintsUsed: shownTips, seconds: Math.round((Date.now() - t0) / 1000),
  });
  const askReason = (rec) => {
    if (rec) reasonBox.replaceChildren(practice.reasonChips((r) => sink.setReason(rec, r)));
  };
  function noteWrong() {
    if (closed || wrongNoted || solutionNoted) return;
    wrongNoted = true;
    askReason(note('wrong'));
  }
  const outcomeLine = h('p', { class: 'muted', 'aria-live': 'polite' });
  let closed = false; // attempt already recorded as correct in this visit
  let shownTips = Math.min(sink.tips(), tips.length);
  let solutionViewed = false;
  const feedbackBox = h('div'); // difficulty card, offered once after the answer is checked or the solution is viewed
  const offerFeedback = () => {
    if (feedbackBox.children.length) return;
    feedbackBox.append(feedbackCard({
      exerciseId: ex.id, topic: ex.topic, level: ex.level, attemptId: t0,
      mode: o.mode || (String(ex.id).startsWith('var-') ? 'endless' : wk ? 'workout' : 'exercise'),
      context: () => ({
        correct: closed ? true : solutionViewed ? false : null, hintsUsed: shownTips, solutionViewed,
        secondsSpent: Math.round((Date.now() - t0) / 1000),
      }),
    }));
  };
  function solved() {
    if (closed) return;
    closed = true;
    offerFeedback();
    if (!solutionNoted) note(shownTips > 0 ? 'hinted' : 'alone');
    sink.correct();
    const ui = OUTCOME_UI[sink.outcome()] || { icon: '✏️', label: 'התשובות נכונות, נותר לסמן את סעיף השרטוט' }; // a sink may hold the result back
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
      'יש טעות בתשובה עבור: ', wrongNames.map((n, i) => [i ? ', ' : '', ltr(n)]), '. בדקו ונסו שוב.'));
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
    if (!closed) sink.setTips(n);
    renderTips();
  }

  /* solution with in-page confirmation */
  const solutionBox = h('div');
  function showConfirm() {
    solutionBox.replaceChildren(h('div', { class: 'panel confirm', role: 'alertdialog', 'aria-label': 'אישור הצגת פתרון' },
      h('p', {}, 'בטוחים שרוצים לראות את הפתרון המלא? כדאי קודם לנסות עם הרמזים.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: showSolution }, 'כן, הציגו פתרון'),
        h('button', { class: 'btn', type: 'button', onclick: () => { solutionBox.replaceChildren(); solutionBtn.focus(); } }, 'ביטול'))));
    solutionBox.querySelector('button').focus();
  }
  function showSolution() {
    shownTips = tips.length;
    solutionViewed = true;
    offerFeedback();
    if (!closed) {
      sink.setTips(tips.length); sink.reveal();
      if (!solutionNoted) { solutionNoted = true; askReason(note('solution')); }
    }
    renderTips();
    solutionBox.replaceChildren(h('div', { class: 'panel' },
      h('h2', {}, 'פתרון מלא'),
      h('ol', { class: 'steps' }, solution.map((s) => h('li', { html: s })))));
  }
  const solutionBtn = h('button', { class: 'btn', type: 'button', onclick: showConfirm }, 'הציגו פתרון מלא');

  const form = h('form', { onsubmit: (ev) => { ev.preventDefault(); check(); } },
    answerArea,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'בדקו')),
    feedback,
    reasonBox);

  renderTips();
  show(
    o.crumbs || h('p', { class: 'crumbs' }, h('a', { href: `#/topic/${ex.topic}` }, `→ ${topic ? topic.title : 'חזרה'}`)),
    h('h1', {}, isolateTitle(ex.title || ex.id), ' ', badge(ex.level)),
    ex.topic.startsWith('phys-') ? h('p', { class: 'muted' }, 'נקח ', ltr('g = 10 מ/ש²'), '.') : null,
    wk ? practice.workoutBar(wk.n, wk.total) : null,
    reviewMode ? h('p', { class: 'notice' }, 'מצב חזרה על טעויות. פתרו לבד, בלי רמזים, כדי להוריד את התרגיל מהרשימה.') : null,
    h('div', { class: 'panel statement', html: ex.statement || '' }),
    diagramFigure(ex),
    form,
    outcomeLine,
    feedbackBox,
    h('h2', {}, 'עזרה'),
    h('div', { class: 'btn-row' }, formulaButton(ex.topic)),
    guidedStepper(ex.guided, () => sink.guided()),
    tips.length ? h('div', { class: 'btn-row' }, tipButtons) : h('p', { class: 'muted' }, 'אין רמזים בתרגיל הזה.'),
    tipList,
    solution.length ? h('div', { class: 'btn-row' }, solutionBtn) : null,
    solutionBox,
    o.nav ? o.nav
    : reviewMode ? h('nav', { class: 'nav', 'aria-label': 'ניווט בחזרה' },
      h('a', { class: 'btn', href: '#/' }, 'סיום החזרה'),
      h('a', { class: 'btn primary', href: o.reviewNextHref() }, 'התרגיל הבא לחזרה ←'))
    : wk ? h('nav', { class: 'nav', 'aria-label': 'ניווט באימון' },
      wk.n > 1 ? h('a', { class: 'btn', href: `#/workout/${wk.n - 1}` }, '→ השאלה הקודמת') : h('a', { class: 'btn', href: '#/' }, 'יציאה'),
      h('a', { class: 'btn primary', href: wk.n < wk.total ? `#/workout/${wk.n + 1}` : '#/workout/summary' }, wk.n < wk.total ? 'השאלה הבאה ←' : 'סיום וסיכום ←'))
    : h('nav', { class: 'nav', 'aria-label': 'ניווט בין תרגילים' },
      prev ? h('a', { class: 'btn', href: `#/ex/${prev.id}` }, '→ התרגיל הקודם') : h('span'),
      next ? h('a', { class: 'btn primary', href: `#/ex/${next.id}` }, 'התרגיל הבא ←') : h('span')));
}

/** Exercise diagram: sanitized inline SVG inside <figure role="img">, or null. */
export function diagramFigure(ex) {
  const svg = typeof ex.diagram === 'string' ? sanitizeSvg(ex.diagram) : '';
  if (!svg) return null;
  return h('figure', { class: 'diagram', role: 'img', 'aria-label': ex.title || ex.id, html: svg });
}
