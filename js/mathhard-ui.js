// #/mathhard: hard math set (radicals, exponents, rational inequalities, parameters, circles).
// List with a method card per family, and one exercise page with set / point / interval answer inputs,
// two progressive hints, a domain step, typical-mistake feedback and the difficulty feedback card.
import { h, ltr } from './dom.js';
import { isolateTitle } from './bidi.js';
import { feedbackCard } from './feedback-ui.js';
import * as store from './store.js';
import { tryFirst } from './tryfirst-ui.js';
import { attemptExtra } from './tryfirst.js';
import { confidenceBar, predExtra } from './calibration-ui.js';
import { mathHardTopic, visitOutcome } from './engine.js';
import {
  FAMILIES, TIERS, loadMathHardData, loadSaved, recordAttempt, canonSpec, studentCanon, sameCanon, diagnose, prettyAnswer,
} from './mathhard.js';

const TITLE = '🧠 מתמטיקה ברמה גבוהה';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const famOf = (id) => FAMILIES.find((f) => f.id === id);
const tierOf = (n) => TIERS.find((t) => t.id === n);

export async function viewMathHard(ctx, id) {
  document.title = 'מתמטיקה ברמה גבוהה – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadMathHardData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewMathHard(ctx, id) }, 'נסו שוב')));
  }
  const ex = id ? res.data.find((x) => x.id === id) : null;
  return ex ? runExercise(ctx, res.data, ex) : list(ctx, res.data);
}

function list(ctx, data) {
  const saved = loadSaved().items;
  const done = data.filter((e) => saved[e.id] && saved[e.id].solved).length;
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', { class: 'muted' }, `${data.length} תרגילים ברמת שיעורי הבית ומעליה, בחמישה נושאים ובשלוש רמות. נפתרו ${done}. כל תשובה מדויקת: שורשים, שברים, קטעים עם סוגריים עגולים או מרובעים.`),
    ...FAMILIES.map((f) => h('section', { class: 'panel', 'aria-label': f.title },
      h('h2', {}, `${f.icon} ${f.title}`),
      h('details', {}, h('summary', {}, 'כרטיס שיטה'), h('ul', {}, f.method.map((m) => h('li', {}, m)))),
      ...TIERS.map((t) => {
        const items = data.filter((e) => e.family === f.id && e.tier === t.id);
        if (!items.length) return null;
        return h('div', {}, h('h3', {}, t.label),
          h('ul', { class: 'ex-list' }, items.map((e) => {
            const s = saved[e.id];
            return h('li', {}, h('a', { class: 'ex-item', href: `#/mathhard/${e.id}` },
              h('span', { class: 't' }, isolateTitle(e.title)),
              e.trap && s && s.solved ? h('span', { class: 'muted', title: 'יש כאן מלכודת' }, '⚠️ מלכודת') : null, // shown only after solving: it would spoil the trap
              h('span', { class: `tick o-${s && s.solved ? (s.alone ? 'alone' : 'hinted') : 'none'}`, role: 'img', 'aria-label': s && s.solved ? 'נפתר' : 'טרם נפתר' }, s && s.solved ? '✓' : '○')));
          })));
      }))));
}

/** Answer widget for one kind. Returns { el, read() -> input for studentCanon, busy(flag) }. */
export function answerWidget(ex) {
  const kind = ex.answer.kind;
  const rowsBox = h('div');
  let none = false;
  const noneBtn = kind === 'number' ? null : h('button', { class: 'chip', type: 'button', style: BTN, 'aria-pressed': 'false', onclick: () => { none = !none; noneBtn.setAttribute('aria-pressed', String(none)); rowsBox.hidden = none; } }, 'אין פתרון');
  let last = null; // last focused input: the symbol keys below type into it (the decimal keypad has no letters)
  const inp = (label, w = '7em') => h('input', {
    type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', 'aria-label': label, style: `${BTN}width:${w};text-align:center`,
    onfocus: (ev) => { last = ev.target; },
  });
  const sym = (ch, label) => h('button', { class: 'chip', type: 'button', style: `${BTN}min-width:44px`, 'aria-label': label, onclick: () => { if (last) { last.value += ch; if (last.focus) last.focus(); } } }, ch);
  const rows = [];
  const addRow = () => {
    const n = rows.length + 1;
    let row;
    if (kind === 'points') {
      const cells = [inp(`x של נקודה ${n}`, '5em'), inp(`y של נקודה ${n}`, '5em')];
      row = { read: () => cells.map((c) => c.value), el: h('div', { class: 'btn-row' }, '(', cells[0], ' , ', cells[1], ')'), cells };
    } else if (kind === 'interval') {
      const st = { lc: false, hc: false };
      const lo = inp(`קצה שמאלי של קטע ${n}`);
      const hi = inp(`קצה ימני של קטע ${n}`);
      const tog = (key, openCh, closedCh, label) => {
        const b = h('button', { class: 'chip', type: 'button', style: `${BTN}min-width:44px`, 'aria-label': label, onclick: () => { st[key] = !st[key]; b.textContent = st[key] ? closedCh : openCh; } }, openCh);
        return b;
      };
      const lb = tog('lc', '(', '[', `סוגר שמאלי של קטע ${n}: עגול או מרובע`);
      const rb = tog('hc', ')', ']', `סוגר ימני של קטע ${n}: עגול או מרובע`);
      row = { read: () => ({ lc: st.lc, lo: lo.value, hi: hi.value, hc: st.hc }), el: h('div', { class: 'btn-row', dir: 'ltr' }, lb, lo, ' , ', hi, rb), cells: [lo, hi] };
    } else {
      const c = inp(kind === 'number' ? 'התשובה' : `פתרון ${n}`, '9em');
      row = { read: () => c.value, el: h('div', { class: 'btn-row' }, c), cells: [c] };
    }
    rows.push(row);
    rowsBox.append(row.el);
  };
  addRow();
  if (kind !== 'number') addRow();
  const addBtn = kind === 'number' ? null : h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { if (rows.length < 6) addRow(); } },
    kind === 'interval' ? '+ קטע נוסף (איחוד)' : kind === 'points' ? '+ נקודה נוספת' : '+ פתרון נוסף');
  const hint = {
    set: 'כתבו כל פתרון בשורה נפרדת: מספר, שבר (3/4) או שורש (sqrt(7) או √7).',
    number: 'כתבו מספר, שבר (3/4) או ביטוי עם שורש (3*sqrt(2)).',
    points: 'כל נקודה בשורה: x ו־y. מותר שבר ושורש.',
    interval: 'כל קטע בשורה: לחצו על הסוגריים להחלפה בין עגול ( ) למרובע [ ]. אינסוף: inf או -inf. איחוד: כמה שורות.',
  }[kind];
  const keys = h('div', { class: 'btn-row', 'aria-label': 'מקשי עזר' }, sym('√', 'הוספת שורש ריבועי'), sym('∛', 'הוספת שורש שלישי'),
    sym('/', 'קו שבר'), sym('(', 'פתיחת סוגריים'), sym(')', 'סגירת סוגריים'), kind === 'interval' ? sym('∞', 'אינסוף') : null);
  const el = h('div', {}, h('p', { class: 'muted' }, hint), rowsBox, keys, h('div', { class: 'btn-row' }, addBtn, noneBtn));
  return {
    el,
    read: () => ({ none, rows: rows.map((r) => r.read()) }),
    lock: () => { for (const r of rows) r.cells.forEach((c) => { c.disabled = true; }); el.querySelectorAll?.('button')?.forEach?.((b) => { b.disabled = true; }); },
  };
}

function runExercise(ctx, data, ex) {
  const fam = famOf(ex.family);
  document.title = `${isolateTitle(ex.title)} – Brain Gains`;
  const next = data[data.indexOf(ex) + 1];
  const want = canonSpec(ex.answer);
  const t0 = Date.now();
  const st = { hints: 0, wrongs: 0, over: false, solved: false };
  const widget = answerWidget(ex);
  const out = h('div', { 'aria-live': 'polite' });
  const hintBox = h('div', { 'aria-live': 'polite' });
  const solBox = h('div');
  const checkBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
  const hintBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'רמז 1');
  const domBtn = ex.domain ? h('button', { class: 'btn', type: 'button', style: BTN }, 'הצגת התחום') : null;
  const solBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'הצגת פתרון מלא');
  const methodCard = h('details', {}, h('summary', {}, `כרטיס שיטה: ${fam.title}`), h('ul', {}, fam.method.map((m) => h('li', {}, m))));
  const tf = tryFirst([hintBtn, domBtn, solBtn, hintBox, methodCard]); // hidden until a first attempt or 60 s, when the mode is on
  const conf = confidenceBar(); // optional "chance of full marks" chips (calibration.js), off by default
  widget.el.addEventListener('input', (ev) => { if (ev && ev.target && String(ev.target.value || '').trim()) tf.attempt(); });

  function showSolution() {
    solBox.replaceChildren(h('section', { class: 'panel', 'aria-label': 'פתרון מלא' }, h('strong', {}, 'פתרון: '),
      ...ex.steps.map((s) => h('div', { steps: s })),
      ex.trap ? h('p', { class: 'notice' }, `⚠️ מלכודת: ${ex.trap.text}`) : null,
      h('p', { dir: 'ltr', class: 'muted' }, prettyAnswer(ex.answer, ex.var))));
  }
  function finish() {
    if (st.over) return;
    st.over = true;
    widget.lock();
    [checkBtn, hintBtn, solBtn].forEach((b) => { b.disabled = true; });
    recordAttempt(ex.id, { solved: st.solved, hints: st.hints, wrongs: st.wrongs });
    store.recordAttempt({ exerciseId: ex.id, topic: mathHardTopic(ex.family), outcome: visitOutcome(st), hintsUsed: st.hints, seconds: Math.round((Date.now() - t0) / 1000), ...attemptExtra(tf.gate), ...predExtra(conf) });
    showSolution();
    out.append(feedbackCard({
      exerciseId: ex.id, topic: 'math', mode: 'mathhard', level: ex.tier, attemptId: t0,
      context: () => ({ correct: st.solved, hintsUsed: st.hints, solutionViewed: !st.solved, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
    }), h('div', { class: 'btn-row' },
      next ? h('a', { class: 'btn primary', href: `#/mathhard/${next.id}` }, 'התרגיל הבא ←') : null,
      h('a', { class: 'btn', href: '#/mathhard' }, 'לרשימת התרגילים')));
  }
  checkBtn.addEventListener('click', () => {
    if (st.over) return;
    tf.attempt();
    conf.lock();
    const r = studentCanon(ex.answer.kind, widget.read());
    if (!r.ok) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
    if (sameCanon(r.canon, want)) {
      st.solved = true;
      out.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון! ' + (st.wrongs ? '' : st.hints ? '(עם רמזים)' : 'פתרתם לבד.')));
      finish();
    } else {
      st.wrongs++;
      out.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, 'לא מדויק. ' + diagnose(ex, r.canon, want, fam)),
        h('p', { class: 'muted' }, 'אפשר לתקן ולבדוק שוב, לקחת רמז, או להציג פתרון.'));
    }
  });
  hintBtn.addEventListener('click', () => {
    if (st.over) return;
    st.hints = Math.min(2, st.hints + 1);
    hintBox.replaceChildren(...ex.hints.slice(0, st.hints).map((t, i) => h('p', { class: 'notice' }, `רמז ${i + 1}: ${t}`)));
    hintBtn.textContent = st.hints >= 2 ? 'אין עוד רמזים' : 'רמז 2';
    if (st.hints >= 2) hintBtn.disabled = true;
  });
  if (domBtn) {
    domBtn.addEventListener('click', () => {
      hintBox.append(h('p', { class: 'notice' }, h('strong', {}, 'שלב התחום: '), ex.domain.text));
      domBtn.disabled = true;
    });
  }
  solBtn.addEventListener('click', () => finish());

  ctx.show(crumbs('#/mathhard', '→ לרשימת התרגילים'), h('h1', {}, isolateTitle(ex.title)),
    h('p', { class: 'muted' }, `${fam.title} · ${tierOf(ex.tier).label}`),
    h('p', {}, ex.ask),
    h('div', { class: 'panel' }, ...ex.eq.map((line) => h('div', { dir: 'ltr', class: 'eq-block' }, ltr(line)))),
    conf.node, tf.bar, methodCard,
    widget.el,
    h('div', { class: 'btn-row' }, checkBtn, hintBtn, domBtn, solBtn),
    hintBox, out, solBox);
}
