// #/derive: spaced derivation recall (logic in derive.js, content in data/derive-math.json + data/derive-physics.json,
// checked by tools/verify-derive.mjs). Hub with the due list, one derivation per page: read it (level 0), then pick the next step,
// type the hidden lines, and finally rebuild the three key lines on a blank page. Math is always a dir=ltr isolate (mathdir.js).
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import { mathBlock } from './mathdir.js';
import * as store from './store.js';
import { tryFirst } from './tryfirst-ui.js';
import { createGate, attemptExtra } from './tryfirst.js';
import {
  TOPIC, LEVEL_LABELS, loadDeriveData, load, save, levelOf, isDue, markRead, applyResult, dueTasks, newTasks, statusText, lineText,
  createSession, intervalDays, MAX_BOX,
} from './derive.js';
import { DAY_MS } from './srs.js';

const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const secs = (t0) => Math.round((Date.now() - t0) / 1000);
const SUBJECT = { math: 'מתמטיקה', physics: 'פיזיקה' };

export async function viewDeriveRoute(ctx, sub, id) {
  document.title = 'גזירה מהזיכרון – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, 'גזירה מהזיכרון'), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadDeriveData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, 'גזירה מהזיכרון'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את הגזירות. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש בלי רשת).'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewDeriveRoute(ctx, sub, id) }, 'נסו שוב')));
  }
  if (sub === 't') {
    const task = res.tasks.find((t) => t.id === id);
    if (task) return viewTask(ctx, task);
  }
  return viewHub(ctx, res.tasks);
}

/* ---------- hub ---------- */
function viewHub(ctx, tasks) {
  const state = load();
  const now = Date.now();
  const due = dueTasks(state, tasks, now);
  const fresh = newTasks(state, tasks);
  const row = (t) => h('li', {}, h('a', { class: 'ex-item', href: `#/derive/t/${t.id}` },
    h('span', { class: 't' }, isolateTitle(t.title)),
    h('span', { class: 'muted' }, statusText(state.tasks[t.id], now))));
  const group = (subject) => h('section', { 'aria-label': SUBJECT[subject] }, h('h2', {}, SUBJECT[subject]),
    h('ul', { class: 'ex-list' }, tasks.filter((t) => t.subject === subject).map(row)));
  const next = due[0] || fresh[0] || null;
  ctx.show(crumbs(), h('h1', {}, '🧩 גזירה מהזיכרון'),
    h('section', { class: 'panel' },
      h('p', {}, 'לא לומדים נוסחה בעל פה אלא יודעים מאיפה היא באה. כל גזירה כאן היא שרשרת של 4 עד 7 שורות. בפעם הראשונה קוראים את כולה. אחר כך משחזרים: קודם בוחרים את השורה הבאה מבין ארבע, אחר כך מקלידים שורות חסרות, ובסוף כותבים שלוש שורות מפתח על דף ריק.'),
      h('p', { class: 'muted' }, `חזרה אחרי ${[0, 1, 2, 3].map(intervalDays).join(' / ')} ימים. שחזור בלי טעות, בלי רמז ובלי להציץ מקדם את הגזירה לשלב הבא, וכל טעות מחזירה אותה לחזרה מחר. זה תרגול ולא ציון.`)),
    next ? h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: `#/derive/t/${next.id}` },
      due.length ? `לגזירה הבאה לחזרה (${due.length} מחכות)` : 'להתחיל גזירה חדשה')) : h('p', { class: 'muted' }, 'אין כרגע גזירות לחזרה. חזרו מחר, או תרגלו גזירה שעוד לא הגיע זמנה.'),
    due.length ? h('section', { class: 'panel', 'aria-label': 'לחזרה עכשיו' }, h('strong', {}, `לחזרה עכשיו: ${due.length}`), h('ul', { class: 'ex-list' }, due.map(row))) : null,
    group('math'), group('physics'));
}

/* ---------- one derivation ---------- */
function viewTask(ctx, task) {
  document.title = `${isolateTitle(task.title)} – Brain Gains`;
  const entry = load().tasks[task.id];
  const level = levelOf(entry);
  const head = (...kids) => [crumbs('#/derive', '→ לרשימת הגזירות'), h('h1', {}, isolateTitle(task.title)), ...kids];
  const startBox = () => h('section', { class: 'panel', 'aria-label': 'נקודת המוצא' }, h('strong', {}, 'נתון: '), h('p', { steps: task.start }));
  const goalBox = () => h('section', { class: 'panel', 'aria-label': 'היעד' }, h('strong', {}, 'מטרה: '), mathBlock(task.goal));
  const stepRow = (s, cls = '') => h('li', { class: cls }, mathBlock(lineText(task, s)), s.n ? h('p', { class: 'muted' }, s.n) : null);
  const chain = () => h('ol', { class: 'path-steps', 'aria-label': 'שרשרת הגזירה' }, task.steps.map((s) => stepRow(s)));

  if (level === 0) {
    ctx.show(...head(
      h('p', { class: 'muted' }, 'קריאה ראשונה: קראו את כל השרשרת לאט, ובכל שורה שאלו למה היא נובעת מקודמתה. מחר תשחזרו אותה בעצמכם.'),
      startBox(), chain(), goalBox(),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => {
        const st = load();
        markRead(st, task.id);
        save(st);
        ctx.show(...head(h('div', { class: 'feedback ok', role: 'status' }, 'קראתם. החזרה הראשונה מחר.'),
          h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/derive' }, 'לרשימת הגזירות'))));
      } }, 'קראתי, מחר משחזרים'))));
    return;
  }

  const t0 = Date.now();
  const session = createSession(task, level);
  const tf = tryFirst([], { gate: createGate({ on: true }), save: () => {} });
  const board = h('div');
  const actions = h('div');
  const hintBox = h('div', { 'aria-live': 'polite' });
  const feedback = h('div', { 'aria-live': 'polite' });
  const hintBtn = h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => {
    const text = session.hint();
    if (text) hintBox.replaceChildren(h('p', { class: 'notice' }, `רמז: ${text}`));
  } }, 'רמז');
  const peekBtn = h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { session.peek(); finish(); } }, 'להציג את הגזירה המלאה');
  tf.add(hintBtn);
  tf.add(hintBox);
  const dueNow = isDue(entry, t0);

  /** Lines on the page: everything before the current step. At level 3 only the key lines show. */
  function boardList() {
    const cur = session.current();
    const upto = cur == null ? task.steps.length : cur;
    const items = [];
    for (let i = 0; i < upto; i++) {
      if (level === 3 && !session.pending.includes(i)) continue;
      items.push(stepRow(task.steps[i], level === 2 && !session.pending.includes(i) ? 'given' : 'done'));
    }
    return items;
  }

  function draw() {
    if (session.done()) { finish(); return; }
    const step = task.steps[session.current()];
    const items = boardList();
    board.replaceChildren(...[
      h('p', { class: 'muted' }, `${LEVEL_LABELS[level]} · שלב ${session.pos + 1} מתוך ${session.pending.length}`),
      level === 3 ? h('p', { class: 'muted' }, 'דף ריק: כתבו על הנייר את השרשרת, ואז הקלידו כאן את שלוש שורות המפתח לפי הסדר.') : null,
      items.length ? h('ol', { class: 'path-steps', 'aria-label': 'שורות עד עכשיו' }, items) : null].filter(Boolean));
    actions.replaceChildren();
    hintBox.replaceChildren();
    if (level === 1) {
      session.candidates().forEach((c, k) => {
        const b = h('button', { class: 'btn math-btn', type: 'button', dir: 'ltr', style: BTN, steps: lineText(task, c), 'aria-label': `אפשרות ${k + 1}` });
        b.addEventListener('click', () => {
          tf.attempt();
          const r = session.pick(k);
          if (r.ok) { feedback.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון. ', step.n)); draw(); return; }
          if (!r.cand) return;
          b.disabled = true;
          feedback.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, h('strong', {}, `${r.feedback.label}. `), r.feedback.text, r.feedback.why ? ` ${r.feedback.why}` : ''));
        });
        actions.append(h('div', {}, b));
      });
    } else {
      const input = h('input', { type: 'text', dir: 'ltr', class: 'math-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', maxlength: '160', 'aria-label': 'השורה הבאה בגזירה', placeholder: 'למשל: cos(2*a) = ...' });
      input.addEventListener('input', () => tf.attempt());
      const check = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
      check.addEventListener('click', () => {
        tf.attempt();
        const r = session.submit(input.value);
        if (r.ok) { feedback.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'נכון. ', step.n)); draw(); } else feedback.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, r.msg));
      });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') check.click(); });
      actions.append(
        h('p', { class: 'muted' }, 'כתבו את השורה בסימון של המחשב: * לכפל, ^ לחזקה, sin(a), cos(a), sqrt(x). הבדיקה מקבלת כל צורה שקולה.'),
        input, h('div', { class: 'btn-row' }, check));
    }
    actions.append(h('div', { class: 'btn-row' }, hintBtn, peekBtn), hintBox);
  }

  function finish() {
    const r = session.result();
    const st = load();
    const next = applyResult(st, task.id, { clean: r.clean }, Date.now());
    save(st);
    store.recordAttempt({ exerciseId: task.id, topic: TOPIC, outcome: r.outcome, hintsUsed: session.hints, seconds: secs(t0), ...attemptExtra(tf.gate) });
    const days = Math.max(1, Math.round((next.due - Date.now()) / DAY_MS));
    const moved = r.clean && dueNow ? `השלב עלה (קופסה ${next.b} מתוך ${MAX_BOX}). החזרה הבאה בעוד ${days} ${days === 1 ? 'יום' : 'ימים'}.`
      : r.clean ? 'שחזרתם בלי טעות, אבל עוד לא הגיע זמן החזרה, ולכן הלוח לא התקדם.'
        : `החזרה מחר, והשלב ירד (קופסה ${next.b}). ככה זוכרים: טעות היום, שחזור נקי מחר.`;
    ctx.show(...head(
      h('div', { class: r.clean ? 'feedback ok' : 'feedback bad', role: 'status' }, r.clean ? 'שחזרתם את הגזירה בלי טעות, בלי רמז ובלי להציץ.' : 'לא נקי הפעם. זה בסדר, זה בדיוק מה שהחזרות באות לתקן.'),
      h('p', {}, moved), startBox(), chain(), goalBox(),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/derive' }, 'לרשימת הגזירות'))));
  }

  ctx.show(...head(
    dueNow ? null : h('p', { class: 'notice' }, 'עוד לא הגיע זמן החזרה של הגזירה הזו. אפשר לתרגל, אבל רק שחזור נקי בזמן החזרה מקדם אותה.'),
    startBox(), goalBox(), tf.bar, board, feedback, actions));
  draw();
}
