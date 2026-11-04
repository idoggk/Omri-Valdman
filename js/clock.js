// Visible-time stopwatch for the SECONDS that are recorded with an attempt (blind, transfer, pressure, recovery, derive, logs, hard math).
// A phone locked or a tab left in the background for ten minutes must not make a 3-minute question look like a 10-minute one:
// only time while document.visibilityState === 'visible' counts, and one item is capped at CAP_FACTOR times its budget.
// Exam wall-clock limits (the countdown that ends a mock, the 90-minute booklet) are NOT measured here: they stay on Date.now().

export const CAP_FACTOR = 3;
export const DEFAULT_BUDGET = 300;

/** A visible-time source over `doc` (injected for tests). start(budgetSeconds) -> { seconds() }. */
export function createClock({ doc = globalThis.document, now = () => Date.now() } = {}) {
  let acc = 0; // visible milliseconds before `since`
  let since = null; // when the page last became visible (null while hidden)
  const isVisible = () => !doc || doc.visibilityState !== 'hidden';
  if (isVisible()) since = now();
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => {
      if (isVisible()) { if (since == null) since = now(); } else if (since != null) { acc += now() - since; since = null; }
    });
  }
  const total = () => acc + (since != null ? now() - since : 0);
  return {
    visibleMs: total,
    /** budget in seconds (falsy: DEFAULT_BUDGET). seconds() = whole visible seconds since start(), at most CAP_FACTOR * budget. */
    start(budget) {
      const t0 = total();
      const cap = CAP_FACTOR * (Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_BUDGET);
      return { cap, seconds: () => Math.min(cap, Math.max(0, Math.round((total() - t0) / 1000))) };
    },
  };
}

let shared = null;
/** The app-wide clock (created on first use so that importing this file in a node test needs no document). */
export const visibleClock = () => shared || (shared = createClock());
/** Shorthand used by the screens: const sw = startVisible(item.budget); ... sw.seconds(). */
export const startVisible = (budget) => visibleClock().start(budget);
