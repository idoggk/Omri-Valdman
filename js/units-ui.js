// #/units: units and dimensional analysis. Routes: #/units (categories, progress), #/units/run[/<category>] (a session of
// up to 10 questions: the ones not yet answered first, then the ones missed last time). Logic and data: js/units.js, js/units-data.js.
import { h } from './dom.js';
import * as store from './store.js';
import { mathInline } from './mathdir.js';
import {
  QUESTIONS, CATS, TOPIC, SESSION_SIZE, answerOf, checkUnitsAnswer, expectedText, fmtUnit, loadSaved, saveSaved, recordResult, knownCount, pickSession, shuffleSeeded,
} from './units.js';

const TITLE = '📏 יחידות וניתוח ממדים';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const code = mathInline;

export function viewUnits(ctx, mode, cat) {
  document.title = 'יחידות – Brain Gains';
  if (mode === 'run') return run(ctx, CATS.some((c) => c.id === cat) ? cat : null);
  return home(ctx);
}

function home(ctx) {
  const saved = loadSaved();
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, '30 שאלות קצרות על יחידות: מה היחידה של כוח, אנרגיה והספק, איך ממירים בלי לטעות, האם נוסחה תקינה מבחינת יחידות, סקלר מול וקטור, ומה אומרים השיפוע והשטח בגרף. בדיקת יחידות לפני הצבה תופסת הרבה טעויות במבחן.'),
    h('p', { role: 'status' }, `עניתם נכון בפעם האחרונה על ${knownCount(saved)} מתוך ${QUESTIONS.length}`),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: '#/units/run' }, `סשן של ${SESSION_SIZE} שאלות`)),
    h('h2', {}, 'לפי נושא'),
    h('div', { class: 'cards' }, CATS.map((c) => {
      const qs = QUESTIONS.filter((q) => q.cat === c.id);
      const ok = qs.filter((q) => saved.q[q.id] && saved.q[q.id].last === 1).length;
      return h('a', { class: 'card', href: `#/units/run/${c.id}` }, h('strong', {}, c.title), h('span', { class: 'muted' }, `${ok} מתוך ${qs.length} נכונות בפעם האחרונה`));
    })));
}

/** Records one answer: unit progress and the attempt log. */
export function applyResult(q, correct, seconds, now = Date.now()) {
  const saved = loadSaved();
  recordResult(saved, q.id, correct, now);
  saveSaved(saved);
  store.recordAttempt({ exerciseId: q.id, topic: TOPIC, outcome: correct ? 'alone' : 'wrong', hintsUsed: 0, seconds: Math.max(0, Math.round(seconds)) });
}

function run(ctx, cat) {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const queue = pickSession(loadSaved(), SESSION_SIZE, seed, cat);
  const total = queue.length;
  let done = 0;
  const wrongIds = [];

  const finish = () => {
    ctx.show(crumbs('#/units', '→ ליחידות'), h('h1', {}, TITLE),
      total ? h('p', { class: wrongIds.length ? 'notice' : 'feedback ok', role: 'status' }, wrongIds.length ? `סיימנו ${total}. ${total - wrongIds.length} נכונות. את השאר תראו שוב בסשן הבא.` : `סיימנו ${total} שאלות, כולן נכונות.`)
        : h('p', { class: 'notice' }, 'אין שאלות בנושא הזה.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: cat ? `#/units/run/${cat}` : '#/units/run' }, 'סשן נוסף'), h('a', { class: 'btn', style: BTN, href: '#/units' }, 'חזרה')));
  };

  const next = () => {
    const q = queue.shift();
    if (!q) return finish();
    const t0 = Date.now();
    const a = answerOf(q);
    const out = h('div', { 'aria-live': 'polite' });
    let answered = false;
    const reveal = (correct) => {
      if (answered) return;
      answered = true;
      applyResult(q, correct, (Date.now() - t0) / 1000);
      if (!correct) wrongIds.push(q.id);
      done += 1;
      out.replaceChildren(
        h('p', { class: correct ? 'feedback ok' : 'feedback bad', role: 'status' }, correct ? '✓ נכון' : '✗ לא נכון. התשובה הנכונה: ', correct ? null : code(expectedText(q))),
        h('div', { class: 'panel' }, h('p', {}, q.why)),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: next }, queue.length ? 'השאלה הבאה' : 'סיום')));
      controls.querySelectorAll && controls.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
    };
    let controls;
    if (a.kind === 'choice') {
      const order = shuffleSeeded(a.choices.map((_, i) => i), seed + done);
      controls = h('div', { class: 'choices', role: 'group', 'aria-label': 'אפשרויות' }, order.map((i) => {
        const b = h('button', { class: 'btn', type: 'button', style: `${BTN}display:block;margin:6px 0;text-align:start` });
        if (q.type === 'unit' || q.type === 'graph') b.append(code(a.choices[i])); else b.textContent = a.choices[i];
        b.addEventListener('click', () => reveal(checkUnitsAnswer(q, i).correct));
        return b;
      }));
    } else {
      const input = h('input', { type: 'text', dir: 'ltr', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'התשובה במספר', style: `${BTN}width:10em` });
      const unit = h('span', {}, ' ', code(fmtUnit(a.unit)));
      const check = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
      const submit = () => {
        const r = checkUnitsAnswer(q, input.value);
        if (!r.valid) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
        reveal(r.correct);
      };
      check.addEventListener('click', submit);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
      controls = h('div', { class: 'panel' }, input, unit, ' ', check);
    }
    const head = q.type === 'dim' ? h('div', { class: 'panel' }, code(q.shown)) : null;
    ctx.show(crumbs('#/units', '→ יציאה (ההתקדמות נשמרת)'), h('h1', {}, TITLE), h('p', { class: 'muted' }, `${done + 1} מתוך ${total}`),
      h('p', {}, h('strong', {}, q.prompt)), head, controls, out);
  };
  next();
}
