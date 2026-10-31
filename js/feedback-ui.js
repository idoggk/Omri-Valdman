// Difficulty card shown after an exercise, and the #/feedback screen with export (share / download / copy).
// Everything is local: nothing is sent unless the learner taps a share button and picks an app.
import { h } from './dom.js';
import * as store from './store.js';
import {
  HARD_TAGS, NOTE_MAX, tagLabel, loadFeedback, saveFeedback, averageByTopic, tagCounts, hardestExercises,
  buildExport, exportFilename,
} from './feedback.js';

const BTN = 'min-height:44px;min-width:44px;';

/**
 * Compact rating card. o: { exerciseId, mode, topic, level, attemptId, context() -> {correct, hintsUsed, solutionViewed, secondsSpent} }.
 * One record per attemptId: tapping again or pressing save updates it. Skipping just removes the card.
 */
export function feedbackCard(o) {
  const id = `${o.mode}|${o.exerciseId}|${o.attemptId ?? Date.now()}`;
  let rating = 0;
  const tags = new Set();
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const noteInput = h('input', { type: 'text', maxlength: String(NOTE_MAX), autocomplete: 'off', 'aria-label': 'הערה קצרה (לא חובה)', style: 'width:100%;min-height:44px' });
  const box = h('section', { class: 'panel feedback-card', 'aria-label': 'דירוג קושי' });

  function persist() {
    if (!rating) return false;
    let ctx = {};
    try { ctx = (o.context && o.context()) || {}; } catch (e) { ctx = {}; }
    const rec = saveFeedback({
      id, exerciseId: o.exerciseId, mode: o.mode, topic: o.topic, level: o.level, rating,
      hardTags: [...tags], note: noteInput.value, ...ctx,
    });
    status.textContent = rec ? 'נשמר ✓ אפשר לעדכן.' : 'לא הצלחנו לשמור במכשיר.';
    return !!rec;
  }

  const ratingBtns = Array.from({ length: 10 }, (_, i) => h('button', {
    class: 'chip', type: 'button', style: BTN, 'aria-pressed': 'false', 'aria-label': `קושי ${i + 1}`,
    onclick: () => {
      rating = i + 1;
      ratingBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
      persist();
    },
  }, String(i + 1)));
  const tagBtns = HARD_TAGS.map((t) => h('button', {
    class: 'chip', type: 'button', style: BTN, 'aria-pressed': 'false',
    onclick: (ev) => {
      const b = ev.currentTarget || ev.target;
      if (tags.has(t.id)) tags.delete(t.id); else tags.add(t.id);
      b.setAttribute('aria-pressed', String(tags.has(t.id)));
      persist();
    },
  }, t.label));

  box.append(
    h('strong', {}, 'כמה היה קשה התרגיל? (1-10)'),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'קושי', style: 'display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0' }, ratingBtns),
    h('p', { class: 'muted', style: 'display:flex;justify-content:space-between;margin:0' }, h('span', {}, '1 = קל מאוד'), h('span', {}, '10 = קשה מאוד')),
    h('p', {}, h('strong', {}, 'מה היה קשה? '), h('span', { class: 'muted' }, '(לא חובה; בלי סימון = שום דבר לא היה קשה)')),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'מה היה קשה', style: 'display:flex;flex-wrap:wrap;gap:.4rem' }, tagBtns),
    h('p', {}, noteInput),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn primary', type: 'button', style: BTN,
        onclick: () => {
          if (!rating) return void (status.textContent = 'בחרו קושי מ-1 עד 10, או דלגו.');
          if (persist()) box.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'תודה, נשמר ✓'));
        },
      }, 'שמירה'),
      h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => box.replaceChildren() }, 'דלג')),
    status);
  return box;
}

/* ---------- export actions; each resolves to { ok, msg } and never throws ---------- */
const failMsg = 'הפעולה לא הצליחה במכשיר הזה. נסו אפשרות אחרת.';

export async function shareExport(json, filename, nav = globalThis.navigator, FileCtor = globalThis.File) {
  try {
    if (!nav || typeof nav.share !== 'function') return { ok: false, msg: 'השיתוף לא נתמך בדפדפן הזה. אפשר להוריד קובץ או להעתיק.' };
    const title = 'Brain Gains – משוב על תרגילים';
    if (typeof FileCtor === 'function' && typeof nav.canShare === 'function') {
      const file = new FileCtor([json], filename, { type: 'application/json' });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title });
        return { ok: true, msg: 'נפתח חלון השיתוף.' };
      }
    }
    await nav.share({ title, text: json });
    return { ok: true, msg: 'נפתח חלון השיתוף.' };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, msg: 'השיתוף בוטל.' };
    return { ok: false, msg: failMsg };
  }
}

export function downloadExport(json, filename, doc = globalThis.document, URLApi = globalThis.URL, BlobCtor = globalThis.Blob) {
  try {
    const url = URLApi.createObjectURL(new BlobCtor([json], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    doc.body.append(a);
    a.click();
    if (a.remove) a.remove();
    setTimeout(() => { try { URLApi.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 4000);
    return { ok: true, msg: 'הקובץ הורד. אפשר לשלוח אותו בוואטסאפ.' };
  } catch (e) {
    return { ok: false, msg: failMsg };
  }
}

export async function copyExport(json, nav = globalThis.navigator, doc = globalThis.document) {
  try {
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(json);
      return { ok: true, msg: 'הועתק. אפשר להדביק בוואטסאפ.' };
    }
  } catch (e) { /* fall through to the textarea fallback */ }
  try {
    const ta = doc.createElement('textarea');
    ta.value = json;
    doc.body.append(ta);
    if (ta.select) ta.select();
    const ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
    if (ta.remove) ta.remove();
    if (ok) return { ok: true, msg: 'הועתק. אפשר להדביק בוואטסאפ.' };
  } catch (e) { /* manual copy below */ }
  return { ok: false, manual: true, msg: 'ההעתקה האוטומטית לא עבדה. סמנו את הטקסט למטה והעתיקו ידנית.' };
}

/* ---------- #/feedback ---------- */
export function viewFeedback(ctx) {
  document.title = 'משוב על קושי – Brain Gains';
  const records = loadFeedback();
  const topicName = (id) => { const t = ctx.topics.find((x) => x.id === id); return t ? t.title : id || 'לא ידוע'; };
  const exName = (id) => { const e = ctx.byId(id); return e ? (e.title || e.id) : id; };
  const total = records.length;
  const overall = total ? Math.round((records.reduce((a, r) => a + r.rating, 0) / total) * 10) / 10 : 0;
  const tags = tagCounts(records).slice(0, 6);
  const hardest = hardestExercises(records);

  const msg = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const manual = h('div');
  const run = async (fn) => {
    manual.replaceChildren();
    let json = '';
    let name = exportFilename();
    try { json = JSON.stringify(buildExport(loadFeedback(), store.getAttempts(), ctx.exercises), null, 1); } catch (e) { msg.textContent = failMsg; return; }
    const res = await fn(json, name);
    msg.textContent = res.msg;
    if (res.manual) {
      const ta = h('textarea', { readonly: '', rows: '8', dir: 'ltr', style: 'width:100%', 'aria-label': 'קובץ המשוב כטקסט' });
      ta.value = json;
      manual.append(ta);
    }
  };

  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/progress' }, '→ ההתקדמות שלי')),
    h('h1', {}, 'משוב על קושי'),
    total
      ? [h('p', {}, h('strong', {}, String(total)), ` דירוגים · קושי ממוצע ${overall} מתוך 10`),
        h('h2', {}, 'קושי ממוצע לפי נושא'),
        h('ul', { class: 'reasons' }, averageByTopic(records).map((t) => h('li', {}, `${topicName(t.topic)}: ${t.avgRating} (${t.count})`))),
        h('h2', {}, 'מה הכי קשה'),
        tags.length ? h('ul', { class: 'reasons' }, tags.map((t) => h('li', {}, `${tagLabel(t.tag)}: ${t.count}`)))
          : h('p', { class: 'muted' }, 'עדיין לא סומן מה היה קשה.'),
        h('h2', {}, '10 התרגילים הקשים ביותר'),
        h('ol', { class: 'reasons' }, hardest.map((x) => h('li', {}, `${exName(x.exerciseId)} – ${x.avgRating}`)))]
      : h('p', { class: 'muted' }, 'עדיין אין דירוגים. אחרי כל תרגיל אפשר לדרג כמה הוא היה קשה.'),
    h('h2', {}, 'ייצוא ושליחה'),
    h('p', { class: 'muted' }, 'קובץ אחד עם הדירוגים וסיכום הלמידה. שום דבר לא נשלח אוטומטית.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: () => run((j, n) => shareExport(j, n)) }, 'שתף בוואטסאפ'),
      h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => run((j, n) => downloadExport(j, n)) }, 'הורדת קובץ'),
      h('button', { class: 'btn', type: 'button', style: BTN, onclick: () => run((j) => copyExport(j)) }, 'העתקה')),
    msg, manual);
}
