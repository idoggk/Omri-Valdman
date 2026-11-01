// #/trig: trig identities teacher. Lessons (3 anchors -> derivation chain), Leitner flashcards, fill / which-is-wrong
// drills with a numeric spot check, and a step-by-step proof trainer. Logic lives in trig.js, content in trig-data.js.
import { h } from './dom.js';
import { feedbackCard } from './feedback-ui.js';
import { LESSONS, CARDS, FILL, WRONG, PROOFS, CHAIN } from './trig-data.js';
import {
  loadState, saveState, gradeCard, dueCards, requeueGap, boxCounts, recordDrill, recordProof, pickDrills,
  spotValues, splitChain, MAX_BOX,
} from './trig.js';

const BTN = 'min-height:44px;';
const eq = (s, cls = '') => h('div', { class: cls, steps: s });
const crumbs = (href = '#/trig', label = '→ חזרה ללימוד הזהויות') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const lessonOf = (id) => LESSONS.find((l) => l.id === id);
const fmtV = (v) => (v == null ? 'לא מוגדר' : String(v));

/** Deterministic shuffle so the right option is not always first (stable per seed, re-render safe). */
export function shuffled(list, seed) {
  let s = 0;
  for (const ch of String(seed)) s = (Math.imul(s, 31) + ch.charCodeAt(0)) >>> 0;
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = (s >>> 8) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Spot-check panel: both sides of an equation at a = 30°, b = 60°. */
export function spotPanel(statement) {
  const parts = splitChain(statement);
  const vals = spotValues(statement);
  const same = vals.every((v) => v != null && Math.abs(v - vals[0]) < 0.0015);
  const known = vals.every((v) => v != null);
  return h('div', { class: 'panel', dir: 'rtl' },
    h('strong', {}, 'בדיקה מספרית ב־a = 30°, b = 60°'),
    ...parts.map((p, i) => h('div', {}, h('span', { dir: 'ltr' }, `${p}  =  ${fmtV(vals[i])}`))),
    h('p', { class: known && same ? 'muted' : 'error' }, !known ? 'באחד הצדדים הביטוי לא מוגדר בזוויות האלה, בוחרים זוויות אחרות.' : same ? 'שני הצדדים שווים ✓ (זה לא הוכחה, אבל סימן טוב).' : 'הצדדים שונים ✗: הנוסחה לא נכונה.'));
}

/* ---------- hub ---------- */
function viewHub(ctx) {
  document.title = 'זהויות טריגונומטריות – Brain Gains';
  const st = loadState();
  const due = dueCards(st, CARDS, Date.now(), 999).length;
  const proofsDone = PROOFS.filter((p) => st.proofs[p.id] && st.proofs[p.id].done).length;
  const tile = (href, title, desc) => h('a', { class: 'card', href }, h('strong', {}, title), h('span', { class: 'muted' }, desc));
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/practice-hub' }, '→ חזרה לתרגול')),
    h('h1', {}, 'זהויות טריגונומטריות'),
    h('section', { class: 'panel' },
      h('strong', {}, 'שלושה עוגנים, והכול נגזר מהם'),
      h('p', {}, 'לא צריך לשנן עשרות נוסחאות. שלוש בלבד:'),
      eq('sin²(a) + cos²(a) = 1'),
      eq('sin(a+b) = sin(a)cos(b) + cos(a)sin(b)'),
      eq('cos(a+b) = cos(a)cos(b) - sin(a)sin(b)'),
      h('p', { class: 'muted' }, 'כל השאר נגזר בצעדים גלויים. כך הנוסחה נזכרת גם כשהיא נשכחת:')),
    h('ol', { class: 'chain' }, CHAIN.map((c) => h('li', {}, `${c.from} ← ${c.to}: ${c.how}`))),
    h('div', { class: 'cards' },
      tile('#/trig/learn', '📖 שיעורים ונגזרות', `${LESSONS.length} כרטיסי לימוד: חריזה, תבנית ו״גזרו בעצמכם״ צעד אחר צעד`),
      tile('#/trig/cards', '🗂️ כרטיסיות זכירה', `${due} כרטיסים לתרגול עכשיו מתוך ${CARDS.length}. מכסים, נזכרים, בודקים; טעויות חוזרות מהר`),
      tile('#/trig/drill', '⚡ השלימו ומצאו את הטעות', `${FILL.length + WRONG.length} פריטים, עם בדיקה מספרית ב־a = 30°`),
      tile('#/trig/proof', '🧮 מאמן הוכחות', `${proofsDone} מתוך ${PROOFS.length} הוכחות הושלמו. בוחרים את הצעד הבא בכל שלב`)));
}

/* ---------- lessons ---------- */
function lessonList(ctx) {
  document.title = 'שיעורי טריגונומטריה – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, 'שיעורים'),
    h('p', { class: 'muted' }, 'קודם שלושת העוגנים, אחר כך כל נוסחה נגזרת מהקודמות.'),
    h('ul', { class: 'ex-list' }, LESSONS.map((l, i) => h('li', {}, h('a', { class: 'ex-item', href: `#/trig/learn/${l.id}` },
      h('span', { class: 'badge' }, l.anchor ? '⚓' : String(i + 1)), h('span', { class: 't' }, l.title))))));
}

function viewLesson(ctx, id) {
  const l = lessonOf(id);
  if (!l) return lessonList(ctx);
  document.title = `${l.title} – Brain Gains`;
  const idx = LESSONS.indexOf(l);
  const next = LESSONS[idx + 1];
  const stepsBox = h('div');
  const status = h('p', { class: 'muted', role: 'status' });
  let shown = 0;
  const more = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'הצעד הבא');
  const all = h('button', { class: 'btn', type: 'button', style: BTN }, 'הציגו הכול');
  function reveal() {
    const st = l.derive[shown++];
    stepsBox.append(h('div', { class: 'panel' }, h('p', {}, h('strong', {}, `צעד ${shown}. `), st.say), st.eq ? eq(st.eq, 'eq-block') : null));
    status.textContent = shown < l.derive.length ? `${shown} מתוך ${l.derive.length}. נסו לנחש את הצעד הבא לפני שלוחצים.` : 'זהו, סיימנו את הגזירה.';
    if (shown >= l.derive.length) { more.disabled = true; all.disabled = true; }
  }
  more.addEventListener('click', reveal);
  all.addEventListener('click', () => { while (shown < l.derive.length) reveal(); });
  const spotBox = h('div');
  ctx.show(crumbs('#/trig/learn', '→ לרשימת השיעורים'),
    h('h1', {}, l.title),
    l.anchor ? h('p', { class: 'notice' }, '⚓ זה אחד משלושת העוגנים: את זה מחזיקים בראש.') : null,
    h('section', { class: 'panel' }, h('strong', {}, 'מה זוכרים'), ...l.formulas.map((f) => eq(f.eq, 'eq-block'))),
    h('section', { class: 'panel' }, h('strong', {}, 'איך זוכרים'), h('p', {}, l.mnemonic),
      l.pattern ? h('table', { class: 'pattern' }, ...l.pattern.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c))))) : null),
    h('section', { 'aria-label': 'גזרו בעצמכם' }, h('h2', {}, 'גזרו בעצמכם'),
      h('p', { class: 'muted' }, 'לפני כל צעד, נסו לכתוב על דף מה הצעד הבא. אחר כך חשפו אותו.'),
      stepsBox, h('div', { class: 'btn-row' }, more, all), status),
    h('section', { class: 'panel' }, h('strong', {}, 'בדיקת שפיות'), h('p', {}, l.check),
      h('div', { class: 'btn-row' }, ...l.formulas.map((f) => h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => spotBox.replaceChildren(spotPanel(f.eq)) }, `בדקו: ${f.name}`))),
      spotBox),
    h('div', { class: 'btn-row' },
      next ? h('a', { class: 'btn primary', href: `#/trig/learn/${next.id}` }, 'השיעור הבא ←') : h('a', { class: 'btn primary', href: '#/trig/cards' }, 'לכרטיסיות זכירה ←'),
      h('a', { class: 'btn', href: '#/trig' }, 'לתפריט')));
}

/* ---------- flashcards (Leitner) ---------- */
function viewCards(ctx) {
  document.title = 'כרטיסיות זכירה – Brain Gains';
  const state = loadState();
  const queue = dueCards(state, CARDS, Date.now(), 12);
  const t0 = Date.now();
  const total = queue.length;
  let right = 0;
  let wrong = 0;
  const box = h('div');
  if (!total) {
    const c = boxCounts(state, CARDS);
    ctx.show(crumbs(), h('h1', {}, 'כרטיסיות זכירה'),
      h('p', {}, 'אין כרטיסים לתרגול כרגע. חזרו מאוחר יותר, או חזרו על שיעורים.'),
      h('p', { class: 'muted' }, `קופסאות: ${c.map((n, i) => `${i}: ${n}`).join(' · ')}`),
      h('a', { class: 'btn', href: '#/trig/learn' }, 'לשיעורים'));
    return;
  }
  function show() {
    if (!queue.length) return finish();
    const card = queue[0];
    const lesson = lessonOf(card.lessonId);
    const answer = h('div', { hidden: true }, eq(card.eq, 'eq-block'));
    const reveal = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'הצג תשובה');
    const grade = h('div', { class: 'btn-row', hidden: true });
    const mark = (ok) => {
      gradeCard(state, card.id, ok);
      saveState(state);
      queue.shift();
      if (ok) right++; else { wrong++; queue.splice(requeueGap(queue.length), 0, card); }
      show();
    };
    grade.append(h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => mark(true) }, 'ידעתי ✓'),
      h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => mark(false) }, 'לא ידעתי ✗'));
    reveal.addEventListener('click', () => {
      answer.hidden = false; grade.hidden = false; reveal.hidden = true;
    });
    const s = state.cards[card.id];
    box.replaceChildren(
      h('p', { class: 'muted' }, `נשארו ${queue.length} · קופסה ${s ? s.box : 0} מתוך ${MAX_BOX}`),
      h('section', { class: 'panel' },
        h('p', {}, h('strong', {}, 'כסו את התשובה וכתבו מהזיכרון: '), card.name),
        h('p', { class: 'muted' }, `מתוך השיעור: ${lesson.title}`),
        reveal, answer, grade));
  }
  function finish() {
    box.replaceChildren(
      h('div', { class: 'feedback ok', role: 'status' }, `סיימנו: ${right} נכונות, ${wrong} טעויות (חזרו לתור עד שנזכרו).`),
      feedbackCard({
        exerciseId: 'trig-cards', topic: 'trig', mode: 'trig', attemptId: t0,
        context: () => ({ correct: wrong === 0, hintsUsed: 0, solutionViewed: wrong > 0, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
      }),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/trig/cards' }, 'סבב נוסף'), h('a', { class: 'btn', href: '#/trig' }, 'לתפריט')));
  }
  ctx.show(crumbs(), h('h1', {}, 'כרטיסיות זכירה'), h('p', { class: 'muted' }, `${total} כרטיסים. כסו, נזכרו, ואז בדקו. מי שטעיתם בו חוזר בעוד כמה כרטיסים.`), box);
  show();
}

/* ---------- drills ---------- */
const drillItems = () => [...FILL.map((f) => ({ ...f, kind: 'fill' })), ...WRONG.map((w) => ({ ...w, kind: 'wrong' }))];

function viewDrill(ctx) {
  document.title = 'תרגול זהויות – Brain Gains';
  const state = loadState();
  const items = pickDrills(state, drillItems(), 10);
  const t0 = Date.now();
  let i = 0;
  let right = 0;
  let hints = 0;
  const box = h('div');
  function show() {
    if (i >= items.length) return finish();
    const it = items[i];
    const out = h('div', { 'aria-live': 'polite' });
    const spot = h('div');
    let done = false;
    const answer = (ok, statement) => {
      if (done) return;
      done = true;
      if (ok) right++;
      recordDrill(state, it.id, ok);
      saveState(state);
      out.replaceChildren(h('div', { class: `feedback ${ok ? 'ok' : 'bad'}`, role: ok ? 'status' : 'alert' }, ok ? 'נכון!' : 'לא נכון.'),
        h('p', {}, it.kind === 'fill' ? it.tip : it.why),
        spotPanel(statement),
        h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => { i++; show(); } }, i + 1 < items.length ? 'הבא ←' : 'לסיום'));
    };
    let body;
    if (it.kind === 'fill') {
      const opts = shuffled(it.options.map((o, k) => ({ o, k })), it.id);
      body = [h('p', {}, 'מה חסר בזהות?'), eq(it.template.replace('?', '___'), 'eq-block'),
        h('div', { class: 'btn-row' }, opts.map(({ o, k }) => h('button', {
          class: 'btn', type: 'button', style: BTN + 'direction:ltr',
          onclick: () => { answer(k === it.ans, it.template.replace('?', it.options[it.ans])); },
        }, o)))];
    } else {
      body = [h('p', {}, 'איזו מהזהויות הבאות שגויה? אפשר לבדוק מספרית לפני שבוחרים.'),
        ...it.statements.map((s, k) => h('div', { class: 'panel' }, eq(s, 'eq-block'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { if (!done) hints++; spot.replaceChildren(spotPanel(s)); } }, 'בדיקה ב־a=30°'),
            h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => answer(k === it.wrong, it.statements[it.wrong]) }, 'זו השגויה')))), spot];
    }
    box.replaceChildren(h('p', { class: 'muted' }, `${i + 1} מתוך ${items.length}`), h('section', { class: 'panel' }, ...body, out));
  }
  function finish() {
    box.replaceChildren(
      h('div', { class: `feedback ${right === items.length ? 'ok' : 'bad'}`, role: 'status' }, `${right} מתוך ${items.length} נכונות.`),
      h('p', { class: 'muted' }, 'הרגל טוב: לפני שסומכים על זהות, מציבים a = 30° ובודקים שני צדדים.'),
      feedbackCard({
        exerciseId: 'trig-drill', topic: 'trig', mode: 'trig', attemptId: t0,
        context: () => ({ correct: right === items.length, hintsUsed: hints, solutionViewed: false, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
      }),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/trig/drill' }, 'סבב נוסף'), h('a', { class: 'btn', href: '#/trig' }, 'לתפריט')));
  }
  ctx.show(crumbs(), h('h1', {}, 'השלימו ומצאו את הטעות'), box);
  show();
}

/* ---------- proof trainer ---------- */
const TIERS = { 1: 'חימום', 2: 'בינוני', 3: 'קשה' };

function proofList(ctx) {
  document.title = 'מאמן הוכחות – Brain Gains';
  const st = loadState();
  ctx.show(crumbs(), h('h1', {}, 'מאמן הוכחות'),
    h('p', { class: 'muted' }, 'בכל שלב בוחרים את הצעד הבא מתוך כמה אפשרויות. הרמז אומר איזו זהות לשלוף.'),
    h('ul', { class: 'ex-list' }, PROOFS.map((p) => {
      const r = st.proofs[p.id];
      return h('li', {}, h('a', { class: 'ex-item', href: `#/trig/proof/${p.id}` },
        h('span', { class: 'badge' }, TIERS[p.tier]), h('span', { class: 't' }, p.title), h('span', { class: 'tick', 'aria-label': r && r.done ? 'הושלם' : 'לא הושלם' }, r && r.done ? '✓' : '')));
    })));
}

function viewProof(ctx, id) {
  const p = PROOFS.find((x) => x.id === id);
  if (!p) return proofList(ctx);
  document.title = `${p.title} – Brain Gains`;
  const state = loadState();
  const t0 = Date.now();
  const next = PROOFS[PROOFS.indexOf(p) + 1];
  const history = h('div');
  const area = h('div');
  let si = 0;
  let mistakes = 0;
  let hints = 0;
  history.append(h('div', { class: 'panel' }, h('strong', {}, 'מתחילים מ: '), eq(p.lhs, 'eq-block')));

  function step() {
    if (si >= p.steps.length) return finish();
    const s = p.steps[si];
    const opts = shuffled([{ to: s.ok, ok: true }, ...s.bad.map((b) => ({ ...b, bad: true })), ...(s.detour ? [{ ...s.detour, detour: true }] : [])], `${p.id}:${si}`);
    const out = h('div', { 'aria-live': 'polite' });
    const hintBox = h('div');
    let hinted = false;
    const hintBtn = h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => {
      if (!hinted) { hinted = true; hints++; }
      hintBox.replaceChildren(h('p', { class: 'notice' }, `רמז: ${s.hint}`));
    } }, 'רמז: איזו זהות?');
    const buttons = opts.map((o) => {
      const b = h('button', { class: 'btn', type: 'button', style: BTN + 'display:block;width:100%;direction:ltr;text-align:left;margin:6px 0' }, eq(o.to));
      b.addEventListener('click', () => {
        if (o.ok) {
          history.append(h('div', { class: 'panel' }, h('span', { class: 'muted' }, `צעד ${si + 1}: `), eq(`= ${s.ok}`, 'eq-block'), h('p', { class: 'muted' }, s.why)));
          si++;
          step();
        } else {
          b.disabled = true;
          if (o.bad) mistakes++;
          out.replaceChildren(h('div', { class: `feedback ${o.bad ? 'bad' : 'ok'}`, role: 'alert' }, o.bad ? `לא נכון. ${o.why}` : `נכון מספרית, אבל לא מקדם. ${o.why}`));
        }
      });
      return b;
    });
    area.replaceChildren(
      h('p', { class: 'muted' }, `צעד ${si + 1} מתוך ${p.steps.length}`),
      h('p', {}, h('strong', {}, 'הביטוי כרגע: '), eq(si ? p.steps[si - 1].ok : p.lhs, 'eq-block')),
      h('p', {}, h('strong', {}, 'מה הצעד הבא?')), ...buttons, h('div', { class: 'btn-row' }, hintBtn), hintBox, out);
  }
  function finish() {
    recordProof(state, p.id, { mistakes, hints });
    saveState(state);
    area.replaceChildren(
      h('div', { class: 'feedback ok', role: 'status' }, `הוכחתם! טעויות: ${mistakes}, רמזים: ${hints}.`),
      h('p', {}, h('strong', {}, 'מה שהוכחנו: '), eq(`${p.lhs} = ${p.rhs}`, 'eq-block')),
      spotPanel(`${p.lhs} = ${p.rhs}`),
      feedbackCard({
        exerciseId: `trig-${p.id}`, topic: 'trig', mode: 'trig', attemptId: t0,
        context: () => ({ correct: mistakes === 0, hintsUsed: hints, solutionViewed: false, secondsSpent: Math.round((Date.now() - t0) / 1000) }),
      }),
      h('div', { class: 'btn-row' }, next ? h('a', { class: 'btn primary', href: `#/trig/proof/${next.id}` }, 'ההוכחה הבאה ←') : null, h('a', { class: 'btn', href: '#/trig/proof' }, 'לרשימה')));
  }
  ctx.show(crumbs('#/trig/proof', '→ לרשימת ההוכחות'), h('h1', {}, p.title), h('p', {}, h('strong', {}, 'להוכיח: '), eq(`${p.lhs} = ${p.rhs}`, 'eq-block')), history, area);
  step();
}

/** Router entry: #/trig, #/trig/learn[/id], #/trig/cards, #/trig/drill, #/trig/proof[/id]. */
export function viewTrigRoute(ctx, sub, id) {
  if (sub === 'learn') return id ? viewLesson(ctx, id) : lessonList(ctx);
  if (sub === 'cards') return viewCards(ctx);
  if (sub === 'drill') return viewDrill(ctx);
  if (sub === 'proof') return id ? viewProof(ctx, id) : proofList(ctx);
  return viewHub(ctx);
}
