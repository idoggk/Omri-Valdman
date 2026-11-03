// Difficulty ceiling detector. Pure logic: no DOM, no storage. Per topic it looks at the learner's first attempt on each of
// the last WINDOW distinct exercises (attempt log + difficulty feedback) and counts five "this topic is too easy now" signals:
//   1 independent accuracy >= 90% with zero hints          (performance)
//   2 median seconds <= 65% of the topic's budget          (performance, independently-correct attempts with a measured time)
//   3 median rating <= 4 on independently-correct attempts (self report)
//   4 no hard tags on those attempts                       (self report)
//   5 >= 80% first-try, hint-free on the reserved transfer questions of that subject/topic (performance, only if attempted)
// Rules: 2+ signals => escalate one level; 4+ => extreme-mixed priority; all 5 => contentCeilingReached (the content
// must be made harder); accuracy < 60% => escalation blocked and repair suggested. Ratings alone never promote: at least one
// performance signal (1, 2 or 5) is needed. Skipped / abandoned attempts and quick wrong guesses never count as mastery.

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const WINDOW = 8; // distinct exercises looked at (most recent first attempts)
export const MIN_ATTEMPTS = 5; // fewer distinct exercises => no verdict
export const MIN_EVIDENCE = 3; // data points needed for signals 2-4
export const MIN_TRANSFER = 2; // transfer questions attempted before signal 5 counts
export const ACCURACY_SIGNAL = 0.9;
export const BLOCK_ACCURACY = 0.6;
export const TIME_FRACTION = 0.65;
export const MAX_RATING = 4;
export const TRANSFER_SIGNAL = 0.8;
export const QUICK_WRONG_SECONDS = 15; // a wrong answer this fast is a guess, not an attempt at the problem
export const FEEDBACK_SLACK_MS = 5000;
export const TRANSFER_PREFIX = 'transfer-';

export const SIGNAL_LABELS = [
  'דיוק עצמאי של 90% ומעלה בלי רמזים',
  'זמן חציוני מהיר בהרבה מהזמן המתוכנן',
  'דירוג קושי חציוני 4 ומטה',
  'בלי תגיות "מה היה קשה"',
  'הצלחה בשאלות העברה חדשות (80% בניסיון ראשון, בלי רמזים)',
];

/**
 * Calibrated time budget per topic, in seconds for one exercise a prepared learner solves with pen and paper.
 * Values come from the suggested exam pace of each family (data/*.json "budget" guesses, the multipart exam pace of ~15
 * minutes for 5-6 parts, ~5 minutes per hard-math item) and are deliberately generous: signal 2 asks for 65% of them.
 * Unknown topics use DEFAULT_BUDGET.
 */
export const TOPIC_BUDGET = {
  'math-3': 300, 'math-4': 420, 'math-rad': 240, 'math-pow': 240, 'math-par': 300, 'math-lg': 240,
  'phys-vertical': 180, 'phys-horizontal': 180,
  'math-hard-radical': 480, 'math-hard-exponent': 480, 'math-hard-rational': 600, 'math-hard-param': 540, 'math-hard-circle': 540,
  multipart: 900, logs: 300, trig: 360,
};
export const DEFAULT_BUDGET = 300;
export const SPRINT_BUDGET = 40; // a sprint item is a few lines of algebra: the generic 300 s would call every one of them fast
export const budgetOf = (topic) => TOPIC_BUDGET[topic] || (String(topic).startsWith('sprint-') ? SPRINT_BUDGET : DEFAULT_BUDGET);

/** Subject of a topic id ('math' | 'physics'), used to match it with the transfer questions. */
export function subjectOf(topic) {
  const t = String(topic || '');
  if (t.startsWith(TRANSFER_PREFIX)) return t.slice(TRANSFER_PREFIX.length) || null;
  if (t.startsWith('math') || t === 'logs' || t === 'trig') return 'math';
  if (t.startsWith('phys') || t === 'multipart') return 'physics';
  return null;
}
export const baseOf = (t) => (typeof t === 'string' ? t.replace(/^(blind|pressure|recovery)-/, '') : t);
export const isTransferTopic = (t) => String(t || '').startsWith(TRANSFER_PREFIX);
/** Self-marked mock exams (#/booklet): reported apart (summary.booklet), never a topic verdict. */
export const isBookletTopic = (t) => String(t || '').startsWith('booklet-');

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const rate = (n, d) => (d ? n / d : 0);

/** First attempt of each exercise (chronological), real attempts only (legacy migrated rows carry no timing). */
function firstAttempts(list) {
  const seen = new Set();
  const out = [];
  for (const { a } of list.map((a, i) => ({ a, i })).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i)) {
    if (!a || a.migrated || seen.has(a.exerciseId)) continue;
    seen.add(a.exerciseId);
    out.push(a);
  }
  return out;
}

/** Earliest feedback record for the exercise made at/after the attempt (a little slack for clock jitter), or null. */
function feedbackFor(a, byExercise) {
  const recs = byExercise.get(a.exerciseId) || [];
  return recs.find((r) => (Number(r.ts) || 0) >= a.ts - FEEDBACK_SLACK_MS) || null;
}

/** Solved alone: no hints, and the feedback record (if any) agrees (correct, no solution viewed). */
export function isIndependent(a, fb) {
  if (a.outcome !== 'alone' || a.hintsUsed > 0) return false;
  return !(fb && (fb.correct === false || Number(fb.hintsUsed) > 0 || fb.solutionViewed === true));
}
/** Gave up or viewed the solution: no evidence either way, never mastery. */
export const isAbandoned = (a) => a.outcome === 'solution';
/** A wrong answer submitted almost at once. */
export const isQuickWrong = (a) => a.outcome === 'wrong' && a.seconds < QUICK_WRONG_SECONDS;

function feedbackIndex(feedback) {
  const m = new Map();
  for (const r of Array.isArray(feedback) ? feedback : []) {
    if (!isRec(r) || typeof r.exerciseId !== 'string') continue;
    if (!m.has(r.exerciseId)) m.set(r.exerciseId, []);
    m.get(r.exerciseId).push(r);
  }
  for (const l of m.values()) l.sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));
  return m;
}

/**
 * Verdict for one topic.
 * opts.topicOf(attempt) -> topic id (default: attempt.topic); opts.transferCovers: Map|object exerciseId -> [topic ids]
 * the transfer question exercises (signal 5 then only counts questions that cover this topic).
 */
export function analyzeTopic(topic, attempts, feedback = [], opts = {}) {
  const topicOf = opts.topicOf || ((a) => a.topic);
  const log = Array.isArray(attempts) ? attempts.filter(isRec) : [];
  // 'blind-<topic>' (blind tournament) and 'pressure-<topic>' attempts count for the topic they were drawn from
  const mine = firstAttempts(log.filter((a) => { const t = baseOf(topicOf(a)); return t === topic && !isTransferTopic(t); })).slice(-WINDOW);
  const fbIdx = feedbackIndex(feedback);

  const subject = subjectOf(topic);
  const covers = opts.transferCovers instanceof Map ? opts.transferCovers : isRec(opts.transferCovers) ? new Map(Object.entries(opts.transferCovers)) : null;
  const transfer = firstAttempts(log.filter((a) => isTransferTopic(a.topic) && subjectOf(a.topic) === subject
    && (!covers || !covers.has(a.exerciseId) || covers.get(a.exerciseId).includes(topic))));
  const transferOk = transfer.filter((a) => isIndependent(a, null)).length;

  const out = {
    topic, sample: mine.length, signals: [false, false, false, false, false], count: 0,
    accuracy: null, independentRate: null, medianSeconds: null, medianRating: null, budget: budgetOf(topic),
    transferAttempted: transfer.length, transferRate: transfer.length ? transferOk / transfer.length : null,
    status: 'insufficient', blocked: false, suggestRepair: false, escalate: false, extremeMixed: false, contentCeilingReached: false,
  };
  if (mine.length < MIN_ATTEMPTS) return out;
  out.status = 'ok';

  const rows = mine.map((a) => { const fb = feedbackFor(a, fbIdx); return { a, fb, ind: isIndependent(a, fb) }; });
  const countable = rows.filter((r) => !isAbandoned(r.a));
  out.accuracy = countable.length ? countable.filter((r) => r.a.outcome === 'alone' || r.a.outcome === 'hinted').length / countable.length : null;
  out.independentRate = rate(rows.filter((r) => r.ind).length, rows.length);
  const ind = rows.filter((r) => r.ind);

  out.signals[0] = out.independentRate >= ACCURACY_SIGNAL;

  const secs = ind.map((r) => r.a.seconds).filter((s) => s > 0);
  if (secs.length >= MIN_EVIDENCE) { out.medianSeconds = median(secs); out.signals[1] = out.medianSeconds <= TIME_FRACTION * out.budget; }

  const rated = ind.filter((r) => r.fb && Number.isFinite(Number(r.fb.rating)));
  if (rated.length >= MIN_EVIDENCE) {
    out.medianRating = median(rated.map((r) => Number(r.fb.rating)));
    out.signals[2] = out.medianRating <= MAX_RATING;
  }
  const withFb = ind.filter((r) => r.fb);
  if (withFb.length >= MIN_EVIDENCE) out.signals[3] = withFb.every((r) => !Array.isArray(r.fb.hardTags) || r.fb.hardTags.length === 0);

  if (transfer.length >= MIN_TRANSFER) out.signals[4] = out.transferRate >= TRANSFER_SIGNAL;

  out.count = out.signals.filter(Boolean).length;
  out.blocked = countable.length >= MIN_EVIDENCE && out.accuracy < BLOCK_ACCURACY;
  out.suggestRepair = out.blocked;
  const performance = out.signals[0] || out.signals[1] || out.signals[4]; // ratings / tags alone never promote
  out.escalate = !out.blocked && out.count >= 2 && performance;
  out.extremeMixed = !out.blocked && out.count >= 4 && performance;
  out.contentCeilingReached = !out.blocked && out.count === 5;
  return out;
}

/** Verdicts for the given topics (default: every topic seen in the log, transfer topics excluded). Map topic -> verdict. */
export function analyzeTopics(attempts, feedback = [], opts = {}, topics = null) {
  const topicOf = opts.topicOf || ((a) => a.topic);
  const list = topics || [...new Set((Array.isArray(attempts) ? attempts : []).filter(isRec).map(topicOf).map(baseOf).filter((t) => t && !isTransferTopic(t) && !isBookletTopic(t)))].sort();
  return new Map(list.map((t) => [t, analyzeTopic(t, attempts, feedback, opts)]));
}

/** Compact per-topic data for the feedback export (only topics with a verdict). */
export function ceilingSummary(attempts, feedback = [], opts = {}) {
  return [...analyzeTopics(attempts, feedback, opts).values()].filter((v) => v.status === 'ok').map((v) => ({
    topic: v.topic, sample: v.sample, signals: v.signals.map((s) => (s ? 1 : 0)), signalCount: v.count,
    escalate: v.escalate, extremeMixed: v.extremeMixed, contentCeilingReached: v.contentCeilingReached, blocked: v.blocked,
  }));
}

/** Topics the learner has outgrown ("what is already behind you"): 2+ signals, not blocked, strongest first. */
export function outgrownTopics(attempts, feedback = [], opts = {}) {
  return [...analyzeTopics(attempts, feedback, opts).values()].filter((v) => v.escalate)
    .sort((a, b) => b.count - a.count || (a.topic < b.topic ? -1 : 1));
}
