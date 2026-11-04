// #/blind: blind weakness tournament. Routes: #/blind (start), #/blind/run (one question per page, no labels), #/blind/result.
// The shared question widgets (questionBlock / answerBody) are also used by the pressure ladder and the recovery mini-mock.
import { h } from './dom.js';
import { startVisible } from './clock.js';
import * as store from './store.js';
import { sanitizeHtml } from './sanitize.js';
import { isolateFormulasHtml } from './bidi.js';
import { mathBlock } from './mathdir.js';
import { answerWidget } from './mathhard-ui.js';
import { loadMathHardData } from './mathhard.js';
import { loadLogsData } from './logs.js';
import { loadMultipartData } from './multipart.js';
import { loadRecoverData } from './recover.js';
import { PROOFS } from './trig-data.js';
import { QUESTIONS as UNITS } from './units-data.js';
import { QUESTIONS as ESTIMATE } from './estimate-data.js';
import { formatTime } from './transfer.js';
import {
  buildPool, load, startSession, nextUid, gradeBlind, skipBlind, submit, attemptFor, resultData, presentChoice, ERROR_TYPES,
  SIZE, MIN_CONFIDENT,
} from './blind.js';

const TITLE = '🕶️ טורניר חולשות עיוור';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const rich = (tag, html, attrs = {}) => h(tag, { ...attrs, rawhtml: isolateFormulasHtml(sanitizeHtml(String(html ?? ''))) });
const pct = (x) => `${Math.round(x * 100)}%`;
const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

/** All banks as one normalised pool; a bank that fails to load is simply missing (the pool is still usable). */
export async function loadBlindPool(fetchFn) {
  const ok = async (p) => { try { const r = await p; return r && r.ok ? r : null; } catch (e) { return null; } };
  const [mh, lg, mp, rc] = await Promise.all([ok(loadMathHardData(fetchFn)), ok(loadLogsData(fetchFn)), ok(loadMultipartData(fetchFn)), ok(loadRecoverData(fetchFn))]);
  let ladder = [];
  try { const r = await fetchFn('data/ladder-math.json', { cache: 'no-cache' }); if (r.ok) ladder = (await r.json()).stages || []; } catch (e) { /* bank missing */ }
  return buildPool({ mathhard: mh ? mh.data : [], logs: lg ? lg.exercises : [], multipart: mp ? mp.data : [], recover: rc ? rc.data : [], ladder, proofs: PROOFS, units: UNITS, estimate: ESTIMATE });
}

/** The question text: statement, equations (always ltr isolates) and ask. Never a title, topic or level. */
export function questionBlock(item) {
  return h('div', {},
    item.html ? rich('p', item.html) : null,
    item.steps ? h('ol', { class: 'panel', style: 'padding-inline-start:1.6em' }, item.steps.map((s) => h('li', {}, mathBlock(s)))) : null,
    item.ask ? h('p', {}, item.ask) : null,
    item.eq ? h('div', { class: 'panel' }, item.eq.map((line) => mathBlock(line, 'eq-block'))) : null);
}

/** Answer controls for an item. -> { el, read(), lock() }; read() returns what gradeBlind expects. */
export function answerBody(item, seed) {
  const input = (label, w = '9em') => h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', 'aria-label': label, style: `${BTN}width:${w};text-align:center` });
  if (item.kind === 'canon') return answerWidget(item);
  if (item.kind === 'inputs') {
    const ins = item.inputs.map((s) => input(s.label));
    return {
      el: h('div', {}, item.inputs.map((s, i) => h('p', {}, h('label', {}, `${s.label}: `, ins[i], s.unit ? ` ${s.unit}` : '')))),
      read: () => ins.map((i) => i.value), lock: () => ins.forEach((i) => { i.disabled = true; }),
    };
  }
  if (item.kind === 'number' || item.kind === 'unitsnum') {
    const i = input('התשובה');
    return { el: h('p', {}, h('label', {}, 'תשובה: ', i, item.unit ? ` ${item.unit}` : '')), read: () => i.value, lock: () => { i.disabled = true; } };
  }
  const { options } = presentChoice(item, seed);
  let picked = null;
  const btns = options.map((o, idx) => {
    const b = h('button', { class: 'chip', type: 'button', style: BTN, dir: item.src === 'trig' ? 'ltr' : null, 'aria-pressed': 'false', onclick: () => { picked = idx; btns.forEach((x, j) => x.setAttribute('aria-pressed', String(j === idx))); } }, o);
    return b;
  });
  return { el: h('div', { class: 'filters', role: 'group', 'aria-label': 'אפשרויות' }, btns), read: () => picked, lock: () => btns.forEach((b) => { b.disabled = true; }) };
}

export async function viewBlind(ctx, arg) {
  document.title = 'טורניר חולשות – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const pool = await loadBlindPool(ctx.fetchFn || ((u, o) => fetch(u, o)));
  if (pool.length < SIZE) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון מספיק שאלות. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewBlind(ctx, arg) }, 'נסו שוב')));
  }
  if (arg === 'run') return run(ctx, pool);
  if (arg === 'result') return result(ctx, pool);
  return home(ctx, pool);
}

function home(ctx, pool) {
  const st = load();
  const last = st.history[st.history.length - 1];
  const start = () => { if (startSession(pool, randomSeed(), store.getAttempts())) viewBlind(ctx, 'run'); };
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, `${SIZE} שאלות מעורבות מכל מה שלמדתם, בלי שם נושא ובלי רמת קושי. לא תדעו מראש מה בכל שאלה, בדיוק כמו במבחן.`),
    h('ul', {},
      h('li', {}, 'ניסיון אחד לכל שאלה, בלי רמזים ובלי פתרון עד הסוף.'),
      h('li', {}, 'השעון רק סופר את הזמן לכל שאלה. אפשר לדלג אם אין תשובה.'),
      h('li', {}, 'בסוף נדרג את הנושאים לפי דיוק עצמאי, זמן מול הזמן המתוכנן וסוג הטעות, ונראה את שלושת הנושאים החלשים.'),
      h('li', {}, 'שאלות שנפתרו לא נכון נכנסות אוטומטית למחברת הטעויות. השאלות לא לקוחות ממבחן ההעברה, מחוברת המבחנים או מ"התאוששות תחת לחץ", ונמנעים משאלות שראיתם בשבוע האחרון כשאפשר.')),
    st.active
      ? h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/blind/run' }, 'להמשיך את הטורניר'))
      : h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: start }, 'מתחילים טורניר חדש'),
        last ? h('a', { class: 'btn', href: '#/blind/result' }, 'התוצאות האחרונות') : null));
}

function run(ctx, pool) {
  const st = load();
  const s = st.active;
  if (!s) return home(ctx, pool);
  const uid = nextUid(s);
  if (!uid) return result(ctx, pool);
  const item = pool.find((it) => it.uid === uid);
  if (!item) return home(ctx, pool);
  const n = s.uids.indexOf(uid) + 1;
  const t0 = Date.now(); // display timer: wall clock
  const sw = startVisible(item.budget); // recorded seconds: visible time only
  const body = answerBody(item, s.seed);
  const out = h('div', { 'aria-live': 'polite' });
  const timer = h('strong', { dir: 'ltr', 'aria-label': 'זמן שעבר' }, '0:00');
  const tick = setInterval(() => {
    if (timer.isConnected === false) { clearInterval(tick); return; }
    timer.textContent = formatTime(Math.round((Date.now() - t0) / 1000));
  }, 1000);
  const submitBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, n === s.uids.length ? 'הגשה וסיום' : 'הגשה והמשך');
  const skipBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'אין לי תשובה, לדלג');
  const finish = (grade) => {
    clearInterval(tick);
    const seconds = sw.seconds();
    if (body.lock) body.lock();
    submitBtn.disabled = true; skipBtn.disabled = true;
    if (submit(pool, uid, grade, seconds)) store.recordAttempt(attemptFor(item, grade, seconds));
    viewBlind(ctx, load().active ? 'run' : 'result');
  };
  submitBtn.addEventListener('click', () => {
    const g = gradeBlind(item, body.read(), s.seed);
    if (!g.valid) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, g.error)); return; }
    finish(g);
  });
  skipBtn.addEventListener('click', () => finish(skipBlind(item)));
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/blind' }, '→ יציאה (הטורניר נשמר)')),
    h('h1', {}, `שאלה ${n} מתוך ${s.uids.length}`),
    h('p', { class: 'muted' }, 'זמן: ', timer),
    h('p', { class: 'notice' }, 'ניסיון אחד, בלי רמזים. נושא ורמה ייחשפו רק בסוף.'),
    questionBlock(item), body.el, h('div', { class: 'btn-row' }, submitBtn, skipBtn), out);
}

function result(ctx, pool) {
  const st = load();
  const s = st.history[st.history.length - 1];
  if (!s) return home(ctx, pool);
  const d = resultData(pool, s);
  document.title = 'תוצאות הטורניר – Brain Gains';
  const errLine = (g) => Object.entries(g.errors).map(([k, v]) => `${ERROR_TYPES[k]}: ${v}`).join(' · ');
  const wrongList = d.rows.filter((r) => !r.correct);
  ctx.show(crumbs('#/blind', '→ לטורניר'), h('h1', {}, 'תוצאות טורניר החולשות'),
    h('p', { role: 'status' }, `${d.correct} מתוך ${d.questions} שאלות נפתרו במלואן · זמן ${formatTime(d.seconds)} מול ${formatTime(d.budget)} מתוכננים.`),
    h('h2', {}, 'שלושת הנושאים החלשים'),
    d.weakest.length
      ? h('ol', {}, d.weakest.map((g) => h('li', {},
        h('strong', {}, g.label), ` · ${g.n} ${g.n === 1 ? 'שאלה' : 'שאלות'} · דיוק עצמאי ${pct(g.accuracy)}`,
        g.overBudget ? ` · ${pct(g.overBudget)} מהשאלות עברו את הזמן המתוכנן` : '',
        errLine(g) ? ` · ${errLine(g)}` : '',
        g.lowConfidence ? h('span', { class: 'muted' }, ` · ביטחון נמוך: פחות מ־${MIN_CONFIDENT} שאלות בנושא, ולכן זה רמז ולא מסקנה`) : null)))
      : h('p', { class: 'feedback ok', role: 'status' }, 'אין נושא חלש בטורניר הזה: כל השאלות נפתרו נכון ובזמן.'),
    h('h2', {}, 'כל הנושאים'),
    h('ul', { class: 'bk-history' }, d.groups.map((g) => h('li', {}, `${g.label}: ${g.n} ${g.n === 1 ? 'שאלה' : 'שאלות'}, דיוק ${pct(g.accuracy)}${g.lowConfidence ? ' (ביטחון נמוך)' : ''}`))),
    h('p', { class: 'muted' }, 'הרשימה מבוססת על שאלות מעטות בכל נושא, ולכן כדאי לחזור על הטורניר כמה פעמים לפני שמסיקים מסקנות.'),
    wrongList.length
      ? h('div', {}, h('h2', {}, 'מה הוחמץ'), h('p', {}, `${wrongList.length} שאלות נכנסו למחברת הטעויות לחזרה אחרי 1, 3, 7 ו־14 ימים.`),
        h('ul', {}, wrongList.map((r) => h('li', {}, `${r.label}${r.error ? ` · ${ERROR_TYPES[r.error]}` : ''}`))),
        h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/notebook' }, 'למחברת הטעויות')))
      : null,
    h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/blind' }, 'טורניר נוסף')));
}
