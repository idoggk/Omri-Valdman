// Foundation repair: #/repair (skills with status) and #/repair/<skillId> (mini-lesson, then 3 questions with
// immediate feedback). Also the "recommended repair" card for the home page. Reads attempts, writes only repair results.
import { h } from './dom.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';
import { isCorrect } from './check.js';
import * as store from './store.js';
import { loadRepair, recordRepair, recommendRepair, skillStatuses, skillById, MIN_MISSES, WINDOW } from './skills.js';

let loaded = null;
/** Loads data/skills.json once (ctx.skills overrides it for tests). Returns null when unavailable. */
export async function loadSkillsData(ctx) {
  if (ctx && ctx.skills) return ctx.skills;
  if (!loaded) {
    try {
      const res = await fetch('data/skills.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data || !Array.isArray(data.skills) || !data.skillTags) throw new Error('bad shape');
      loaded = data;
    } catch (e) { return null; }
  }
  return loaded;
}

const STATUS_LABEL = { weak: '⚠️ דורש חיזוק', repaired: '✅ חוזק', ok: 'אין בעיה כרגע' };
const crumbs = (href, text) => h('p', { class: 'crumbs' }, h('a', { href }, text));
const title = (t) => { document.title = `${t} – Brain Gains`; };
const eqBlock = (eqs) => (eqs && eqs.length ? h('div', { class: 'cp-eqs' }, eqs.map((q) => h('div', { dir: 'ltr' }, ltrIsolate(q)))) : null);
const nameOf = (data, id) => (skillById(data, id) || { name: id }).name;

/** Home-page card: stays empty unless some skill has repeated recent misses. */
export function homeCard(ctx) {
  const box = h('div');
  loadSkillsData(ctx).then((data) => {
    if (!data) return;
    const rec = recommendRepair(store.getAttempts(), data, loadRepair());
    if (!rec) return;
    box.append(h('section', { class: 'card review-card', 'aria-labelledby': 'repair-h' },
      h('strong', { id: 'repair-h' }, '🩹 חיזוק מומלץ'),
      h('span', { class: 'muted' }, rec.target === rec.weak
        ? `שגיאות חוזרות ב: ${nameOf(data, rec.weak)}`
        : `שגיאות חוזרות ב: ${nameOf(data, rec.weak)}. כדאי לחזק קודם: ${nameOf(data, rec.target)}`),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: `#/repair/${rec.target}` }, 'מיני־שיעור ו־3 שאלות'))));
  }).catch(() => {});
  return box;
}

function viewList(ctx, data) {
  title('חיזוק יסודות');
  const repair = loadRepair();
  const rec = recommendRepair(store.getAttempts(), data, repair);
  const statuses = skillStatuses(store.getAttempts(), data, repair);
  const section = (topic, heading) => [h('h2', {}, heading),
    h('ul', { class: 'ex-list' }, data.skills.filter((s) => s.topic === topic).map((s) => {
      const st = statuses.find((x) => x.id === s.id);
      return h('li', {}, h('a', { class: 'ex-item', href: `#/repair/${s.id}` },
        h('span', { class: 't' }, isolateTitle(s.name)),
        h('span', { class: st.status === 'ok' ? 'muted' : '' }, STATUS_LABEL[st.status] + (st.best != null ? ` · שיא ${st.best}/3` : ''))));
    }))];
  ctx.show(
    crumbs('#/', '→ חזרה לדף הבית'),
    h('h1', {}, '🩹 חיזוק יסודות'),
    h('p', { class: 'muted' }, `מיומנות מסומנת כחלשה אחרי ${MIN_MISSES} טעויות או יותר מתוך ${WINDOW} הניסיונות האחרונים בתרגילים שלה. כל מיומנות: מיני־שיעור קצר ו־3 שאלות.`),
    rec ? h('div', { class: 'panel' }, h('strong', {}, 'מומלץ עכשיו: '),
      h('a', { href: `#/repair/${rec.target}` }, isolateTitle(nameOf(data, rec.target)))) : null,
    section('math', '🧮 מתמטיקה'), section('phys', '🚀 פיזיקה'));
}

function viewSkill(ctx, data, id) {
  const s = skillById(data, id);
  if (!s) {
    title('חיזוק יסודות');
    return ctx.show(h('h1', {}, 'המיומנות לא נמצאה'), h('p', {}, h('a', { class: 'btn primary', href: '#/repair' }, 'לרשימה')));
  }
  title(s.name);
  const back = crumbs('#/repair', '→ חיזוק יסודות');
  const lesson = () => ctx.show(back,
    h('h1', {}, isolateTitle(s.name)),
    s.prereqs.length ? h('p', { class: 'muted' }, 'נשענת על: ', s.prereqs.map((p, i) => [i ? ', ' : '', h('a', { href: `#/repair/${p}` }, isolateTitle(nameOf(data, p)))])) : null,
    h('div', { class: 'panel' }, h('strong', {}, 'מיני־שיעור'), h('ul', {}, s.lesson.map((l) => h('li', {}, isolateFormulas(l))))),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => ask(0, 0) }, 'התחלת 3 שאלות')));

  const ask = (i, score) => {
    if (i >= s.questions.length) {
      recordRepair(s.id, score);
      return ctx.show(back, h('h1', {}, 'סיום'),
        h('div', { class: score === s.questions.length ? 'feedback ok' : 'feedback bad', role: 'status' },
          score === s.questions.length ? `${score} מתוך ${s.questions.length}. המיומנות חוזקה!` : `${score} מתוך ${s.questions.length}. כדאי לקרוא שוב את המיני־שיעור ולנסות שוב.`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: lesson }, 'שיעור וניסיון נוסף'),
          h('a', { class: 'btn', href: '#/repair' }, 'לרשימה')));
    }
    const q = s.questions[i];
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', id: 'rp-input', dir: 'ltr', 'aria-label': 'תשובה' });
    const fb = h('div', { role: 'status', 'aria-live': 'polite' });
    const form = h('form', { onsubmit: (ev) => {
      ev.preventDefault();
      if (input.disabled) return;
      const ok = isCorrect(input.value, q.answer, 0.01);
      input.disabled = true;
      fb.replaceChildren(
        h('div', { class: ok ? 'feedback ok' : 'feedback bad' }, ok ? 'נכון!' : ['לא מדויק. התשובה הנכונה: ', h('span', { dir: 'ltr' }, ltrIsolate(String(q.answer)))]),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => ask(i + 1, score + (ok ? 1 : 0)) }, i + 1 < s.questions.length ? 'השאלה הבאה ←' : 'לסיכום')));
    } },
    h('label', { for: 'rp-input' }, 'תשובה:'),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'בדיקה')), fb);
    ctx.show(back, h('h1', {}, `שאלה ${i + 1} מתוך ${s.questions.length}`),
      h('div', { class: 'panel statement' }, h('p', {}, isolateFormulas(q.prompt)), eqBlock(q.eqs)), form);
  };
  lesson();
}

export async function viewRepairRoute(ctx, id) {
  const data = await loadSkillsData(ctx);
  if (!data) {
    title('חיזוק יסודות');
    return ctx.show(h('h1', {}, 'חיזוק יסודות'),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את המיומנויות. נסו לרענן את הדף.'),
      h('p', {}, h('a', { class: 'btn', href: '#/' }, 'חזרה לדף הבית')));
  }
  return id ? viewSkill(ctx, data, id) : viewList(ctx, data);
}
