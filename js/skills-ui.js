// Foundation repair: #/repair (skills with status) and #/repair/<skillId> (mini-lesson, then 3 questions with
// immediate feedback). Also the "recommended repair" card for the home page. Reads attempts, writes only repair results.
import { h } from './dom.js';
import { isolateFormulas, isolateTitle, ltrIsolate } from './bidi.js';
import { isCorrect } from './check.js';
import * as store from './store.js';
import { loadRepair, recordRepair, recommendRepair, skillStatuses, skillById, isRepaired, nextTier, harderSet, MIN_MISSES, WINDOW, TIER_SIZES, TIER_NAMES, REPAIR_QUESTIONS, MASTERY } from './skills.js';

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
      h('span', { class: 'muted' }, `הצעד הבא: שלב ${TIER_NAMES[rec.tier]}`),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn primary', href: `#/repair/${rec.target}` }, `מיני־שיעור ושלב ${TIER_NAMES[rec.tier]}`))));
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
        h('span', { class: st.status === 'ok' ? 'muted' : '' }, STATUS_LABEL[st.status] + (st.best != null ? ` · שיא ${st.best}/${REPAIR_QUESTIONS}` : ''))));
    }))];
  ctx.show(
    crumbs('#/', '→ חזרה לדף הבית'),
    h('h1', {}, '🩹 חיזוק יסודות'),
    h('p', { class: 'muted' }, `מיומנות מסומנת כחלשה אחרי ${MIN_MISSES} טעויות או יותר מתוך ${WINDOW} הניסיונות האחרונים בתרגילים שלה. כל מיומנות: מיני־שיעור, דוגמה פתורה ו־8 שאלות בשלוש רמות (התחלה, בינוני, רמת מבחן). מחוזקת אחרי לפחות 6 תשובות נכונות מתוך 8.`),
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
  const tierQs = (tier) => s.questions.filter((q) => (q.tier || 1) === tier + 1);

  /* one tier = one session of 3 / 3 / 2 questions with a visible tier label */
  const ask = (tier, i, score) => {
    const qs = tierQs(tier);
    if (i >= qs.length) return finishTier(tier, score, qs.length);
    return question(qs[i], `שלב ${tier + 1} מתוך ${TIER_SIZES.length} · ${TIER_NAMES[tier]}`, i, qs.length, (ok) => ask(tier, i + 1, score + (ok ? 1 : 0)));
  };

  /* shared by the tier sessions and the harder set */
  const question = (q, label, i, n, next) => {
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', id: 'rp-input', dir: 'ltr', 'aria-label': 'תשובה' });
    const fb = h('div', { role: 'status', 'aria-live': 'polite' });
    const form = h('form', { onsubmit: (ev) => {
      ev.preventDefault();
      if (input.disabled) return;
      const ok = isCorrect(input.value, q.answer, 0.01);
      input.disabled = true;
      fb.replaceChildren(
        h('div', { class: ok ? 'feedback ok' : 'feedback bad' }, ok ? 'נכון!' : ['לא מדויק. התשובה הנכונה: ', h('span', { dir: 'ltr' }, ltrIsolate(String(q.answer)))]),
        Array.isArray(q.solution) && q.solution.length
          ? h('details', { class: 'panel', open: ok ? null : true }, h('summary', {}, 'פתרון מלא'), h('ol', {}, q.solution.map((l) => h('li', { steps: l })))) : null,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => next(ok) }, i + 1 < n ? 'השאלה הבאה ←' : 'לסיכום')));
    } },
    h('label', { for: 'rp-input' }, 'תשובה:'),
    h('div', { class: 'row' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'בדיקה')), fb);
    ctx.show(back, h('p', { class: 'muted tier-label' }, h('strong', {}, label)), h('h1', {}, `שאלה ${i + 1} מתוך ${n}`),
      h('div', { class: 'panel statement' }, h('p', {}, isolateFormulas(q.prompt)), eqBlock(q.eqs)), form);
  };

  const finishTier = (tier, score, n) => {
    recordRepair(s.id, tier, score);
    const repair = loadRepair();
    const repaired = isRepaired(repair, s.id);
    const all = repair.skills[s.id].t.every((x) => x !== null);
    const nxt = nextTier(repair, s.id);
    ctx.show(back, h('h1', {}, `סיום שלב ${TIER_NAMES[tier]}`),
      h('div', { class: score === n ? 'feedback ok' : 'feedback bad', role: 'status' }, `${score} מתוך ${n} בשלב הזה.`),
      repaired
        ? h('div', { class: 'feedback ok', role: 'status' }, `המיומנות חוזקה! ${repair.skills[s.id].best} מתוך ${REPAIR_QUESTIONS} נכונות (נדרש לפחות ${MASTERY}).`)
        : all ? h('div', { class: 'feedback bad', role: 'status' }, `כרגע ${repair.skills[s.id].best} מתוך ${REPAIR_QUESTIONS} נכונות, ונדרש לפחות ${MASTERY}. כדאי לקרוא שוב את המיני־שיעור ולנסות שוב את השלב החלש.`) : null,
      h('div', { class: 'btn-row' },
        nxt < TIER_SIZES.length && !repaired ? h('button', { class: 'btn primary', type: 'button', onclick: () => ask(nxt, 0, 0) }, all ? `ניסיון נוסף: ${TIER_NAMES[nxt]}` : `לשלב הבא: ${TIER_NAMES[nxt]} ←`) : null,
        all ? h('button', { class: 'btn primary', type: 'button', onclick: () => harder() }, 'סט קשה יותר') : null,
        h('button', { class: 'btn', type: 'button', onclick: lesson }, 'שיעור ושלבים'),
        h('a', { class: 'btn', href: '#/repair' }, 'לרשימה')));
  };

  /* harder set: tier-3 questions of the other skills of the same topic; not stored */
  const harder = () => {
    const qs = harderSet(data, s.id);
    const step = (i, score) => {
      if (i >= qs.length) {
        return ctx.show(back, h('h1', {}, 'סיום הסט הקשה'),
          h('div', { class: score === qs.length ? 'feedback ok' : 'feedback bad', role: 'status' }, `${score} מתוך ${qs.length}.`),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: lesson }, 'שיעור ושלבים'), h('a', { class: 'btn', href: '#/repair' }, 'לרשימה')));
      }
      return question(qs[i], 'סט קשה יותר · רמת מבחן ממיומנויות קרובות', i, qs.length, (ok) => step(i + 1, score + (ok ? 1 : 0)));
    };
    if (!qs.length) return lesson();
    return step(0, 0);
  };

  const lesson = () => {
    const repair = loadRepair();
    const t = repair.skills[s.id] ? repair.skills[s.id].t : [null, null, null];
    const nxt = nextTier(repair, s.id);
    const all = t.every((x) => x !== null);
    ctx.show(back,
      h('h1', {}, isolateTitle(s.name)),
      s.prereqs.length ? h('p', { class: 'muted' }, 'נשענת על: ', s.prereqs.map((p, i) => [i ? ', ' : '', h('a', { href: `#/repair/${p}` }, isolateTitle(nameOf(data, p)))])) : null,
      h('div', { class: 'panel' }, h('strong', {}, 'מיני־שיעור'), h('ul', {}, s.lesson.map((l) => h('li', {}, isolateFormulas(l))))),
      Array.isArray(s.example) && s.example.length
        ? h('div', { class: 'panel' }, h('strong', {}, 'דוגמה פתורה'), h('p', {}, isolateFormulas(s.example[0])), h('ol', {}, s.example.slice(1).map((l) => h('li', { steps: l })))) : null,
      h('div', { class: 'panel' }, h('strong', {}, `${REPAIR_QUESTIONS} שאלות בשלוש רמות`),
        h('p', { class: 'muted' }, `המיומנות נחשבת מחוזקת כשעונים נכון לפחות על ${MASTERY} מתוך ${REPAIR_QUESTIONS}, אחרי שסיימתם את שלושת השלבים.`),
        h('ul', { class: 'tier-list' }, TIER_NAMES.map((name, i) => h('li', {},
          h('strong', {}, `שלב ${i + 1} · ${name}`), ` (${TIER_SIZES[i]} שאלות) `,
          h('span', { class: 'muted' }, t[i] === null ? (i === nxt ? 'הבא בתור' : 'טרם הושלם') : `✓ ${t[i]} מתוך ${TIER_SIZES[i]}`))))),
      h('div', { class: 'btn-row' },
        nxt < TIER_SIZES.length
          ? h('button', { class: 'btn primary', type: 'button', onclick: () => ask(nxt, 0, 0) }, t[nxt] === null ? `התחלת שלב ${nxt + 1}: ${TIER_NAMES[nxt]}` : `ניסיון נוסף בשלב ${TIER_NAMES[nxt]}`)
          : h('button', { class: 'btn', type: 'button', onclick: () => ask(0, 0, 0) }, 'תרגול חוזר משלב ההתחלה'),
        all ? h('button', { class: 'btn primary', type: 'button', onclick: () => harder() }, 'סט קשה יותר') : null,
        t.some((x) => x !== null) ? TIER_NAMES.map((name, i) => (t[i] !== null && i !== nxt ? h('button', { class: 'btn', type: 'button', onclick: () => ask(i, 0, 0) }, `שוב: ${name}`) : null)) : null));
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
