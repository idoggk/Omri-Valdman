// Deterministic workout picker: mixes due reviews, weak-topic practice and new exercises.
import { schedules, weakTopics, levelInfo } from './srs.js';
import { ladderStatus, outcomeLookup } from './ladder.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const PROMOTE_STREAK = 3;
export const MAX_RATING_EASY = 2;
export const LADDER_SHARE = 1 / 3;
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/** Latest feedback record per exercise id (records of old/garbage shape are ignored). */
function latestFeedback(feedback) {
  const m = new Map();
  for (const r of Array.isArray(feedback) ? feedback : []) {
    if (!isRec(r) || typeof r.exerciseId !== 'string') continue;
    const old = m.get(r.exerciseId);
    if (!old || (Number(r.ts) || 0) >= (Number(old.ts) || 0)) m.set(r.exerciseId, r);
  }
  return m;
}

/** An attempt counts as "too easy" when solved alone and, if rated, rated <= 2 (no hints / solution in the feedback either). */
function easyAttempt(a, fb) {
  if (a.outcome !== 'alone' || a.hintsUsed > 0) return null;
  const r = fb.get(a.exerciseId);
  if (!r) return { rated: false };
  if (r.correct === false || Number(r.hintsUsed) > 0 || r.solutionViewed === true) return null;
  const rating = Number(r.rating);
  if (!Number.isFinite(rating)) return { rated: false };
  return rating <= MAX_RATING_EASY ? { rated: true } : null;
}

/**
 * topicLevels(log, exercises, feedback) -> Map topic -> { level, base, from, rated }.
 * Base level is the global suggested level (levelInfo). Per topic, while the last PROMOTE_STREAK attempts at the current
 * level were all easy (see easyAttempt) the level goes up one step, up to the hardest level the topic has. The result is
 * never below the level of the topic's most recent failure (wrong / solution viewed). `from` is the level promoted from.
 */
export function topicLevels(attempts, exercises, feedback = []) {
  const log = Array.isArray(attempts) ? attempts : [];
  const base = levelInfo(log, exercises).suggested ?? Math.min(...exercises.map((e) => e.level));
  const fb = latestFeedback(feedback);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const sorted = log.map((a, i) => ({ a, i })).filter((x) => byId.has(x.a.exerciseId))
    .sort((x, y) => x.a.ts - y.a.ts || x.i - y.i).map((x) => x.a);
  const out = new Map();
  for (const topic of [...new Set(exercises.map((e) => e.topic))]) {
    const levels = [...new Set(exercises.filter((e) => e.topic === topic).map((e) => e.level))].sort((a, b) => a - b);
    const mine = sorted.filter((a) => byId.get(a.exerciseId).topic === topic);
    // easy-streak chain from the topic's lowest level; the global unlock level (base) stays a floor for old behaviour
    let chain = levels[0], from = null, rated = true;
    for (;;) {
      const next = levels.find((l) => l > chain);
      const last = mine.filter((a) => byId.get(a.exerciseId).level === chain).slice(-PROMOTE_STREAK);
      const marks = last.map((a) => easyAttempt(a, fb));
      if (next === undefined || last.length < PROMOTE_STREAK || marks.some((m) => !m)) break;
      from = chain;
      rated = marks.every((m) => m.rated);
      chain = next;
    }
    let level = Math.max(chain, base);
    const failed = [...mine].reverse().find((a) => a.outcome === 'wrong' || a.outcome === 'solution');
    if (failed) level = Math.max(level, byId.get(failed.exerciseId).level);
    out.set(topic, { level, base, from: from !== null && chain === level ? from : null, rated });
  }
  return out;
}

/** Highest unlocked ladder stage (last stage that is not locked / empty) or null. outcome(id) -> 'alone'|... */
export function currentStage(stages, outcome, skip = {}) {
  if (!Array.isArray(stages)) return null;
  const st = ladderStatus(stages, outcome, skip);
  for (let i = st.length - 1; i >= 0; i--) if (st[i].status === 'unlocked' || st[i].status === 'done') return stages[i];
  return null;
}

/** Outcome of an exercise from the attempt log (latest attempt): 'alone' | 'hinted' | 'review' | null. */
export function logOutcome(attempts) {
  const last = new Map();
  for (const a of Array.isArray(attempts) ? attempts : []) if (!last.has(a.exerciseId) || a.ts >= last.get(a.exerciseId).ts) last.set(a.exerciseId, a);
  return (id) => { const a = last.get(id); return !a ? null : a.outcome === 'alone' ? 'alone' : a.outcome === 'hinted' ? 'hinted' : 'review'; };
}

/**
 * pickWorkout(attempts, exercises, now, size=10, opts) -> [exerciseId]
 * opts = { feedback: [records], ladder: [stages], skip: {stageId: true} } (all optional).
 * Quotas: ~40% due reviews (most overdue first), ~1/3 from the ladder stage the learner is on (exam-style items not yet
 * solved alone), ~30% weak-topic exercises (weakest topic first), the rest new exercises at the topic's level
 * (see topicLevels; then nearest levels). Gaps are filled from the remaining pool: other new, unmastered, then anything.
 * Same input always gives the same output.
 */
export function pickWorkout(attempts, exercises, now, size = 10, opts = {}) {
  const log = Array.isArray(attempts) ? attempts : [];
  const n = Math.min(Math.max(0, Math.floor(size)), exercises.length);
  if (!n) return [];
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const sch = schedules(log.filter((a) => byId.has(a.exerciseId)));
  const levels = topicLevels(log, exercises, opts.feedback);
  const picked = [];
  const taken = new Set();
  const take = (ids, max) => {
    for (const id of ids) {
      if (picked.length >= n || max <= 0) break;
      if (taken.has(id)) continue;
      taken.add(id); picked.push(id); max--;
    }
  };

  const order = new Map(exercises.map((e, i) => [e.id, i]));
  const inOrder = (a, b) => order.get(a.id) - order.get(b.id);
  const levelDist = (e) => { const lvl = levels.get(e.topic).level; return e.level === lvl ? 0 : Math.abs(e.level - lvl) + (e.level > lvl ? 0.5 : 0); };
  const newOnes = exercises.filter((e) => !sch.has(e.id))
    .sort((a, b) => levelDist(a) - levelDist(b) || inOrder(a, b));

  // 1. due reviews
  const due = [...sch].filter(([, s]) => s.due <= now)
    .sort((a, b) => a[1].due - b[1].due || cmp(a[0], b[0])).map(([id]) => id);
  take(due, Math.ceil(n * 0.4));

  // 1b. exam-style items from the ladder stage the learner is on (a third of the workout)
  // inline ladder items (no ref) keep their progress in the ladder key, so they must count for the unlock status
  const outcome = Array.isArray(opts.ladder) ? outcomeLookup(opts.ladder, logOutcome(log)) : logOutcome(log);
  const stage = currentStage(opts.ladder, outcome, opts.skip || {});
  if (stage) {
    const refs = stage.items.filter((it) => it && it.ref && byId.has(it.ref) && outcome(it.ref) !== 'alone').map((it) => it.ref);
    take(refs, Math.floor(n * LADDER_SHARE + 1e-9));
  }

  // 2. weak topics: not-yet-mastered exercises there, previously failed first, then new ones at level
  const weakQuota = Math.floor(n * 0.3);
  const weak = weakTopics(log, exercises).filter((t) => t.score < 0.8);
  const weakIds = [];
  for (const t of weak) {
    const pool = exercises.filter((e) => e.topic === t.topic && !taken.has(e.id) && !(sch.get(e.id) && sch.get(e.id).mastered));
    const rank = (e) => { const s = sch.get(e.id); return !s ? 1 : s.lastOutcome === 'alone' ? 2 : 0; };
    pool.sort((a, b) => rank(a) - rank(b) || levelDist(a) - levelDist(b) || inOrder(a, b));
    weakIds.push(pool.map((e) => e.id));
  }
  // round-robin across weak topics, weakest first, so one topic cannot take the whole quota
  for (let i = 0, left = weakQuota; left > 0 && weakIds.some((p) => i < p.length); i++) {
    for (const p of weakIds) if (i < p.length && left > 0 && !taken.has(p[i])) { take([p[i]], 1); left--; }
  }

  // 3. new exercises at the right level, topics interleaved
  const topics = [...new Set(newOnes.map((e) => e.topic))];
  const perTopic = topics.map((t) => newOnes.filter((e) => e.topic === t));
  const newQuota = n - picked.length;
  const interleaved = [];
  for (let i = 0; perTopic.some((p) => i < p.length); i++) for (const p of perTopic) if (i < p.length) interleaved.push(p[i].id);
  // keep the level preference: only the best-level group is interleaved first
  const best = newOnes.length ? levelDist(newOnes[0]) : 0;
  take(interleaved.filter((id) => levelDist(byId.get(id)) === best), newQuota);
  take(newOnes.map((e) => e.id), n);

  // 4. fill: unmastered attempted exercises (oldest practice first), then mastered ones
  const rest = exercises.filter((e) => !taken.has(e.id) && sch.has(e.id)).map((e) => ({ e, s: sch.get(e.id) }));
  rest.sort((a, b) => (a.s.mastered - b.s.mastered) || (a.s.due - b.s.due) || inOrder(a.e, b.e));
  take(rest.map((x) => x.e.id), n);
  return picked;
}

/** One plain Hebrew line for the today screen: what level the workout is at and why. titleOf(topicId) -> topic title. */
export function levelLine(attempts, exercises, feedback, titleOf = (t) => t) {
  if (!exercises.length) return '';
  const lv = topicLevels(attempts, exercises, feedback);
  const up = [...lv].filter(([, v]) => v.from !== null);
  if (!up.length) {
    const levels = [...new Set([...lv.values()].map((v) => v.level))].sort((a, b) => a - b);
    return `האימון היום ברמה ${levels.join('–')}.`;
  }
  return up.map(([topic, v]) => `רמת האימון עלתה ב${titleOf(topic)}: האימון עכשיו ברמה ${v.level} כי שלושת התרגילים האחרונים ברמה ${v.from} נפתרו נכון, בלי רמזים, ${v.rated ? 'ודורגו כקלים' : 'בלי עזרה'}.`).join(' ');
}
