// #/examday: the 5-minute exam-day rehearsal. One page: timer, checklists (materials, read the paper, signs, answer checks),
// 5 random formulas checked for equivalence, a time allocation computed from the marks and a calm-breathing prompt.
// Logic in js/examday.js. Math is a dir=ltr isolate (mathdir.js).
import { h } from './dom.js';
import { mathInline } from './mathdir.js';
import { loadCatalogue, checkAnswer, TOKEN_HELP } from './fbuilder.js';
import {
  MATERIALS, SIGN_REMINDERS, ANSWER_CHECKS, READ_PAPER, BREATHING, DURATION_MS, FORMULA_COUNT,
  createTimer, clock, pickFormulas, parseMarks, allocateTime, load, save, recordCompletion, statusText,
} from './examday.js';

const BTN = 'min-height:44px;';
const crumbs = () => h('p', { class: 'crumbs' }, h('a', { href: '#/plan' }, '→ לתוכנית שלי'));

const checklist = (title, items) => h('section', { class: 'card', 'aria-label': title },
  h('strong', {}, title),
  h('ul', { class: 'ex-list' }, items.map((t) => h('li', {}, h('label', { style: 'display:flex;gap:10px;align-items:center;min-height:44px' },
    h('input', { type: 'checkbox', style: 'width:22px;height:22px' }), t)))));

export async function viewExamDay(ctx) {
  document.title = 'שגרת יום המבחן – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, 'שגרת יום המבחן'), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const cat = await loadCatalogue(ctx.fetchFn);
  const picks = cat.ok ? pickFormulas(cat.data.items) : [];
  const t0 = Date.now();
  const timer = createTimer({ total: DURATION_MS });
  const display = h('strong', { dir: 'ltr', 'aria-label': 'זמן שנותר', style: 'font-size:1.6rem' }, clock(DURATION_MS));
  const startBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'התחלת שעון');
  const pauseBtn = h('button', { class: 'btn', type: 'button', style: BTN, hidden: true }, 'השהיה');
  let tick = null;
  const paint = () => {
    display.textContent = clock(timer.remainingMs());
    if (timer.finished() && tick) { clearInterval(tick); tick = null; startBtn.textContent = 'השעון הסתיים'; startBtn.disabled = true; pauseBtn.hidden = true; }
  };
  startBtn.addEventListener('click', () => {
    if (timer.running()) return;
    timer.start();
    startBtn.textContent = 'רץ…';
    pauseBtn.hidden = false;
    if (!tick) tick = setInterval(() => { if (display.isConnected === false) { clearInterval(tick); tick = null; return; } paint(); }, 500);
    paint();
  });
  pauseBtn.addEventListener('click', () => {
    if (timer.running()) { timer.pause(); pauseBtn.textContent = 'המשך'; startBtn.textContent = 'מושהה'; } else { timer.resume(); pauseBtn.textContent = 'השהיה'; startBtn.textContent = 'רץ…'; }
    paint();
  });

  /* formulas */
  const results = new Map(); // id -> true/false (first check counts)
  const formulaRow = (q, i) => {
    const input = h('input', { type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '160', 'aria-label': `הנוסחה לשאלה ${i + 1}`, style: BTN });
    const out = h('div', { 'aria-live': 'polite' });
    const check = h('button', { class: 'btn', type: 'button', style: BTN }, 'בדיקה');
    check.addEventListener('click', () => {
      const r = checkAnswer(q, input.value);
      if (!r.valid) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
      if (!results.has(q.id)) results.set(q.id, r.correct);
      if (r.correct) out.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון (כל צורה שקולה מתקבלת).'));
      else out.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, r.echo ? 'זו רק השורה שבשאלה. כתבו את הצד השני של הנוסחה.' : r.trap ? r.trap.note : 'לא שווה לנוסחה הנכונה. נסו שוב.'));
    });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') check.click(); });
    return h('li', {}, h('p', {}, h('strong', {}, `${i + 1}. `), q.prompt, ' '), h('div', { dir: 'ltr' }, mathInline(q.lhs)), h('div', { class: 'btn-row' }, input, check), out);
  };
  const formulas = h('section', { class: 'card', 'aria-label': 'נוסחאות מהזיכרון' },
    h('strong', {}, `${FORMULA_COUNT} נוסחאות מהזיכרון`),
    h('p', { class: 'muted' }, 'כתבו כל נוסחה בלי להסתכל. הבדיקה מקבלת כל ביטוי שקול. סימון: ', mathInline(TOKEN_HELP)),
    picks.length ? h('ol', { class: 'ex-list' }, picks.map(formulaRow)) : h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את קטלוג הנוסחאות. פתחו פעם אחת עם חיבור לאינטרנט.'));

  /* time allocation */
  const totalIn = h('input', { type: 'number', min: '10', max: '600', value: '90', inputmode: 'numeric', dir: 'ltr', 'aria-label': 'זמן המבחן בדקות', style: `${BTN}width:6em` });
  const marksIn = h('input', { type: 'text', value: '25, 25, 25, 25', dir: 'ltr', inputmode: 'text', maxlength: '80', 'aria-label': 'נקודות לכל שאלה', style: `${BTN}width:14em` });
  const allocOut = h('div', { 'aria-live': 'polite' });
  const alloc = () => {
    const marks = parseMarks(marksIn.value);
    const r = marks ? allocateTime(Number(totalIn.value), marks) : { ok: false, error: 'כתבו את הנקודות של כל שאלה, מופרדות בפסיקים (למשל 25, 25, 25, 25).' };
    if (!r.ok) { allocOut.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
    allocOut.replaceChildren(h('ul', {},
      h('li', {}, `קריאת כל המבחן: ${r.read} דקות`),
      ...r.perQuestion.map((q) => h('li', {}, `שאלה ${q.n} (${q.marks} נקודות): ${q.minutes} דקות`)),
      h('li', {}, `בדיקה אחרונה: ${r.review} דקות`)));
  };
  [totalIn, marksIn].forEach((el) => el.addEventListener('input', alloc));
  const allocBox = h('section', { class: 'card', 'aria-label': 'חלוקת זמן' },
    h('strong', {}, 'חלוקת זמן לפי נקודות'),
    h('p', { class: 'muted' }, 'הזינו את משך המבחן ואת הנקודות של כל שאלה. הזמן מחולק בהתאם לנקודות, אחרי זמן קריאה וזמן לבדיקה.'),
    h('div', { class: 'fields' }, h('div', { class: 'field' }, h('label', {}, 'דקות ', totalIn)), h('div', { class: 'field' }, h('label', {}, 'נקודות לכל שאלה ', marksIn))), allocOut);
  alloc();

  /* breathing */
  const phaseText = h('p', { role: 'status', 'aria-live': 'polite', style: 'font-size:1.2rem' }, 'מוכנים?');
  const breathBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'להתחיל נשימה');
  let breathing = false;
  breathBtn.addEventListener('click', () => {
    if (breathing) return;
    breathing = true;
    const seq = [];
    for (let c = 0; c < BREATHING.cycles; c++) for (const p of BREATHING.phases) seq.push(p);
    let i = 0;
    const step = () => {
      if (phaseText.isConnected === false) return;
      if (i >= seq.length) { phaseText.textContent = 'סיימתם. הגוף רגוע יותר.'; breathing = false; return; }
      phaseText.textContent = `${seq[i].label} (${seq[i].seconds})`;
      const t = setTimeout(() => { i++; step(); }, seq[i].seconds * 1000);
      if (t && t.unref) t.unref();
    };
    step();
  });
  const breathBox = h('section', { class: 'card', 'aria-label': 'נשימה' }, h('strong', {}, 'נשימה רגועה'), h('p', {}, BREATHING.intro), phaseText, breathBtn);

  /* completion */
  const done = h('div', { 'aria-live': 'polite' });
  const finish = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'סיימתי את החזרה');
  finish.addEventListener('click', () => {
    const state = load();
    const ok = [...results.values()].filter(Boolean).length;
    recordCompletion(state, { now: Date.now(), seconds: Math.round((Date.now() - t0) / 1000), formulas: results.size ? { ok, n: results.size } : null });
    if (save(state) === false) { done.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'השמירה נכשלה (האחסון מלא).')); return; }
    finish.disabled = true;
    done.replaceChildren(h('p', { class: 'feedback ok', role: 'status' }, `נשמר. ${statusText(state)}${results.size ? ` נוסחאות נכונות: ${ok} מתוך ${results.size}.` : ''} בהצלחה במבחן!`));
  });

  ctx.show(crumbs(), h('h1', {}, '🧘 שגרת יום המבחן'),
    h('section', { class: 'panel' },
      h('p', {}, 'חמש דקות של חזרה לפני המבחן, או ביום שלפניו: לוודא שהכול מוכן, לרענן נוסחאות, לתכנן את הזמן ולהירגע. אפשר להפעיל שעון, והוא רק מראה זמן.'),
      h('p', { class: 'muted', role: 'status' }, statusText(load())),
      h('div', { class: 'btn-row' }, display, startBtn, pauseBtn)),
    checklist('1. ציוד', MATERIALS), formulas, checklist('2. קריאת המבחן', READ_PAPER), allocBox,
    checklist('3. סימנים והסכמות', SIGN_REMINDERS), checklist('4. הרגלי בדיקה לתשובה', ANSWER_CHECKS), breathBox,
    h('div', { class: 'btn-row' }, finish, h('a', { class: 'btn', href: '#/plan' }, 'חזרה לתוכנית')), done);
}
