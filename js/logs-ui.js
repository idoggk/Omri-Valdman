// #/logs: logarithm course. Lessons (intuition, definition, derivation, worked examples, mistake box, 3-question quiz),
// Leitner flashcards for the ten key rules, and 70 graded exercises in 5 tiers that reuse the #/mathhard answer inputs.
// Logic is in logs.js, content in data/logs-*.json (checked by tools/verify-logs.mjs).
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import { feedbackCard } from './feedback-ui.js';
import { answerWidget } from './mathhard-ui.js';
import { canonSpec, studentCanon, sameCanon, diagnose, prettyAnswer, loadSaved, recordAttempt } from './mathhard.js';
import {
  TIERS, loadLogsData, loadCards, saveCards, gradeCard, dueCards, requeueGap, boxCounts, MAX_BOX, tierCounts,
} from './logs.js';

const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const tierOf = (n) => TIERS.find((t) => t.id === n);
/** log_2(x) -> log<sub>2</sub>(x) so subscripts show in running text too. */
const fmt = (s) => String(s ?? '').replace(/log_(\d+(?:\.\d+)?|[a-z])\(/g, 'log<sub>$1</sub>(');
/** Name shown in front of the answer: "A" for "A = ..." value items, otherwise x. */
const varOf = (ex) => { const m = ex.check.type === 'value' ? /^\s*([A-Za-z])\s*=/.exec(ex.eq[0]) : null; return m ? m[1] : 'x'; };
const line = (s, cls = 'eq-block') => h('div', { class: cls, steps: fmt(s) });
const para = (s, cls = '') => h('p', { class: cls, steps: fmt(s) });

export async function viewLogsRoute(ctx, sub, id) {
  document.title = 'לוגריתמים – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, 'לוגריתמים'), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadLogsData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, 'לוגריתמים'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את הקורס. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewLogsRoute(ctx, sub, id) }, 'נסו שוב')));
  }
  if (sub === 'learn') return id ? viewLesson(ctx, res, id) : lessonList(ctx, res);
  if (sub === 'cards') return viewCards(ctx, res);
  if (sub === 'practice') return practiceList(ctx, res);
  if (sub === 'ex') return viewExercise(ctx, res, id);
  return viewHub(ctx, res);
}

/* ---------- hub ---------- */
function viewHub(ctx, res) {
  const st = loadCards();
  const due = dueCards(st, res.cards, Date.now(), 999).length;
  const saved = loadSaved().items;
  const done = res.exercises.filter((e) => saved[e.id] && saved[e.id].solved).length;
  const tile = (href, title, desc) => h('a', { class: 'card', href }, h('strong', {}, title), h('span', { class: 'muted' }, desc));
  ctx.show(crumbs(), h('h1', {}, '📏 לוגריתמים מהיסוד'),
    h('section', { class: 'panel' }, h('strong', {}, 'הרעיון בשורה אחת'),
      para('log_a(b) = c ⟺ a^c = b'),
      h('p', {}, 'לוגריתם הוא המעריך: ״a בחזקת מה נותן b?״. מכאן כל הכללים נגזרים מחוקי החזקות, וכל שיעור מראה את הגזירה.')),
    h('div', { class: 'cards' },
      tile('#/logs/learn', '📖 שיעורים', `${res.lessons.length} שיעורים: אינטואיציה, הגדרה, דוגמאות פתורות צעד אחר צעד, ״טעות נפוצה״ ומבחן עצמי של 3 שאלות`),
      tile('#/logs/cards', '🗂️ כרטיסיות זכירה', `${due} כרטיסים לתרגול עכשיו מתוך ${res.cards.length}. עשרת הכללים החשובים, בשיטת קופסאות`),
      tile('#/logs/practice', '✏️ תרגילים', `${res.exercises.length} תרגילים בחמש רמות (${tierCounts(res.exercises).join(' · ')}). נפתרו ${done}. תחום, כרטיס שיטה ומלכודות בכל רמה`)));
}

/* ---------- lessons ---------- */
function lessonList(ctx, res) {
  document.title = 'שיעורי לוגריתמים – Brain Gains';
  ctx.show(crumbs('#/logs', '→ לתפריט הלוגריתמים'), h('h1', {}, 'שיעורים'),
    h('p', { class: 'muted' }, 'לפי הסדר: כל שיעור בנוי על הקודם.'),
    h('ul', { class: 'ex-list' }, res.lessons.map((l, i) => h('li', {}, h('a', { class: 'ex-item', href: `#/logs/learn/${l.id}` },
      h('span', { class: 'badge' }, String(i + 1)), h('span', { class: 't' }, isolateTitle(l.title.replace(/^\d+\.\s*/, ''))))))));
}

function quizBlock(l) {
  const box = h('div');
  let right = 0;
  let answered = 0;
  const score = h('p', { class: 'muted', role: 'status' });
  l.quiz.forEach((q, qi) => {
    const out = h('div', { 'aria-live': 'polite' });
    const btns = q.options.map((o, oi) => {
      const b = h('button', { class: 'btn', type: 'button', style: `${BTN}display:block;width:100%;margin:6px 0;text-align:start` }, o);
      b.addEventListener('click', () => {
        if (btns[oi].disabled) return;
        const ok = oi === q.ans;
        answered++;
        if (ok) right++;
        btns.forEach((x) => { x.disabled = true; });
        out.replaceChildren(h('div', { class: `feedback ${ok ? 'ok' : 'bad'}`, role: ok ? 'status' : 'alert' }, ok ? 'נכון!' : `לא נכון. התשובה הנכונה: ${q.options[q.ans]}.`), para(q.why));
        score.textContent = answered === l.quiz.length ? `סיימתם: ${right} מתוך ${l.quiz.length}.` : `${answered} מתוך ${l.quiz.length} נענו.`;
      });
      return b;
    });
    box.append(h('section', { class: 'panel' }, h('p', {}, h('strong', {}, `שאלה ${qi + 1}. `), q.q), ...btns, out));
  });
  box.append(score);
  return box;
}

function viewLesson(ctx, res, id) {
  const l = res.lessons.find((x) => x.id === id);
  if (!l) return lessonList(ctx, res);
  document.title = `${l.title} – Brain Gains`;
  const next = res.lessons[res.lessons.indexOf(l) + 1];
  const stepsBox = h('div');
  const status = h('p', { class: 'muted', role: 'status' });
  let shown = 0;
  const more = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'הצעד הבא');
  const all = h('button', { class: 'btn', type: 'button', style: BTN }, 'הציגו הכול');
  function reveal() {
    const st = l.derive[shown++];
    stepsBox.append(h('div', { class: 'panel' }, para(`צעד ${shown}. ${st.say}`), st.eq ? line(st.eq) : null));
    status.textContent = shown < l.derive.length ? `${shown} מתוך ${l.derive.length}. נסו לנחש את הצעד הבא לפני שלוחצים.` : 'זהו, סיימנו את הגזירה.';
    if (shown >= l.derive.length) { more.disabled = true; all.disabled = true; }
  }
  more.addEventListener('click', reveal);
  all.addEventListener('click', () => { while (shown < l.derive.length) reveal(); });
  const table = l.table ? h('table', { class: 'pattern', 'aria-label': l.table.caption },
    h('tr', {}, ...l.table.head.map((c) => h('th', { dir: 'ltr' }, c))),
    ...l.table.rows.map((r) => h('tr', {}, ...r.map((c) => h('td', { dir: 'ltr' }, c))))) : null;

  ctx.show(crumbs('#/logs/learn', '→ לרשימת השיעורים'), h('h1', {}, isolateTitle(l.title)),
    h('section', { class: 'panel' }, h('strong', {}, 'האינטואיציה'), ...l.intuition.map((p) => para(p))),
    l.table ? h('section', {}, h('strong', {}, l.table.caption), table) : null,
    h('section', { class: 'panel' }, h('strong', {}, 'ההגדרה והחוק'), ...l.definition.map((d) => [d.say ? para(d.say) : null, d.eq ? line(d.eq) : null])),
    l.derive ? h('section', { 'aria-label': 'גזרו בעצמכם' }, h('h2', {}, 'למה זה נכון? גזירה צעד אחר צעד'),
      h('p', { class: 'muted' }, 'לפני כל צעד, נסו לכתוב על דף מה הצעד הבא. אחר כך חשפו אותו.'),
      stepsBox, h('div', { class: 'btn-row' }, more, all), status) : null,
    h('section', { class: 'panel' }, h('strong', {}, 'איך זוכרים'), para(l.hook), ...l.rules.map((r) => h('div', {}, h('span', { class: 'muted' }, r.name), line(r.eq)))),
    h('h2', {}, 'דוגמאות פתורות'),
    ...l.examples.map((ex, i) => h('section', { class: 'panel', 'aria-label': `דוגמה ${i + 1}` },
      h('strong', {}, `דוגמה ${i + 1}: ${ex.title}`), para(ex.ask), ...ex.eq.map((e) => line(e)),
      h('ol', { class: 'chain' }, ex.steps.map((s) => h('li', {}, para(s)))),
      h('p', { class: 'notice' }, h('strong', {}, 'תשובה: '), prettyAnswer(ex.answer, varOf(ex))))),
    h('section', { class: 'panel notice', 'aria-label': 'טעות נפוצה' }, h('strong', {}, '⚠️ טעות נפוצה'),
      h('p', {}, h('strong', {}, 'הטעות: '), l.mistake.wrong),
      h('p', {}, h('strong', {}, 'נכון: '), l.mistake.right),
      para(l.mistake.why)),
    h('h2', {}, 'בדקו את עצמכם'), quizBlock(l),
    h('div', { class: 'btn-row' },
      next ? h('a', { class: 'btn primary', href: `#/logs/learn/${next.id}` }, 'השיעור הבא ←') : h('a', { class: 'btn primary', href: '#/logs/cards' }, 'לכרטיסיות זכירה ←'),
      h('a', { class: 'btn', href: '#/logs' }, 'לתפריט')));
}

/* ---------- flashcards (Leitner, same boxes as the trig cards) ---------- */
function viewCards(ctx, res) {
  document.title = 'כרטיסיות לוגריתמים – Brain Gains';
  const state = loadCards();
  const queue = dueCards(state, res.cards, Date.now(), 12);
  const t0 = Date.now();
  const total = queue.length;
  let right = 0;
  let wrong = 0;
  const box = h('div');
  if (!total) {
    const c = boxCounts(state, res.cards);
    ctx.show(crumbs('#/logs', '→ לתפריט הלוגריתמים'), h('h1', {}, 'כרטיסיות זכירה'),
      h('p', {}, 'אין כרטיסים לתרגול כרגע. חזרו מאוחר יותר, או חזרו על שיעורים.'),
      h('p', { class: 'muted' }, `קופסאות: ${c.map((n, i) => `${i}: ${n}`).join(' · ')}`),
      h('a', { class: 'btn', href: '#/logs/learn' }, 'לשיעורים'));
    return;
  }
  function show() {
    if (!queue.length) return finish();
    const card = queue[0];
    const lesson = res.lessons.find((x) => x.id === card.lessonId);
    const answer = h('div', { hidden: true }, line(card.eq));
    const reveal = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'הצג תשובה');
    const grade = h('div', { class: 'btn-row', hidden: true });
    const mark = (ok) => {
      gradeCard(state, card.id, ok);
      saveCards(state);
      queue.shift();
      if (ok) right++; else { wrong++; queue.splice(requeueGap(queue.length), 0, card); }
      show();
    };
    grade.append(h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => mark(true) }, 'ידעתי ✓'),
      h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => mark(false) }, 'לא ידעתי ✗'));
    reveal.addEventListener('click', () => { answer.hidden = false; grade.hidden = false; reveal.hidden = true; });
    const s = state.cards[card.id];
    box.replaceChildren(
      h('p', { class: 'muted' }, `נשארו ${queue.length} · קופסה ${s ? s.box : 0} מתוך ${MAX_BOX}`),
      h('section', { class: 'panel' },
        h('p', {}, h('strong', {}, 'כסו את התשובה וכתבו מהזיכרון: '), card.name),
        lesson ? h('p', { class: 'muted' }, `מתוך השיעור: ${lesson.title.replace(/^\d+\.\s*/, '')}`) : null,
        reveal, answer, grade));
  }
  function finish() {
    box.replaceChildren(
      h('div', { class: 'feedback ok', role: 'status' }, `סיימנו: ${right} נכונות, ${wrong} טעויות (חזרו לתור עד שנזכרו).`),
      feedbackCard({
        exerciseId: 'logs-cards', topic: 'math', mode: 'logs', attemptId: t0,
        context: () => ({ correct: wrong === 0, hintsUsed: 0, solutionViewed: wrong > 0, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
      }),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/logs/cards' }, 'סבב נוסף'), h('a', { class: 'btn', href: '#/logs' }, 'לתפריט')));
  }
  ctx.show(crumbs('#/logs', '→ לתפריט הלוגריתמים'), h('h1', {}, 'כרטיסיות זכירה'),
    h('p', { class: 'muted' }, `${total} כרטיסים. כסו, נזכרו, ואז בדקו. מי שטעיתם בו חוזר בעוד כמה כרטיסים.`), box);
  show();
}

/* ---------- practice ---------- */
function practiceList(ctx, res) {
  document.title = 'תרגילי לוגריתמים – Brain Gains';
  const saved = loadSaved().items;
  ctx.show(crumbs('#/logs', '→ לתפריט הלוגריתמים'), h('h1', {}, 'תרגילים'),
    h('p', { class: 'muted' }, 'חמש רמות. בכל רמה כרטיס שיטה, ובכל תרגיל שלב תחום, שני רמזים ופתרון מלא. תשובות מדויקות: מספרים, שברים, שורשים, קטעים וזוגות.'),
    ...TIERS.map((t) => {
      const items = res.exercises.filter((e) => e.tier === t.id);
      return h('section', { class: 'panel', 'aria-label': t.label },
        h('h2', {}, t.label),
        h('details', {}, h('summary', {}, 'כרטיס שיטה'), h('ul', {}, t.method.map((m) => h('li', {}, para(m))))),
        h('ul', { class: 'ex-list' }, items.map((e) => {
          const s = saved[e.id];
          return h('li', {}, h('a', { class: 'ex-item', href: `#/logs/ex/${e.id}` },
            h('span', { class: 't' }, isolateTitle(e.title)),
            e.trap ? h('span', { class: 'muted', title: 'יש כאן מלכודת' }, '⚠️ מלכודת') : null,
            h('span', { class: `tick o-${s && s.solved ? (s.alone ? 'alone' : 'hinted') : 'none'}`, role: 'img', 'aria-label': s && s.solved ? 'נפתר' : 'טרם נפתר' }, s && s.solved ? '✓' : '○')));
        })));
    }));
}

function viewExercise(ctx, res, id) {
  const ex = res.exercises.find((x) => x.id === id);
  if (!ex) return practiceList(ctx, res);
  const tier = tierOf(ex.tier);
  document.title = `${isolateTitle(ex.title)} – Brain Gains`;
  const next = res.exercises[res.exercises.indexOf(ex) + 1];
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

  function showSolution() {
    solBox.replaceChildren(h('section', { class: 'panel', 'aria-label': 'פתרון מלא' }, h('strong', {}, 'פתרון: '),
      ...ex.steps.map((s) => line(s, '')),
      ex.trap ? para(`⚠️ מלכודת: ${ex.trap.text}`, 'notice') : null,
      h('p', { dir: 'ltr', class: 'muted' }, prettyAnswer(ex.answer, varOf(ex)))));
  }
  function finish() {
    if (st.over) return;
    st.over = true;
    widget.lock();
    [checkBtn, hintBtn, solBtn].forEach((b) => { b.disabled = true; });
    recordAttempt(ex.id, { solved: st.solved, hints: st.hints, wrongs: st.wrongs });
    showSolution();
    out.append(feedbackCard({
      exerciseId: ex.id, topic: 'math', mode: 'logs', level: ex.tier, attemptId: t0,
      context: () => ({ correct: st.solved, hintsUsed: st.hints, solutionViewed: !st.solved, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
    }), h('div', { class: 'btn-row' },
      next ? h('a', { class: 'btn primary', href: `#/logs/ex/${next.id}` }, 'התרגיל הבא ←') : null,
      h('a', { class: 'btn', href: '#/logs/practice' }, 'לרשימת התרגילים')));
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
      out.replaceChildren(h('div', { class: 'feedback bad', role: 'alert', steps: 'לא מדויק. ' + diagnose(ex, r.canon, want, tier) }),
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
  if (domBtn) {
    domBtn.addEventListener('click', () => {
      hintBox.append(para(`שלב התחום: ${ex.domain.text}`, 'notice'));
      domBtn.disabled = true;
    });
  }
  solBtn.addEventListener('click', () => finish());

  ctx.show(crumbs('#/logs/practice', '→ לרשימת התרגילים'), h('h1', {}, isolateTitle(ex.title)),
    h('p', { class: 'muted' }, `${tier.label}`, ex.trap ? ' · ⚠️ יש כאן מלכודת' : ''),
    para(ex.ask),
    h('div', { class: 'panel' }, ...ex.eq.map((e) => line(e))),
    h('details', {}, h('summary', {}, `כרטיס שיטה: ${tier.label}`), h('ul', {}, tier.method.map((m) => h('li', {}, para(m))))),
    widget.el,
    h('div', { class: 'btn-row' }, checkBtn, hintBtn, domBtn, solBtn),
    hintBox, out, solBox);
}
