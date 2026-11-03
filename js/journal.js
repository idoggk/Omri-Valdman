// Prediction vs reality journal. Before a booklet mock or a transfer test the student records a predicted score (percent),
// the topic he expects to be hardest and the time he expects to need; afterwards the actual values are compared. Pure logic:
// storage is injected. js/journal-ui.js draws the form and the comparison card.
//
// state = { v: 1, pending: { [key]: pred }, entries: [ { id, kind, key, ts, pred, act } ] }
//   pred = { score: 0..100, topic, topicLabel, minutes: 1..600 | null, conf: 50|70|90|100 | null, ts }
//   act  = { score: 0..100, topic: string|null, topicLabel, minutes: number|null }
import { safeSetItem } from './storage.js';
import { CHIPS } from './calibration.js';

export const KEY = 'omri-study-journal-v1';
export const KINDS = ['booklet', 'transfer'];
export const HISTORY = 10; // comparison history shown (and averaged)
export const MAX_ENTRIES = 40;
export const TRANSFER_KEY = 'transfer-next'; // the pending prediction for the next transfer test (its session does not exist yet)

/** Broad topics for the transfer test (its questions are not known in advance); a question maps to the first of its `covers` found here. */
export const CATEGORIES = [
  { id: 'c:radical', label: 'שורשים', covers: ['math-hard-radical'] },
  { id: 'c:exp', label: 'חזקות ולוגריתמים', covers: ['math-hard-exponent', 'logs'] },
  { id: 'c:rational', label: 'אי־שוויונות רציונליים', covers: ['math-hard-rational'] },
  { id: 'c:param', label: 'משוואה עם פרמטר', covers: ['math-hard-param'] },
  { id: 'c:circle', label: 'מעגל וגאומטריה אנליטית', covers: ['math-hard-circle', 'math-3', 'math-4'] },
  { id: 'c:trig', label: 'טריגונומטריה', covers: ['trig'] },
  { id: 'c:vertical', label: 'פיזיקה: תנועה אנכית', covers: ['phys-vertical'] },
  { id: 'c:horizontal', label: 'פיזיקה: תנועה אופקית', covers: ['phys-horizontal'] },
];
/** Category id of a question's `covers` list (null when none matches). */
export function categoryOf(covers) {
  const list = Array.isArray(covers) ? covers : [];
  for (const c of list) {
    const cat = CATEGORIES.find((x) => x.covers.includes(c));
    if (cat) return cat.id;
  }
  return null;
}
export const categoryLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: '' }).label;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
const clampInt = (n, lo, hi) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };

export function cleanPred(p) {
  if (!isRec(p)) return null;
  const score = clampInt(p.score, 0, 100);
  if (score === null) return null;
  return {
    score, topic: str(p.topic, 40), topicLabel: str(p.topicLabel, 80), minutes: clampInt(p.minutes, 1, 600),
    conf: CHIPS.includes(p.conf) ? p.conf : null, ts: nn(p.ts),
  };
}
function cleanAct(a) {
  if (!isRec(a)) return null;
  const score = clampInt(a.score, 0, 100);
  if (score === null) return null;
  return { score, topic: a.topic == null ? null : str(a.topic, 40), topicLabel: str(a.topicLabel, 80), minutes: clampInt(a.minutes, 1, 600) };
}
function cleanEntry(e) {
  if (!isRec(e) || typeof e.id !== 'string' || !e.id || e.id.length > 60 || !KINDS.includes(e.kind)) return null;
  const pred = cleanPred(e.pred), act = cleanAct(e.act);
  return pred && act ? { id: e.id, kind: e.kind, key: str(e.key, 60), ts: nn(e.ts), pred, act } : null;
}

export const emptyState = () => ({ v: 1, pending: {}, entries: [] });
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw)) return out;
  if (isRec(raw.pending)) {
    for (const [k, p] of Object.entries(raw.pending)) {
      const c = cleanPred(p);
      if (c && k.length <= 60 && KINDS.includes(p.kind)) out.pending[k] = { ...c, kind: p.kind };
    }
  }
  if (Array.isArray(raw.entries)) out.entries = raw.entries.map(cleanEntry).filter(Boolean).sort((a, b) => a.ts - b.ts).slice(-MAX_ENTRIES);
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export function save(state, storage = globalThis.localStorage) { return safeSetItem(KEY, JSON.stringify(state), storage); }

/** Stores (or replaces) the prediction made before a mock. Returns the cleaned prediction or null when the score is unusable. */
export function setPending(state, kind, key, pred, now = Date.now()) {
  const c = cleanPred({ ...pred, ts: now });
  if (!c || !KINDS.includes(kind) || typeof key !== 'string' || !key) return null;
  state.pending[key] = { ...c, kind };
  return c;
}

/**
 * Closes a mock: the pending prediction of `key` (or, for an entry that is entered again, its old prediction) meets the actual values.
 * `id` is the entry id (a re-entered booklet keeps one line). Returns the entry, or null when no prediction was recorded.
 * Mutates the state: the pending prediction is consumed.
 */
export function finishEntry(state, kind, key, id, act, now = Date.now()) {
  const old = state.entries.find((e) => e.id === id);
  const pend = state.pending[key];
  const pred = pend ? cleanPred(pend) : old ? old.pred : null;
  const a = cleanAct(act);
  if (!pred || !a || !KINDS.includes(kind)) return null;
  const entry = { id, kind, key: str(key, 60), ts: now, pred, act: a };
  state.entries = state.entries.filter((e) => e.id !== id).concat(entry).sort((x, y) => x.ts - y.ts).slice(-MAX_ENTRIES);
  delete state.pending[key];
  return entry;
}

/** Gaps of one entry. score: actual - predicted points (positive = better than predicted). time: actual - predicted minutes (positive = slower), null when either is missing. topic: hit true/false, null when nothing was hard. */
export function compare(e) {
  return {
    score: { pred: e.pred.score, act: e.act.score, gap: e.act.score - e.pred.score },
    time: e.pred.minutes !== null && e.act.minutes !== null ? { pred: e.pred.minutes, act: e.act.minutes, gap: e.act.minutes - e.pred.minutes } : null,
    topic: { pred: e.pred.topicLabel, act: e.act.topicLabel, hit: e.act.topic ? e.pred.topic === e.act.topic : null },
  };
}

const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

/** The last `n` entries (newest first) with their comparisons and the averages over them. */
export function summary(state, n = HISTORY) {
  const rows = state.entries.slice(-n).reverse().map((e) => ({ entry: e, cmp: compare(e) }));
  const times = rows.filter((r) => r.cmp.time).map((r) => r.cmp.time.gap);
  const topics = rows.filter((r) => r.cmp.topic.hit !== null);
  return {
    n: rows.length, rows,
    avgScoreGap: mean(rows.map((r) => r.cmp.score.gap)),
    avgAbsScoreGap: mean(rows.map((r) => Math.abs(r.cmp.score.gap))),
    avgTimeGap: mean(times), timeN: times.length,
    topicHits: topics.filter((r) => r.cmp.topic.hit).length, topicN: topics.length,
  };
}

/** Hebrew sentences for one comparison. */
export function gapTexts(c) {
  const s = c.score;
  const score = s.gap === 0 ? `חזיתם ${s.pred} וקיבלתם ${s.act}: בדיוק.` : `חזיתם ${s.pred}, קיבלתם ${s.act}: ${s.gap > 0 ? 'יותר' : 'פחות'} מהצפוי ב־${Math.abs(s.gap)} נקודות.`;
  const t = c.time;
  const time = !t ? 'זמן סיום: לא הוזן זמן (או שלא נחזה), ולכן אין השוואה.'
    : t.gap === 0 ? `חזיתם ${t.pred} דקות וזה לקח ${t.act}: בדיוק.` : `חזיתם ${t.pred} דקות, לקח ${t.act}: ${t.gap > 0 ? 'איטי' : 'מהיר'} מהצפוי ב־${Math.abs(t.gap)} דקות.`;
  const p = c.topic;
  const topic = p.hit === null ? 'נושא קשה: אין נושא שהוחמץ, ולכן אין השוואה.'
    : p.hit ? `ציפיתם שהקשה יהיה ״${p.pred}״ וזה מה שהיה: פגעתם.` : `ציפיתם ״${p.pred || 'לא נבחר'}״, והקשה בפועל היה ״${p.act}״.`;
  return { score, time, topic };
}

/**
 * Hardest question of a booklet paper from the self-marked part points: the lowest fraction of its marks (the earlier question on a tie).
 * paper.questions[{ id, n, title, total, parts:[{ id }] }], parts = { 'bk-m1.a': points }. null when every question got full marks.
 */
export function hardestInPaper(paper, parts) {
  let best = null;
  for (const q of paper.questions) {
    const got = q.parts.reduce((s, p) => s + (Number(parts[`${q.id}.${p.id}`]) || 0), 0);
    const f = q.total ? got / q.total : 1;
    if (f < 1 && (!best || f < best.f)) best = { f, topic: `q:${q.id}`, topicLabel: `שאלה ${q.n}: ${q.title}` };
  }
  return best ? { topic: best.topic, topicLabel: best.topicLabel } : null;
}

/** Hardest category of a finished transfer session: lowest score fraction, then the biggest overrun of the suggested time. null when all were fully right. */
export function hardestInTransfer(items, session) {
  let best = null;
  for (const id of session.ids) {
    const q = items.find((x) => x.id === id);
    const r = session.results[id];
    if (!q || !r) continue;
    const f = r.total ? r.score / r.total : 1;
    if (f >= 1) continue;
    const over = q.budget ? r.seconds / q.budget : 0;
    const cat = categoryOf(q.covers);
    if (cat && (!best || f < best.f || (f === best.f && over > best.over))) best = { f, over, topic: cat, topicLabel: categoryLabel(cat) };
  }
  return best ? { topic: best.topic, topicLabel: best.topicLabel } : null;
}

/** Restore merge (strings in, string out): entries by id (the later one wins), pending by key (the later one wins, dropped when an entry already closed it). */
export function mergeJournal(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return emptyState(); } };
  const a = parse(localRaw), b = parse(backupRaw);
  const byId = new Map();
  for (const e of [...a.entries, ...b.entries]) { const cur = byId.get(e.id); if (!cur || e.ts > cur.ts) byId.set(e.id, e); }
  const out = emptyState();
  out.entries = [...byId.values()].sort((x, y) => x.ts - y.ts).slice(-MAX_ENTRIES);
  for (const k of new Set([...Object.keys(a.pending), ...Object.keys(b.pending)])) {
    const x = a.pending[k], y = b.pending[k];
    const p = !x || !y ? (x || y) : y.ts > x.ts ? y : x;
    const closed = out.entries.some((e) => e.key === k && e.ts >= p.ts);
    if (!closed) out.pending[k] = p;
  }
  return JSON.stringify(out);
}
