// #/recover: one-error recovery. Tap the first wrong step, state the corrected value, then finish the parts that
// depend on it (computed from the corrected value, not from the erroneous one). Logic is in js/recover.js.
import { h } from './dom.js';
import { sanitizeHtml } from './sanitize.js';
import { isolateTitle, isolateFormulasHtml } from './bidi.js';
import { feedbackCard } from './feedback-ui.js';
import * as store from './store.js';
import { tryFirst } from './tryfirst-ui.js';
import { attemptExtra } from './tryfirst.js';
import { confidenceBar, predExtra } from './calibration-ui.js';
import { answerWidget } from './mathhard-ui.js';
import {
  SUBJECTS, loadRecoverData, loadSaved, recordResult, gradeAnswer, pointsOf, outcomeOf, creditLines, errorLabel, recoverTopic, MAX_POINTS,
} from './recover.js';

const TITLE = '🩹 תקנו ותמשיכו';
const BTN = 'min-height:44px;';
const fmt = (n) => String(Math.round(n * 100) / 100);
const safe = (html) => sanitizeHtml(typeof html === 'string' ? html : '');
const rich = (tag, html, attrs = {}) => h(tag, { ...attrs, rawhtml: isolateFormulasHtml(safe(html)) });
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));

export async function viewRecover(ctx, id) {
  document.title = 'תקנו ותמשיכו – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadRecoverData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewRecover(ctx, id) }, 'נסו שוב')));
  }
  const it = id ? res.data.find((x) => x.id === id) : null;
  return it ? runItem(ctx, res.data, it) : list(ctx, res.data);
}

function list(ctx, data) {
  const saved = loadSaved().items;
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', { class: 'muted' }, 'בכל תרגיל יש פתרון מלא עם טעות אחת, בשלב מוקדם. שלושה שלבים: למצוא את השלב השגוי, לתקן את הערך, ולהמשיך מהערך המתוקן עד הסוף. מקבלים ניקוד חלקי על כל שלב.'),
    ...SUBJECTS.map((s) => {
      const items = data.filter((x) => x.subject === s.id);
      if (!items.length) return null;
      return h('section', { 'aria-label': s.label },
        h('h2', {}, s.label),
        h('ul', { class: 'ex-list' }, items.map((x) => {
          const r = saved[x.id];
          const full = r && r.best >= MAX_POINTS - 1e-9;
          return h('li', {}, h('a', { class: 'ex-item', href: `#/recover/${x.id}` },
            h('span', { class: 't' }, isolateTitle(x.title)),
            h('span', { class: `tick o-${full ? 'alone' : 'none'}`, role: 'img', 'aria-label': r ? `שיא ${fmt(r.best)} מתוך ${MAX_POINTS}` : 'טרם נפתר' }, r ? `${fmt(r.best)}/${MAX_POINTS}` : '○')));
        })));
    }));
}

function runItem(ctx, data, it) {
  document.title = `${isolateTitle(it.title)} – Brain Gains`;
  const next = data[data.indexOf(it) + 1];
  const t0 = Date.now();
  const res = { found: false, fixed: false, finished: 0, total: it.finish.length, hints: 0, wrongs: 0 };
  const out = h('div', { 'aria-live': 'polite' });
  const stageBox = h('div');
  const hintBox = h('div', { 'aria-live': 'polite' });
  const summaryBox = h('div', { 'aria-live': 'polite' });
  const hintBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'רמז');
  const tf = tryFirst([hintBtn, hintBox]);
  const conf = confidenceBar(); // optional "chance of full marks" chips (calibration.js), off by default
  let taps = 0;
  let located = false;
  let over = false;

  hintBtn.addEventListener('click', () => {
    if (over) return;
    res.hints = Math.min(2, res.hints + 1);
    hintBox.replaceChildren(...it.hints.slice(0, res.hints).map((t, i) => rich('p', `רמז ${i + 1}: ${t}`, { class: 'notice' })));
    hintBtn.textContent = res.hints >= 2 ? 'אין עוד רמזים' : 'רמז נוסף';
    if (res.hints >= 2) hintBtn.disabled = true;
  });

  const buttons = it.steps.map((s, i) => h('button', {
    class: 'btn drill-opt', type: 'button', 'aria-label': `שלב ${i + 1}`, onclick: () => choose(i),
  }, h('strong', {}, `${i + 1}. `), rich('span', s)));

  /* stage 1: tap the first wrong step */
  function choose(i) {
    if (located) return;
    tf.attempt();
    conf.lock();
    taps++;
    if (i === it.firstWrong) {
      res.found = taps === 1;
      buttons[i].classList.toggle('right', true);
      return foundStep(taps === 1 ? 'נכון! מצאתם את הטעות בניסיון הראשון.' : 'נכון, זה השלב השגוי (בניסיון מאוחר יותר, ולכן בלי נקודה על האיתור).');
    }
    res.wrongs++;
    buttons[i].classList.toggle('wrong', true);
    out.replaceChildren(
      h('div', { class: 'feedback bad', role: 'alert' }, i < it.firstWrong
        ? `שלב ${i + 1} נכון. הטעות הראשונה מאוחרת יותר.`
        : `שלב ${i + 1} נשען על שלב קודם שכבר שגוי. הטעות הראשונה מוקדמת יותר.`),
      h('div', { class: 'btn-row' }, h('button', {
        class: 'btn', type: 'button', style: BTN,
        onclick: () => { if (located) return; buttons[it.firstWrong].classList.toggle('right', true); foundStep('הנה השלב השגוי הראשון.'); },
      }, 'הציגו לי את השלב')));
  }
  function foundStep(msg) {
    located = true;
    buttons.forEach((b) => { b.disabled = true; });
    out.replaceChildren(
      h('div', { class: `feedback ${res.found ? 'ok' : 'bad'}`, role: res.found ? 'status' : 'alert' }, `${msg} סוג הטעות: ${errorLabel(it.errorType)}.`),
      h('div', { class: 'panel' }, h('strong', {}, 'מה השתבש: '), rich('span', it.whyWrong)));
    fixStage();
  }

  /* stage 2: state the corrected value */
  function fixStage() {
    const widget = answerWidget({ answer: it.fix.answer });
    const msg = h('div', { 'aria-live': 'polite' });
    const checkBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
    const showBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'הציגו את הערך');
    const done = (fixed) => {
      res.fixed = fixed;
      widget.lock(); checkBtn.disabled = true; showBtn.disabled = true;
      msg.append(rich('p', `השלב המתוקן: ${it.correctedStep}`, { class: 'notice' }));
      finishStage(0);
    };
    checkBtn.addEventListener('click', () => {
      const g = gradeAnswer(it.fix, widget.read());
      if (!g.ok) { msg.replaceChildren(h('p', { class: 'error', role: 'alert' }, g.error)); return; }
      if (g.result === 'correct') { msg.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון!')); done(true); return; }
      res.wrongs++;
      msg.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, 'לא מדויק. חשבו שוב את הערך הנכון בשלב המתוקן, ונסו שוב.'));
    });
    showBtn.addEventListener('click', () => done(false));
    stageBox.replaceChildren(h('section', { class: 'panel', 'aria-label': 'תיקון הערך' },
      h('h2', {}, 'שלב 2: תקנו'), rich('p', it.fix.ask), it.fix.unit ? h('p', { class: 'muted' }, `יחידות: ${it.fix.unit}`) : null,
      widget.el, h('div', { class: 'btn-row' }, checkBtn, showBtn), msg));
  }

  /* stage 3: finish the remaining parts from the corrected value */
  function finishStage(k) {
    if (k >= it.finish.length) return end();
    const p = it.finish[k];
    const widget = answerWidget({ answer: p.answer });
    const msg = h('div', { 'aria-live': 'polite' });
    const checkBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
    const showBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'הציגו פתרון');
    const close = (ok) => {
      if (ok) res.finished++;
      widget.lock(); checkBtn.disabled = true; showBtn.disabled = true;
      msg.append(h('div', { class: 'panel' }, h('strong', {}, 'פתרון: '), rich('span', p.solution)));
      finishStage(k + 1);
    };
    checkBtn.addEventListener('click', () => {
      const g = gradeAnswer(p, widget.read());
      if (!g.ok) { msg.replaceChildren(h('p', { class: 'error', role: 'alert' }, g.error)); return; }
      if (g.result === 'correct') { msg.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון!')); close(true); return; }
      res.wrongs++;
      msg.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, g.result === 'from-error'
        ? 'זו התוצאה שמתקבלת אם ממשיכים מהשלב השגוי. חשבו מחדש, הפעם מהערך המתוקן.'
        : 'לא מדויק. חשבו מהערך המתוקן ונסו שוב.'));
    });
    showBtn.addEventListener('click', () => close(false));
    stageBox.append(h('section', { class: 'panel', 'aria-label': `סעיף ${k + 1}` },
      k === 0 ? h('h2', {}, 'שלב 3: ממשיכים מהערך המתוקן') : null,
      k === 0 ? h('p', { class: 'muted' }, 'כל הסעיפים האלה מחושבים מהערך הנכון, לא מהפתרון השגוי.') : null,
      h('p', {}, h('strong', {}, `${k + 1}. `), rich('span', p.ask)), p.unit ? h('p', { class: 'muted' }, `יחידות: ${p.unit}`) : null,
      widget.el, h('div', { class: 'btn-row' }, checkBtn, showBtn), msg));
  }

  function end() {
    over = true;
    hintBtn.disabled = true;
    const outcome = outcomeOf(res);
    recordResult(it.id, res);
    store.recordAttempt({ exerciseId: it.id, topic: recoverTopic(it.subject), outcome, hintsUsed: res.hints, seconds: Math.round((Date.now() - t0) / 1000), ...attemptExtra(tf.gate), ...predExtra(conf) });
    const pts = pointsOf(res);
    summaryBox.replaceChildren(
      h('div', { class: `feedback ${pts >= MAX_POINTS - 1e-9 ? 'ok' : 'bad'}`, role: 'status' }, `${fmt(pts)} מתוך ${MAX_POINTS} נקודות.`),
      h('ul', {}, creditLines(res).map((l) => h('li', {}, `${l.done ? '✓' : '✗'} ${l.label}`))),
      feedbackCard({
        exerciseId: it.id, topic: it.subject, mode: 'recover', attemptId: t0,
        context: () => ({ correct: outcome !== 'wrong', hintsUsed: res.hints, solutionViewed: !res.fixed || res.finished < res.total, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
      }),
      h('div', { class: 'btn-row' },
        next ? h('a', { class: 'btn primary', href: `#/recover/${next.id}` }, 'התרגיל הבא ←') : null,
        h('a', { class: 'btn', href: '#/recover' }, 'לרשימת התרגילים')));
  }

  ctx.show(crumbs('#/recover', '→ לרשימת התרגילים'), h('h1', {}, isolateTitle(it.title)),
    h('p', { class: 'muted', role: 'status' }, `תרגיל ${data.indexOf(it) + 1} מתוך ${data.length}`),
    rich('div', it.statement, { class: 'panel statement' }),
    conf.node, tf.bar,
    h('h2', {}, 'שלב 1: הפתרון (יש בו טעות אחת)'),
    h('p', { class: 'muted' }, 'הקישו על השלב הראשון השגוי.'),
    h('div', { class: 'drill-options' }, buttons),
    h('div', { class: 'btn-row' }, hintBtn), hintBox,
    out, stageBox, summaryBox);
}
