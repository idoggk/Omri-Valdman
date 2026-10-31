// Exam ladder screens: #/ladder (six stage cards), #/ladder/<stageId> (item list), #/ladder/<stageId>/<n> (one exercise).
// Exercises come from data/physics.json by id (ctx.byId) and are drawn by the shared exercise renderer, so hints,
// solution, answer check and the difficulty card all work. Progress is the normal outcome store; only the
// "skip anyway" flags live in the ladder's own key (see ladder.js).
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import * as store from './store.js';
import { ladderStatus, loadLadder, setSkip, needed } from './ladder.js';
import { OUTCOME_UI, badge } from './exercise-view.js';

let loaded = null;
async function loadStages(ctx) {
  if (Array.isArray(ctx.ladder)) return ctx.ladder;
  if (!loaded) {
    try {
      const res = await fetch('data/ladder.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      loaded = Array.isArray(data.stages) ? data.stages : [];
    } catch (e) { return null; }
  }
  return loaded;
}

const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };
const STATUS_LABEL = { locked: '🔒 נעול', unlocked: '🔓 פתוח', done: '✅ הושלם', soon: '⏳ בקרוב' };
export const progressText = (e) => `${e.alone}/${e.total} לבד`;

const statuses = (stages) => ladderStatus(stages, (id) => store.outcomeOf(id), loadLadder().skip);

function viewOverview(ctx, stages) {
  title('הסלם לרמת מבחן');
  const st = statuses(stages);
  ctx.show(
    crumbs('#/practice-hub', '→ חזרה לתרגול'),
    h('h1', {}, '🪜 הסלם לרמת מבחן'),
    h('p', { class: 'muted' }, 'שישה שלבים, מתרגיל של נוסחה אחת ועד תרגיל מלא בסגנון מבחן. שלב נפתח אחרי ש־70% מהתרגילים בשלב הקודם נפתרו לבד: בלי רמזים, בלי צעדים מודרכים ובלי הצגת פתרון.'),
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
        : h('a', { class: 'card', href: `#/ladder/${s.id}` }, body);
    })));
}

function viewStage(ctx, stages, stage) {
  const i = stages.indexOf(stage);
  const e = statuses(stages)[i];
  title(stage.title);
  const head = [crumbs('#/ladder', '→ הסלם לרמת מבחן'), h('h1', {}, isolateTitle(`${i + 1}. ${stage.title}`)), h('p', {}, stage.intro)];
  if (e.status === 'soon') return ctx.show(...head, h('p', { class: 'notice' }, stage.soon || 'התרגילים בשלב הזה יתווספו בקרוב.'));
  const lock = e.status === 'locked'
    ? [h('p', { class: 'notice' }, 'השלב נעול. כדי לפתוח אותו פתרו לבד לפחות 70% מהתרגילים בשלב הקודם.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => { setSkip(stage.id); viewStage(ctx, stages, stage); } }, 'לדלג בכל זאת'))]
    : null;
  ctx.show(...head,
    h('div', { class: 'panel' }, h('strong', {}, `${progressText(e)} (נדרשים ${needed(e.total)} לפתיחת השלב הבא)`),
      h('div', { class: 'progress-bar', role: 'img', 'aria-label': progressText(e) }, h('span', { style: `width:${Math.round((100 * e.alone) / e.total)}%` }))),
    lock,
    e.status === 'locked' ? null : h('ul', { class: 'ex-list' }, stage.items.map((it, n) => {
      const ex = ctx.byId(it.ref);
      const o = store.outcomeOf(it.ref);
      const ui = OUTCOME_UI[o || 'none'];
      return h('li', {}, h('a', { class: 'ex-item', href: `#/ladder/${stage.id}/${n + 1}` },
        ex ? badge(ex.level) : null,
        h('span', { class: 't' }, isolateTitle(ex ? (ex.title || ex.id) : it.ref)),
        h('span', { class: `tick o-${o || 'none'}`, role: 'img', 'aria-label': ui.label }, ui.icon)));
    })));
}

function viewItem(ctx, stages, stage, n) {
  const e = statuses(stages)[stages.indexOf(stage)];
  const total = stage.items.length;
  const ex = Number.isInteger(n) && n >= 1 && n <= total ? ctx.byId(stage.items[n - 1].ref) : null;
  if (!ex || e.status === 'locked' || e.status === 'soon') return viewStage(ctx, stages, stage);
  const nav = h('nav', { class: 'nav', 'aria-label': 'ניווט בשלב' },
    n > 1 ? h('a', { class: 'btn', href: `#/ladder/${stage.id}/${n - 1}` }, '→ התרגיל הקודם') : h('a', { class: 'btn', href: `#/ladder/${stage.id}` }, 'לרשימת השלב'),
    n < total ? h('a', { class: 'btn primary', href: `#/ladder/${stage.id}/${n + 1}` }, 'התרגיל הבא ←') : h('a', { class: 'btn primary', href: '#/ladder' }, 'סיום השלב ←'));
  ctx.renderExercise(ex, {
    ctx, nav,
    crumbs: h('p', { class: 'crumbs' }, h('a', { href: `#/ladder/${stage.id}` }, `→ ${stage.title} (${n}/${total})`)),
  });
}

export async function viewLadderRoute(ctx, stageId, itemNo) {
  const stages = await loadStages(ctx);
  if (!stages) {
    title('הסלם לרמת מבחן');
    return ctx.show(h('h1', {}, 'הסלם לרמת מבחן'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את התרגילים. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  if (!stageId) return viewOverview(ctx, stages);
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return viewOverview(ctx, stages);
  return itemNo ? viewItem(ctx, stages, stage, Number(itemNo)) : viewStage(ctx, stages, stage);
}
