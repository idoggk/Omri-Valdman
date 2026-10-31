// Deterministic workout picker: mixes due reviews, weak-topic practice and new exercises.
import { schedules, weakTopics, levelInfo } from './srs.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * pickWorkout(attempts, exercises, now, size=10) -> [exerciseId]
 * Quotas: ~40% due reviews (most overdue first), ~30% weak-topic exercises (weakest topic first),
 * the rest new exercises at the suggested level (then nearest levels). Gaps are filled from the
 * remaining pool: other new, unmastered, then anything. Same input always gives the same output.
 */
export function pickWorkout(attempts, exercises, now, size = 10) {
  const log = Array.isArray(attempts) ? attempts : [];
  const n = Math.min(Math.max(0, Math.floor(size)), exercises.length);
  if (!n) return [];
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const sch = schedules(log.filter((a) => byId.has(a.exerciseId)));
  const { suggested } = levelInfo(log, exercises);
  const lvl = suggested ?? Math.min(...exercises.map((e) => e.level));
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
  const levelDist = (e) => (e.level === lvl ? 0 : Math.abs(e.level - lvl) + (e.level > lvl ? 0.5 : 0));
  const newOnes = exercises.filter((e) => !sch.has(e.id))
    .sort((a, b) => levelDist(a) - levelDist(b) || inOrder(a, b));

  // 1. due reviews
  const due = [...sch].filter(([, s]) => s.due <= now)
    .sort((a, b) => a[1].due - b[1].due || cmp(a[0], b[0])).map(([id]) => id);
  take(due, Math.ceil(n * 0.4));

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
