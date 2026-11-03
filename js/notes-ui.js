// #/notes: "דגשים" memory cards and drill questions (logic in notes.js, content in data/notes.json, checked by tools/verify-notes.mjs).
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import { mathBlock } from './mathdir.js';
import { feedbackCard } from './feedback-ui.js';
import * as store from './store.js';
import { visitOutcome } from './engine.js';
import { answerWidget } from './mathhard-ui.js';
import { canonSpec, studentCanon, sameCanon, diagnose, prettyAnswer } from './mathhard.js';
import {
  NOTES_TOPIC, GROUPS, loadNotesData, loadNotes, saveNotes, gradeCard, dueCards, requeueGap, boxCounts, recordDrill,
  MAX_BOX, cardKnown, cardOutcome, groupCounts,
} from './notes.js';

const BTN = 'min-height:44px;';
const FAMILY = { generic: 'לפני שמעבירים אגפים: מה הסימן של כל חזקה? לפני שמכפילים אי־שוויון: מה הסימן של הכופל? ובלוגריתם: תחום קודם.' };
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
/** log_2(x) -> log<sub>2</sub>(x), log_(1/3)(x) -> log<sub>1/3</sub>(x). */
const fmt = (s) => String(s ?? '').replace(/log_\(([^()]+)\)\(/g, 'log<sub>$1</sub>(').replace(/log_(\d+(?:\.\d+)?|[a-z])\(/g, 'log<sub>$1</sub>(');
const line = (s, cls = '') => mathBlock(fmt(s), cls);
const para = (s, cls = '') => h('p', { class: cls, steps: fmt(s) });
const varOf = (ex) => { const m = ex.check.type === 'value' ? /^\s*([A-Za-z])\s*=/.exec(ex.eq[0]) : null; return m ? m[1] : 'x'; };
const secs = (t0) => Math.round((Date.now() - t0) / 1000);

export async function viewNotesRoute(ctx, sub, id) {
  document.title = 'דגשים – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, 'דגשים'), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadNotesData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, 'דגשים'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את הדגשים. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש בלי רשת).'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewNotesRoute(ctx, sub, id) }, 'נסו שוב')));
  }
  if (sub === 'cards') return viewCards(ctx, res);
  if (sub === 'read') return viewRead(ctx, res);
  if (sub === 'drill') return drillList(ctx, res);
  if (sub === 'ex') return viewQuestion(ctx, res, id);
  return viewHub(ctx, res);
}

/* ---------- hub ---------- */
function viewHub(ctx, res) {
  const st = loadNotes();
  const due = dueCards(st, res.cards, Date.now(), 999).length;
  const tried = res.questions.filter((q) => st.drills[q.id] && st.drills[q.id].right > 0).length;
  const tile = (href, title, desc) => h('a', { class: 'card', href }, h('strong', {}, title), h('span', { class: 'muted' }, desc));
  ctx.show(crumbs(), h('h1', {}, '📌 דגשים: מה שחשוב לזכור'),
    h('section', { class: 'panel' }, h('strong', {}, 'הדגש הראשון, ומלכודת קבועה במבחנים'),
      line('a > 0 ⟹ a^x > 0 (לכל x)'),
      h('p', {}, 'חזקה בבסיס חיובי היא חיובית תמיד. לכן a^x = מספר שלילי אין לו פתרון, a^x > מספר שלילי נכון לכל x, ו־a^x < מספר שלילי לא מתקיים אף פעם.')),
    h('div', { class: 'cards' },
      tile('#/notes/cards', '🗂️ כרטיסיות דגשים', `${due} כרטיסים לתרגול עכשיו מתוך ${res.cards.length}. בכל כרטיס שאלה קצרה עם תשובה מדויקת, ואז הכלל, ההסבר והמלכודת.`),
      tile('#/notes/read', '📖 כל הדגשים ברשימה', `${res.cards.length} כללים בשלוש קבוצות (${groupCounts(res.cards).join(' · ')}): כלל בשורה, למה זה נכון, ומלכודת.`),
      tile('#/notes/drill', '✏️ תרגילים', `${res.questions.length} שאלות חדשות על הדגשים. נפתרו ${tried}.`),
      h('a', { class: 'card', href: '#/logs' }, h('strong', {}, '📏 הקורס המלא בלוגריתמים'), h('span', { class: 'muted' }, 'שיעורים, כרטיסיות ותרגילים מהיסוד'))));
}

/* ---------- reading list ---------- */
function cardBody(c) {
  return [para(c.rule), h('p', {}, h('strong', {}, 'למה: '), c.why),
    h('div', { class: 'panel notice', 'aria-label': 'מלכודת' }, h('strong', {}, '⚠️ מלכודת'),
      h('p', {}, h('strong', {}, 'הטעות:')), line(c.trap.wrong), h('p', {}, h('strong', {}, 'נכון: '), c.trap.right))];
}

function viewRead(ctx, res) {
  document.title = 'כל הדגשים – Brain Gains';
  ctx.show(crumbs('#/notes', '→ לדגשים'), h('h1', {}, 'כל הדגשים'),
    ...GROUPS.map((g) => h('section', { 'aria-label': g.label },
      h('h2', {}, g.label),
      ...res.cards.filter((c) => c.group === g.id).map((c) => h('section', { class: 'panel' }, h('strong', {}, isolateTitle(c.name)), ...cardBody(c))))),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/notes/cards' }, 'לכרטיסיות ←'), h('a', { class: 'btn', href: '#/notes' }, 'לתפריט')));
}

/* ---------- one question: shared by the cards and the drill ---------- */
/**
 * Builds the question block (statement, answer inputs, check / hint / solution buttons).
 * Calls opts.onFinish(state) exactly once: solved, or the solution was shown. state = { solved, hints, wrongs, peeked }.
 */
function questionBlock(ex, { onFinish, solutionLabel = 'הצגת פתרון מלא' }) {
  const want = canonSpec(ex.answer);
  const st = { hints: 0, wrongs: 0, over: false, solved: false, peeked: false };
  const widget = answerWidget(ex);
  const out = h('div', { 'aria-live': 'polite' });
  const hintBox = h('div', { 'aria-live': 'polite' });
  const solBox = h('div');
  const checkBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
  const hintBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'רמז 1');
  const solBtn = h('button', { class: 'btn', type: 'button', style: BTN }, solutionLabel);

  function finish() {
    if (st.over) return;
    st.over = true;
    widget.lock();
    [checkBtn, hintBtn, solBtn].forEach((b) => { b.disabled = true; });
    solBox.replaceChildren(h('section', { class: 'panel', 'aria-label': 'פתרון מלא' }, h('strong', {}, 'פתרון: '),
      ...ex.steps.map((s) => line(s)),
      ex.trap ? para(`⚠️ מלכודת: ${ex.trap.text}`, 'notice') : null,
      h('p', { dir: 'ltr', class: 'muted' }, prettyAnswer(ex.answer, varOf(ex)))));
    onFinish(st, out);
  }
  checkBtn.addEventListener('click', () => {
    if (st.over) return;
    const r = studentCanon(ex.answer.kind, widget.read());
    if (!r.ok) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
    if (sameCanon(r.canon, want)) {
      st.solved = true;
      out.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון! ' + (st.wrongs ? '' : st.hints ? '(עם רמזים)' : 'פתרתם לבד.')));
      finish();
    } else {
      st.wrongs++;
      out.replaceChildren(h('div', { class: 'feedback bad', role: 'alert', steps: 'לא מדויק. ' + diagnose(ex, r.canon, want, FAMILY) }),
        h('p', { class: 'muted' }, 'אפשר לתקן ולבדוק שוב, לקחת רמז, או להציג פתרון.'));
    }
  });
  hintBtn.addEventListener('click', () => {
    if (st.over) return;
    st.hints = Math.min(2, st.hints + 1);
    hintBox.replaceChildren(...ex.hints.slice(0, st.hints).map((t, i) => para(`רמז ${i + 1}: ${t}`, 'notice')));
    hintBtn.textContent = st.hints >= 2 ? 'אין עוד רמזים' : 'רמז 2';
    if (st.hints >= 2) hintBtn.disabled = true;
  });
  solBtn.addEventListener('click', () => { if (!st.over) { st.peeked = true; finish(); } });

  const el = h('div', {},
    para(ex.ask),
    h('div', { class: 'panel' }, ...ex.eq.map((e) => line(e))),
    widget.el,
    h('div', { class: 'btn-row' }, checkBtn, hintBtn, solBtn),
    hintBox, out, solBox);
  return { el, st };
}

/* ---------- flashcards (Leitner) ---------- */
function viewCards(ctx, res) {
  document.title = 'כרטיסיות דגשים – Brain Gains';
  const state = loadNotes();
  const queue = dueCards(state, res.cards, Date.now(), 12);
  const total = queue.length;
  const t0 = Date.now();
  let right = 0;
  let wrong = 0;
  const box = h('div');
  if (!total) {
    const c = boxCounts(state, res.cards);
    return ctx.show(crumbs('#/notes', '→ לדגשים'), h('h1', {}, 'כרטיסיות דגשים'),
      h('p', {}, 'אין כרטיסים לתרגול כרגע. חזרו מאוחר יותר, או קראו שוב את הדגשים.'),
      h('p', { class: 'muted' }, `קופסאות: ${c.map((n, i) => `${i}: ${n}`).join(' · ')}`),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/notes/read' }, 'לדגשים ברשימה'), h('a', { class: 'btn', href: '#/notes/drill' }, 'לתרגילים')));
  }
  function show() {
    if (!queue.length) return finish();
    const card = queue[0];
    const s = state.cards[card.id];
    const started = Date.now();
    const q = questionBlock({ ...card.mini, id: card.id, title: card.name }, {
      solutionLabel: 'הצגת הכלל והפתרון',
      onFinish: (r, out) => {
        const known = cardKnown(r);
        gradeCard(state, card.id, known);
        saveNotes(state);
        store.recordAttempt({ exerciseId: card.id, topic: NOTES_TOPIC, outcome: cardOutcome(r), hintsUsed: r.hints, seconds: secs(started) });
        queue.shift();
        if (known) right++; else { wrong++; queue.splice(requeueGap(queue.length), 0, card); }
        out.append(h('section', { class: 'panel', 'aria-label': 'הכלל' }, h('strong', {}, 'הכלל'), ...cardBody(card)),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: show }, queue.length ? 'הכרטיס הבא ←' : 'לסיום')));
      },
    });
    box.replaceChildren(
      h('p', { class: 'muted' }, `נשארו ${queue.length} · קופסה ${s ? s.box : 0} מתוך ${MAX_BOX}`),
      h('section', { class: 'panel' }, h('strong', {}, isolateTitle(card.name)),
        h('p', { class: 'muted' }, 'קודם שאלה קצרה. הכלל והמלכודת יוצגו אחרי התשובה.'), q.el));
  }
  function finish() {
    store.recordAttempt({ exerciseId: 'notes-cards', topic: NOTES_TOPIC, outcome: wrong === 0 ? 'alone' : 'hinted', hintsUsed: 0, seconds: secs(t0) });
    box.replaceChildren(
      h('div', { class: 'feedback ok', role: 'status' }, `סיימנו: ${right} כרטיסים בלי טעות, ${wrong} חזרו לתור.`),
      feedbackCard({
        exerciseId: 'notes-cards', topic: 'math', mode: 'notes', attemptId: t0,
        context: () => ({ correct: wrong === 0, hintsUsed: 0, solutionViewed: wrong > 0, secondsSpent: secs(t0) }),
      }),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/notes/cards' }, 'סבב נוסף'), h('a', { class: 'btn', href: '#/notes' }, 'לתפריט')));
  }
  ctx.show(crumbs('#/notes', '→ לדגשים'), h('h1', {}, 'כרטיסיות דגשים'),
    h('p', { class: 'muted' }, `${total} כרטיסים. כרטיס נחשב ״ידוע״ רק אם פתרתם את השאלה הקצרה בלי רמז, בלי טעות ובלי להציץ בכלל.`), box);
  show();
}

/* ---------- drill questions ---------- */
function drillList(ctx, res) {
  document.title = 'תרגילי דגשים – Brain Gains';
  const st = loadNotes();
  const order = res.questions;
  ctx.show(crumbs('#/notes', '→ לדגשים'), h('h1', {}, 'תרגילי דגשים'),
    h('p', { class: 'muted' }, 'שאלות חדשות על אותם דגשים. תשובות מדויקות: מספרים, קטעים, או ״אין פתרון״.'),
    h('ul', { class: 'ex-list' }, order.map((q) => {
      const d = st.drills[q.id];
      return h('li', {}, h('a', { class: 'ex-item', href: `#/notes/ex/${q.id}` },
        h('span', { class: 't' }, isolateTitle(q.title)),
        h('span', { class: `tick o-${d && d.right ? 'alone' : 'none'}`, role: 'img', 'aria-label': d && d.right ? 'נפתר' : 'טרם נפתר' }, d && d.right ? '✓' : '○')));
    })));
}

function viewQuestion(ctx, res, id) {
  const ex = res.questions.find((x) => x.id === id);
  if (!ex) return drillList(ctx, res);
  document.title = `${isolateTitle(ex.title)} – Brain Gains`;
  const next = res.questions[res.questions.indexOf(ex) + 1];
  const t0 = Date.now();
  const q = questionBlock(ex, {
    onFinish: (r, out) => {
      const state = loadNotes();
      recordDrill(state, ex.id, r.solved);
      saveNotes(state);
      store.recordAttempt({ exerciseId: ex.id, topic: NOTES_TOPIC, outcome: visitOutcome(r), hintsUsed: r.hints, seconds: secs(t0) });
      out.append(feedbackCard({
        exerciseId: ex.id, topic: 'math', mode: 'notes', level: ex.tier, attemptId: t0,
        context: () => ({ correct: r.solved, hintsUsed: r.hints, solutionViewed: !r.solved, secondsSpent: secs(t0) }),
      }), h('div', { class: 'btn-row' },
        next ? h('a', { class: 'btn primary', href: `#/notes/ex/${next.id}` }, 'התרגיל הבא ←') : null,
        h('a', { class: 'btn', href: '#/notes/drill' }, 'לרשימת התרגילים')));
    },
  });
  ctx.show(crumbs('#/notes/drill', '→ לרשימת התרגילים'), h('h1', {}, isolateTitle(ex.title)), q.el);
}
