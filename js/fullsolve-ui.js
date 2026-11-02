// Full-solution mode: solve one exercise on paper like in the exam. Picker (#/solve) and one exercise (#/solve/<id>).
// Flow: question + count-up timer (no hints) -> final answer + confidence BEFORE checking -> verdict, official
// solution and a self-check rubric -> result card. Independent results go to the normal attempt log / progress
// (hintsUsed = 0, wrong answers join the mistakes queue); confidence records live in their own storage key.
import { h, ltr } from './dom.js';
import { isolateTitle } from './bidi.js';
import { validAnswerSets } from './answersets.js';
import { diagramFigure, badge } from './exercise-view.js';
import { gradeQuestion, isBlank, formatClock, createTicker } from './exam.js';
import * as store from './store.js';
import { safeSetItem } from './storage.js';
import { feedbackCard } from './feedback-ui.js';

export const CONF_KEY = 'omri-study-confidence-v1';
const MAX_RECS = 500;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/* ---------- pure logic ---------- */

/** 'sure-right' | 'sure-wrong' | 'unsure-right' | 'unsure-wrong'. 'sure-wrong' is the priority-review flag. */
export function classify(correct, confident) {
  return `${confident ? 'sure' : 'unsure'}-${correct ? 'right' : 'wrong'}`;
}

export const CLASS_TEXT = {
  'sure-right': 'ביטחון מדויק: הייתם בטוחים וצדקתם.',
  'sure-wrong': 'בטוחים אבל טעיתם: סומן לחזרה בעדיפות.',
  'unsure-right': 'צדקתם למרות הספק: יש לכם יותר ידע ממה שנדמה לכם.',
  'unsure-wrong': 'ידעתם שאתם לא בטוחים, וזה נכון: כדאי לחזור על התרגיל.',
};

/** One rubric line per official solution step, or the generic 4-line rubric when the exercise has no steps. */
export const GENERIC_RUBRIC = ['הגדרתי את הנעלמים וכתבתי את הנתונים (הצבה והכנה)', 'כתבתי נוסחה או משוואה מתאימה והצבתי בה', 'ביצעתי את החישוב בלי טעויות', 'כתבתי מסקנה עם יחידות ובדקתי שהתשובה הגיונית'];
export function rubricItems(ex) {
  const steps = Array.isArray(ex.solution) ? ex.solution.filter((s) => typeof s === 'string' && s.trim()) : [];
  if (steps.length) return steps.map((html) => ({ html, step: true }));
  return GENERIC_RUBRIC.map((text) => ({ html: text, step: false }));
}

export const rubricPercent = (checked, total) => (total > 0 ? Math.round((100 * checked) / total) : 0);

/** Unofficial estimate text for a rubric score. */
export function estimateText(pct) {
  if (pct >= 90) return 'הערכה לא רשמית: פתרון מלא ומסודר.';
  if (pct >= 60) return 'הערכה לא רשמית: רוב הפתרון נכון, כדאי לחדד את השלבים החסרים.';
  return 'הערכה לא רשמית: בהרבה שלבים נפלה טעות. כדאי לעבור על הפתרון הרשמי ולנסות שוב.';
}

/** Weight of an exercise for "surprise me": unsolved-alone and wrong ones first. */
export function surpriseWeight(outcome, lastAttempt) {
  if (lastAttempt === 'wrong') return 6;
  if (outcome === 'review') return 5;
  if (outcome === 'hinted') return 4;
  if (!outcome) return 3;
  return 0.2; // solved alone: still possible, but rare
}

export function pickSurprise(exercises, log, outcomeOf, rnd = Math.random) {
  if (!exercises.length) return null;
  const last = new Map();
  for (const a of [...log].sort((x, y) => x.ts - y.ts)) last.set(a.exerciseId, a.outcome);
  const w = exercises.map((e) => surpriseWeight(outcomeOf(e.id), last.get(e.id)));
  const total = w.reduce((s, x) => s + x, 0);
  let r = rnd() * total;
  for (let i = 0; i < exercises.length; i++) { r -= w[i]; if (r < 0) return exercises[i]; }
  return exercises[exercises.length - 1];
}

/* ---------- confidence storage: { v:1, recs:[{id, ts, correct, confident, seconds, rubric|null}] } ---------- */
export function sanitizeConf(raw) {
  const out = { v: 1, recs: [] };
  if (!isRec(raw) || !Array.isArray(raw.recs)) return out;
  for (const r of raw.recs) {
    if (!isRec(r) || typeof r.id !== 'string' || !r.id) continue;
    out.recs.push({
      id: r.id, ts: Number.isFinite(r.ts) ? r.ts : 0, correct: r.correct === true, confident: r.confident === true,
      seconds: Number.isFinite(r.seconds) && r.seconds >= 0 ? Math.round(r.seconds) : 0,
      rubric: Number.isFinite(r.rubric) ? Math.max(0, Math.min(100, Math.round(r.rubric))) : null,
    });
  }
  out.recs = out.recs.slice(-MAX_RECS);
  return out;
}
export function loadConf() {
  try { return sanitizeConf(JSON.parse(localStorage.getItem(CONF_KEY))); } catch (e) { return sanitizeConf(null); }
}
function saveConf(d) { safeSetItem(CONF_KEY, JSON.stringify(d)); }
export function recordConf(rec) {
  const d = loadConf();
  d.recs.push(sanitizeConf({ recs: [rec] }).recs[0]);
  d.recs = d.recs.slice(-MAX_RECS);
  saveConf(d);
}
/** Updates the rubric score of the record made at `ts` for exercise `id`. */
export function setRubric(id, ts, pct) {
  const d = loadConf();
  const r = d.recs.find((x) => x.id === id && x.ts === ts);
  if (r) { r.rubric = pct; saveConf(d); }
}
export function calibration(recs) {
  const c = { 'sure-right': 0, 'sure-wrong': 0, 'unsure-right': 0, 'unsure-wrong': 0 };
  for (const r of recs) c[classify(r.correct, r.confident)]++;
  return c;
}
/** Short line for the progress page, or null when there are no records. */
export function calibrationLine(recs = loadConf().recs) {
  if (!recs.length) return null;
  const c = calibration(recs);
  return h('p', { class: 'muted' }, `🎯 כיול ביטחון (פתרון מלא): בטוחים וטעו ${c['sure-wrong']} · בטוחים וצדקו ${c['sure-right']} · לא בטוחים ${c['unsure-right'] + c['unsure-wrong']}`);
}

/* ---------- views ---------- */
const ticker = createTicker();
const title = (t) => { document.title = `${t} – Brain Gains`; };
const NOTE = 'פותרים על דף, כמו במבחן. אין רמזים ואין פתרון לפני ההגשה.';

function viewPicker(ctx, topicId = '', level = 0) {
  ticker.stop();
  title('פתרון מלא');
  const list = ctx.exercises.filter((e) => (!topicId || e.topic === topicId) && (!level || e.level === level));
  const conf = loadConf().recs;
  const flagged = new Set(conf.filter((r) => r.confident && !r.correct).map((r) => r.id));
  const chip = (label, on, fn) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(on), onclick: fn }, label);
  const surprise = () => {
    const ex = pickSurprise(list, store.getAttempts(), store.outcomeOf, ctx.rnd || Math.random);
    if (ex) location.hash = `#/solve/${ex.id}`;
  };
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/practice-hub' }, '→ חזרה לתרגול')),
    h('h1', {}, '✍️ פתרון מלא כמו במבחן'),
    h('p', { class: 'muted' }, `${NOTE} אחרי ההגשה מקבלים בדיקה, פתרון רשמי ורשימת בדיקה עצמית.`),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'נושא' },
      chip('כל הנושאים', !topicId, () => viewPicker(ctx, '', level)),
      ctx.topics.map((t) => chip(t.title, t.id === topicId, () => viewPicker(ctx, t.id, level)))),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'רמה' },
      [[0, 'כל הרמות'], [1, 'רמה 1'], [2, 'רמה 2'], [3, 'רמה 3']].map(([lv, label]) =>
        chip(label, lv === level, () => viewPicker(ctx, topicId, lv)))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', disabled: list.length ? null : true, onclick: surprise }, '🎲 הפתיעו אותי')),
    h('p', { class: 'muted' }, 'ההפתעה מעדיפה תרגילים שלא פתרתם לבד או שטעיתם בהם.'),
    list.length
      ? h('ul', { class: 'ex-list' }, list.map((e) => h('li', {}, h('a', { class: 'ex-item', href: `#/solve/${e.id}` },
        badge(e.level), h('span', { class: 't' }, isolateTitle(e.title || e.id)),
        flagged.has(e.id) ? h('span', { title: 'בטוחים וטעו' }, '⚠️') : null))))
      : h('p', { class: 'muted' }, 'אין תרגילים בבחירה הזו.'));
}

/** Answer widget. Returns { node, read } where read() has the shape expected by exam.gradeQuestion. */
function answerWidget(ex) {
  if (validAnswerSets(ex.answerSets)) {
    const sets = ex.answerSets;
    const rows = Array.from({ length: sets.count }, (_, r) => {
      const inputs = sets.labels.map((label, c) => ({ label, input: h('input', { type: 'text', id: `sv-${r}-${c}`, inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }) }));
      return { inputs, node: h('fieldset', { class: 'solution-row' }, h('legend', {}, `פתרון ${r + 1}`),
        inputs.map((x, c) => h('div', { class: 'field' }, h('label', { for: `sv-${r}-${c}` }, ltr(x.label), ' ='), h('div', { class: 'row' }, x.input)))) };
    });
    return { node: h('div', { class: 'fields' }, h('p', { class: 'muted' }, 'למערכת יש כמה פתרונות. מלאו פתרון בכל שורה; אפשר להשאיר שורות ריקות, והסדר לא משנה.'), rows.map((r) => r.node)),
      read: () => rows.map((r) => r.inputs.map((x) => x.input.value)) };
  }
  if (!Array.isArray(ex.inputs) && ex.choice) {
    const name = `sc-${ex.id}`;
    const radios = ex.choice.options.map((opt, i) => {
      const input = h('input', { type: 'radio', name, value: String(i) });
      return { input, label: h('label', {}, input, h('span', { html: String(opt) })) };
    });
    return { node: h('fieldset', { class: 'options' }, h('legend', { class: 'muted' }, 'בחרו תשובה'), radios.map((r) => r.label)),
      read: () => radios.findIndex((r) => r.input.checked) };
  }
  const fields = ex.inputs.map((spec, i) => ({ spec, input: h('input', { type: 'text', id: `sv-${i}`, inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }) }));
  return { node: h('div', { class: 'fields' }, fields.map((f, i) => h('div', { class: 'field' },
    h('label', { for: `sv-${i}` }, ltr(f.spec.label || `תשובה ${i + 1}`), ' ='),
    h('div', { class: 'row' }, f.input, f.spec.unit ? h('span', { class: 'unit' }, f.spec.unit) : null)))),
  read: () => fields.map((f) => f.input.value) };
}

function viewSolve(ctx, ex) {
  title(isolateTitle(ex.title || ex.id));
  const t0 = Date.now();
  const clock = h('strong', { 'aria-label': 'זמן שחלף' }, '0:00');
  const clockLine = h('p', { class: 'panel', role: 'timer' }, '⏱️ ', clock);
  const tick = () => {
    if (clockLine.isConnected === false) return ticker.stop();
    clock.textContent = formatClock(Date.now() - t0);
  };
  tick();
  ticker.start(tick, 1000);

  const widget = answerWidget(ex);
  let confident = null;
  const sure = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: () => setConf(true) }, 'בטוח');
  const unsure = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: () => setConf(false) }, 'לא בטוח');
  function setConf(v) {
    confident = v;
    sure.setAttribute('aria-pressed', String(v === true));
    unsure.setAttribute('aria-pressed', String(v === false));
  }
  const msg = h('div', { 'aria-live': 'polite' });
  const result = h('div', { 'aria-live': 'polite' });
  const submitBtn = h('button', { class: 'btn primary', type: 'submit' }, 'הגשה ובדיקה');
  let submitted = false;

  function submit() {
    if (submitted) return;
    const answer = widget.read();
    if (isBlank(ex, answer)) return msg.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, 'הזינו תשובה סופית לפני ההגשה.'));
    if (confident === null) return msg.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, 'בחרו קודם: בטוח או לא בטוח.'));
    submitted = true;
    ticker.stop();
    const ms = Date.now() - t0;
    const seconds = Math.round(ms / 1000);
    const ts = Date.now();
    const correct = gradeQuestion(ex, answer) === 'right';
    // independent solve: no hints, wrong answers join the mistakes queue
    store.recordAttempt({ exerciseId: ex.id, outcome: correct ? 'alone' : 'wrong', hintsUsed: 0, seconds });
    store.recordExamResults([{ id: ex.id, correct }]);
    recordConf({ id: ex.id, ts, correct, confident, seconds, rubric: null });
    submitBtn.disabled = true;
    msg.replaceChildren();

    const items = rubricItems(ex);
    const cls = classify(correct, confident);
    const rubricLine = h('p', {}, 'סמנו בשלבים למעלה כדי לקבל הערכה.');
    const boxes = items.map(() => h('input', { type: 'checkbox' }));
    const update = () => {
      const pct = rubricPercent(boxes.filter((b) => b.checked === true).length, items.length);
      setRubric(ex.id, ts, pct);
      rubricLine.textContent = `ציון עצמי: ${pct}% (${estimateText(pct)})`;
    };
    boxes.forEach((b) => b.addEventListener('change', update));
    const steps = Array.isArray(ex.solution) ? ex.solution : [];
    const next = pickSurprise(ctx.exercises, store.getAttempts(), store.outcomeOf, ctx.rnd || Math.random);
    result.replaceChildren(
      h('div', { class: correct ? 'feedback ok' : 'feedback bad', role: 'status' }, correct ? 'התשובה הסופית נכונה 🎉' : 'התשובה הסופית שגויה.'),
      steps.length ? h('div', { class: 'panel' }, h('h2', {}, 'הפתרון הרשמי המלא'), h('ol', { class: 'steps' }, steps.map((s) => h('li', { html: s })))) : null,
      h('div', { class: 'panel' }, h('h2', {}, 'רשימת בדיקה עצמית'),
        h('p', { class: 'muted' }, 'השוו לדף שלכם. סמנו רק שלבים שכתבתם נכון.'),
        items.map((it, i) => h('label', { class: 'rubric-row', style: 'display:flex;gap:.6rem;align-items:flex-start;margin:.4rem 0' },
          boxes[i], h('span', {}, 'כתבתי את השלב הזה נכון? ', it.step ? h('span', { html: it.html }) : it.html)))),
      h('div', { class: 'panel result-card' }, h('h2', {}, 'כרטיס תוצאה'),
        h('ul', {},
          h('li', {}, `תשובה סופית: ${correct ? 'נכונה' : 'שגויה'}`),
          h('li', {}, `ביטחון: ${confident ? 'בטוח' : 'לא בטוח'}. ${CLASS_TEXT[cls]}`),
          h('li', {}, 'ציון רשימת הבדיקה: ', rubricLine),
          h('li', {}, `זמן: ${formatClock(ms)}`))),
      feedbackCard({
        exerciseId: ex.id, mode: 'solve', topic: ex.topic, level: ex.level, attemptId: ts,
        context: () => ({ correct, hintsUsed: 0, solutionViewed: false, secondsSpent: seconds }),
      }),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn primary', href: next ? `#/solve/${next.id}` : '#/solve' }, 'תרגיל הבא ←'),
        h('a', { class: 'btn', href: '#/solve' }, 'לבחירת תרגיל')));
  }

  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/solve' }, '→ פתרון מלא')),
    h('h1', {}, isolateTitle(ex.title || ex.id), ' ', badge(ex.level)),
    h('p', { class: 'notice' }, NOTE),
    clockLine,
    ex.topic.startsWith('phys-') ? h('p', { class: 'muted' }, 'נקח ', ltr('g = 10 מ/ש²'), '.') : null,
    h('div', { class: 'panel statement', html: ex.statement || '' }),
    diagramFigure(ex),
    h('form', { onsubmit: (ev) => { ev.preventDefault(); submit(); } },
      widget.node,
      h('div', { role: 'group', 'aria-label': 'רמת ביטחון' }, h('p', {}, h('strong', {}, 'עד כמה אתם בטוחים בתשובה?')),
        h('div', { class: 'filters' }, sure, unsure)),
      h('div', { class: 'btn-row' }, submitBtn), msg),
    result);
}

export function viewSolveRoute(ctx, id) {
  if (!id) return viewPicker(ctx);
  const ex = ctx.byId(id);
  if (!ex) {
    ticker.stop();
    title('פתרון מלא');
    return ctx.show(h('h1', {}, 'התרגיל לא נמצא'), h('p', {}, h('a', { class: 'btn primary', href: '#/solve' }, 'לבחירת תרגיל')));
  }
  return viewSolve(ctx, ex);
}
