// #/counter: counterexample challenge. Pure logic: parsing the typed numbers, the numeric validation of a counterexample,
// the saved progress and its restore merge. Tasks and their numeric predicates are in js/counter-data.js; UI in js/counter-ui.js.
import { safeSetItem } from './storage.js';
import { TASKS, byId } from './counter-data.js';

export { TASKS, byId };
export const KEY = 'omri-study-counter-v1';
export const TOPIC = 'counter';

/** Typed number: decimal (dot or comma), minus sign (- or U+2212) or a fraction a/b. null when it is not a finite number. */
export function parseNum(text) {
  const s = String(text == null ? '' : text).trim().replace(/−/g, '-').replace(/,/g, '.').replace(/\s+/g, '');
  const num = (t) => (/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : NaN);
  const m = s.match(/^(.+)\/(.+)$/);
  const v = m ? num(m[1]) / num(m[2]) : num(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Validates a counterexample. `typed` = { varId: text }. Returns
 *  { ok:false, reason:'input', msg }   a field is empty or not a number
 *  { ok:false, reason:'domain', msg }  the values are outside the claim's domain (they prove nothing)
 *  { ok:false, reason:'holds', msg }   the claim is true at these values
 *  { ok:true, values }                 the claim is false at values inside its domain
 */
export function checkCounterexample(task, typed) {
  const values = {};
  for (const v of task.vars) {
    const n = parseNum(typed && typed[v.id]);
    if (n === null) return { ok: false, reason: 'input', msg: `יש להקליד מספר בשדה ${v.label} (למשל 3, -0.5 או 1/2).` };
    values[v.id] = n;
  }
  if (!task.domain(values)) return { ok: false, reason: 'domain', msg: `הערכים האלה מחוץ לתחום של הטענה, ולכן הם לא מפריכים אותה. ${task.domainText}` };
  if (task.holds(values)) return { ok: false, reason: 'holds', msg: 'בערכים האלה הטענה דווקא מתקיימת, ולכן זו לא דוגמה נגדית. חפשו ערכים שבהם שני הצדדים נבדלים (או שהמסקנה נכשלת).' };
  return { ok: true, values };
}

/* ---------- saved progress: { v, tasks: { id: { done, tries, ts } } } ---------- */
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
export const emptyState = () => ({ v: 1, tasks: {} });
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw) || !isRec(raw.tasks)) return out;
  for (const [id, e] of Object.entries(raw.tasks)) {
    if (!byId(id) || !isRec(e)) continue;
    out.tasks[id] = { done: e.done === true, tries: nn(e.tries), ts: nn(e.ts) };
  }
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export function save(state, storage = globalThis.localStorage) { return safeSetItem(KEY, JSON.stringify(state), storage); }

/** One check result: a failed check counts a try, a counterexample marks the task done. Mutates and returns the state. */
export function applyCheck(state, id, ok, now = Date.now()) {
  const e = state.tasks[id] || { done: false, tries: 0, ts: 0 };
  e.tries += 1;
  if (ok) e.done = true;
  e.ts = now;
  state.tasks[id] = e;
  return state;
}
export const doneCount = (state) => Object.values(state.tasks).filter((e) => e.done).length;

/** Restore merge (strings in, string out): union by task id; done wins, tries take the larger count, ts the latest. */
export function mergeCounter(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return emptyState(); } };
  const a = parse(localRaw), b = parse(backupRaw);
  const out = emptyState();
  for (const id of new Set([...Object.keys(a.tasks), ...Object.keys(b.tasks)])) {
    const x = a.tasks[id], y = b.tasks[id];
    out.tasks[id] = !x || !y ? (x || y) : { done: x.done || y.done, tries: Math.max(x.tries, y.tries), ts: Math.max(x.ts, y.ts) };
  }
  return JSON.stringify(out);
}

/** Outcome for the attempt log: the first correct counterexample without a failed try is 'alone'; with failed tries 'hinted'; giving up 'solution'. */
export const outcomeOf = ({ solved, wrongs = 0 }) => (!solved ? 'solution' : wrongs ? 'hinted' : 'alone');
