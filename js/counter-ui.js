// #/counter: counterexample challenge (20 false claims). List page, then one claim per page: the student types numbers,
// the numeric predicate of the task decides (js/counter.js), and the page explains why the claim fails and what is true.
// All math is a dir=ltr isolate (mathdir.js).
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import { mathBlock, mathInline } from './mathdir.js';
import * as store from './store.js';
import { tryFirst } from './tryfirst-ui.js';
import { attemptExtra } from './tryfirst.js';
import { confidenceBar, predExtra } from './calibration-ui.js';
import { TASKS, TOPIC, byId, load, save, applyCheck, doneCount, checkCounterexample, outcomeOf } from './counter.js';

const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));

export function viewCounter(ctx, sub, id) {
  document.title = 'אתגר הדוגמה הנגדית – Brain Gains';
  if (sub === 't' && byId(id)) return viewTask(ctx, byId(id));
  return viewList(ctx);
}

function viewList(ctx) {
  const state = load();
  ctx.show(crumbs(), h('h1', {}, '🔍 אתגר הדוגמה הנגדית'),
    h('section', { class: 'panel' },
      h('p', {}, 'כדי להפריך טענה כללית מספיקה דוגמה אחת. בכל משימה כאן מופיעה טענה שנשמעת סבירה אבל אינה נכונה תמיד. תפקידכם: להקליד מספרים שמראים שהיא נכשלת.'),
      h('p', { class: 'muted' }, 'הבדיקה מחשבת: הערכים צריכים להיות בתחום של הטענה (כל ביטוי מוגדר וההנחה מתקיימת), והטענה צריכה להיכשל בהם. אחרי הפתרון תראו למה הטענה נכשלת ומה הניסוח הנכון.')),
    h('p', { role: 'status' }, `הופרכו ${doneCount(state)} מתוך ${TASKS.length} טענות.`),
    h('ul', { class: 'ex-list' }, TASKS.map((t) => {
      const e = state.tasks[t.id];
      return h('li', {}, h('a', { class: 'ex-item', href: `#/counter/t/${t.id}` },
        h('span', { class: 't' }, isolateTitle(t.title)),
        h('span', { class: 'muted' }, e && e.done ? '✓ הופרכה' : e ? `ניסיונות: ${e.tries}` : 'חדשה')));
    })));
}

function viewTask(ctx, task) {
  document.title = `${isolateTitle(task.title)} – Brain Gains`;
  const t0 = Date.now();
  const idx = TASKS.indexOf(task);
  const next = TASKS[idx + 1];
  const st = { wrongs: 0, over: false };
  const out = h('div', { 'aria-live': 'polite' });
  const inputs = {};
  const fields = task.vars.map((v) => {
    const input = h('input', { type: 'text', inputmode: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '20', 'aria-label': `הערך של ${v.label}`, style: `${BTN}width:7em` });
    inputs[v.id] = input;
    return h('label', { class: 'field' }, mathInline(v.label), ' = ', input);
  });
  const check = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
  const giveUp = h('button', { class: 'btn', type: 'button', style: BTN }, 'אין לי רעיון, להציג דוגמה והסבר');

  const tf = tryFirst([giveUp]); // the "show the example" escape stays hidden until a first attempt or 60 s, when the mode is on
  const conf = confidenceBar();
  Object.values(inputs).forEach((el) => el.addEventListener('input', () => { if (String(el.value || '').trim()) tf.attempt(); }));

  function explain(solved) {
    const w = task.witness;
    return h('section', { class: 'panel', 'aria-label': 'הסבר' },
      solved ? null : h('p', {}, h('strong', {}, 'דוגמה נגדית: '), mathInline(task.vars.map((v) => `${v.id} = ${w[v.id]}`).join(', '))),
      h('p', {}, h('strong', {}, 'למה הטענה נכשלת: '), task.why),
      h('p', {}, h('strong', {}, 'הניסוח הנכון: ')), mathBlock(task.correct));
  }
  function finish(solved) {
    if (st.over) return;
    st.over = true;
    check.disabled = true; giveUp.disabled = true;
    Object.values(inputs).forEach((el) => { el.disabled = true; });
    const state = load();
    applyCheck(state, task.id, solved);
    save(state);
    store.recordAttempt({ exerciseId: task.id, topic: TOPIC, outcome: outcomeOf({ solved, wrongs: st.wrongs }), hintsUsed: 0, seconds: Math.round((Date.now() - t0) / 1000), ...attemptExtra(tf.gate), ...predExtra(conf) });
    out.append(explain(solved), h('div', { class: 'btn-row' },
      next ? h('a', { class: 'btn primary', href: `#/counter/t/${next.id}` }, 'הטענה הבאה ←') : null,
      h('a', { class: 'btn', href: '#/counter' }, 'לרשימת הטענות')));
  }
  check.addEventListener('click', () => {
    if (st.over) return;
    tf.attempt();
    conf.lock();
    const r = checkCounterexample(task, Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
    if (r.ok) { out.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון! זו דוגמה נגדית: הערכים בתחום והטענה נכשלת בהם.')); finish(true); return; }
    if (r.reason !== 'input') st.wrongs += 1;
    out.replaceChildren(h('div', { class: r.reason === 'input' ? 'error' : 'feedback bad', role: 'alert' }, r.msg));
  });
  giveUp.addEventListener('click', () => finish(false));
  Object.values(inputs).forEach((el) => el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') check.click(); }));

  ctx.show(crumbs('#/counter', '→ לרשימת הטענות'), h('h1', {}, isolateTitle(task.title)),
    h('div', { class: 'panel' }, h('p', {}, h('strong', {}, 'הטענה: '), task.claim), mathBlock(task.eq)),
    h('p', { class: 'muted' }, `תחום: ${task.domainText}`),
    h('p', {}, 'הקלידו ערכים שמפריכים את הטענה. מותר מספר שלם, עשרוני או שבר (1/2).'),
    conf.node, tf.bar,
    h('div', { class: 'btn-row' }, fields), h('div', { class: 'btn-row' }, check, giveUp), out);
}
