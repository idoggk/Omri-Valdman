// #/transfer: cold-start transfer test. One page per question (first attempt only, no hints, nothing revealed),
// a count-up timer next to the suggested time, and a Hebrew result screen at the end of the 6-question session.
import { h, ltr } from './dom.js';
import { startVisible } from './clock.js';
import { isolateTitle } from './bidi.js';
import { sanitizeSvg } from './sanitize.js';
import * as store from './store.js';
import { answerWidget } from './mathhard-ui.js';
import { prettyAnswer } from './mathhard.js';
import { topicTitle } from './engine.js';
import { confidenceBar, predExtra } from './calibration-ui.js';
import { predictionForm, comparisonCard } from './journal-ui.js';
import { load as loadJournal, save as saveJournal, finishEntry, compare, hardestInTransfer, CATEGORIES, TRANSFER_KEY } from './journal.js';
import {
  loadTransferData, loadSaved, startSession, nextQuestionId, gradeItem, skipGrade, attemptFor, submitResult, resultData,
  subjectLabel, formatTime, pickSession, PHYSICS_LETTERS, SESSION_SIZE, SUBJECTS,
} from './transfer.js';

import { track, timelineCard, replayLine } from './replay-ui.js';
import { load as replayStore } from './replay.js';

const replayKey = (session) => `transfer-${session.startedAt}`;
const replayQuestions = (items, session) => session.ids.map((id, i) => {
  const q = items.find((x) => x.id === id);
  const r = session.results[id];
  return { key: id, label: `שאלה ${i + 1}`, marks: q ? (q.subject === 'math' ? 1 : q.parts.length) : 1, earned: r ? r.score : 0 };
});
const TITLE = '🧊 מבחן העברה: שאלות חדשות לגמרי';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const stepsOf = (s) => (Array.isArray(s) ? s : [s]);
const fmt = (n) => String(Math.round(n * 100) / 100);

function figureEl(svg, label) {
  const clean = typeof svg === 'string' ? sanitizeSvg(svg) : '';
  return clean ? h('figure', { class: 'diagram', role: 'img', 'aria-label': label, html: clean }) : null;
}

export async function viewTransfer(ctx, arg) {
  document.title = 'מבחן העברה – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadTransferData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את השאלות. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewTransfer(ctx, arg) }, 'נסו שוב')));
  }
  if (arg === 'run') return runQuestion(ctx, res.data);
  if (arg === 'result') return resultView(ctx, res.data);
  return home(ctx, res.data);
}

function home(ctx, items) {
  const saved = loadSaved();
  const seen = Object.keys(saved.seen).length;
  const left = items.filter((q) => !saved.seen[q.id]).length;
  const active = saved.session && !saved.session.finishedAt ? saved.session : null;
  const lastDone = saved.session && saved.session.finishedAt ? saved.session : null;
  const nextSize = pickSession(items, saved.seen).length;
  const start = () => { if (startSession(items)) viewTransfer(ctx, 'run'); };
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, 'שאלות שלא מופיעות בשום מקום אחר באתר: ברמת שיעורי הבית ומעליה, עם ניסוח לא מוכר ושיטות מעורבות. הן נועדו למדוד אם מה שלמדתם עובד גם על שאלה חדשה.'),
    h('ul', {},
      h('li', {}, `מבחן של ${SESSION_SIZE} שאלות: 3 במתמטיקה ו־3 בפיזיקה.`),
      h('li', {}, 'ניסיון ראשון בלבד, בלי רמזים, ובלי פתרון עד סוף המבחן.'),
      h('li', {}, 'לכל שאלה יש זמן מומלץ. השעון רק מראה את הזמן ואינו עוצר אתכם.'),
      h('li', {}, 'כל שאלה מופיעה פעם אחת בלבד, ולכן אי אפשר לנסות שוב.'),
      h('li', {}, 'בפיזיקה g = 10 מ/ש² והתנגדות האוויר זניחה. אם לא כתוב אחרת, ציר y חיובי כלפי מעלה. התשובות לשתי ספרות אחרי הנקודה לכל היותר.')),
    h('p', { class: 'muted' }, `נענו ${seen} מתוך ${items.length} שאלות. נשארו ${left} שאלות חדשות.`),
    !active && nextSize ? predictionForm({ kind: 'transfer', key: TRANSFER_KEY, topics: CATEGORIES.map((c) => ({ id: c.id, label: c.label })) }) : null,
    h('div', { class: 'btn-row' },
      active ? h('a', { class: 'btn primary', href: '#/transfer/run' }, 'להמשיך את המבחן') : null,
      !active && nextSize ? h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: start }, `להתחיל מבחן חדש (${nextSize} שאלות)`) : null,
      lastDone ? h('a', { class: 'btn', href: '#/transfer/result' }, 'התוצאות האחרונות') : null),
    !active && !nextSize ? h('p', { class: 'notice' }, 'סיימתם את כל שאלות ההעברה. התוצאות האחרונות נשארות זמינות.') : null);
}

function physicsBody(item) {
  const inputs = {};
  const rows = item.parts.map((p) => {
    const input = h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', 'aria-label': `תשובה לסעיף ${PHYSICS_LETTERS[p.id] || p.id}`, style: `${BTN}width:8em` });
    inputs[p.id] = input;
    return h('section', { class: 'panel', 'aria-label': `סעיף ${PHYSICS_LETTERS[p.id] || p.id}` },
      h('p', {}, h('strong', {}, `${PHYSICS_LETTERS[p.id] || p.id}. `), p.ask),
      h('div', { class: 'btn-row' }, input, p.unit ? h('span', { class: 'muted' }, p.unit) : null));
  });
  return {
    el: h('div', {}, h('p', {}, item.stem), figureEl(item.diagram, item.title), rows),
    read: () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])),
    lock: () => Object.values(inputs).forEach((el) => { el.disabled = true; }),
  };
}

function runQuestion(ctx, items) {
  const saved = loadSaved();
  const session = saved.session && !saved.session.finishedAt ? saved.session : null;
  if (!session) return home(ctx, items);
  const id = nextQuestionId(session);
  if (!id) return resultView(ctx, items);
  const item = items.find((q) => q.id === id);
  if (!item) return home(ctx, items);
  const n = session.ids.indexOf(id) + 1;
  const t0 = Date.now(); // display timer: wall clock
  const sw = startVisible(item.budget); // recorded seconds: visible time only
  const body = item.subject === 'math' ? { widget: answerWidget(item) } : { widget: physicsBody(item) };
  const widget = body.widget;
  const conf = confidenceBar(); // optional "chance of full marks" chips (calibration.js), off by default
  const out =h('div', { 'aria-live': 'polite' });
  const timer = h('strong', { dir: 'ltr', 'aria-label': 'זמן שעבר' }, '0:00');
  const over = h('span', { class: 'muted' }, '');
  const submit = h('button', { class: 'btn primary', type: 'button', style: BTN }, n === session.ids.length ? 'הגשה וסיום' : 'הגשה ומעבר לשאלה הבאה');
  const skip = h('button', { class: 'btn', type: 'button', style: BTN }, 'אין לי תשובה, לדלג');
  const budgetText = `זמן מומלץ: ${formatTime(item.budget)}`;

  const tick = setInterval(() => {
    if (timer.isConnected === false) { clearInterval(tick); return; }
    const s = Math.round((Date.now() - t0) / 1000);
    timer.textContent = formatTime(s);
    over.textContent = s > item.budget ? ' · עברתם את הזמן המומלץ, אפשר להגיש מה שיש' : '';
  }, 1000);

  const rkey = replayKey(session);
  track('transfer', rkey, 'open', id, { start: true }); // strategy replay: the question page was opened
  const finish = (grade) => {
    clearInterval(tick);
    const seconds = sw.seconds();
    if (widget.lock) widget.lock();
    submit.disabled = true; skip.disabled = true;
    if (submitResult(items, id, grade, seconds)) store.recordAttempt({ ...attemptFor(item, grade, seconds), ...predExtra(conf) });
    track('transfer', rkey, grade.skipped ? 'skip' : 'answer', id);
    const done = loadSaved().session;
    if (done && done.finishedAt) track('transfer', rkey, 'finish', '');
    viewTransfer(ctx, done && done.finishedAt ? 'result' : 'run');
  };
  submit.addEventListener('click', () => {
    const grade = gradeItem(item, widget.read());
    if (!grade.valid) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, grade.error)); return; }
    finish(grade);
  });
  skip.addEventListener('click', () => finish(skipGrade(item)));

  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/transfer' }, '→ יציאה (המבחן נשמר)')),
    h('h1', {}, `שאלה ${n} מתוך ${session.ids.length} · ${subjectLabel(item.subject)}`),
    h('p', { class: 'muted' }, budgetText, ' · ', timer, over),
    h('p', { class: 'notice' }, 'ניסיון ראשון בלבד. אין רמזים, ואין פתרון עד סוף המבחן.'),
    conf.node,
    item.subject === 'math'
      ? [h('p', {}, item.ask), h('div', { class: 'panel' }, ...item.eq.map((line) => h('div', { dir: 'ltr', class: 'eq-block' }, ltr(line)))), widget.el]
      : widget.el,
    h('div', { class: 'btn-row' }, submit, skip), out);
}

function resultView(ctx, items) {
  const saved = loadSaved();
  const session = saved.session && saved.session.finishedAt ? saved.session : null;
  if (!session) return home(ctx, items);
  const byId = new Map(items.map((q) => [q.id, q]));
  const topicTitles = new Map((ctx.topics || []).map((t) => [t.id, t.title]));
  const data = resultData(items, session, { titleOf: (t) => topicTitles.get(t) || topicTitle(t) || t });
  const subjectCard = (s) => {
    const r = data.perSubject[s.id];
    return h('section', { class: 'card', 'aria-label': s.label },
      h('strong', {}, s.label),
      h('span', {}, `${r.correct} מתוך ${r.questions} שאלות נפתרו במלואן`),
      h('span', { class: 'muted' }, `${r.score} מתוך ${r.total} סעיפים נכונים · זמן ${formatTime(r.seconds)}`));
  };
  const missedItem = (m) => {
    const q = byId.get(m.id);
    return h('details', {},
      h('summary', {}, `${isolateTitle(m.title)} · ${subjectLabel(m.subject)} · ${m.score}/${m.total}${m.overBudget ? ' · עברתם את הזמן המומלץ' : ''}`),
      q.subject === 'math'
        ? h('div', { class: 'panel' }, h('p', {}, q.ask), ...q.eq.map((line) => h('div', { dir: 'ltr', class: 'eq-block' }, ltr(line))),
          h('strong', {}, 'פתרון: '), ...q.steps.map((st) => h('div', { steps: st })), h('p', { dir: 'ltr', class: 'muted' }, prettyAnswer(q.answer)))
        : h('div', { class: 'panel' }, h('p', {}, q.stem), figureEl(q.diagram, q.title),
          ...q.parts.map((p) => h('div', {}, h('p', {}, h('strong', {}, `${PHYSICS_LETTERS[p.id] || p.id}. `), p.ask, ' ', h('span', { dir: 'ltr', class: 'muted' }, `${fmt(p.answer)}${p.unit ? ' ' + p.unit : ''}`)),
            h('div', { steps: p.solution })))));
  };
  const left = pickSession(items, saved.seen).length;
  // prediction journal: close the entry of this session once (id = finish time), then show the comparison
  const jr = loadJournal();
  const jid = `transfer-${session.finishedAt}`;
  let jentry = jr.entries.find((e) => e.id === jid) || null;
  if (!jentry) {
    const hard = hardestInTransfer(items, session);
    const tot = Object.values(data.perSubject).reduce((a, r) => ({ s: a.s + r.score, t: a.t + r.total }), { s: 0, t: 0 });
    jentry = finishEntry(jr, 'transfer', TRANSFER_KEY, jid, {
      score: tot.t ? Math.round((tot.s / tot.t) * 100) : 0, topic: hard ? hard.topic : null, topicLabel: hard ? hard.topicLabel : '', minutes: data.seconds ? Math.max(1, Math.round(data.seconds / 60)) : null,
      replay: replayStore().logs[replayKey(session)] ? replayKey(session) : undefined,
    }, session.finishedAt);
    if (jentry) saveJournal(jr);
  }
  const rqs = replayQuestions(items, session);
  const rlog = replayStore().logs[replayKey(session)];
  document.title = 'תוצאות מבחן ההעברה – Brain Gains';
  ctx.show(crumbs('#/transfer', '→ למבחן ההעברה'), h('h1', {}, 'תוצאות מבחן ההעברה'),
    jentry ? comparisonCard(jentry, compare(jentry), replayLine(jentry.act.replay, rqs)) : null,
    h('div', { class: 'cards' }, SUBJECTS.map(subjectCard)),
    timelineCard(rlog, rqs, 'סעיפים'),
    h('p', {}, `זמן כולל: ${formatTime(data.seconds)} (זמן מומלץ לכל המבחן: ${formatTime(data.budget)}).`),
    h('h2', {}, 'מה הוחמץ'),
    data.missed.length ? stepsList(data.missed.map(missedItem)) : h('p', { class: 'feedback ok', role: 'status' }, 'אין החמצות. כל השאלות נפתרו נכון בניסיון ראשון.'),
    h('h2', {}, 'הצעד הבא'),
    h('div', { class: 'notice' }, data.next.text),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn primary', href: data.next.href }, 'לעבור לצעד הבא'),
      left ? h('a', { class: 'btn', href: '#/transfer' }, 'למבחן הבא') : null,
      h('a', { class: 'btn', href: '#/progress' }, 'להתקדמות שלי')));
}

const stepsList = (nodes) => h('div', {}, nodes);
