// Pressure ladder (#/pressure): OPTIONAL and off by default. One skill family (a weakness group of js/blind.js) at 100%, 85% and 70%
// of the exam time budget, with different items on every rung. Accuracy comes first: each rung shows its accuracy and, separately,
// the time used; there is no combined or speed-only score. Pure logic: banks, clock and storage are injected. js/pressure-ui.js draws it.
import { safeSetItem } from './storage.js';
import { mulberry32 } from './booklet.js';
import { GROUPS, groupOf, groupLabel, gradeBlind, skipBlind } from './blind.js';

export const KEY = 'omri-study-pressure-v1';
export const RUNGS = [1, 0.85, 0.7];
export const PER_RUNG = 3;
export const DROP_WARN = 0.25; // an accuracy drop of this much between the first and the last rung is called out
export const MAX_HISTORY = 12;
export const pressureTopic = (topic) => `pressure-${topic}`;
const PREFIX_OK = (it) => ['canon', 'number', 'inputs', 'choice', 'unitsnum'].includes(it.kind);

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const seedNum = (s) => { let a = 11; for (const ch of String(s)) a = (Math.imul(a, 33) + ch.charCodeAt(0)) | 0; return a; };

/** Families with enough items for 3 rungs: [{ id, label, count }]. */
export function families(pool) {
  return GROUPS.map((g) => ({ id: g.id, label: g.label, count: pool.filter((it) => PREFIX_OK(it) && groupOf(it.topic) === g.id).length }))
    .filter((f) => f.count >= PER_RUNG * RUNGS.length);
}

/** Seconds allowed for a rung: the sum of the items' planned budgets times the rung percentage. */
export const rungSeconds = (items, pct) => Math.round(items.reduce((s, it) => s + it.budget, 0) * pct);

/**
 * buildRungs(pool, family, seed, recent) -> [{ pct, uids }] with different items on every rung. The items are dealt round-robin after sorting by
 * planned budget, so the three rungs have almost the same total budget and a faster rung really means less time for the same work.
 * Items seen in the last 7 days (recent) are used only when there are not enough fresh ones.
 */
export function buildRungs(pool, family, seed, recent = new Set()) {
  const need = PER_RUNG * RUNGS.length;
  const rnd = mulberry32(seedNum(`pressure:${family}:${seed}`));
  const mine = pool.filter((it) => PREFIX_OK(it) && groupOf(it.topic) === family);
  const shuffled = mine.map((it) => ({ it, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.it);
  const ids = new Set();
  const pick = [];
  for (const it of [...shuffled.filter((x) => !recent.has(x.id)), ...shuffled.filter((x) => recent.has(x.id))]) {
    if (pick.length >= need) break;
    if (!ids.has(it.id)) { ids.add(it.id); pick.push(it); }
  }
  if (pick.length < need) return null;
  pick.sort((a, b) => a.budget - b.budget || (a.uid < b.uid ? -1 : 1));
  const rungs = RUNGS.map((pct) => ({ pct, uids: [] }));
  pick.forEach((it, i) => { const r = Math.floor(i / RUNGS.length); rungs[(r % 2 === 0 ? i % RUNGS.length : RUNGS.length - 1 - (i % RUNGS.length))].uids.push(it.uid); });
  return rungs;
}

/* ---------- session ---------- */
// session = { id, seed, ts, family, rungs: [{ pct, uids, seconds (allowed), startedAt, finishedAt, results: { uid: {correct,score,total,seconds,skipped} } }], finishedAt }
export function makeSession(pool, family, seed, recent, now) {
  const rungs = buildRungs(pool, family, seed, recent);
  if (!rungs) return null;
  return {
    id: `p${seed}-${now}`, seed, ts: now, family, finishedAt: null,
    rungs: rungs.map((r) => ({ pct: r.pct, uids: r.uids, seconds: rungSeconds(r.uids.map((u) => pool.find((it) => it.uid === u)), r.pct), startedAt: null, finishedAt: null, results: {} })),
  };
}
export const currentRung = (s) => s.rungs.findIndex((r) => !r.finishedAt);

export const startRung = (rung, now) => { if (!rung.startedAt) rung.startedAt = now; return rung; };

/**
 * Closes a rung: `readings` = { uid: input | undefined }; a missing reading is an unanswered item (0). The time used is capped at the allowed time.
 * Returns { rung, grades } where grades[uid] is the grade (invalid inputs count as unanswered).
 */
export function finishRung(pool, session, idx, readings, seed, now) {
  const rung = session.rungs[idx];
  if (!rung || rung.finishedAt) return null;
  startRung(rung, now);
  const used = Math.min(rung.seconds, Math.max(0, Math.round((now - rung.startedAt) / 1000)));
  const grades = {};
  for (const u of rung.uids) {
    const it = pool.find((x) => x.uid === u);
    const hasInput = readings[u] !== undefined && readings[u] !== null;
    let g = hasInput ? gradeBlind(it, readings[u], seed) : null;
    if (!g || !g.valid) g = skipBlind(it);
    grades[u] = g;
    rung.results[u] = { correct: g.correct === true, score: g.score, total: g.total, skipped: g.skipped === true };
  }
  rung.finishedAt = now;
  rung.used = used;
  if (session.rungs.every((r) => r.finishedAt)) session.finishedAt = now;
  return { rung, grades };
}

/** Accuracy of a finished rung (score fraction over all its items) and the time used, kept apart. */
export function rungSummary(rung) {
  let score = 0, total = 0, right = 0;
  for (const u of rung.uids) { const r = rung.results[u] || { score: 0, total: 1, correct: false }; score += r.score; total += r.total; if (r.correct) right += 1; }
  return { pct: rung.pct, items: rung.uids.length, right, accuracy: total ? score / total : 0, seconds: nn(rung.used), allowed: rung.seconds, usedShare: rung.seconds ? nn(rung.used) / rung.seconds : 0 };
}

/** Plain Hebrew summary: accuracy per rung, time per rung (separately) and one sentence on the effect of the pressure. */
export function summarize(session) {
  const rows = session.rungs.map(rungSummary);
  const first = rows[0], last = rows[rows.length - 1];
  const drop = first.accuracy - last.accuracy;
  const verdict = drop >= DROP_WARN
    ? 'הדיוק ירד כשהזמן התקצר. זה סימן שהשיטה עוד לא אוטומטית מספיק: חזרו על הנושא בלי לחץ לפני שמגבירים מהירות.'
    : drop <= -0.0001 && last.accuracy > first.accuracy
      ? 'הדיוק לא נפגע מהלחץ, ואפילו השתפר. אפשר להתקדם לנושא הבא או להקטין את הזמן עוד.'
      : 'הדיוק נשמר גם כשהזמן התקצר. זה מה שאנחנו רוצים לראות: מהירות בלי לוותר על נכונות.';
  return { family: session.family, label: groupLabel(session.family), rows, drop, verdict };
}

/* ---------- saved state: { v:1, on:false, active, history } ---------- */
export const emptyState = () => ({ v: 1, on: false, active: null, history: [] });
const cleanRung = (r) => {
  if (!isRec(r) || !Array.isArray(r.uids) || !r.uids.length || !RUNGS.includes(r.pct)) return null;
  const results = {};
  if (isRec(r.results)) for (const u of r.uids) { const x = r.results[u]; if (isRec(x)) results[u] = { correct: x.correct === true, score: Math.floor(nn(x.score)), total: Math.max(1, Math.floor(nn(x.total))), skipped: x.skipped === true }; }
  return { pct: r.pct, uids: r.uids.filter((u) => typeof u === 'string' && u.length <= 80), seconds: nn(r.seconds), startedAt: Number.isFinite(r.startedAt) ? r.startedAt : null, finishedAt: Number.isFinite(r.finishedAt) ? r.finishedAt : null, used: nn(r.used), results };
};
export function cleanSession(s) {
  if (!isRec(s) || typeof s.id !== 'string' || !s.id || s.id.length > 60 || !Array.isArray(s.rungs) || s.rungs.length !== RUNGS.length) return null;
  const rungs = s.rungs.map(cleanRung);
  if (rungs.some((r) => !r)) return null;
  return { id: s.id, seed: Number.isInteger(s.seed) ? s.seed : 1, ts: nn(s.ts), family: GROUPS.some((g) => g.id === s.family) ? s.family : GROUPS[0].id, rungs, finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : null };
}
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw)) return out;
  out.on = raw.on === true;
  const a = cleanSession(raw.active);
  out.active = a && !a.finishedAt ? a : null;
  if (Array.isArray(raw.history)) out.history = raw.history.map(cleanSession).filter((s) => s && s.finishedAt).slice(-MAX_HISTORY);
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export const save = (state, storage = globalThis.localStorage) => safeSetItem(KEY, JSON.stringify(state), storage);
export const isOn = (storage) => load(storage).on;

/** Restore merge (strings in, string out): history by session id; the switch and the active session follow the newer side. */
export function mergePressure(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return emptyState(); } };
  const a = parse(localRaw), b = parse(backupRaw);
  const byId = new Map();
  for (const s of [...a.history, ...b.history]) { const c = byId.get(s.id); if (!c || s.finishedAt > c.finishedAt) byId.set(s.id, s); }
  const out = emptyState();
  out.history = [...byId.values()].sort((x, y) => x.finishedAt - y.finishedAt).slice(-MAX_HISTORY);
  out.on = a.on; // the switch is a device choice: the local one wins
  const act = [a.active, b.active].filter(Boolean).sort((x, y) => y.ts - x.ts)[0] || null;
  out.active = act && !out.history.some((s) => s.id === act.id) ? act : null;
  return JSON.stringify(out);
}
