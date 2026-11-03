// Error notebook (#/notebook). Pure logic: collects every wrong or hint-heavy attempt from the attempt log into one entry per
// exercise (deduped by exerciseId: count goes up, the latest attempt wins), schedules a review on a 1/3/7/14 day ladder
// and merges two notebooks on restore. No DOM; storage is injected. js/notebook-ui.js draws it.
//
// entry = { id, topic, title, key, href, count, firstTs, lastTs, seen, reason, tags, hints, seconds, note, status, step, due, upd }
//   status: 'open' (no clean re-solve yet) | 'understood' (at least one clean re-solve, or marked by hand) | 'mastered' (14 day re-solve done)
//   step:   number of clean independent re-solves since the last mistake (0..4); due = lastBad/lastClean + INTERVALS[step]
import { safeSetItem } from './storage.js';
import { INTERVAL_DAYS, DAY_MS, isReservedTopic } from './srs.js';
import { hardHref } from './workout.js';
import { itemHref } from './engine.js';
import { confidentWrong } from './calibration.js';

export const KEY = 'omri-study-notebook-v1';
export const STATUSES = ['open', 'understood', 'mastered'];
export const STATUS_LABELS = { open: 'פתוח', understood: 'הבנתי', mastered: 'שולט' };
export const HINT_HEAVY = 2; // hinted with this many hints or more counts as a mistake worth writing down
export const NOTE_MAX = 500;
export const KEY_MAX = 600;
export const TITLE_MAX = 120;
export const MAX_ENTRIES = 400;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');

/** Attempts that never enter the notebook: reserved transfer questions and the self-marked writing trainer. */
export const skipTopic = isReservedTopic;

/** A mistake worth recording: wrong, gave up (solution shown) or hint-heavy. */
export const isProblem = (a) => !!a && (a.outcome === 'wrong' || a.outcome === 'solution' || (a.outcome === 'hinted' && a.hintsUsed >= HINT_HEAVY) || confidentWrong(a));
/** Tag added to an entry whose attempt was predicted at 90-100 percent and failed (calibration.js). */
export const OVERCONFIDENT_TAG = 'ביטחון יתר';
/** A clean independent solve: alone and without hints. */
export const isClean = (a) => !!a && a.outcome === 'alone' && !(a.hintsUsed > 0);

/** Page that reopens the exercise. */
export const reopenHref = (id, topic) => hardHref(id) || itemHref(id, topic) || `#/ex/${id}`;

/** Due timestamp for an entry that has `step` clean re-solves, counted from `ts`. null once mastered. */
export const dueAfter = (ts, step) => (step >= INTERVAL_DAYS.length ? null : ts + INTERVAL_DAYS[step] * DAY_MS);
export const isDue = (e, now) => e.due != null && e.due <= now;

/* ---------- saved shape: { v: 1, entries: { [exerciseId]: entry } } ---------- */
export function sanitizeEntry(id, e) {
  if (!isRec(e) || typeof id !== 'string' || !id || id.length > 80) return null;
  const step = Math.min(INTERVAL_DAYS.length, Math.floor(nn(e.step)));
  const status = STATUSES.includes(e.status) ? e.status : step >= INTERVAL_DAYS.length ? 'mastered' : step > 0 ? 'understood' : 'open';
  const lastTs = nn(e.lastTs);
  return {
    id,
    topic: str(e.topic, 60),
    title: str(e.title, TITLE_MAX) || id,
    key: str(e.key, KEY_MAX),
    href: typeof e.href === 'string' && /^#\//.test(e.href) && e.href.length <= 120 ? e.href : `#/ex/${id}`,
    count: Math.max(1, Math.floor(nn(e.count))),
    firstTs: nn(e.firstTs) || lastTs,
    lastTs,
    seen: nn(e.seen),
    reason: str(e.reason, 20),
    tags: Array.isArray(e.tags) ? [...new Set(e.tags.filter((t) => typeof t === 'string' && t.length <= 20))].slice(0, 6) : [],
    hints: Math.floor(nn(e.hints)),
    seconds: Math.floor(nn(e.seconds)),
    note: str(e.note, NOTE_MAX),
    status: step >= INTERVAL_DAYS.length ? 'mastered' : status === 'mastered' ? 'understood' : status,
    step,
    due: e.due == null ? (step >= INTERVAL_DAYS.length ? null : dueAfter(lastTs, step)) : (Number.isFinite(e.due) ? e.due : null),
    upd: nn(e.upd),
  };
}

export function sanitize(raw) {
  const out = { v: 1, entries: {} };
  if (!isRec(raw) || !isRec(raw.entries)) return out;
  for (const [id, e] of Object.entries(raw.entries)) {
    const c = sanitizeEntry(id, e);
    if (c) out.entries[id] = c;
  }
  return out;
}

export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return sanitize(null); }
}
export function save(state, storage = globalThis.localStorage) {
  safeSetItem(KEY, JSON.stringify(state), storage);
}

/* ---------- collection ---------- */

/** Nearest feedback record made at/after the attempt for the same exercise (the "what was hard" tags). */
function tagsFor(a, feedback) {
  const recs = (Array.isArray(feedback) ? feedback : []).filter((r) => isRec(r) && r.exerciseId === a.exerciseId && (Number(r.ts) || 0) >= a.ts - 5000)
    .sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));
  return recs.length && Array.isArray(recs[0].hardTags) ? recs[0].hardTags.filter((t) => typeof t === 'string') : [];
}

/**
 * Folds the attempt log into the notebook (mutates and returns `state`). Idempotent: an attempt is processed once
 * (entry.seen = timestamp of the last processed attempt of that exercise).
 * describe(id, topic) -> { title, key, href } | null supplies the Hebrew title and the corrected step (UI side, from the exercise data).
 * Returns the number of entries that changed.
 */
export function syncNotebook(state, log, feedback = [], describe = () => null, now = Date.now()) {
  let changed = 0;
  const rows = (Array.isArray(log) ? log : []).filter((a) => a && a.ts > 0 && !a.migrated && !skipTopic(a.topic))
    .map((a, i) => ({ a, i })).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i).map((x) => x.a);
  for (const a of rows) {
    const cur = state.entries[a.exerciseId];
    if (cur && a.ts <= cur.seen) continue;
    if (isProblem(a)) {
      const d = describe(a.exerciseId, a.topic) || {};
      const tags = tagsFor(a, feedback);
      if (confidentWrong(a) && !tags.includes(OVERCONFIDENT_TAG)) tags.push(OVERCONFIDENT_TAG);
      const e = cur || {
        id: a.exerciseId, topic: a.topic || '', title: '', key: '', href: '', count: 0, firstTs: a.ts, lastTs: 0, seen: 0, reason: '', tags: [],
        hints: 0, seconds: 0, note: '', status: 'open', step: 0, due: null, upd: 0,
      };
      e.count += 1;
      e.lastTs = a.ts; e.seen = a.ts; e.hints = a.hintsUsed; e.seconds = a.seconds;
      e.reason = a.errorReason || e.reason; // keep the older reason when this miss has none recorded
      e.tags = tags.length ? tags.slice(0, 6) : e.tags;
      e.topic = a.topic || e.topic;
      e.title = str(d.title, TITLE_MAX) || e.title || a.exerciseId;
      e.key = str(d.key, KEY_MAX) || e.key;
      e.href = d.href || e.href || reopenHref(a.exerciseId, a.topic);
      e.step = 0; e.status = 'open'; e.due = dueAfter(a.ts, 0); e.upd = Math.max(now, a.ts);
      state.entries[a.exerciseId] = sanitizeEntry(a.exerciseId, e);
      changed++;
    } else if (cur && isClean(a)) {
      // a clean re-solve moves the ladder up only once the review was due: solving again the same hour proves nothing
      cur.seen = a.ts;
      if (cur.due != null && a.ts >= cur.due) {
        cur.step += 1;
        cur.status = cur.step >= INTERVAL_DAYS.length ? 'mastered' : 'understood';
        cur.due = dueAfter(a.ts, cur.step);
        cur.upd = Math.max(now, a.ts);
        changed++;
      }
    } else if (cur) cur.seen = a.ts; // neutral attempt (light hints): nothing changes
  }
  // oldest finished entries make room first
  const ids = Object.keys(state.entries);
  if (ids.length > MAX_ENTRIES) {
    ids.map((id) => state.entries[id]).sort((x, y) => (x.status === 'mastered' ? 0 : 1) - (y.status === 'mastered' ? 0 : 1) || x.lastTs - y.lastTs)
      .slice(0, ids.length - MAX_ENTRIES).forEach((e) => { delete state.entries[e.id]; });
  }
  return changed;
}

/* ---------- editing ---------- */
export function setNote(state, id, text, now = Date.now()) {
  const e = state.entries[id];
  if (!e) return false;
  e.note = str(text, NOTE_MAX); e.upd = now;
  return true;
}

/**
 * "I understood it". Never moves the date by itself: only a clean independent re-solve (found by syncNotebook) does that.
 * Returns 'marked' | 'already' | null (unknown id).
 */
export function markUnderstood(state, id, now = Date.now()) {
  const e = state.entries[id];
  if (!e) return null;
  if (e.status !== 'open') return 'already';
  e.status = 'understood'; e.upd = now;
  return 'marked';
}

/* ---------- views ---------- */

/** Entries as a list: due first (most overdue first), then by next date; finished ones last. */
export function sortedEntries(state, now = Date.now()) {
  const rank = (e) => (e.due == null ? 2 : e.due <= now ? 0 : 1);
  return Object.values(state.entries).sort((a, b) => rank(a) - rank(b) || (a.due ?? Infinity) - (b.due ?? Infinity) || (a.id < b.id ? -1 : 1));
}
export const dueEntries = (state, now = Date.now()) => sortedEntries(state, now).filter((e) => isDue(e, now));
export const topicsOf = (state) => [...new Set(Object.values(state.entries).map((e) => e.topic))].sort();

/** Reads the notebook for the home screen without any exercise data: only entries that are due. */
export function dueCount(log, feedback, now = Date.now(), storage = globalThis.localStorage) {
  const state = load(storage);
  syncNotebook(state, log, feedback, () => null, now);
  return dueEntries(state, now).length;
}

/* ---------- restore merge ---------- */

/** Union by exerciseId. The entry edited last wins; count and firstTs take the extremes; the note falls back to the other copy. */
export function mergeNotebook(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return sanitize(null); } };
  const a = parse(localRaw), b = parse(backupRaw);
  const out = { v: 1, entries: {} };
  for (const id of new Set([...Object.keys(a.entries), ...Object.keys(b.entries)])) {
    const x = a.entries[id], y = b.entries[id];
    if (!x || !y) { out.entries[id] = x || y; continue; }
    const [win, lose] = y.upd > x.upd ? [y, x] : [x, y]; // a tie keeps the local copy
    out.entries[id] = sanitizeEntry(id, {
      ...win, count: Math.max(x.count, y.count), firstTs: Math.min(x.firstTs, y.firstTs) || win.firstTs,
      note: win.note || lose.note, key: win.key || lose.key, reason: win.reason || lose.reason, upd: Math.max(x.upd, y.upd),
    });
  }
  return JSON.stringify(out);
}
