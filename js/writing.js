// Partial-credit writing trainer (#/writing): 16 guided tasks that teach the exam layout
// givens > equations > substitution > calculation > conclusion with units. The learner writes the solution on paper, then
// self-marks it against a model solution with a rubric (5-6 checkable lines, each worth points).
// Pure part: data validation, scoring, the unofficial "what a grader would likely give" estimate, saved results and the
// missed-line statistics. js/writing-ui.js draws it. The result goes to the attempt log under topic 'writing' with a score
// fraction; it is never an independent solve (outcome is 'hinted' or 'wrong', never 'alone'), see srs.isReservedTopic.
import { safeSetItem } from './storage.js';
import { WRITING_TOPIC } from './srs.js';

export const KEY = 'omri-study-writing-v1';
export const DATA_FILE = 'data/writing.json';
export const ID_PREFIX = 'wr-';
export const TOPIC = WRITING_TOPIC;
export const PASS_FRACTION = 0.6;
export const STAGES = [
  { id: 'givens', label: 'נתונים', hint: 'כותבים מה נתון ומה מבקשים, בוחרים כיוון לציר ורושמים יחידות.' },
  { id: 'equations', label: 'נוסחאות', hint: 'כותבים את הנוסחה או המשוואה בצורתה הכללית, לפני שמציבים מספרים.' },
  { id: 'substitution', label: 'הצבה', hint: 'מציבים את הנתונים בנוסחה, עם יחידות, ועדיין בלי לחשב.' },
  { id: 'calculation', label: 'חישוב', hint: 'מחשבים צעד אחר צעד. כל תוצאת ביניים נכתבת.' },
  { id: 'conclusion', label: 'מסקנה עם יחידות', hint: 'משפט מסכם שעונה על מה ששאלו, כולל יחידות ובדיקה אם צריך.' },
];
export const stageLabel = (id) => (STAGES.find((s) => s.id === id) || { label: id }).label;
export const SUBJECTS = [{ id: 'physics', label: 'פיזיקה' }, { id: 'math', label: 'מתמטיקה' }];
export const UNOFFICIAL = 'הערכה לא רשמית: כך בוחן טיפוסי עשוי לנקד. הציון האמיתי נקבע לפי הנחיות הבוחן שלכם.';

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

/** `{{x}}` in the data marks a left-to-right formula; this turns it into a span (before sanitizing). */
export const ltr = (s) => String(s).replace(/\{\{([\s\S]*?)\}\}/g, (m, f) => `<span dir="ltr">${f}</span>`);

/* ---------- data ---------- */
export function validTask(t) {
  if (!isRec(t) || typeof t.id !== 'string' || !t.id.startsWith(ID_PREFIX) || !SUBJECTS.some((s) => s.id === t.subject)) return false;
  if (typeof t.title !== 'string' || typeof t.statement !== 'string' || typeof t.graderNote !== 'string') return false;
  if (!Array.isArray(t.model) || t.model.length !== STAGES.length) return false;
  if (!t.model.every((m, i) => isRec(m) && m.stage === STAGES[i].id && typeof m.text === 'string')) return false;
  if (!Array.isArray(t.rubric) || t.rubric.length < 5 || t.rubric.length > 6) return false;
  const ids = new Set();
  for (const r of t.rubric) {
    if (!isRec(r) || typeof r.id !== 'string' || ids.has(r.id) || !STAGES.some((s) => s.id === r.stage)) return false;
    if (typeof r.label !== 'string' || !Number.isInteger(r.pts) || r.pts < 1 || r.pts > 3) return false;
    ids.add(r.id);
  }
  return true;
}

let cache = null;
export const resetWritingCache = () => { cache = null; };
export async function loadWritingData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn(DATA_FILE, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!Array.isArray(d)) throw new Error('not an array');
    cache = d.filter(validTask);
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}

/* ---------- scoring ---------- */
export const totalOf = (task) => task.rubric.reduce((s, r) => s + r.pts, 0);

/** got = ids of the rubric lines the learner marked as achieved (unknown ids are ignored). -> { points, total, fraction, missed:[ids] } */
export function scoreOf(task, got) {
  const set = new Set(Array.isArray(got) ? got : got instanceof Set ? [...got] : []);
  const total = totalOf(task);
  const points = task.rubric.filter((r) => set.has(r.id)).reduce((s, r) => s + r.pts, 0);
  return { points, total, fraction: total ? round2(points / total) : 0, missed: task.rubric.filter((r) => !set.has(r.id)).map((r) => r.id) };
}

/**
 * Unofficial estimate of what a typical grader would give. A missed line marked `ecf` (it depends on an earlier result)
 * earns half its points when an EARLIER rubric line was missed: graders usually follow a slip through ("העברת טעות").
 * Everything else counts as marked. -> { points, total, extra, note }
 */
export function graderEstimate(task, got) {
  const set = new Set(Array.isArray(got) ? got : []);
  const total = totalOf(task);
  let extra = 0;
  let slipped = false;
  for (const r of task.rubric) {
    if (set.has(r.id)) continue;
    if (slipped && r.ecf) extra += r.pts / 2;
    slipped = true;
  }
  const base = scoreOf(task, set).points;
  return { points: Math.min(total, base + extra), total, extra, note: task.graderNote };
}

/** Attempt outcome for the log. Never 'alone': a self-marked written solution is not an independent solve. */
export const outcomeOf = (fraction) => (fraction >= PASS_FRACTION ? 'hinted' : 'wrong');

/* ---------- saved: { v, items: { id: { attempts, best, last, ts, missed: [lineId] } }, stages: { stage: { missed, total } } } ---------- */
export function sanitizeSaved(raw) {
  const out = { v: 1, items: {}, stages: {} };
  if (!isRec(raw)) return out;
  if (isRec(raw.items)) {
    for (const [id, e] of Object.entries(raw.items)) {
      if (!isRec(e) || id.length > 40 || !id.startsWith(ID_PREFIX)) continue;
      const fr = (x) => (Number.isFinite(x) && x >= 0 ? Math.min(1, x) : 0);
      out.items[id] = {
        attempts: nn(e.attempts), best: fr(e.best), last: fr(e.last), ts: Number.isFinite(e.ts) ? e.ts : 0,
        missed: Array.isArray(e.missed) ? e.missed.filter((m) => typeof m === 'string' && m.length <= 12).slice(0, 8) : [],
      };
    }
  }
  if (isRec(raw.stages)) {
    for (const s of STAGES) {
      const e = raw.stages[s.id];
      if (isRec(e)) out.stages[s.id] = { missed: nn(e.missed), total: nn(e.total) };
    }
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return sanitizeSaved(null); }
}

/** Stores one finished self-marking. Stage statistics are in points: missed points / available points. Returns the item. */
export function recordResult(task, got, storage = globalThis.localStorage, now = Date.now()) {
  const d = loadSaved(storage);
  const sc = scoreOf(task, got);
  const it = d.items[task.id] || (d.items[task.id] = { attempts: 0, best: 0, last: 0, ts: 0, missed: [] });
  it.attempts += 1; it.last = sc.fraction; it.best = Math.max(it.best, sc.fraction); it.ts = now; it.missed = sc.missed.slice(0, 8);
  const miss = new Set(sc.missed);
  for (const r of task.rubric) {
    const s = d.stages[r.stage] || (d.stages[r.stage] = { missed: 0, total: 0 });
    s.total += r.pts;
    if (miss.has(r.id)) s.missed += r.pts;
  }
  safeSetItem(KEY, JSON.stringify(d), storage);
  return { item: it, score: sc };
}

/** Stages by miss rate over time (only stages with data), worst first. [{ stage, label, missed, total, rate }] */
export function missedStages(saved) {
  return STAGES.map((s) => {
    const e = (saved.stages || {})[s.id] || { missed: 0, total: 0 };
    return { stage: s.id, label: s.label, missed: e.missed, total: e.total, rate: e.total ? e.missed / e.total : 0 };
  }).filter((x) => x.total > 0).sort((a, b) => b.rate - a.rate || b.missed - a.missed);
}
/** The stage he misses most, once at least 2 tasks were marked and something was missed; else null. */
export function weakestStage(saved) {
  const done = Object.values(saved.items || {}).reduce((n, e) => n + (e.attempts > 0 ? 1 : 0), 0);
  const w = missedStages(saved)[0];
  return done >= 2 && w && w.missed > 0 ? w : null;
}

/** Per-task summary for ceiling / feedback data: { tasks, attempts, avgBest, weakStage }. */
export function writingSummary(saved) {
  const items = Object.values(saved.items || {}).filter((e) => e.attempts > 0);
  const w = weakestStage(saved);
  return {
    tasks: items.length, attempts: items.reduce((s, e) => s + e.attempts, 0),
    avgBest: items.length ? round2(items.reduce((s, e) => s + e.best, 0) / items.length) : null,
    weakStage: w ? w.stage : null,
  };
}
