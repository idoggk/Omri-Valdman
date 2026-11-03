// Glue between the standalone modes (hard math, multipart, trig, logs) and the attempt-log engine.
// Pure: no DOM, no storage. The modes call store.recordAttempt with the topic ids below, and the progress,
// summary and home screens use topicTitle / topicHref to show them in Hebrew with a working link.
import { FAMILIES } from './mathhard.js';
import { familyTitle } from './sprint.js';

export const MULTIPART_TOPIC = 'multipart';
export const TRIG_TOPIC = 'trig';
export const LOGS_TOPIC = 'logs';
export const LADDER_MATH_TOPIC = 'ladder-math'; // only inline ladder items that carry a confidence prediction are logged under it
export const COUNTER_TOPIC = 'counter';
export const mathHardTopic = (family) => `math-hard-${family}`;

const FIXED = {
  [MULTIPART_TOPIC]: ['שאלות בכמה סעיפים', '#/multipart'],
  [TRIG_TOPIC]: ['זהויות טריגונומטריות', '#/trig'],
  [LOGS_TOPIC]: ['לוגריתמים', '#/logs'],
  writing: ['כתיבת פתרון (ניקוד חלקי)', '#/writing'],
  formulas: ['הדף שלי: נוסחאות מהזיכרון', '#/formulas'],
  units: ['יחידות וניתוח ממדים', '#/units'],
  estimate: ['הערכה לפני חישוב', '#/estimate'],
  notes: ['דגשים: חזקות, כפל באי־שוויון ולוגריתמים', '#/notes'],
  derive: ['גזירה מהזיכרון: שחזור הוכחות ונוסחאות', '#/derive'],
  [COUNTER_TOPIC]: ['אתגר הדוגמה הנגדית', '#/counter'],
  [LADDER_MATH_TOPIC]: ['סולם המתמטיקה', '#/ladder/math'],
};

/** Hebrew title of an engine topic, or null when the id is not one of the standalone modes. */
export function topicTitle(id) {
  if (FIXED[id]) return FIXED[id][0];
  if (id.startsWith('sprint-')) return `ספרינט אלגברה: ${familyTitle(id.slice(7))}`;
  if (id === 'transfer-math') return 'מבחן העברה: מתמטיקה';
  if (id === 'transfer-physics') return 'מבחן העברה: פיזיקה';
  if (id === 'booklet-math') return 'חוברת מבחן: מתמטיקה';
  if (id === 'booklet-physics') return 'חוברת מבחן: פיזיקה';
  if (id === 'recover-math') return 'תקנו ותמשיכו: מתמטיקה';
  if (id === 'recover-physics') return 'תקנו ותמשיכו: פיזיקה';
  const fam = FAMILIES.find((f) => mathHardTopic(f.id) === id);
  return fam ? `מתמטיקה ברמה גבוהה: ${fam.title}` : null;
}

/** Page that practices the topic, or null for data/*.json topics (those use #/topic/<id>). */
export function topicHref(id) {
  if (FIXED[id]) return FIXED[id][1];
  if (id === 'recover-math' || id === 'recover-physics') return '#/recover';
  if (id.startsWith('sprint-')) return '#/sprint';
  if (id === 'booklet-math' || id === 'booklet-physics') return '#/booklet';
  return FAMILIES.some((f) => mathHardTopic(f.id) === id) ? '#/mathhard' : null;
}

/** Link back to one recorded item (for due reviews), or null for items of the data topics. */
export function itemHref(id, topic) {
  if (topic === LOGS_TOPIC) return id === 'logs-cards' ? '#/logs/cards' : `#/logs/ex/${id}`;
  if (topic === MULTIPART_TOPIC) return `#/multipart/${id}`;
  if (topic === 'writing') return `#/writing/${id}`;
  if (topic === 'formulas') return '#/formulas';
  if (topic === 'notes') return id === 'notes-cards' || id.startsWith('nt-c') ? '#/notes/cards' : `#/notes/ex/${id}`;
  if (topic === 'units') return '#/units';
  if (topic === 'derive') return `#/derive/t/${id}`;
  if (topic === COUNTER_TOPIC) return `#/counter/t/${id}`;
  if (topic === LADDER_MATH_TOPIC) return '#/ladder/math';
  if (topic === 'estimate' || String(topic).startsWith('sprint-')) return topic === 'estimate' ? '#/estimate' : '#/sprint';
  if (topic === 'recover-math' || topic === 'recover-physics') return `#/recover/${id}`;
  if (topic === TRIG_TOPIC) {
    if (id === 'trig-cards') return '#/trig/cards';
    if (id === 'trig-drill') return '#/trig/drill';
    return id.startsWith('trig-') ? `#/trig/proof/${id.slice(5)}` : '#/trig';
  }
  return topicHref(topic) ? `#/mathhard/${id}` : null;
}

/** Outcome of one visit to a solve-and-check exercise: alone / hinted / wrong (gave up or showed the solution). */
export function visitOutcome({ solved, hints = 0, wrongs = 0 }) {
  if (!solved) return 'wrong';
  return !hints && !wrongs ? 'alone' : 'hinted';
}

/** Multipart statuses {partId: correct|carried|wrong} -> alone (all correct) / hinted (no wrong part) / wrong. */
export function multipartOutcome(statuses) {
  const v = Object.values(statuses || {});
  if (!v.length || v.includes('wrong')) return 'wrong';
  return v.every((s) => s === 'correct') ? 'alone' : 'hinted';
}

/** Topics for title lookups: the data topics plus the standalone ones seen in `log` (with an optional href). */
export function topicsWithEngine(topics, log) {
  const have = new Set(topics.map((t) => t.id));
  const extra = [];
  for (const a of log) {
    if (a.topic && !have.has(a.topic)) {
      have.add(a.topic);
      extra.push({ id: a.topic, title: topicTitle(a.topic) || a.topic, href: topicHref(a.topic) });
    }
  }
  return extra.length ? topics.concat(extra) : topics;
}
