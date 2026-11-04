// #/derive schedule state: the spaced-recall store (load/save/sanitize, boxes, due counts, restore merge).
// Split out of js/derive.js so that the home screen and the plan (due counts) do not load the derivation parser
// (fbuilder.js, trig.js). js/derive.js re-exports everything here, so existing imports keep working.
import { safeSetItem } from './storage.js';
import { INTERVAL_DAYS, DAY_MS } from './srs.js';

export const KEY = 'omri-study-derive-v1';
export const MAX_BOX = 4;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

/* ---------- schedule: { v: 1, tasks: { [id]: { seen, b, due, last, tries, clean, upd } } } ---------- */
export const emptyState = () => ({ v: 1, tasks: {} });

export function sanitizeEntry(id, e) {
  if (!isRec(e) || typeof id !== 'string' || !/^dv-[mp]-\d\d$/.test(id)) return null;
  const seen = e.seen === true;
  return {
    seen,
    b: seen ? Math.min(MAX_BOX, Math.floor(nn(e.b))) : 0,
    due: seen && Number.isFinite(e.due) && e.due > 0 ? e.due : null,
    last: nn(e.last), tries: Math.floor(nn(e.tries)), clean: Math.floor(nn(e.clean)), upd: nn(e.upd),
  };
}
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw) || !isRec(raw.tasks)) return out;
  for (const [id, e] of Object.entries(raw.tasks)) { const c = sanitizeEntry(id, e); if (c) out.tasks[id] = c; }
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export function save(state, storage = globalThis.localStorage) { return safeSetItem(KEY, JSON.stringify(state), storage); }

const entryOf = (state, id) => state.tasks[id] || { seen: false, b: 0, due: null, last: 0, tries: 0, clean: 0, upd: 0 };

/** Level shown next: 0 unseen, then 1, 2, 3 as the box grows (box 2 and above stay on the blank page). */
export const levelOf = (e) => (!e || !e.seen ? 0 : Math.min(3, e.b + 1));
export const isDue = (e, now) => !!e && e.seen && e.due != null && e.due <= now;
export const intervalDays = (b) => INTERVAL_DAYS[Math.min(b, INTERVAL_DAYS.length - 1)];

/** First time: the full derivation was read. Schedules the first recall in a day. Reading again later changes nothing. */
export function markRead(state, id, now = Date.now()) {
  const e = entryOf(state, id);
  if (!e.seen) { e.seen = true; e.b = 0; e.due = now + intervalDays(0) * DAY_MS; }
  e.last = now; e.upd = now;
  state.tasks[id] = sanitizeEntry(id, e) || e;
  return state.tasks[id];
}

/**
 * Result of a recall session. clean = no wrong try, no hint, no peek. A clean result moves the box up only when the review was due
 * (doing it again the same hour proves nothing); anything else moves it down one box and brings the task back tomorrow.
 */
export function applyResult(state, id, { clean }, now = Date.now()) {
  let e = entryOf(state, id);
  if (!e.seen) { markRead(state, id, now); e = state.tasks[id]; }
  e.tries += 1; e.last = now; e.upd = now;
  if (clean) {
    e.clean += 1;
    if (e.due == null || now >= e.due) { e.b = Math.min(MAX_BOX, e.b + 1); e.due = now + intervalDays(e.b) * DAY_MS; }
  } else { e.b = Math.max(0, e.b - 1); e.due = now + intervalDays(0) * DAY_MS; }
  state.tasks[id] = sanitizeEntry(id, e);
  return state.tasks[id];
}

/** Due tasks first (most overdue first). tasks = the loaded list; only ids present in it are returned. */
export function dueTasks(state, tasks, now = Date.now()) {
  return tasks.filter((t) => isDue(state.tasks[t.id], now)).sort((a, b) => state.tasks[a.id].due - state.tasks[b.id].due || (a.id < b.id ? -1 : 1));
}
export const newTasks = (state, tasks) => tasks.filter((t) => !(state.tasks[t.id] && state.tasks[t.id].seen));
/** Count of due ids without the task list (home screen and plan). */
export const dueIds = (state, now = Date.now()) => Object.keys(state.tasks).filter((id) => isDue(state.tasks[id], now)).sort((a, b) => state.tasks[a].due - state.tasks[b].due);
export function dueCount(storage = globalThis.localStorage, now = Date.now()) {
  try { return dueIds(load(storage), now).length; } catch (e) { return 0; }
}

/** Restore merge: union by task id; the entry updated last wins (a tie keeps the local one); counters take the larger value. JSON strings in and out. */
export function mergeDerive(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return emptyState(); } };
  const a = parse(localRaw);
  const b = parse(backupRaw);
  const out = emptyState();
  for (const id of new Set([...Object.keys(a.tasks), ...Object.keys(b.tasks)])) {
    const x = a.tasks[id];
    const y = b.tasks[id];
    if (!x || !y) { out.tasks[id] = x || y; continue; }
    const win = y.upd > x.upd ? y : x;
    out.tasks[id] = sanitizeEntry(id, { ...win, tries: Math.max(x.tries, y.tries), clean: Math.max(x.clean, y.clean), last: Math.max(x.last, y.last), upd: Math.max(x.upd, y.upd) });
  }
  return JSON.stringify(out);
}
