// #/sprint: algebra fluency sprints. Routes: #/sprint (choose length and family, levels, personal bests),
// #/sprint/run/<120|300>/<mixed|family>. Logic, generators and scoring are in js/sprint.js.
import { h } from './dom.js';
import * as store from './store.js';
import {
  FAMILIES, DURATIONS, MAX_LEVEL, loadSaved, saveSaved, levelOf, newSession, currentItem, submitAnswer, skipItem, finishSession, setAttempt, familyTitle,
} from './sprint.js';

const TITLE = '⏱️ ספרינטים באלגברה';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
/** A left-to-right expression as plain text (h() would insert bidi marks inside it). */
const code = (text, cls = '') => { const el = h('bdi', { dir: 'ltr', class: cls || null }); el.textContent = text; return el; };
const minutes = (dur) => (dur === 300 ? '5 דקות' : '2 דקות');
const dateText = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const pct = (x) => `${Math.round(x * 100)}%`;

export function viewSprint(ctx, mode, dur, fam) {
  document.title = 'ספרינטים באלגברה – Brain Gains';
  if (mode === 'run') {
    const d = Number(dur);
    return runSprint(ctx, DURATIONS.includes(d) ? d : 120, FAMILIES.some((f) => f.id === fam) ? fam : 'mixed');
  }
  return home(ctx);
}

function home(ctx) {
  const saved = loadSaved();
  const best = (d) => (saved.best[d] ? `${saved.best[d].cpm} נכונות לדקה (דיוק ${pct(saved.best[d].acc)}, ${dateText(saved.best[d].ts)})` : 'עדיין אין');
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, 'מערכות של תרגילים קצרים שנוצרים מתבניות מאומתות. כותבים את התשובה ו־Enter, ומיד מקבלים משוב ועוברים לתרגיל הבא. בסוף יש רשימה קצרה של כל התרגילים, הציון הוא נכונות לדקה ודיוק.'),
    h('p', { class: 'muted' }, 'אפשר להקליד כפל בלי כוכבית (2x, (x+1)(x+2)), חזקה עם ^ ושורש עם sqrt(...). שברים כותבים כ־3/4. מספר פתרונות מפרידים בפסיק. התשובה נבדקת לפי הערך ולא לפי הצורה, אבל במקומות שבהם מבקשים צורה מסוימת (מכפלת גורמים, שבר מצומצם) צריך לכתוב אותה.'),
    h('div', { class: 'btn-row' }, DURATIONS.map((d) => h('a', { class: 'btn primary', style: BTN, href: `#/sprint/run/${d}/mixed` }, `ספרינט מעורב · ${minutes(d)}`))),
    h('p', { role: 'status' }, `השיא שלכם ל־2 דקות: ${best(120)}`), h('p', { role: 'status' }, `השיא שלכם ל־5 דקות: ${best(300)}`),
    h('h2', {}, 'לפי נושא'),
    h('p', { class: 'muted' }, 'הרמה (1 עד 3) עולה כשהדיוק בנושא גבוה, ויורדת כשהוא נמוך.'),
    h('div', { class: 'cards' }, FAMILIES.map((f) => h('div', { class: 'card' },
      h('strong', {}, f.title), h('span', { class: 'muted' }, `רמה ${levelOf(saved, f.id)} מתוך ${MAX_LEVEL}`),
      h('div', { class: 'btn-row' }, DURATIONS.map((d) => h('a', { class: 'btn', style: BTN, href: `#/sprint/run/${d}/${f.id}` }, minutes(d))))))),
    saved.history.length ? h('section', {}, h('h2', {}, 'ספרינטים אחרונים'),
      h('ul', { class: 'sp-history' }, saved.history.slice(-8).reverse().map((e) => h('li', {},
        `${dateText(e.ts)} · ${minutes(e.dur)} · ${e.mode === 'mixed' ? 'מעורב' : familyTitle(e.mode)}: ${e.correct} נכונות, ${e.cpm} לדקה, דיוק ${pct(e.acc)}`)))) : null);
}

function runSprint(ctx, dur, family) {
  const saved = loadSaved();
  const sess = newSession({ seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, dur, family, saved });
  const t0 = Date.now();
  const left = () => dur - (Date.now() - t0) / 1000;
  let itemStart = Date.now();
  let timer = null;
  let over = false;

  const clock = h('strong', { role: 'timer' });
  const tally = h('span', { class: 'muted' });
  const promptEl = h('p', {});
  const mathEl = h('div', { class: 'panel sp-math' });
  const input = h('input', { type: 'text', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', maxlength: '120', 'aria-label': 'התשובה שלכם', style: `${BTN}width:min(100%,24em);font-family:monospace` });
  const msg = h('div', { 'aria-live': 'polite' });
  const last = h('div', { 'aria-live': 'polite', class: 'sp-last' });
  const okBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'בדיקה');
  const skipBtn = h('button', { class: 'btn', type: 'button', style: BTN }, 'דלגו');

  const refresh = () => {
    const s = Math.max(0, Math.ceil(left()));
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const c = sess.results.filter((r) => r.correct).length;
    tally.textContent = ` · נכונות: ${c} מתוך ${sess.results.length}`;
  };
  const show = () => {
    const item = currentItem(sess);
    promptEl.textContent = item.prompt;
    mathEl.replaceChildren(code(item.math, 'sp-expr'));
    input.value = '';
    msg.replaceChildren();
    itemStart = Date.now();
    refresh();
    if (typeof input.focus === 'function') input.focus();
  };
  const record = (res) => {
    saveSaved(sess.saved); // the attempts log gets one aggregated row per set, written in finish()
  };
  const feedback = (res) => {
    last.replaceChildren(res.correct
      ? h('span', { class: 'feedback ok', role: 'status' }, '✓ נכון')
      : h('span', { class: 'feedback bad', role: 'status' }, res.skipped ? 'דילגתם. התשובה: ' : '✗ לא נכון. התשובה: ', code(res.expected)));
  };
  const act = (fn) => {
    if (over) return;
    if (left() <= 0) { finish(); return; }
    const r = fn((Date.now() - itemStart) / 1000);
    if (!r.valid) { msg.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
    record(r.result);
    feedback(r.result);
    show();
    if (r.note) msg.replaceChildren(h('p', { class: 'muted' }, `ההערה לתשובה הקודמת: ${r.note}`));
  };

  function finish() {
    if (over) return;
    over = true;
    if (timer) clearInterval(timer);
    const out = finishSession(sess, Date.now());
    saveSaved(sess.saved);
    const row = setAttempt(sess, Date.now());
    if (row) store.recordAttempt(row);
    document.title = 'ספרינטים באלגברה – Brain Gains';
    const { score } = out;
    ctx.show(crumbs('#/sprint', '→ לספרינטים'), h('h1', {}, 'סיימנו!'),
      h('p', { class: 'feedback ok', role: 'status' }, `${score.correct} נכונות ב־${minutes(dur)}: ${score.cpm} לדקה · דיוק ${pct(score.acc)}${score.skipped ? ` · ${score.skipped} דילוגים` : ''}`),
      out.isBest ? h('p', { class: 'notice', role: 'status' }, `🏆 שיא אישי חדש${out.previousBest ? ` (קודם: ${out.previousBest.cpm} לדקה)` : ''}!`)
        : (out.previousBest ? h('p', { class: 'muted' }, `השיא שלכם: ${out.previousBest.cpm} נכונות לדקה. שיא נרשם רק עם דיוק של 70% ומעלה.`) : null),
      sess.moves.length ? h('ul', {}, sess.moves.map((m) => h('li', {}, `${familyTitle(m.fam)}: ${m.move === 'up' ? 'עליתם' : 'ירדתם'} לרמה ${m.level}`))) : null,
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: `#/sprint/run/${dur}/${family}` }, 'ספרינט נוסף'), h('a', { class: 'btn', style: BTN, href: '#/sprint' }, 'חזרה')),
      h('h2', {}, 'כל התרגילים'),
      sess.results.length ? h('ol', { class: 'sp-list' }, sess.results.map((r) => h('li', { class: r.correct ? 'ok' : 'bad' },
        h('span', { role: 'img', 'aria-label': r.correct ? 'נכון' : r.skipped ? 'דילוג' : 'שגוי' }, r.correct ? '✓' : r.skipped ? '⏭' : '✗'), ' ',
        code(r.math), ' → ', code(r.correct ? r.given : r.expected),
        r.correct ? null : h('span', { class: 'muted' }, r.skipped ? ' (דילוג)' : r.given ? ' (כתבתם: ' : ''), r.correct || r.skipped || !r.given ? null : code(r.given), r.correct || r.skipped || !r.given ? null : h('span', { class: 'muted' }, ')'))))
        : h('p', { class: 'notice' }, 'לא נענו תרגילים.'));
  }

  okBtn.addEventListener('click', () => act((sec) => submitAnswer(sess, input.value, sec)));
  skipBtn.addEventListener('click', () => act((sec) => skipItem(sess, sec)));
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); act((sec) => submitAnswer(sess, input.value, sec)); } });

  ctx.show(crumbs('#/sprint', '→ יציאה'), h('h1', {}, `${TITLE} · ${family === 'mixed' ? 'מעורב' : familyTitle(family)}`),
    h('p', {}, clock, tally), promptEl, mathEl, h('div', { class: 'panel' }, input), h('div', { class: 'btn-row' }, okBtn, skipBtn), msg, last);
  show();
  timer = setInterval(() => {
    if (over) return;
    if (clock.isConnected === false) { clearInterval(timer); over = true; return; }
    refresh();
    if (left() <= 0) finish();
  }, 250);
  return sess;
}
