// Weak-foundation finder. Pure functions over the attempt log (srs.js records) and data/skills.json;
// nothing here writes to progress or attempts. Repair-session results live in their own storage key.
//
// data = { skills: [{ id, prereqs: [id], ... }], skillTags: { exerciseId: [skillId] } }
import { cleanLog } from './srs.js';
import { safeSetItem } from './storage.js';

export const WINDOW = 5; // last attempts per skill that are looked at
export const MIN_MISSES = 2; // misses inside the window that make a skill "weak"
export const REPAIR_KEY = 'omri-study-repair-v1';
export const TIER_SIZES = [3, 3, 2]; // התחלה, בינוני, רמת מבחן
export const TIER_NAMES = ['התחלה', 'בינוני', 'רמת מבחן'];
export const REPAIR_QUESTIONS = 8; // all tiers together
export const MASTERY = 6; // correct answers (best per tier, all tiers finished) that count a skill as repaired

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonneg = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** A miss is a wrong answer or giving up to the solution. Hints alone are not a miss. */
export const isMiss = (a) => a.outcome === 'wrong' || a.outcome === 'solution';

/* ---------- repair results: { v:1, skills: { id: { tries, best, last, ts, t } } } ----------
 * t = best correct count per finished tier, [t1, t2, t3] (null = tier not finished); best = sum of t; last = score of
 * the last finished tier session. Entries saved before tiers existed (no t; 3 questions answered) read as tier 1 done. */
export function sanitizeRepair(raw) {
  const out = { v: 1, skills: {} };
  if (!isRec(raw) || !isRec(raw.skills)) return out;
  for (const [id, e] of Object.entries(raw.skills)) {
    if (!isRec(e)) continue;
    const tries = Math.max(1, nonneg(e.tries));
    const t = TIER_SIZES.map((size, i) => {
      if (Array.isArray(e.t)) return Number.isFinite(e.t[i]) && e.t[i] !== null ? Math.min(size, nonneg(e.t[i])) : null;
      return i === 0 ? Math.min(size, Math.max(nonneg(e.best), nonneg(e.last))) : null; // legacy: the old 3 questions are tier 1
    });
    out.skills[id] = { tries, best: t.reduce((a, n) => a + (n || 0), 0), last: Math.min(REPAIR_QUESTIONS, nonneg(e.last)), ts: Number.isFinite(e.ts) ? e.ts : 0, t };
  }
  return out;
}
export function loadRepair() {
  try { return sanitizeRepair(JSON.parse(localStorage.getItem(REPAIR_KEY))); } catch (e) { return sanitizeRepair(null); }
}
/** Stores the score of one finished tier session (tier 0..2, score 0..TIER_SIZES[tier]); keeps the best score per tier. */
export function recordRepair(skillId, tier, score, now = Date.now()) {
  const d = loadRepair();
  const p = d.skills[skillId];
  const i = Math.max(0, Math.min(TIER_SIZES.length - 1, Math.floor(tier)));
  const sc = Math.max(0, Math.min(TIER_SIZES[i], Math.floor(score)));
  const t = p ? p.t.slice() : [null, null, null];
  t[i] = Math.max(t[i] || 0, sc);
  d.skills[skillId] = { tries: (p ? p.tries : 0) + 1, best: t.reduce((a, n) => a + (n || 0), 0), last: sc, ts: now, t };
  safeSetItem(REPAIR_KEY, JSON.stringify(d));
}
const tiersOf = (repair, id) => (repair && repair.skills && repair.skills[id] ? repair.skills[id].t : [null, null, null]);
/** Repaired = every tier finished and at least MASTERY of the 8 questions answered correctly (best per tier). */
export const isRepaired = (repair, id) => {
  const t = tiersOf(repair, id);
  return t.every((n) => n !== null) && t.reduce((a, n) => a + n, 0) >= MASTERY;
};
/**
 * The tier to do next (0..2): the first unfinished one; when all three are finished but the skill is not repaired yet,
 * the finished tier with the lowest share of correct answers. Returns 3 when the skill is repaired.
 */
export function nextTier(repair, id) {
  const t = tiersOf(repair, id);
  const open = t.findIndex((n) => n === null);
  if (open !== -1) return open;
  if (isRepaired(repair, id)) return TIER_SIZES.length;
  return t.map((n, i) => ({ i, r: n / TIER_SIZES[i] })).sort((a, b) => a.r - b.r || a.i - b.i)[0].i;
}

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

/** The one recommendation: { weak, target, misses, tier } or null when no skill is weak; tier = first unfinished tier of the target. */
export function recommendRepair(log, data, repair = null) {
  const weak = weakSkills(log, data, repair);
  if (!weak.length) return null;
  const stats = skillStats(log, data, repair);
  const w = weak[0];
  const target = repairTarget(data, w.id, stats, repair);
  return { weak: w.id, target, misses: w.misses, tier: Math.min(nextTier(repair, target), TIER_SIZES.length - 1) };
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

/**
 * The "harder set" offered once tier 3 of a skill is done: the tier-3 question of each other skill of the same topic
 * (rotating from the one after this skill), up to n questions. Not stored anywhere.
 */
export function harderSet(data, skillId, n = 4) {
  const s = skillById(data, skillId);
  if (!s) return [];
  const same = data.skills.filter((x) => x.topic === s.topic);
  const at = same.findIndex((x) => x.id === skillId);
  const out = [];
  for (let k = 1; k < same.length && out.length < n; k++) {
    const hard = same[(at + k) % same.length].questions.filter((q) => q.tier === 3);
    if (hard.length) out.push(hard[out.length % hard.length]);
  }
  return out;
}
