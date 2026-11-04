// Prediction vs reality journal UI: the pre-mock form, the comparison card shown after the mock, and the history of the last 10 mocks.
// Logic in js/journal.js. Used by the booklet and transfer screens and by the plan screen's progress panel.
import { h } from './dom.js';
import { isolateTitle } from './bidi.js';
import { confidenceBar } from './calibration-ui.js';
import { load, save, setPending, summary, gapTexts, HISTORY } from './journal.js';

const BTN = 'min-height:44px;';
const KIND_LABEL = { booklet: 'חוברת', transfer: 'מבחן העברה' };
const dateText = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
const sign = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * The form to fill before a mock. opts: { kind, key, topics: [{id,label}], withConf }.
 * Saves into the journal when the button is pressed; the node shows what was saved. Returns the node.
 */
export function predictionForm({ kind, key, topics, withConf = false, now = () => Date.now() }) {
  const state0 = load();
  const prior = state0.pending[key] || null;
  const score = h('input', { type: 'number', min: '0', max: '100', step: '1', inputmode: 'numeric', dir: 'ltr', 'aria-label': 'הציון החזוי באחוזים', style: `${BTN}width:6em`, value: prior ? String(prior.score) : '' });
  const minutes = h('input', { type: 'number', min: '1', max: '600', step: '1', inputmode: 'numeric', dir: 'ltr', 'aria-label': 'זמן הסיום החזוי בדקות', style: `${BTN}width:6em`, value: prior && prior.minutes ? String(prior.minutes) : '' });
  const topic = h('select', { 'aria-label': 'הנושא הקשה ביותר', style: BTN },
    h('option', { value: '' }, 'בחרו נושא'), topics.map((t) => h('option', { value: t.id }, t.label)));
  if (prior) topic.value = prior.topic;
  const conf = withConf ? confidenceBar() : { node: null, take: () => undefined };
  const out = h('div', { 'aria-live': 'polite' });
  const saved = (p) => out.replaceChildren(h('p', { class: 'feedback ok', role: 'status' }, `נשמרה תחזית: ${p.score} נקודות${p.topicLabel ? `, קשה: ${p.topicLabel}` : ''}${p.minutes ? `, ${p.minutes} דקות` : ''}. אחרי המבחן תראו את ההשוואה.`));
  if (prior) saved(prior);
  const submit = () => {
    const v = Number(score.value);
    if (score.value === '' || !Number.isInteger(v) || v < 0 || v > 100) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'הציון החזוי צריך להיות מספר שלם בין 0 ל־100.')); return; }
    const m = minutes.value === '' ? null : Number(minutes.value);
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 600)) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'זמן הסיום: מספר שלם של דקות (1 עד 600), או להשאיר ריק.')); return; }
    const t = topics.find((x) => x.id === topic.value);
    const state = load();
    const p = setPending(state, kind, key, { score: v, topic: t ? t.id : '', topicLabel: t ? t.label : '', minutes: m, conf: conf.take ? conf.take() : null }, now());
    if (!p || save(state) === false) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'השמירה נכשלה.')); return; }
    saved(p);
  };
  return h('section', { class: 'card', 'aria-label': 'תחזית לפני המבחן' },
    h('strong', {}, '🔮 קודם מנחשים'),
    h('p', { class: 'muted' }, 'לפני שמתחילים: מה הציון שתקבלו, איזה נושא יהיה הכי קשה, ובכמה דקות תסיימו. אחרי המבחן נשווה לתוצאה בפועל.'),
    h('div', { class: 'fields' },
      h('div', { class: 'field' }, h('label', {}, 'ציון חזוי (0 עד 100) ', score)),
      h('div', { class: 'field' }, h('label', {}, 'הנושא הכי קשה ', topic)),
      h('div', { class: 'field' }, h('label', {}, 'זמן סיום חזוי (דקות) ', minutes))),
    conf.node,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', style: BTN, onclick: submit }, 'שמירת התחזית')),
    out);
}

/** Comparison card of one journal entry: the three gaps. */
export function comparisonCard(entry, cmp, extra = null) {
  const t = gapTexts(cmp);
  return h('section', { class: 'card', 'aria-label': 'תחזית מול מציאות' },
    h('strong', {}, '🔮 תחזית מול מציאות'),
    h('ul', { class: 'plan-ready' },
      h('li', {}, h('strong', {}, 'ציון: '), t.score),
      h('li', {}, h('strong', {}, 'נושא קשה: '), t.topic),
      h('li', {}, h('strong', {}, 'זמן סיום: '), t.time)),
    extra,
    cmp.score.gap < -10 ? h('p', { class: 'notice' }, 'הציון בפועל נמוך בהרבה מהתחזית. כדאי לבדוק איפה הרגשתם בטוחים וטעיתם.')
      : cmp.score.gap > 10 ? h('p', { class: 'muted' }, 'הציון בפועל גבוה מהתחזית: אתם מצליחים יותר ממה שאתם מאמינים.') : null);
}

/** History of the last 10 mocks with the average gaps. */
export function historyBlock(state = load()) {
  const s = summary(state, HISTORY);
  if (!s.n) return h('p', { class: 'muted' }, 'עוד אין תחזיות עם תוצאה. רשמו תחזית לפני מבחן חוברת או מבחן העברה.');
  return h('div', {},
    h('p', { role: 'status' },
      `פער ממוצע בציון: ${sign(s.avgScoreGap)} נקודות (פער מוחלט ${s.avgAbsScoreGap})`,
      s.timeN ? ` · פער ממוצע בזמן: ${sign(s.avgTimeGap)} דקות` : '',
      s.topicN ? ` · פגיעה בנושא הקשה: ${s.topicHits} מתוך ${s.topicN}` : ''),
    h('ul', { class: 'bk-history' }, s.rows.map(({ entry, cmp }) => h('li', {},
      `${dateText(entry.ts)} · ${KIND_LABEL[entry.kind]} · חזיתם ${cmp.score.pred}, קיבלתם ${cmp.score.act} (`, h('strong', {}, sign(cmp.score.gap)), ')',
      cmp.time ? ` · זמן ${sign(cmp.time.gap)} דקות` : '',
      cmp.topic.hit === null ? '' : cmp.topic.hit ? ' · פגעתם בנושא' : ` · הקשה בפועל: ${isolateTitle(cmp.topic.act)}`))));
}

export { planLines } from './journal.js'; // lives in journal.js so that the home screen does not load this UI module
