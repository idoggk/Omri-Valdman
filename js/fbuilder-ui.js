// #/formulas: personal formula-sheet builder. He types each formula from memory; the numeric checker (js/fbuilder.js)
// decides. Right = green mark and the formula enters his sheet; wrong = the correct form is shown, the item is queued in the
// Leitner boxes and written to the error notebook. Routes: #/formulas, #/formulas/build[/<topic>], #/formulas/review,
// #/formulas/sheet.
import { h } from './dom.js';
import * as store from './store.js';
import { loadFeedback } from './feedback.js';
import { load as loadNotebook, save as saveNotebook, syncNotebook } from './notebook.js';
import { describer } from './notebook-ui.js';
import {
  loadCatalogue, loadSaved, saveSaved, recordCheck, checkAnswer, dueQueue, buildQueue, sheetGroups, attemptId, FORMULAS_TOPIC, TOKEN_HELP,
} from './fbuilder.js';

const TITLE = '📋 הדף שלי: בונים דף נוסחאות מהזיכרון';
const BTN = 'min-height:44px;';
/** A left-to-right formula in its own element, set as plain text (h() would insert bidi marks inside the expression). */
const code = (text, cls = '') => { const el = h('bdi', { dir: 'ltr', class: cls || null }); el.textContent = text; return el; };
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));

export async function viewFormulas(ctx, mode, arg) {
  document.title = 'הדף שלי – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadCatalogue(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את הנוסחאות. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewFormulas(ctx, mode, arg) }, 'נסו שוב')));
  }
  const cat = res.data;
  if (mode === 'build') return runQueue(ctx, cat, 'build', arg || '');
  if (mode === 'review') return runQueue(ctx, cat, 'review', '');
  if (mode === 'sheet') return sheetView(ctx, cat);
  return home(ctx, cat);
}

function home(ctx, cat) {
  const saved = loadSaved();
  const now = Date.now();
  const total = cat.items.length;
  const onSheet = cat.items.filter((q) => saved.sheet[q.id]).length;
  const due = dueQueue(saved, cat.items, now, 99).length;
  const queued = cat.items.filter((q) => saved.cards[q.id]).length;
  const left = buildQueue(saved, cat.items).length;
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, 'כותבים כל נוסחה מהזיכרון, והמערכת בודקת אם הביטוי שלכם שווה לנוסחה הנכונה (לא נדרשת צורה זהה). נוסחה שכתבתם נכון נכנסת לדף האישי שלכם עם סימון ירוק. נוסחה שטעיתם בה חוזרת בכרטיסיות ונכנסת למחברת הטעויות.'),
    h('p', { class: 'muted' }, 'כותבים בכתב לועזי: ', code(TOKEN_HELP), '. כפל נכתב תמיד עם * (למשל 2*x).'),
    h('p', { role: 'status' }, `בדף שלכם: ${onSheet} מתוך ${total} · בכרטיסיות לחזרה: ${queued} (${due} מחכות עכשיו) · עוד לא ניסיתם: ${left}`),
    h('div', { class: 'btn-row' },
      left ? h('a', { class: 'btn primary', style: BTN, href: '#/formulas/build' }, 'להמשיך לבנות את הדף') : null,
      due ? h('a', { class: 'btn primary', style: BTN, href: '#/formulas/review' }, `חזרה על ${due} כרטיסיות`) : null,
      h('a', { class: 'btn', style: BTN, href: '#/formulas/sheet' }, 'הדף שלי והדפסה')),
    h('h2', {}, 'לפי נושא'),
    h('div', { class: 'cards' }, cat.topics.map((t) => {
      const items = cat.items.filter((q) => q.topic === t.id);
      const have = items.filter((q) => saved.sheet[q.id]).length;
      return h('a', { class: 'card', href: `#/formulas/build/${t.id}` }, h('strong', {}, t.title), h('span', { class: 'muted' }, `${have} מתוך ${items.length} בדף שלכם`));
    })));
}

/** Stores a result: sheet / cards, the attempt log, and (when wrong) a notebook entry through the notebook API. */
export function applyResult(ctx, item, correct, seconds, now = Date.now()) {
  const saved = loadSaved();
  recordCheck(saved, item.id, correct, now);
  saveSaved(saved);
  store.recordAttempt({ exerciseId: attemptId(item.id), topic: FORMULAS_TOPIC, outcome: correct ? 'alone' : 'wrong', hintsUsed: 0, seconds: Math.max(0, Math.round(seconds)) });
  if (!correct) {
    const nb = loadNotebook();
    if (syncNotebook(nb, store.getAttempts(), loadFeedback(), describer(ctx), now)) saveNotebook(nb);
  }
}

function runQueue(ctx, cat, mode, topic) {
  const saved0 = loadSaved();
  let queue = mode === 'review' ? dueQueue(saved0, cat.items, Date.now(), 12) : buildQueue(saved0, cat.items, topic).slice(0, 10);
  const topicTitle = topic ? (cat.topics.find((t) => t.id === topic) || { title: '' }).title : '';
  const heading = mode === 'review' ? 'חזרה על כרטיסיות' : `בונים את הדף${topicTitle ? `: ${topicTitle}` : ''}`;
  let done = 0;
  let wrong = 0;
  const total = queue.length;

  const finish = () => {
    document.title = 'הדף שלי – Brain Gains';
    ctx.show(crumbs('#/formulas', '→ לדף הנוסחאות'), h('h1', {}, heading),
      total ? h('p', { class: wrong ? 'notice' : 'feedback ok', role: 'status' }, wrong ? `סיימנו ${total}. ${total - wrong} נכונות, ${wrong} חוזרות בכרטיסיות ונכנסו למחברת הטעויות.` : `סיימנו ${total} נוסחאות, כולן נכונות. הן בדף שלכם.`)
        : h('p', { class: 'notice' }, mode === 'review' ? 'אין כרטיסיות לחזרה עכשיו.' : 'אין עוד נוסחאות חדשות בנושא הזה.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: '#/formulas/sheet' }, 'הדף שלי'), h('a', { class: 'btn', style: BTN, href: '#/formulas' }, 'חזרה')));
  };

  const next = () => {
    const q = queue.shift();
    if (!q) return finish();
    const t0 = Date.now();
    const out = h('div', { 'aria-live': 'polite' });
    const step = () => { done += 1; next(); };
    const nextBtn = (label = 'הבאה') => h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: step }, label);
    const head = [crumbs('#/formulas', '→ יציאה (ההתקדמות נשמרת)'), h('h1', {}, heading), h('p', { class: 'muted' }, `${done + 1} מתוך ${total}`), h('p', {}, h('strong', {}, q.prompt))];
    if (q.kind === 'self') {
      const reveal = h('button', { class: 'btn', type: 'button', style: BTN }, 'הציגו את התשובה');
      reveal.addEventListener('click', () => {
        reveal.disabled = true;
        const know = h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => { applyResult(ctx, q, true, (Date.now() - t0) / 1000); step(); } }, 'ידעתי');
        const dont = h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { wrong += 1; applyResult(ctx, q, false, (Date.now() - t0) / 1000); step(); } }, 'לא ידעתי');
        out.replaceChildren(h('div', { class: 'panel' }, h('strong', {}, 'התשובה: '), code(q.answer), q.note ? h('p', { class: 'muted' }, q.note) : null), h('div', { class: 'btn-row' }, know, dont));
      });
      return ctx.show(...head, h('div', { class: 'btn-row' }, reveal), out);
    }
    const input = h('input', { type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', maxlength: '160', 'aria-label': 'הנוסחה שלכם', style: `${BTN}width:min(100%,28em);font-family:monospace` });
    const check = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
    const submit = () => {
      const r = checkAnswer(q, input.value);
      if (!r.valid) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
      input.disabled = true; check.disabled = true;
      applyResult(ctx, q, r.correct, (Date.now() - t0) / 1000);
      if (r.correct) {
        out.replaceChildren(h('p', { class: 'feedback ok', role: 'status' }, '✓ נכון! הנוסחה נכנסה לדף שלכם.'), h('div', { class: 'btn-row' }, nextBtn()));
      } else {
        wrong += 1;
        out.replaceChildren(
          h('p', { class: 'feedback bad', role: 'alert' }, 'לא נכון.', r.trap ? ` ${r.trap.note}` : ''),
          h('div', { class: 'panel' }, h('strong', {}, 'הצורה הנכונה: '), code(`${q.lhs} ${q.ref}`)),
          h('p', { class: 'muted' }, 'הנוסחה חוזרת בכרטיסיות ונכנסה למחברת הטעויות.'), h('div', { class: 'btn-row' }, nextBtn()));
      }
    };
    check.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !check.disabled) { ev.preventDefault(); submit(); } });
    ctx.show(...head, h('div', { class: 'panel' }, code(q.lhs), ' ', input), h('div', { class: 'btn-row' }, check), out);
  };
  next();
}

function sheetView(ctx, cat) {
  const saved = loadSaved();
  const groups = sheetGroups(saved, cat);
  const count = groups.reduce((s, g) => s + g.items.length, 0);
  document.title = 'הדף שלי – Brain Gains';
  ctx.show(crumbs('#/formulas', '→ לדף הנוסחאות'), h('h1', {}, 'דף הנוסחאות שלי'),
    h('p', { class: 'muted no-print' }, 'רק נוסחאות שכתבתם נכון מהזיכרון מופיעות כאן. ההדפסה היא ב־A4 בשני טורים. (ההדפסה עובדת באתר עצמו ולא בתצוגה מקדימה בתוך תיבת חול.)'),
    h('div', { class: 'btn-row no-print' },
      h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => window.print() }, '🖨️ הדפסה'),
      h('a', { class: 'btn', style: BTN, href: '#/formulas/build' }, 'להוסיף נוסחאות')),
    count ? h('div', { class: 'fs-sheet' }, groups.map((g) => h('section', { class: 'fs-group' },
      h('h2', {}, g.topic.title),
      h('ul', { class: 'fs-list' }, g.items.map((q) => h('li', { class: 'fs-item' },
        h('span', { class: 'fs-mark', role: 'img', 'aria-label': 'נכתבה נכון מהזיכרון' }, '✓'), ' ',
        h('span', { class: 'fs-note' }, q.prompt), ' ',
        code(q.kind === 'self' ? q.answer : `${q.lhs} ${q.ref}`, 'fs-formula')))))))
      : h('p', { class: 'notice' }, 'הדף ריק. כתבו כמה נוסחאות נכון מהזיכרון והן יופיעו כאן.'));
}
