// #/pressure: the optional pressure ladder. Routes: #/pressure (switch + choose a family), #/pressure/run (the current rung), #/pressure/result.
import { h } from './dom.js';
import * as store from './store.js';
import { loadBlindPool, questionBlock, answerBody } from './blind-ui.js';
import { attemptFor } from './blind.js';
import { formatTime } from './transfer.js';
import {
  families, makeSession, currentRung, startRung, finishRung, summarize, load, save, pressureTopic, RUNGS, PER_RUNG,
} from './pressure.js';

const TITLE = '🪜 סולם לחץ (רשות)';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const pct = (x) => `${Math.round(x * 100)}%`;
const randomSeed = () => 1 + Math.floor(Math.random() * 999999);

export async function viewPressure(ctx, arg) {
  document.title = 'סולם לחץ – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const pool = await loadBlindPool(ctx.fetchFn || ((u, o) => fetch(u, o)));
  const fams = families(pool);
  if (!fams.length) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון מספיק שאלות. בדקו את החיבור לאינטרנט ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewPressure(ctx, arg) }, 'נסו שוב')));
  }
  const env = { ctx, pool, fams };
  if (arg === 'run') return run(env);
  if (arg === 'result') return result(env);
  return home(env);
}

function home({ ctx, pool, fams }) {
  const st = load();
  let family = fams[0].id;
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': 'משפחת מיומנות' });
  const paint = () => chips.replaceChildren(...fams.map((f) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f.id === family), onclick: () => { family = f.id; paint(); } }, f.label)));
  paint();
  const toggle = () => { st.on = !st.on; save(st); home({ ctx, pool, fams }); };
  const start = () => {
    const recent = new Set(store.getAttempts().filter((a) => a.ts >= Date.now() - 7 * 86400000).map((a) => a.exerciseId));
    const s = makeSession(pool, family, randomSeed(), recent, Date.now());
    if (!s) return;
    st.active = s; save(st); viewPressure(ctx, 'run');
  };
  const last = st.history[st.history.length - 1];
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', { class: 'notice' }, 'זה תרגול רשות, והוא כבוי כברירת מחדל. הוא לא חלק מהאימון היומי ולא משפיע על שום ציון.'),
    h('p', {}, `אותה מיומנות, שלושה שלבים עם אותו סוג עבודה ופריטים שונים בכל שלב: ${RUNGS.map((r) => pct(r)).join(', ')} מהזמן המתוכנן למבחן. בכל שלב ${PER_RUNG} שאלות.`),
    h('ul', {},
      h('li', {}, 'לכל שלב שעון לאחור. כשהזמן נגמר, מה שכתבתם נבדק.'),
      h('li', {}, 'לא יהיה ציון אחד שמערבב דיוק ומהירות. הדיוק מוצג קודם, והזמן בנפרד.'),
      h('li', {}, 'בלי רמזים. הטעויות נכנסות למחברת הטעויות.')),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', style: BTN, 'aria-pressed': String(st.on), onclick: toggle }, st.on ? 'מופעל. לחצו לכיבוי' : 'כבוי. לחצו להפעלה')),
    st.on ? [h('h2', {}, 'בחירת משפחת מיומנות'), chips,
      st.active ? h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/pressure/run' }, 'להמשיך את הסולם'))
        : h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: start }, 'מתחילים'), last ? h('a', { class: 'btn', href: '#/pressure/result' }, 'התוצאה האחרונה') : null)]
      : last ? h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/pressure/result' }, 'התוצאה האחרונה')) : null);
}

function run({ ctx, pool, fams }) {
  const st = load();
  const s = st.active;
  if (!s || !st.on) return home({ ctx, pool, fams });
  const idx = currentRung(s);
  if (idx < 0) return result({ ctx, pool, fams });
  const rung = s.rungs[idx];
  startRung(rung, rung.startedAt || Date.now());
  save(st);
  const items = rung.uids.map((u) => pool.find((it) => it.uid === u));
  if (items.some((i) => !i)) { st.active = null; save(st); return home({ ctx, pool, fams }); }
  const bodies = items.map((it) => answerBody(it, s.seed));
  const clock = h('strong', { dir: 'ltr', 'aria-label': 'זמן שנותר בשלב' }, '');
  const left = () => Math.max(0, rung.seconds - Math.round((Date.now() - rung.startedAt) / 1000));
  const done = () => {
    clearInterval(tick);
    const readings = {};
    items.forEach((it, i) => { try { const v = bodies[i].read(); readings[it.uid] = v; } catch (e) { /* unreadable = unanswered */ } });
    const res = finishRung(pool, s, idx, readings, s.seed, Date.now());
    if (!res) return;
    const per = Math.max(1, Math.round(res.rung.used / items.length));
    for (const it of items) store.recordAttempt({ ...attemptFor(it, res.grades[it.uid], per), topic: pressureTopic(it.topic) });
    if (s.finishedAt) { st.history = [...st.history, s].slice(-12); st.active = null; }
    save(st);
    viewPressure(ctx, s.finishedAt ? 'result' : 'run');
  };
  const tick = setInterval(() => {
    if (clock.isConnected === false) { clearInterval(tick); return; }
    const l = left();
    clock.textContent = formatTime(l);
    if (l <= 0) done();
  }, 1000);
  clock.textContent = formatTime(left());
  ctx.show(h('p', { class: 'crumbs' }, h('a', { href: '#/pressure' }, '→ יציאה (השעון ממשיך)')),
    h('h1', {}, `שלב ${idx + 1} מתוך ${s.rungs.length}: ${pct(rung.pct)} מהזמן`),
    h('p', { class: 'muted' }, 'זמן שנותר: ', clock, ` (מתוך ${formatTime(rung.seconds)})`),
    items.map((it, i) => h('section', { class: 'card', 'aria-label': `שאלה ${i + 1}` }, h('h2', {}, `שאלה ${i + 1}`), questionBlock(it), bodies[i].el)),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: done }, idx === s.rungs.length - 1 ? 'סיום ובדיקה' : 'סיום השלב ומעבר לבא')));
}

function result({ ctx, pool, fams }) {
  const st = load();
  const s = st.history[st.history.length - 1];
  if (!s) return home({ ctx, pool, fams });
  const sum = summarize(s);
  document.title = 'תוצאות סולם הלחץ – Brain Gains';
  ctx.show(crumbs('#/pressure', '→ לסולם הלחץ'), h('h1', {}, `סולם לחץ: ${sum.label}`),
    h('p', { class: 'muted' }, 'הדיוק והזמן מוצגים בנפרד. אין ציון שמשלב ביניהם.'),
    h('table', { class: 'bk-table' }, h('tbody', {},
      h('tr', {}, h('th', {}, 'שלב'), h('th', {}, 'דיוק'), h('th', {}, 'שאלות נכונות'), h('th', {}, 'זמן שנוצל'), h('th', {}, 'זמן שהוקצב')),
      sum.rows.map((r) => h('tr', {}, h('td', {}, pct(r.pct)), h('td', {}, pct(r.accuracy)), h('td', {}, `${r.right} מתוך ${r.items}`), h('td', {}, formatTime(r.seconds)), h('td', {}, formatTime(r.allowed)))))),
    h('p', { class: 'feedback ok', role: 'status' }, sum.verdict),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/pressure' }, 'סולם נוסף'), h('a', { class: 'btn', href: '#/notebook' }, 'למחברת הטעויות')));
}
