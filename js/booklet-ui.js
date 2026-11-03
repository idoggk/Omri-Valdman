// #/booklet: printable mock exam. Routes: #/booklet (choose paper + history), #/booklet/paper/<subject>/<count>/<seed>
// (the paper, print or show on screen), #/booklet/enter/<subject>/<count>/<seed> (enter the points he gave himself).
// Logic and data are in js/booklet.js; the print layout is the .bk-* rules in styles.css.
import { h, ltr } from './dom.js';
import * as store from './store.js';
import { predictionForm, comparisonCard, historyBlock } from './journal-ui.js';
import { load as loadJournal, save as saveJournal, finishEntry, compare, hardestInPaper } from './journal.js';
import {
  loadBookletData, buildPaper, paperParts, loadSaved, saveSaved, recordResult, attemptFor, historySummary, parseSeed, subjectLabel,
  SUBJECTS, COUNTS, MINUTES, TOTAL, SEED_MAX,
} from './booklet.js';

const TITLE = '📄 חוברת מבחן להדפסה';
const BTN = 'min-height:44px;';
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const pct = (x) => `${Math.round(x * 100)}%`;
const paperHref = (kind, subject, count, seed) => `#/booklet/${kind}/${subject}/${count}/${seed}`;
const randomSeed = () => 1 + Math.floor(Math.random() * SEED_MAX);
const dateText = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' });

export async function viewBooklet(ctx, kind, subject, count, seed) {
  document.title = 'חוברת מבחן – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadBookletData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את שאלות החוברת. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewBooklet(ctx, kind, subject, count, seed) }, 'נסו שוב')));
  }
  if (kind === 'paper' || kind === 'enter') {
    const paper = buildPaper(res.data, subject, Number(count), parseSeed(seed));
    if (!paper) return home(ctx);
    return kind === 'paper' ? paperView(ctx, paper) : enterView(ctx, paper);
  }
  return home(ctx);
}

function home(ctx) {
  const saved = loadSaved();
  const summary = historySummary(saved);
  let subject = 'math';
  let count = 4;
  const seedInput = h('input', { type: 'number', min: '1', max: String(SEED_MAX), value: String(randomSeed()), 'aria-label': 'מספר מבחן', dir: 'ltr', style: `${BTN}width:8em` });
  const subjBtns = h('div', { class: 'filters', role: 'group', 'aria-label': 'מקצוע' });
  const countBtns = h('div', { class: 'filters', role: 'group', 'aria-label': 'מספר שאלות' });
  const paintChips = () => {
    subjBtns.replaceChildren(...SUBJECTS.map((s) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(s.id === subject), onclick: () => { subject = s.id; paintChips(); } }, s.label)));
    countBtns.replaceChildren(...COUNTS.map((n) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(n === count), onclick: () => { count = n; paintChips(); } }, `${n} שאלות`)));
  };
  paintChips();
  const err = h('div', { 'aria-live': 'polite' });
  const go = () => {
    const seed = parseSeed(seedInput.value);
    if (!seed) { err.replaceChildren(h('p', { class: 'error', role: 'alert' }, `מספר המבחן צריך להיות מספר שלם בין 1 ל־${SEED_MAX}.`)); return; }
    location.hash = paperHref('paper', subject, count, seed);
  };
  const rows = [...saved.results].reverse().slice(0, 10);
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, `מבחן בכתב־יד בסגנון מבחן אמיתי: ${MINUTES} דקות, ${TOTAL} נקודות, שאלות ארוכות עם סעיפים א–ו ומקום לפתרון מתחת לכל סעיף. השאלות כאן שייכות רק לחוברת ולא מופיעות בשום מקום אחר באתר.`),
    h('ul', {},
      h('li', {}, 'בוחרים מקצוע ומספר שאלות. אותו מספר מבחן תמיד נותן את אותו מבחן, כך אפשר להדפיס שוב או לחזור אליו.'),
      h('li', {}, 'מדפיסים (או מציגים על המסך), פותרים על הדף ובזמן, ואז מסמנים לעצמכם נקודות לפי מפתח הניקוד.'),
      h('li', {}, 'האתר לא בודק פתרונות בכתב־יד: אתם מזינים את הנקודות שנתתם לעצמכם, והתוצאה נשמרת בהיסטוריה.')),
    h('h2', {}, 'בחירת מבחן'), subjBtns, countBtns,
    h('p', {}, h('label', {}, 'מספר מבחן: ', seedInput), ' ', h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => { seedInput.value = String(randomSeed()); } }, 'מבחן חדש')),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: go }, 'להכנת המבחן')), err,
    h('h2', {}, 'היסטוריית מבחנים'),
    rows.length ? [
      h('p', { class: 'muted', role: 'status' }, SUBJECTS.filter((s) => summary[s.id]).map((s) => `${s.label}: ${summary[s.id].n} מבחנים, ממוצע ${pct(summary[s.id].avg)}, אחרון ${pct(summary[s.id].last)}`).join(' · ')),
      h('ul', { class: 'bk-history' }, rows.map((r) => h('li', {},
        `${dateText(r.ts)} · ${subjectLabel(r.subject)} · ${r.count} שאלות · מבחן ${r.seed} · `, h('strong', {}, `${r.total}/${r.max}`), ' ',
        h('a', { href: paperHref('paper', r.subject, r.count, r.seed) }, 'פתיחה'), ' · ', h('a', { href: paperHref('enter', r.subject, r.count, r.seed) }, 'עדכון ניקוד'))))]
      : h('p', { class: 'muted' }, 'עוד אין מבחנים. אחרי המבחן הראשון תוצאה תופיע כאן.'),
    h('h2', {}, 'תחזית מול מציאות'), historyBlock());
}

const lines = (n) => h('div', { class: 'bk-lines', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'bk-line' })));
const eqBlocks = (eq) => (eq || []).map((e) => h('div', { class: 'bk-eq', dir: 'ltr' }, ltr(e)));

function questionBlock(q) {
  return h('section', { class: `bk-q${q.fits ? ' fits' : ''}`, 'aria-label': `שאלה ${q.n}` },
    h('h2', {}, `שאלה ${q.n} (${q.total} נקודות) · ${q.title}`),
    h('p', {}, q.stem), eqBlocks(q.eq),
    q.parts.map((p) => h('div', { class: 'bk-part' },
      h('p', {}, h('strong', {}, `${p.letter}. `), p.ask, ' ', h('span', { class: 'bk-marks' }, `(${p.marks} נק׳)`)),
      lines(p.lines))));
}

function keyBlock(q) {
  return h('section', { class: 'bk-key-q', 'aria-label': `מפתח לשאלה ${q.n}` },
    h('h3', {}, `שאלה ${q.n} · ${q.title}`),
    q.parts.map((p) => h('div', { class: 'bk-key-part' },
      h('p', {}, h('strong', {}, `${p.letter}. `), h('span', {}, p.answer), p.unit ? ` (${p.unit})` : '', ' ', h('span', { class: 'bk-marks' }, `(${p.marks} נק׳)`)),
      h('ul', { class: 'bk-solution' }, p.solution.map((s) => h('li', {}, s))),
      h('p', { class: 'bk-rubric' }, h('em', {}, 'חלוקת נקודות: '), p.rubric.map(([pts, text], i) => [i ? ' · ' : '', `${pts} נק׳ ${text}`]).flat()))));
}

function paperView(ctx, paper) {
  document.title = `חוברת מבחן ${subjectLabel(paper.subject)} ${paper.seed} – Brain Gains`;
  let showKey = false;
  const root = h('div', { class: 'bk-paper bk-nokey' });
  const keyToggle = h('input', { type: 'checkbox', id: 'bk-key-toggle', onchange: (ev) => { showKey = ev.target.checked; root.classList.toggle('bk-nokey', !showKey); } });
  const clock = h('strong', { dir: 'ltr', 'aria-label': 'שעון' }, `${MINUTES}:00`);
  let timer = null;
  const startClock = () => {
    if (timer) return;
    const end = Date.now() + MINUTES * 60000;
    timer = setInterval(() => {
      if (clock.isConnected === false) { clearInterval(timer); return; }
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (!left) clearInterval(timer);
    }, 1000);
  };
  const toolbar = h('div', { class: 'bk-toolbar no-print' },
    crumbs('#/booklet', '→ בחירת מבחן אחר'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => window.print() }, '🖨️ הדפסה'),
      h('button', { class: 'btn', type: 'button', style: BTN, onclick: startClock }, 'התחלת שעון'),
      h('a', { class: 'btn', style: BTN, href: paperHref('enter', paper.subject, paper.count, paper.seed) }, 'הזנת תוצאות')),
    h('p', { class: 'muted' }, h('label', {}, keyToggle, ' להציג ולהדפיס גם את מפתח הניקוד (בדפים נפרדים אחרי עמוד ״עצרו כאן״)'), ' · זמן שנותר: ', clock),
    h('p', { class: 'muted' }, 'ההדפסה עובדת באתר עצמו ולא בתצוגה מקדימה בתוך תיבת חול. בלי מדפסת אפשר לפתור על דפים ריקים מתוך המסך.'));

  const header = h('header', { class: 'bk-head' },
    h('h1', {}, `מבחן בחוברת: ${subjectLabel(paper.subject)} (מבחן ${paper.seed})`),
    h('p', { class: 'bk-fill' }, 'שם: ______________________ · תאריך: ______________ · שעת התחלה: ________'),
    h('p', {}, `זמן: ${paper.minutes} דקות · סך הכול ${paper.total} נקודות · ${paper.count} שאלות. `,
      paper.subject === 'physics' ? 'בכל החישובים g = 10 מ/ש²; מתעלמים מהתנגדות האוויר. ' : '', 'כתבו את כל שלבי הפתרון; ענו על כל הסעיפים בסדר שנוח לכם.'),
    h('table', { class: 'bk-table' }, h('tbody', {},
      h('tr', {}, h('th', {}, 'שאלה'), paper.questions.map((q) => h('td', {}, String(q.n))), h('th', {}, 'סה״כ')),
      h('tr', {}, h('th', {}, 'נקודות'), paper.questions.map((q) => h('td', {}, String(q.total))), h('td', {}, String(paper.total))),
      h('tr', {}, h('th', {}, 'ציון'), paper.questions.map(() => h('td', {}, '')), h('td', {}, '')))));

  const keyset = h('div', { class: 'bk-keyset' },
    h('div', { class: 'bk-stop' }, h('h2', {}, 'עצרו כאן'), h('p', {}, 'זהו סוף חוברת המבחן. הדפים הבאים הם מפתח התשובות וחלוקת הנקודות: אל תפתחו אותם לפני שסיימתם לפתור.')),
    h('div', { class: 'bk-key' }, h('h2', {}, `מפתח תשובות וחלוקת נקודות: ${subjectLabel(paper.subject)}, מבחן ${paper.seed}`), paper.questions.map(keyBlock)));

  root.append(header, ...paper.questions.map(questionBlock), keyset);
  // prediction journal (no-print): score, hardest question and finishing time, compared after the points are entered
  const predict = h('div', { class: 'no-print' }, predictionForm({
    kind: 'booklet', key: paper.key, withConf: true,
    topics: paper.questions.map((q) => ({ id: `q:${q.id}`, label: `שאלה ${q.n}: ${q.title}` })),
  }));
  ctx.show(toolbar, predict, root);
}

function enterView(ctx, paper) {
  document.title = 'הזנת תוצאות – Brain Gains';
  const parts = paperParts(paper);
  const inputs = {};
  const totalEl = h('strong', { role: 'status', 'aria-live': 'polite' }, `0 מתוך ${paper.total}`);
  const update = () => {
    const sum = parts.reduce((s, p) => s + (Number.isInteger(Number(inputs[p.key].value)) && Number(inputs[p.key].value) > 0 ? Math.min(Number(inputs[p.key].value), p.max) : 0), 0);
    totalEl.textContent = `${sum} מתוך ${paper.total}`;
  };
  const prior = loadSaved().results.find((r) => r.key === paper.key);
  const minutes = h('input', { type: 'number', min: '0', max: '600', inputmode: 'numeric', dir: 'ltr', 'aria-label': 'כמה דקות לקח המבחן', style: `${BTN}width:6em` });
  if (prior && prior.minutes) minutes.value = String(prior.minutes);
  const out = h('div', { 'aria-live': 'polite' });
  const form = paper.questions.map((q) => h('section', { class: 'card', 'aria-label': `שאלה ${q.n}` },
    h('strong', {}, `שאלה ${q.n} · ${q.title} (${q.total})`),
    h('div', { class: 'bk-enter-parts' }, q.parts.map((p) => {
      const key = `${q.id}.${p.id}`;
      const input = h('input', { type: 'number', min: '0', max: String(p.marks), step: '1', inputmode: 'numeric', dir: 'ltr', 'aria-label': `סעיף ${p.letter} של שאלה ${q.n}, מתוך ${p.marks}`, style: `${BTN}width:5em` });
      if (prior && prior.parts[key] != null) input.value = String(prior.parts[key]);
      input.addEventListener('input', update);
      inputs[key] = input;
      return h('label', { class: 'bk-enter-part' }, `${p.letter}. `, input, ` / ${p.marks}`);
    }))));
  const save = () => {
    const scores = Object.fromEntries(parts.map((p) => [p.key, inputs[p.key].value]));
    const state = loadSaved();
    const r = recordResult(state, paper, scores, Number(minutes.value) || 0);
    if (!r.ok) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, r.error)); return; }
    if (saveSaved(state) === false) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'השמירה נכשלה (האחסון מלא).')); return; }
    const jr = loadJournal();
    const pend = jr.pending[paper.key];
    if (r.isNew) store.recordAttempt({ ...attemptFor(r.entry), ...(pend && pend.conf ? { predicted: pend.conf } : {}) });
    // close the journal entry (when a prediction was recorded): predicted vs actual score, hardest question and minutes
    const hard = hardestInPaper(paper, r.entry.parts);
    const closed = finishEntry(jr, 'booklet', paper.key, paper.key, {
      score: Math.round(r.entry.fraction * 100), topic: hard ? hard.topic : null, topicLabel: hard ? hard.topicLabel : '', minutes: r.entry.minutes || null,
    });
    if (closed) saveJournal(jr);
    out.replaceChildren(
      h('p', { class: 'feedback ok', role: 'status' }, `נשמר: ${r.entry.total} מתוך ${r.entry.max} (${pct(r.entry.fraction)}). ${r.isNew ? 'התוצאה נוספה להיסטוריה וליומן הניסיונות.' : 'התוצאה בהיסטוריה עודכנה.'}`),
      closed ? comparisonCard(closed, compare(closed)) : h('p', { class: 'muted' }, 'לא נרשמה תחזית לפני המבחן הזה, ולכן אין השוואה. בפעם הבאה אפשר לנחש בדף המבחן, לפני שמתחילים.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', style: BTN, href: '#/booklet' }, 'להיסטוריה ולמבחן הבא'), h('a', { class: 'btn', style: BTN, href: '#/notebook' }, 'למחברת הטעויות')));
  };
  update();
  ctx.show(crumbs(paperHref('paper', paper.subject, paper.count, paper.seed), '→ חזרה למבחן'), h('h1', {}, `הזנת תוצאות: ${subjectLabel(paper.subject)}, מבחן ${paper.seed}`),
    h('p', {}, 'הזינו את הנקודות שנתתם לעצמכם בכל סעיף לפי מפתח הניקוד (מספר שלם, עד המקסימום שליד הסעיף). סעיף שלא נבדק נשאר ריק, והוא נחשב 0. האתר לא מנקד פתרונות בכתב־יד.'),
    form,
    h('p', {}, h('label', {}, 'כמה דקות לקח לכם? (לא חובה) ', minutes)),
    h('p', {}, 'סך הכול: ', totalEl),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: save }, 'שמירת התוצאה')), out);
}
