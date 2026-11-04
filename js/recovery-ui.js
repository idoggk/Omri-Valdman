// #/recovery: recovery under pressure. Routes: #/recovery (start), #/recovery/run (the 20-minute mini-mock), #/recovery/result.
import { h } from './dom.js';
import { startVisible } from './clock.js';
import * as store from './store.js';
import { loadBlindPool, questionBlock, answerBody } from './blind-ui.js';
import { gradeBlind, skipBlind, attemptFor } from './blind.js';
import { formatTime } from './transfer.js';
import { timelineCard } from './replay-ui.js';
import {
  loadHardData, hardItem, ordinaryPool, makeSession, event, finishSession, recordResult, timeLeft, strategyScore, load, save, archive,
  MINUTES, SIZE, HARD_POS, recoveryTopic,
} from './recovery.js';

const TITLE = '🛟 התאוששות תחת לחץ';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const randomSeed = () => 1 + Math.floor(Math.random() * 999999);
const labelOf = (i) => `שאלה ${i + 1}`;

export async function viewRecovery(ctx, arg) {
  document.title = 'התאוששות תחת לחץ – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const fetchFn = ctx.fetchFn || ((u, o) => fetch(u, o));
  const [hard, pool] = await Promise.all([loadHardData(fetchFn), loadBlindPool(fetchFn)]);
  const ordinary = ordinaryPool(pool);
  if (!hard.ok || !hard.data.length || ordinary.length < SIZE) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את השאלות. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewRecovery(ctx, arg) }, 'נסו שוב')));
  }
  const env = { ctx, hards: hard.data, ordinary, pool };
  if (arg === 'run') return run(env);
  if (arg === 'result') return result(env);
  return home(env);
}

function home({ ctx, hards, ordinary }) {
  const st = load();
  const start = () => {
    const recent = new Set(store.getAttempts().filter((a) => a.ts >= Date.now() - 7 * 86400000).map((a) => a.exerciseId));
    const s = makeSession(ordinary, hards, randomSeed(), { history: st.history, recent }, Date.now());
    if (!s) return;
    st.active = s; save(st); viewRecovery(ctx, 'run');
  };
  const last = st.history[st.history.length - 1];
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, `מיני־מבחן של ${MINUTES} דקות עם ${SIZE} שאלות. אחת מהן, השנייה, קשה מאוד ולא מוכרת. המטרה היא לא לפתור אותה בכל מחיר, אלא לאמן הרגל של מבחן טוב: לדלג בזמן, לסיים את השאר ולחזור.`),
    h('ul', {},
      h('li', {}, 'אפשר לעבור בין השאלות בכל סדר, ולדלג על שאלה בלחיצה.'),
      h('li', {}, 'ניסיון אחד להגשה בכל שאלה. בלי רמזים.'),
      h('li', {}, 'בסוף נבדוק אם דילגתם בזמן, אם חזרתם, איך היה הדיוק לפני ואחרי השאלה הקשה וכמה זמן חסכתם.'),
      h('li', {}, 'הציון הוא לפי האסטרטגיה והדיוק, לא לפי מהירות.')),
    st.active ? h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/recovery/run' }, 'להמשיך את המבחן'))
      : h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: start }, 'מתחילים'), last ? h('a', { class: 'btn', href: '#/recovery/result' }, 'התוצאה האחרונה') : null));
}

function run(env) {
  const { ctx, hards, pool } = env;
  const st = load();
  const s = st.active;
  if (!s) return home(env);
  const items = s.uids.map((u) => (hards.find((q) => q.id === u) ? hardItem(hards.find((q) => q.id === u)) : pool.find((it) => it.uid === u)));
  if (items.some((i) => !i)) { st.active = null; save(st); return home(env); }
  const bodies = items.map((it) => answerBody(it, s.seed));
  const watch = (u) => startVisible((items[s.uids.indexOf(u)] || {}).budget);
  const opened = new Map(); // uid -> visible-time stopwatch of the current visit
  const spent = new Map(); // uid -> seconds on the question so far
  let cur = -1;
  const persist = () => save(st);
  const clock = h('strong', { dir: 'ltr', 'aria-label': 'זמן שנותר' }, formatTime(Math.round(timeLeft(s, Date.now()) / 1000)));
  const panel = h('div');
  const tabs = h('div', { class: 'filters', role: 'group', 'aria-label': 'שאלות' });
  const msg = h('div', { 'aria-live': 'polite' });

  const leave = () => {
    if (cur < 0) return;
    const u = s.uids[cur];
    spent.set(u, (spent.get(u) || 0) + (opened.get(u) ? opened.get(u).seconds() : 0)); // visible seconds only (js/clock.js); the mock's own countdown stays wall-clock
  };
  const open = (i) => {
    if (s.finishedAt) return;
    leave();
    cur = i;
    const u = s.uids[i];
    event(s, 'open', u, Date.now());
    opened.set(u, watch(u));
    persist();
    paint();
  };
  const finishAll = (auto) => {
    if (s.finishedAt) return;
    leave();
    clearInterval(tick);
    finishSession(s, Date.now());
    items.forEach((it, i) => {
      const r = s.results[s.uids[i]];
      store.recordAttempt({ ...attemptFor(it, r ? { correct: r.correct, skipped: r.skipped } : skipBlind(it), spent.get(s.uids[i]) || 0), topic: recoveryTopic(it.topic) });
    });
    archive(st, s); persist();
    if (auto) msg.replaceChildren(h('p', { class: 'notice', role: 'status' }, 'הזמן נגמר.'));
    viewRecovery(ctx, 'result');
  };
  const nextUnanswered = (from) => { for (let k = 1; k <= SIZE; k++) { const i = (from + k) % SIZE; if (!s.results[s.uids[i]] && !(i === from)) return i; } return -1; };

  const submit = (i) => {
    const it = items[i];
    const g = gradeBlind(it, bodies[i].read(), s.seed);
    if (!g.valid) { msg.replaceChildren(h('p', { class: 'error', role: 'alert' }, g.error)); return; }
    leave(); opened.set(s.uids[i], watch(s.uids[i]));
    if (recordResult(s, s.uids[i], g, spent.get(s.uids[i]) || 0, Date.now())) { event(s, 'answer', s.uids[i], Date.now()); bodies[i].lock && bodies[i].lock(); }
    persist(); msg.replaceChildren();
    const n = nextUnanswered(i);
    if (n < 0) finishAll(false); else open(n);
  };
  const skip = (i) => {
    event(s, 'skip', s.uids[i], Date.now());
    persist();
    const n = nextUnanswered(i);
    if (n < 0) { open(i); msg.replaceChildren(h('p', { class: 'notice' }, 'אין עוד שאלות פתוחות. אפשר לחזור לשאלה שדילגתם עליה או לסיים.')); } else open(n);
  };

  function paint() {
    tabs.replaceChildren(...items.map((it, i) => h('button', {
      class: 'chip', type: 'button', style: BTN, 'aria-pressed': String(i === cur),
      onclick: () => open(i),
    }, `${labelOf(i)}${s.results[s.uids[i]] ? ' ✓' : ''}`)));
    if (cur < 0) { panel.replaceChildren(h('p', { class: 'muted' }, 'בחרו שאלה כדי להתחיל. מומלץ להסתכל על כולן.')); return; }
    const answered = !!s.results[s.uids[cur]];
    panel.replaceChildren(h('section', { class: 'card', 'aria-label': labelOf(cur) },
      h('h2', {}, labelOf(cur)),
      questionBlock(items[cur]), bodies[cur].el,
      answered ? h('p', { class: 'muted' }, 'ענו על השאלה הזאת.') : h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => submit(cur) }, 'הגשה'),
        h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => skip(cur) }, 'דילוג (אחזור אליה)'))));
  }
  const tick = setInterval(() => {
    if (clock.isConnected === false) { clearInterval(tick); return; }
    const left = timeLeft(s, Date.now());
    clock.textContent = formatTime(Math.round(left / 1000));
    if (left <= 0) finishAll(true);
  }, 1000);

  ctx.show(h('p', { class: 'crumbs' }, h('a', { href: '#/recovery' }, '→ יציאה (המבחן נשמר והשעון ממשיך)')),
    h('h1', {}, TITLE), h('p', { class: 'muted' }, 'זמן שנותר: ', clock), tabs, panel, msg,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => finishAll(false) }, 'סיימתי את המבחן')));
  const resume = s.log.events.length ? s.uids.indexOf([...s.log.events].reverse().find((e) => e.type === 'open' || e.type === 'revisit')?.q) : -1;
  if (resume >= 0) { cur = resume; opened.set(s.uids[cur], watch(s.uids[cur])); paint(); } else paint();
}

function result({ ctx, hards, pool }) {
  const st = load();
  const s = st.history[st.history.length - 1];
  if (!s) return home({ ctx, hards, ordinary: ordinaryPool(pool), pool });
  const rec = hards.find((q) => q.id === s.hardUid);
  const sc = strategyScore(s, rec);
  const labels = s.uids.map((_, i) => (i === HARD_POS ? `${labelOf(i)} (הקשה)` : labelOf(i)));
  const tl = timelineCard(s.log, s.uids.map((u, i) => ({ key: u, label: labels[i], marks: 1, earned: s.results[u] ? s.results[u].score / s.results[u].total : 0 })), 'נקודה');
  document.title = 'תוצאות התאוששות – Brain Gains';
  ctx.show(crumbs('#/recovery', '→ להתאוששות'), h('h1', {}, 'איך הלכה האסטרטגיה'),
    h('p', { class: 'feedback ok', role: 'status' }, `ציון אסטרטגיה: ${sc.points} מתוך ${sc.max}. ${sc.verdict}`),
    h('ul', { class: 'plan-ready' }, sc.lines.map((l) => h('li', {}, l))),
    h('p', { class: 'muted' }, `השאלה הקשה הייתה: ${rec ? rec.title : ''}. ${sc.hardCorrect ? 'פתרתם אותה נכון.' : 'לא פתרתם אותה נכון.'}`),
    rec ? h('details', {}, h('summary', {}, 'הפתרון של השאלה הקשה'), h('div', { class: 'panel' }, rec.steps.map((t) => h('div', { steps: t })))) : null,
    tl,
    h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: '#/recovery' }, 'מיני־מבחן נוסף'), h('a', { class: 'btn', href: '#/notebook' }, 'למחברת הטעויות')));
}
