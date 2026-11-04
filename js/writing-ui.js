// #/writing: partial-credit writing trainer. Write the solution on paper in five stages, then compare with the model
// solution and mark the rubric lines you earned. Logic is in js/writing.js.
import { h } from './dom.js';
import { sanitizeHtml } from './sanitize.js';
import { isolateTitle, isolateFormulasHtml } from './bidi.js';
import * as store from './store.js';
import { createGate, attemptExtra } from './tryfirst.js';
import { confidenceBar, predExtra } from './calibration-ui.js';
import {
  STAGES, SUBJECTS, UNOFFICIAL, TOPIC, loadWritingData, loadSaved, recordResult, scoreOf, graderEstimate, outcomeOf, missedStages, weakestStage, totalOf, stageLabel, ltr,
} from './writing.js';

const TITLE = '✍️ כתיבת פתרון לניקוד חלקי';
const BTN = 'min-height:44px;';
const fmt = (n) => String(Math.round(n * 100) / 100);
const pct = (x) => `${Math.round(x * 100)}%`;
const rich = (tag, text, attrs = {}) => h(tag, { ...attrs, rawhtml: isolateFormulasHtml(sanitizeHtml(ltr(typeof text === 'string' ? text : ''))) });
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));

export async function viewWriting(ctx, id) {
  document.title = 'כתיבת פתרון – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadWritingData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewWriting(ctx, id) }, 'נסו שוב')));
  }
  const task = id ? res.data.find((x) => x.id === id) : null;
  return task ? runTask(ctx, res.data, task) : list(ctx, res.data);
}

function stageBars(saved) {
  const rows = missedStages(saved);
  if (!rows.length) return null;
  const weak = weakestStage(saved);
  return h('section', { class: 'panel', 'aria-labelledby': 'wr-stages' },
    h('h2', { id: 'wr-stages' }, 'איפה מפספסים נקודות'),
    weak ? h('p', { class: 'notice' }, `השלב שבו הפסדתם הכי הרבה נקודות: ${weak.label} (${pct(weak.rate)} מהנקודות שלו). שימו עליו דגש בפעם הבאה.`)
      : h('p', { class: 'muted' }, 'אחרי שני תרגילים נוכל להראות באיזה שלב מפספסים הכי הרבה.'),
    h('ul', { class: 'wr-stage-list' }, rows.map((r) => h('li', {}, `${r.label}: הפסדתם ${fmt(r.missed)} מתוך ${fmt(r.total)} נקודות (${pct(r.rate)})`))));
}

function list(ctx, data) {
  const saved = loadSaved();
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', {}, 'במבחן מקבלים ניקוד גם על הדרך, לא רק על התשובה. כאן מתרגלים את מבנה הפתרון: נתונים, נוסחאות, הצבה, חישוב, מסקנה עם יחידות.'),
    h('ol', {}, STAGES.map((s) => h('li', {}, h('strong', {}, `${s.label}: `), s.hint))),
    h('p', { class: 'muted' }, 'כותבים את הפתרון על דף, מציגים פתרון מודל ומסמנים בעצמכם איזה שורות ברשימת הבדיקה קיבלתם. התוצאה נשמרת כתרגול כתיבה ואינה נספרת כפתרון עצמאי.'),
    stageBars(saved),
    ...SUBJECTS.map((s) => {
      const items = data.filter((x) => x.subject === s.id);
      if (!items.length) return null;
      return h('section', { 'aria-label': s.label },
        h('h2', {}, s.label),
        h('ul', { class: 'ex-list' }, items.map((x) => {
          const r = saved.items[x.id];
          return h('li', {}, h('a', { class: 'ex-item', href: `#/writing/${x.id}` },
            h('span', { class: 't' }, isolateTitle(x.title)),
            h('span', { class: `tick o-${r && r.best >= 0.8 ? 'alone' : 'none'}`, role: 'img', 'aria-label': r ? `שיא ${pct(r.best)}` : 'טרם נפתר' }, r ? pct(r.best) : '○')));
        })));
    }));
}

function runTask(ctx, data, task) {
  document.title = `${isolateTitle(task.title)} – Brain Gains`;
  const next = data[data.indexOf(task) + 1];
  const t0 = Date.now();
  const total = totalOf(task);
  const got = new Set();
  const stage = h('div');
  const outBox = h('div', { 'aria-live': 'polite' });

  const gate = createGate({ on: false }); // writing has no hints to hide; the gate only times the first attempt (pressing "done writing")
  const conf = confidenceBar();
  const reveal = () => {
    gate.attempt();
    conf.lock();
    revealBtn.disabled = true;
    const sum = h('p', { class: 'wr-sum', role: 'status' });
    const est = h('div', { class: 'notice', role: 'note' });
    const saveBtn = h('button', { class: 'btn primary', type: 'button', style: BTN }, 'שמירת התוצאה');
    const refresh = () => {
      const sc = scoreOf(task, got);
      const ge = graderEstimate(task, [...got]);
      sum.textContent = `הניקוד שסימנתם: ${fmt(sc.points)} מתוך ${total}`;
      est.replaceChildren(
        h('strong', {}, `בוחן טיפוסי היה נותן כ־${fmt(ge.points)} מתוך ${total}`), h('span', { class: 'muted' }, ' (לא רשמי)'),
        h('p', { class: 'muted' }, UNOFFICIAL),
        rich('p', ge.extra ? `${ge.note} כאן העברת טעות הוסיפה כ־${fmt(ge.extra)} נקודות.` : ge.note));
    };
    const boxes = task.rubric.map((r) => {
      const cb = h('input', { type: 'checkbox', id: `wr-${r.id}`, onchange: () => { if (cb.checked) got.add(r.id); else got.delete(r.id); refresh(); } });
      return h('li', { class: 'wr-line' }, cb, ' ', h('label', { for: `wr-${r.id}` },
        h('strong', {}, `${stageLabel(r.stage)} · ${r.pts} ${r.pts === 1 ? 'נקודה' : 'נקודות'}: `), rich('span', r.label)));
    });
    saveBtn.addEventListener('click', () => {
      saveBtn.disabled = true;
      boxes.forEach((li) => { li.querySelector('input').disabled = true; });
      const { score } = recordResult(task, [...got]);
      store.recordAttempt({ exerciseId: task.id, topic: TOPIC, outcome: outcomeOf(score.fraction), hintsUsed: 0, seconds: Math.round((Date.now() - t0) / 1000), score: score.fraction, ...attemptExtra(gate), ...predExtra(conf) });
      const missed = task.rubric.filter((r) => !got.has(r.id));
      outBox.replaceChildren(
        h('div', { class: `feedback ${missed.length ? 'bad' : 'ok'}`, role: 'status' }, missed.length ? 'נשמר. אלה השורות שהוחמצו:' : 'נשמר. קיבלתם את כל הנקודות.'),
        missed.length ? h('ul', {}, missed.map((r) => h('li', {}, `${stageLabel(r.stage)}: `, rich('span', r.label)))) : null,
        stageBars(loadSaved()),
        h('div', { class: 'btn-row' },
          next ? h('a', { class: 'btn primary', href: `#/writing/${next.id}` }, 'התרגיל הבא ←') : null,
          h('a', { class: 'btn', href: '#/writing' }, 'לרשימת התרגילים')));
    });
    refresh();
    stage.replaceChildren(h('div', { class: 'wr-cols' },
      h('section', { class: 'panel', 'aria-label': 'פתרון מודל' },
        h('h2', {}, 'פתרון מודל'),
        task.model.map((m) => h('div', { class: 'wr-step' }, h('h3', {}, stageLabel(m.stage)), rich('p', m.text)))),
      h('section', { class: 'panel', 'aria-label': 'רשימת בדיקה' },
        h('h2', {}, 'רשימת בדיקה: סמנו מה קיבלתם'),
        h('p', { class: 'muted' }, 'סמנו רק שורות שכתובות בפתרון שלכם, גם אם התשובה הסופית לא יצאה.'),
        h('ul', { class: 'wr-rubric' }, boxes), sum, est, h('div', { class: 'btn-row' }, saveBtn))));
  };

  const revealBtn = h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: reveal }, 'סיימתי לכתוב, הציגו פתרון מודל');
  ctx.show(crumbs('#/writing', '→ לרשימת התרגילים'), h('h1', {}, isolateTitle(task.title)),
    h('p', { class: 'muted', role: 'status' }, `תרגיל ${data.indexOf(task) + 1} מתוך ${data.length} · ${total} נקודות`),
    rich('div', task.statement, { class: 'panel statement' }),
    h('section', { class: 'panel', 'aria-label': 'מבנה הפתרון' },
      h('h2', {}, 'כתבו על דף, בחמישה שלבים'),
      h('ol', {}, STAGES.map((s) => h('li', {}, h('strong', {}, `${s.label}: `), s.hint)))),
    conf.node, h('div', { class: 'btn-row' }, revealBtn), stage, outBox);
}
