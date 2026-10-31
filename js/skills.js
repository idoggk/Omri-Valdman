// Weak-foundation finder. Pure functions over the attempt log (srs.js records) and data/skills.json;
// nothing here writes to progress or attempts. Repair-session results live in their own storage key.
//
// data = { skills: [{ id, prereqs: [id], ... }], skillTags: { exerciseId: [skillId] } }
import { cleanLog } from './srs.js';

export const WINDOW = 5; // last attempts per skill that are looked at
export const MIN_MISSES = 2; // misses inside the window that make a skill "weak"
export const REPAIR_KEY = 'omri-study-repair-v1';
export const REPAIR_QUESTIONS = 3;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonneg = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** A miss is a wrong answer or giving up to the solution. Hints alone are not a miss. */
export const isMiss = (a) => a.outcome === 'wrong' || a.outcome === 'solution';

/* ---------- repair results: { v:1, skills: { id: { tries, best, last, ts } } } (last/best = 0..3 correct) ---------- */
export function sanitizeRepair(raw) {
  const out = { v: 1, skills: {} };
  if (!isRec(raw) || !isRec(raw.skills)) return out;
  for (const [id, e] of Object.entries(raw.skills)) {
    if (!isRec(e)) continue;
    const last = Math.min(REPAIR_QUESTIONS, nonneg(e.last));
    out.skills[id] = { tries: Math.max(1, nonneg(e.tries)), best: Math.min(REPAIR_QUESTIONS, Math.max(last, nonneg(e.best))), last, ts: Number.isFinite(e.ts) ? e.ts : 0 };
  }
  return out;
}
export function loadRepair() {
  try { return sanitizeRepair(JSON.parse(localStorage.getItem(REPAIR_KEY))); } catch (e) { return sanitizeRepair(null); }
}
/** Stores the score (0..3) of one finished repair session. */
export function recordRepair(skillId, score, now = Date.now()) {
  const d = loadRepair();
  const p = d.skills[skillId];
  const last = Math.max(0, Math.min(REPAIR_QUESTIONS, Math.floor(score)));
  d.skills[skillId] = { tries: (p ? p.tries : 0) + 1, best: Math.max(p ? p.best : 0, last), last, ts: now };
  try { localStorage.setItem(REPAIR_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
}
export const isRepaired = (repair, id) => !!(repair && repair.skills && repair.skills[id] && repair.skills[id].last === REPAIR_QUESTIONS);

/* ---------- graph ---------- */
export const skillById = (data, id) => data.skills.find((s) => s.id === id) || null;

/** Depth = longest prerequisite chain below the skill (0 for foundations). Cycles are cut, not looped on. */
export function depthOf(data, id, seen = new Set()) {
  const s = skillById(data, id);
  if (!s || seen.has(id)) return 0;
  seen.add(id);
  const d = s.prereqs.length ? 1 + Math.max(...s.prereqs.map((p) => depthOf(data, p, new Set(seen)))) : 0;
  return d;
}

/** All transitive prerequisites of a skill, each once, in discovery order. */
export function allPrereqs(data, id) {
  const out = [];
  const walk = (x) => {
    const s = skillById(data, x);
    if (!s) return;
    for (const p of s.prereqs) if (p !== id && !out.includes(p)) { out.push(p); walk(p); }
  };
  walk(id);
  return out;
}

/* ---------- recent misses per skill ---------- */
/**
 * For every skill: the last WINDOW attempts on exercises tagged with it (oldest first). Attempts made before the
 * skill's last full-score repair are ignored, so a repaired skill starts again with a clean window.
 * Returns { [skillId]: { recent: [attempt], misses, lastMissTs } }.
 */
export function skillStats(log, data, repair = null) {
  const clean = cleanLog(log).map((a, i) => ({ a, i })).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i).map((x) => x.a);
  const out = {};
  for (const s of data.skills) {
    const since = isRepaired(repair, s.id) ? repair.skills[s.id].ts : -1;
    const recent = clean
      .filter((a) => a.ts > since && (data.skillTags[a.exerciseId] || []).includes(s.id))
      .slice(-WINDOW);
    const missed = recent.filter(isMiss);
    out[s.id] = { recent, misses: missed.length, lastMissTs: missed.length ? missed[missed.length - 1].ts : 0 };
  }
  return out;
}

/** Skills with >= MIN_MISSES misses in their last WINDOW attempts, most misses first (ties: later miss, then data order). */
export function weakSkills(log, data, repair = null) {
  const stats = skillStats(log, data, repair);
  return data.skills
    .map((s, i) => ({ id: s.id, i, ...stats[s.id] }))
    .filter((x) => x.misses >= MIN_MISSES)
    .sort((a, b) => b.misses - a.misses || b.lastMissTs - a.lastMissTs || a.i - b.i)
    .map(({ id, misses, lastMissTs }) => ({ id, misses, lastMissTs }));
}

/**
 * What to repair for one weak skill: its weakest not-yet-repaired prerequisite (most recent misses, then the
 * most basic one, then data order), or the skill itself when all prerequisites are fine.
 */
export function repairTarget(data, weakId, stats, repair = null) {
  const cands = allPrereqs(data, weakId)
    .filter((p) => !isRepaired(repair, p))
    .map((id, i) => ({ id, i, misses: stats[id] ? stats[id].misses : 0, depth: depthOf(data, id) }))
    .sort((a, b) => b.misses - a.misses || a.depth - b.depth || a.i - b.i);
  return cands.length ? cands[0].id : weakId;
}

/** The one recommendation: { weak, target, misses } or null when no skill is weak. */
export function recommendRepair(log, data, repair = null) {
  const weak = weakSkills(log, data, repair);
  if (!weak.length) return null;
  const stats = skillStats(log, data, repair);
  const w = weak[0];
  return { weak: w.id, target: repairTarget(data, w.id, stats, repair), misses: w.misses };
}

/** Status of each skill for the list: 'weak' | 'repaired' | 'ok' (no recent trouble), with the stats. */
export function skillStatuses(log, data, repair = null) {
  const stats = skillStats(log, data, repair);
  return data.skills.map((s) => ({
    id: s.id,
    status: stats[s.id].misses >= MIN_MISSES ? 'weak' : isRepaired(repair, s.id) ? 'repaired' : 'ok',
    misses: stats[s.id].misses,
    attempts: stats[s.id].recent.length,
    best: repair && repair.skills[s.id] ? repair.skills[s.id].best : null,
  }));
}
