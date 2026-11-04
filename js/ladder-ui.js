// Exam ladder screens: #/ladder (six stage cards), #/ladder/<stageId> (item list), #/ladder/<stageId>/<n> (one exercise).
// Items are either { ref } (an exercise of data/physics.json by id, ctx.byId) or inline exercise objects; both are
// drawn by the shared exercise renderer, so hints, solution, answer check and the difficulty card all work.
// Refs use the normal outcome store. Inline items and the "skip anyway" flags live in the ladder's own key.
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import * as store from './store.js';
import { LADDER_MATH_TOPIC } from './engine.js';
import { ladderStatus, loadLadder, setSkip, needed, outcomeLookup, inlineSink, isInline, itemId, SUBJECTS, subjectOf, parseLadderArgs } from './ladder.js';
import { OUTCOME_UI, badge, diagramFigure } from './exercise-view.js';

// Per subject: page title, heading and the overview blurb. Physics wording is unchanged.
const COPY = {
  physics: {
    title: 'הסלם לרמת מבחן',
    heading: '🪜 הסלם לרמת מבחן',
    intro: 'שישה שלבים, מתרגיל של נוסחה אחת ועד תרגיל מלא בסגנון מבחן. שלב נפתח אחרי ש־70% מהתרגילים בשלב הקודם נפתרו לבד: בלי רמזים, בלי צעדים מודרכים ובלי הצגת פתרון.',
  },
  math: {
    title: 'הסלם במתמטיקה',
    heading: '🪜 הסלם במתמטיקה',
    intro: 'שישה שלבים, ממשוואה אחת ועד מערכות עם שלושה וארבעה נעלמים וחזקות. שלב נפתח אחרי ש־70% מהתרגילים בשלב הקודם נפתרו לבד: בלי רמזים, בלי צעדים מודרכים ובלי הצגת פתרון.',
  },
};

const loaded = {};
async function loadStages(ctx, sub) {
  if (Array.isArray(ctx[sub.ctxKey])) return ctx[sub.ctxKey];
  if (!loaded[sub.id]) {
    try {
      const res = await fetch(sub.file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      loaded[sub.id] = Array.isArray(data.stages) ? data.stages : [];
    } catch (e) { return null; }
  }
  return loaded[sub.id];
}

/** Subject selector shown on the overview: physics / math, the current one marked. */
function subjectTabs(sub) {
  return h('nav', { class: 'btn-row', 'aria-label': 'בחירת מקצוע' }, SUBJECTS.map((s) =>
    h('a', { class: s.id === sub.id ? 'btn primary' : 'btn', href: s.base, 'aria-current': s.id === sub.id ? 'page' : null }, s.label)));
}

const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };
const STATUS_LABEL = { locked: '🔒 נעול', unlocked: '🔓 פתוח', done: '✅ הושלם', soon: '⏳ בקרוב' };
export const progressText = (e) => `${e.alone}/${e.total} לבד`;

const statuses = (stages) => ladderStatus(stages, outcomeLookup(stages, (id) => store.outcomeOf(id)), loadLadder().skip);
const exerciseOf = (ctx, it) => (isInline(it) ? it : ctx.byId(it.ref));

function viewOverview(ctx, sub, stages) {
  const copy = COPY[sub.id];
  title(copy.title);
  const st = statuses(stages);
  ctx.show(
    crumbs('#/practice-hub', '→ חזרה לתרגול'),
    h('h1', {}, copy.heading),
    subjectTabs(sub),
    h('p', { class: 'muted' }, copy.intro),
    h('div', { class: 'cards' }, stages.map((s, i) => {
      const e = st[i];
      const body = [
        h('strong', {}, isolateTitle(`${i + 1}. ${s.title}`)),
        h('span', { class: 'muted' }, STATUS_LABEL[e.status]),
        e.total ? h('span', { class: 'muted' }, progressText(e)) : h('span', { class: 'muted' }, s.soon || 'בקרוב'),
        e.total ? h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((100 * e.alone) / e.total)}%` })) : null,
      ];
      return e.status === 'soon'
        ? h('div', { class: 'card', 'aria-disabled': 'true' }, body)
        : h('a', { class: 'card', href: `${sub.base}/${s.id}` }, body);
    })));
}

function viewStage(ctx, sub, stages, stage) {
  const i = stages.indexOf(stage);
  const e = statuses(stages)[i];
  title(stage.title);
  const head = [crumbs(sub.base, `→ ${COPY[sub.id].title}`), h('h1', {}, isolateTitle(`${i + 1}. ${stage.title}`)), h('p', {}, stage.intro)];
  if (e.status === 'soon') return ctx.show(...head, h('p', { class: 'notice' }, stage.soon || 'התרגילים בשלב הזה יתווספו בקרוב.'));
  const lock = e.status === 'locked'
    ? [h('p', { class: 'notice' }, 'השלב נעול. כדי לפתוח אותו פתרו לבד לפחות 70% מהתרגילים בשלב הקודם.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { setSkip(stage.id); viewStage(ctx, sub, stages, stage); } }, 'לדלג בכל זאת'))]
    : null;
  ctx.show(...head,
    h('div', { class: 'panel' }, h('strong', {}, `${progressText(e)} (נדרשים ${needed(e.total)} לפתיחת השלב הבא)`),
      h('div', { class: 'progress-bar', role: 'img', 'aria-label': progressText(e) }, h('span', { style: `width:${Math.round((100 * e.alone) / e.total)}%` }))),
    lock,
    e.status === 'locked' ? null : h('ul', { class: 'ex-list' }, stage.items.map((it, n) => {
      const ex = exerciseOf(ctx, it);
      const o = outcomeLookup(stages, (id) => store.outcomeOf(id))(itemId(it));
      const ui = OUTCOME_UI[o || 'none'];
      return h('li', {}, h('a', { class: 'ex-item', href: `${sub.base}/${stage.id}/${n + 1}` },
        ex ? badge(ex.level) : null,
        h('span', { class: 't' }, isolateTitle(ex ? (ex.title || ex.id) : itemId(it))),
        h('span', { class: `tick o-${o || 'none'}`, role: 'img', 'aria-label': ui.label }, ui.icon)));
    })));
}

/**
 * Sketch parts (ex.sketches: [{ label, prompt, svg, checklist: [3 lines] }]): the student draws on paper, taps "show the correct
 * graph" and ticks a self-check list. A sketch is done only when every box is ticked. It never blocks the numeric parts, and the
 * item is recorded as solved only once the numeric answers are right AND every sketch is done (see gatedSink).
 */
export function sketchGate(sketches) {
  const ticks = sketches.map((sk) => (sk.checklist || []).map(() => false));
  const status = h('p', { class: 'muted', 'aria-live': 'polite' });
  const listeners = [];
  const done = () => ticks.every((t) => t.length > 0 && t.every(Boolean));
  const refresh = (extra) => {
    status.replaceChildren(done() ? `✏️ סעיפי השרטוט הושלמו${extra ? ` · ${extra}` : ''}` : '✏️ סעיף השרטוט נחשב רק אחרי שמסמנים את כל תיבות הבדיקה העצמית. הוא לא נבדק אוטומטית.');
  };
  refresh();
  const panels = sketches.map((sk, i) => {
    const out = h('div');
    const btn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false' }, 'הצג את הגרף הנכון');
    btn.addEventListener('click', () => {
      if (out.children.length) return;
      btn.setAttribute('aria-expanded', 'true');
      out.append(
        diagramFigure({ diagram: sk.svg, title: sk.label }),
        h('p', {}, h('strong', {}, 'בדיקה עצמית: סמנו מה שהצלחתם בשרטוט שלכם')),
        h('ul', { class: 'tips' }, (sk.checklist || []).map((line, j) => {
          const box = h('input', { type: 'checkbox', id: `sk-${i}-${j}` });
          box.addEventListener('change', () => { ticks[i][j] = !!box.checked; refresh(); listeners.forEach((f) => f()); });
          return h('li', {}, box, ' ', h('label', { for: `sk-${i}-${j}` }, line));
        })));
    });
    return h('div', { class: 'panel' }, h('h2', {}, sk.label || 'סעיף שרטוט'), h('p', { html: sk.prompt || '' }), h('div', { class: 'btn-row' }, btn), out);
  });
  return { node: h('div', {}, panels, status), done, refresh, onChange: (f) => listeners.push(f) };
}

/** Sink wrapper: the item counts as solved (correct()) only when the numeric answers AND the sketch parts are done. */
export function gatedSink(base, gate) {
  let numeric = false;
  const finish = () => {
    if (!numeric || !gate.done()) return;
    base.correct();
    const o = OUTCOME_UI[base.outcome()];
    gate.refresh(o ? `${o.icon} ${o.label}` : '');
  };
  gate.onChange(finish);
  return { ...base, correct: () => { numeric = true; finish(); } };
}

function viewItem(ctx, sub, stages, stage, n) {
  const e = statuses(stages)[stages.indexOf(stage)];
  const total = stage.items.length;
  const item = Number.isInteger(n) && n >= 1 && n <= total ? stage.items[n - 1] : null;
  const ex = item ? exerciseOf(ctx, item) : null;
  if (!ex || e.status === 'locked' || e.status === 'soon') return viewStage(ctx, sub, stages, stage);
  const nav = h('nav', { class: 'nav', 'aria-label': 'ניווט בשלב' },
    n > 1 ? h('a', { class: 'btn', href: `${sub.base}/${stage.id}/${n - 1}` }, '→ התרגיל הקודם') : h('a', { class: 'btn', href: `${sub.base}/${stage.id}` }, 'לרשימת השלב'),
    n < total ? h('a', { class: 'btn primary', href: `${sub.base}/${stage.id}/${n + 1}` }, 'התרגיל הבא ←') : h('a', { class: 'btn primary', href: sub.base }, 'סיום השלב ←'));
  const sketches = isInline(item) && Array.isArray(ex.sketches) ? ex.sketches : [];
  const gate = sketches.length ? sketchGate(sketches) : null;
  const inline = isInline(item) ? inlineSink(item.id) : undefined;
  // inline items never reach the attempt log, except a visit with a stated chance of full marks (calibration.js): that one is logged as 'ladder-math'
  const sink = inline && sub.id === 'math' ? { ...inline, attempt: (a) => (a.predicted ? store.recordAttempt({ ...a, topic: LADDER_MATH_TOPIC }) : null) } : inline;
  // the sketch panel goes right under the answer form
  const show = gate ? (...nodes) => {
    const k = nodes.findIndex((x) => x && x.tagName === 'FORM');
    ctx.show(...(k < 0 ? [...nodes, gate.node] : [...nodes.slice(0, k + 1), gate.node, ...nodes.slice(k + 1)]));
  } : ctx.show;
  ctx.renderExercise(ex, {
    ctx: gate ? { ...ctx, show } : ctx, nav, tryFirst: true, confidence: true,
    sink: gate ? gatedSink(sink, gate) : sink,
    crumbs: h('p', { class: 'crumbs' }, h('a', { href: `${sub.base}/${stage.id}` }, `→ ${stage.title} (${n}/${total})`)),
  });
}

/** Route: viewLadderRoute(ctx, ...args) with the args after "ladder": [], ['S2','3'], ['math'], ['math','M2','3']. */
export async function viewLadderRoute(ctx, ...args) {
  const { subject, stageId, itemNo } = parseLadderArgs(args);
  const sub = subjectOf(subject);
  const stages = await loadStages(ctx, sub);
  if (!stages) {
    title(COPY[sub.id].title);
    return ctx.show(h('h1', {}, COPY[sub.id].title),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  if (!stageId) return viewOverview(ctx, sub, stages);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return viewOverview(ctx, sub, stages);
  return itemNo ? viewItem(ctx, sub, stages, stage, Number(itemNo)) : viewStage(ctx, sub, stages, stage);
}
