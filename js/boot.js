// Boot-time data loading with failure tracking, so the home screen can say what is missing and offer a retry.
// Pure logic: fetch, the exercise validator and the hard-set loaders are injected (app.js wires the real ones).

export const CORE_FILES = ['math', 'physics'];
export const HARD_SETS = ['mathhard', 'multipart', 'logs'];

/** True when something failed but only hard-set files (the daily workout then just loses its hard slots). */
export const onlyHardFailed = (failed) => failed.length > 0 && failed.every((f) => HARD_SETS.includes(f));

/**
 * Loads exercises, ladder stages and the hard sets. Never throws.
 * `loaders` = { mathhard, multipart, logs }, each (fetchFn) => Promise<{ ok, data|exercises }>.
 * `resets` run first so a retry does not reuse a stale module cache.
 * Returns { exercises, ladder, hard, failed } where failed lists the names that did not load.
 */
export async function loadBootData({ fetchFn, validExercise, loaders, resets = [] }) {
  for (const r of resets) { try { r(); } catch (e) { /* best effort */ } }
  const failed = [];
  const results = await Promise.all(CORE_FILES.map(async (f) => {
    try {
      const res = await fetchFn(`data/${f}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error('not an array');
      return arr.filter(validExercise);
    } catch (err) {
      failed.push(f);
      return [];
    }
  }));
  let ladder = null;
  try { // ladder stages feed a share of the daily workout
    const res = await fetchFn('data/ladder.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data || !Array.isArray(data.stages)) throw new Error('bad ladder');
    ladder = data.stages;
  } catch (err) { failed.push('ladder'); }
  const safe = async (name, fn) => {
    try { const r = await fn(fetchFn); if (r && r.ok) return r; } catch (e) { /* counted below */ }
    failed.push(name);
    return null;
  };
  const [mh, mp, lg] = await Promise.all([
    safe('mathhard', loaders.mathhard), safe('multipart', loaders.multipart), safe('logs', loaders.logs)]);
  const hard = { mathhard: mh ? mh.data : [], multipart: mp ? mp.data : [], logs: lg ? lg.exercises : [] };
  return { exercises: results.flat(), ladder, hard, failed };
}
