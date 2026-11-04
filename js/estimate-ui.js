// #/estimate: commit to an estimate first, then see the exact calculation and whether the estimate bracketed it.
// Routes: #/estimate (groups, hit rate), #/estimate/run[/<group>] (a session of 8). Logic: js/estimate.js, data: js/estimate-data.js.
import { h } from './dom.js';
import * as store from './store.js';
import { mathInline } from './mathdir.js';
import {
  QUESTIONS, GROUPS, TOPIC, SESSION_SIZE, SLIDER_STEPS, MAX_RATIO, exactOf, rangesOf, rangeLabel, fmtVal, judgeChoice, judgeSlider, sliderValue,
  loadSaved, saveSaved, recordResult, hitRate, pickSession,
} from './estimate.js';

const TITLE = '🎯 קודם מעריכים';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const code = mathInline;
const withUnit = (q, v) => `${fmtVal(v)}${q.unit ? ` ${q.unit}` : ''}`;

export function viewEstimate(ctx, mode, group) {
  document.title = 'הערכה – Brain Gains';
  if (mode === 'run') return run(ctx, GROUPS.some((g) => g.id === group) ? group : null);
  return home(ctx);
}

function home(ctx) {
  const saved = loadSaved();
  const rate = hitRate(saved);
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, '24 שאלות שבהן מחליטים על הערכה לפני שמחשבים: בוחרים טווח (או קובעים טווח על סרגל לוגריתמי), ורק אחר כך רואים את החישוב המדויק ובודקים אם ההערכה תפסה אותו. הערכה טובה לוכדת את התשובה בטווח צר, ולא יותר מפי 10 רוחב.'),
    h('p', { role: 'status' }, rate === null ? 'עוד לא עניתם על שאלות.' : `ההערכות שלכם תפסו את התשובה ב־${Math.round(rate * 100)}% מהמקרים.`),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: '#/estimate/run' }, `סשן של ${SESSION_SIZE} שאלות`)),
    h('h2', {}, 'לפי נושא'),
    h('div', { class: 'cards' }, GROUPS.map((g) => {
      const qs = QUESTIONS.filter((q) => q.group === g.id);
      const ok = qs.filter((q) => saved.q[q.id] && saved.q[q.id].last === 1).length;
      return h('a', { class: 'card', href: `#/estimate/run/${g.id}` }, h('strong', {}, g.title), h('span', { class: 'muted' }, `${ok} מתוך ${qs.length} נתפסו בפעם האחרונה`));
    })));
}

export function applyResult(q, success, seconds, now = Date.now()) {
  const saved = loadSaved();
  recordResult(saved, q.id, success, now);
  saveSaved(saved);
  store.recordAttempt({ exerciseId: q.id, topic: TOPIC, outcome: success ? 'alone' : 'wrong', hintsUsed: 0, seconds: Math.max(0, Math.round(seconds)) });
}

function verdictText(q, j) {
  if (j.success) return q.mode === 'slider' ? `✓ הטווח שלכם תפס את הערך, והוא צר מספיק (פי ${fmtVal(j.ratio)}).` : '✓ ההערכה שלכם תפסה את הערך.';
  if (j.tooWide) return `הטווח תפס את הערך, אבל הוא רחב מדי (פי ${fmtVal(j.ratio)}). שאפו לטווח של עד פי ${MAX_RATIO}.`;
  return `✗ ההערכה החמיצה: הערך המדויק ${j.side === 'high' ? 'גבוה' : 'נמוך'} מהטווח שבחרתם.`;
}

function run(ctx, group) {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const queue = pickSession(loadSaved(), SESSION_SIZE, seed, group);
  const total = queue.length;
  let done = 0;
  let hits = 0;

  const finish = () => ctx.show(crumbs('#/estimate', '→ להערכה'), h('h1', {}, TITLE),
    total ? h('p', { class: hits === total ? 'feedback ok' : 'notice', role: 'status' }, `סיימנו ${total} שאלות. ההערכות תפסו את הערך ב־${hits} מהן.`) : h('p', { class: 'notice' }, 'אין שאלות בנושא הזה.'),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: group ? `#/estimate/run/${group}` : '#/estimate/run' }, 'סשן נוסף'), h('a', { class: 'btn', style: BTN, href: '#/estimate' }, 'חזרה')));

  const next = () => {
    const q = queue.shift();
    if (!q) return finish();
    const t0 = Date.now();
    const out = h('div', { 'aria-live': 'polite' });
    let answered = false;
    const reveal = (j, chosen) => {
      if (answered) return;
      answered = true;
      applyResult(q, j.success, (Date.now() - t0) / 1000);
      done += 1;
      if (j.success) hits += 1;
      out.replaceChildren(
        h('p', { class: j.success ? 'feedback ok' : 'feedback bad', role: 'status' }, verdictText(q, j)),
        h('p', {}, 'ההערכה שלכם: ', code(chosen)),
        h('div', { class: 'panel' }, h('strong', {}, 'החישוב המדויק:'), h('ul', {}, q.steps.map((s) => h('li', {}, code(s)))),
          h('p', {}, h('strong', {}, 'ערך מדויק: '), code(withUnit(q, exactOf(q))))),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: next }, queue.length ? 'השאלה הבאה' : 'סיום')));
    };
    let controls;
    if (q.mode === 'choice') {
      controls = h('div', { role: 'group', 'aria-label': 'טווחים' }, rangesOf(q).map((r, i) => {
        const b = h('button', { class: 'btn', type: 'button', style: `${BTN}display:block;margin:6px 0` });
        b.append(code(rangeLabel(q, i)));
        b.addEventListener('click', () => reveal(judgeChoice(q, i), rangeLabel(q, i)));
        return b;
      }));
    } else {
      const mk = (label, value) => h('input', { type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1', value: String(value), 'aria-label': label, style: 'width:min(100%,24em)' });
      const lowIn = mk('קצה תחתון של הטווח', Math.round(SLIDER_STEPS * 0.3));
      const highIn = mk('קצה עליון של הטווח', Math.round(SLIDER_STEPS * 0.7));
      const lowOut = h('bdi', { dir: 'ltr' }); const highOut = h('bdi', { dir: 'ltr' });
      const show = () => {
        lowOut.textContent = withUnit(q, sliderValue(Number(lowIn.value), q.axis));
        highOut.textContent = withUnit(q, sliderValue(Number(highIn.value), q.axis));
      };
      [lowIn, highIn].forEach((el) => { el.addEventListener('input', show); el.addEventListener('change', show); });
      show();
      const ok = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'אישור הטווח');
      ok.addEventListener('click', () => {
        const a = sliderValue(Number(lowIn.value), q.axis); const b = sliderValue(Number(highIn.value), q.axis);
        reveal(judgeSlider(q, a, b), `${withUnit(q, Math.min(a, b))} עד ${withUnit(q, Math.max(a, b))}`);
      });
      controls = h('div', { class: 'panel' },
        h('p', { class: 'muted' }, 'הסרגל לוגריתמי: כל צעד שווה לאותו יחס, לא לאותו הפרש.'),
        h('div', {}, h('label', {}, 'מ־ '), lowIn, ' ', lowOut), h('div', {}, h('label', {}, 'עד '), highIn, ' ', highOut), h('div', { class: 'btn-row' }, ok));
    }
    ctx.show(crumbs('#/estimate', '→ יציאה (ההתקדמות נשמרת)'), h('h1', {}, TITLE), h('p', { class: 'muted' }, `${done + 1} מתוך ${total}`),
      h('p', {}, h('strong', {}, q.prompt)), h('p', { class: 'muted' }, q.mode === 'choice' ? 'בחרו את הטווח שבו לדעתכם התשובה נמצאת, לפני שמחשבים.' : 'קבעו טווח סביר לתשובה, לפני שמחשבים.'), controls, out);
  };
  next();
}
