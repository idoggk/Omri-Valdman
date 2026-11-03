// Draws the exam strategy replay (js/replay.js): the live tracker for a booklet mock, the automatic logging for the transfer
// test, and the timeline card shown after a mock and inside the prediction-vs-reality comparison.
import { h } from './dom.js';
import { load, save, newLog, logEvent, buildTimeline, summaryLine } from './replay.js';
import { formatTime } from './transfer.js';

const BTN = 'min-height:44px;';
const pct = (x) => `${Math.round(x * 100)}%`;

/** Appends one event to the stored log (creating it first when `start` is true). Returns the log, or null when nothing was stored. */
export function track(kind, key, type, q, { start = false, now = Date.now(), storage = globalThis.localStorage } = {}) {
  const st = load(storage);
  let log = st.logs[key];
  if (!log && start) { log = newLog(kind, key, now); st.logs[key] = log; }
  if (!log) return null;
  const ev = type ? logEvent(log, type, q, now) : null;
  if (ev || start) save(st, storage);
  return log;
}

/** Timeline card: order, time per question against its marks, skips and 2-3 lessons. Null when there is no usable log. */
export function timelineCard(log, questions, unit = 'נקודות') {
  if (!log || !log.events.length) return null;
  const tl = buildTimeline(log, questions);
  if (!tl.seconds) return null;
  const rows = tl.perQuestion.filter((r) => r.visits > 0 || r.marks > 0);
  const totalMarks = rows.reduce((s, r) => s + r.marks, 0);
  return h('section', { class: 'card replay-card', 'aria-label': 'שחזור אסטרטגיית המבחן' },
    h('strong', {}, '🎬 שחזור האסטרטגיה'),
    h('p', { class: 'muted' }, `זמן פעיל: ${formatTime(tl.seconds)}. סדר הפתרון: ${tl.order.length ? tl.order.map((k) => tl.perQuestion.find((r) => r.key === k).label).join(' ← ') : 'לא נרשם'}.`),
    h('ul', { class: 'bk-history replay-rows' }, rows.map((r) => h('li', {},
      h('strong', {}, r.label), ` · ${formatTime(r.seconds)} (${tl.seconds ? pct(r.seconds / tl.seconds) : '0%'} מהזמן) · ${r.marks} ${unit} (${totalMarks ? pct(r.marks / totalMarks) : '0%'} מהניקוד)`,
      r.earned != null ? ` · קיבלתם ${r.earned}` : '',
      r.visits > 1 ? ` · ${r.visits} כניסות` : '',
      r.skipped ? (r.returned ? ' · דילגתם וחזרתם' : ' · דילגתם') : '',
      r.visits === 0 ? ' · לא נפתחה' : ''))),
    h('p', {}, h('strong', {}, 'מה לומדים מזה:')),
    h('ul', { class: 'plan-ready' }, tl.lessons.map((t) => h('li', {}, t))));
}

/** Compact version for the journal comparison: one line, null when there is no log under `key`. */
export function replayLine(key, questions, storage = globalThis.localStorage) {
  if (!key) return null;
  const log = load(storage).logs[key];
  if (!log || !log.events.length) return null;
  const line = summaryLine(buildTimeline(log, questions));
  return line ? h('p', { class: 'muted replay-line' }, `🎬 ${line}`) : null;
}

/**
 * Booklet tracker (screen only): start, then per question "I am here now" / "done" / "skip", then finish.
 * Opening a question you left earlier is logged as a revisit by replay.js. Draws from and writes to the stored log.
 */
export function trackerPanel(key, questions, { onStart = () => {}, storage = globalThis.localStorage } = {}) {
  const box = h('div', { class: 'no-print', 'aria-live': 'polite' });
  const paint = () => {
    const log = load(storage).logs[key] || null;
    const running = log && !log.finishedAt;
    const cur = running ? [...log.events].reverse().find((e) => e.type === 'open' || e.type === 'revisit' || e.type === 'answer' || e.type === 'skip') : null;
    const here = cur && (cur.type === 'open' || cur.type === 'revisit') ? cur.q : null;
    box.replaceChildren(h('details', { class: 'card', open: !log },
      h('summary', {}, '🎬 מעקב אסטרטגיה (לא חובה)'),
      h('p', { class: 'muted' }, 'לחצו על הכפתורים תוך כדי המבחן. אחרי שתזינו את הניקוד תראו איפה הזמן הלך ביחס לנקודות. הלחיצות נרשמות עם שעה, ולא משפיעות על הציון.'),
      !log ? h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => { track('booklet', key, null, null, { start: true, storage }); onStart(); paint(); } }, 'התחלנו את המבחן')
        : log.finishedAt ? h('p', { class: 'muted' }, `המעקב הסתיים (${log.events.length - 1} פעולות). הזינו תוצאות כדי לראות את השחזור.`)
          : h('div', {},
            questions.map((q) => h('div', { class: 'btn-row' },
              h('strong', {}, q.label, here === q.key ? ' · כאן עכשיו' : ''),
              h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { track('booklet', key, 'open', q.key, { storage }); paint(); } }, 'עוברים לשאלה'),
              h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { track('booklet', key, 'answer', q.key, { storage }); paint(); } }, 'סיימנו אותה'),
              h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { track('booklet', key, 'skip', q.key, { storage }); paint(); } }, 'מדלגים'))),
            h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => { track('booklet', key, 'finish', '', { storage }); paint(); } }, 'סיימנו את המבחן')))));
  };
  paint();
  return box;
}
