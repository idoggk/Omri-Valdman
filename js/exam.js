// Pure exam logic: building a seeded set, scoring, timer math. No DOM, no storage.
import { checkAll } from './check.js';
import { matchSets, validAnswerSets } from './answersets.js';
import { cleanLog, schedules, weakTopics, countReasons } from './srs.js';

export const COUNTS = [5, 8, 12];
export const MINUTES_PER_QUESTION = 6;

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const defaultTimeLimitMs = (count) => count * MINUTES_PER_QUESTION * 60000;

/**
 * Picks `count` distinct exercises from the chosen topics (round robin across topics).
 * mix: 'hard' prefers level 3, then 2, then 1; 'mixed' ignores the level.
 * Exercises not yet solved alone (isAlone(id) false) come before ones solved alone.
 * Same seed + same inputs => same ids in the same order.
 */
export function buildExamSet({ exercises, topics, count, mix = 'mixed', seed = 1, isAlone = () => false }) {
  const rand = rng(seed);
  const chosen = new Set(topics);
  const pool = exercises.filter((e) => chosen.has(e.topic));
  const rank = (e) => (isAlone(e.id) ? 1 : 0) * 10 + (mix === 'hard' ? 3 - Math.min(3, Math.max(1, e.level || 1)) : 0);
  const queues = topics.map((t) => {
    const mine = shuffle(pool.filter((e) => e.topic === t), rand);
    return mine.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
  }).filter((q) => q.length);
  const picked = [];
  while (picked.length < count && queues.some((q) => q.length)) {
    for (const q of shuffle(queues, rand)) {
      if (picked.length >= count) break;
      if (q.length) picked.push(q.shift());
    }
  }
  return shuffle(picked, rand).map((e) => e.id);
}

/* ---------- smart picker + presets ---------- */

/** '45 minutes mixed pack': 6 math + 6 physics, one shared timer, pace = limit / questions. */
export const PACK_45 = { math: 6, phys: 6, minutes: 45 };
export const domainOf = (topic) => String(topic).split('-')[0];
const LEVEL_SHARE_3 = 0.7; // realistic mix: mostly level 3, the rest level 2
const REPEAT_TOPIC = 0.7;  // damping per exercise already picked from the same topic
const RECENT_MS = 14 * 86400000;

/** Pick weight of each exercise: weak topic, recently failed, due, new => heavier; mastered => lighter. */
export function smartWeights(exercises, attempts, now) {
  const log = cleanLog(attempts);
  const sch = schedules(log);
  const weak = new Map(weakTopics(log, exercises).map((t) => [t.topic, t.score]));
  const w = new Map();
  for (const e of exercises) {
    let x = weak.has(e.topic) ? 1 + 2 * (1 - weak.get(e.topic)) : 1.5;
    const s = sch.get(e.id);
    if (!s) x *= 1.2;
    else {
      if (s.lastOutcome !== 'alone') x *= now - s.lastTs <= RECENT_MS ? 3 : 2;
      if (s.due <= now) x *= 1.5;
      if (s.mastered) x *= 0.3;
    }
    w.set(e.id, x);
  }
  return w;
}

/**
 * Smart exam: `count` distinct ids, deterministic for (inputs, seed), fine with an empty history.
 * quotas {math: 6, phys: 6} fixes the count per domain (topic id prefix); shortfalls are refilled from the rest.
 */
export function buildSmartExamSet({ exercises, topics, count, attempts = [], now = 0, seed = 1, quotas = null }) {
  const rand = rng(seed);
  const chosen = new Set(topics);
  const pool = exercises.filter((e) => chosen.has(e.topic));
  const weights = smartWeights(pool, attempts, now);
  const picks = {};
  const picked = [];
  const draw = (cands) => {
    const ws = cands.map((e) => weights.get(e.id) * Math.pow(REPEAT_TOPIC, picks[e.topic] || 0));
    let r = rand() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r < 0) return cands[i]; }
    return cands[cands.length - 1];
  };
  const take = (e) => { picked.push(e); picks[e.topic] = (picks[e.topic] || 0) + 1; };
  const group = (cands, n) => {
    const left = cands.filter((e) => !picked.includes(e));
    const n3 = Math.round(n * LEVEL_SHARE_3);
    const start = picked.length;
    for (const [lvl, k] of [[3, n3], [2, n - n3]]) {
      for (let i = 0; i < k; i++) {
        const c = left.filter((e) => e.level === lvl && !picked.includes(e));
        if (c.length) take(draw(c));
      }
    }
    // shortfall: highest levels first (3, 2, then the rest)
    while (picked.length - start < n) {
      const c = left.filter((e) => !picked.includes(e));
      if (!c.length) break;
      const top = [3, 2].find((l) => c.some((e) => e.level === l));
      take(draw(top ? c.filter((e) => e.level === top) : c));
    }
  };
  if (quotas) {
    for (const [dom, n] of Object.entries(quotas)) group(pool.filter((e) => domainOf(e.topic) === dom), n);
    if (picked.length < count) group(pool, count - picked.length);
  } else group(pool, count);
  return shuffle(picked.slice(0, count), rand).map((e) => e.id);
}

/* ---------- exam state ---------- */
// { v:1, seed, ids:[], answers:{id: value}, skipped:{id:true}, idx, startedAt, limitMs|null, endedAt|null, recorded:boolean,
//   paceMs?, times?:{id: ms}, curAt?: ms when the current question was opened }

export function createExam({ ids, seed, limitMs, now, paceMs }) {
  const e = { v: 1, seed, ids: ids.slice(), answers: {}, skipped: {}, idx: 0, startedAt: now, limitMs: limitMs ?? null, endedAt: null, recorded: false, times: {}, curAt: now };
  if (Number.isFinite(paceMs) && paceMs > 0) e.paceMs = paceMs;
  return e;
}

/** Target time per question: explicit pace, else limit / questions, else the default. */
export function targetMs(exam) {
  if (Number.isFinite(exam.paceMs) && exam.paceMs > 0) return exam.paceMs;
  if (Number.isFinite(exam.limitMs) && exam.limitMs > 0 && exam.ids.length) return Math.round(exam.limitMs / exam.ids.length);
  return MINUTES_PER_QUESTION * 60000;
}

/** Adds the time spent on the current question to its total and restarts the question clock. */
function bank(exam, now) {
  if (!Number.isFinite(exam.curAt) || !Number.isFinite(now)) return;
  const id = exam.ids[exam.idx];
  if (!exam.times || typeof exam.times !== 'object') exam.times = {};
  exam.times[id] = (Number.isFinite(exam.times[id]) ? exam.times[id] : 0) + Math.max(0, now - exam.curAt);
  exam.curAt = now;
}

export function validExamState(x) {
  return !!x && typeof x === 'object' && x.v === 1 && Array.isArray(x.ids) && x.ids.length > 0 &&
    x.ids.every((i) => typeof i === 'string') && Number.isInteger(x.idx) && x.idx >= 0 && x.idx < x.ids.length &&
    Number.isFinite(x.startedAt) && (x.limitMs === null || Number.isFinite(x.limitMs)) &&
    !!x.answers && typeof x.answers === 'object' && !!x.skipped && typeof x.skipped === 'object';
}

export function setAnswer(exam, id, value) {
  exam.answers[id] = value;
  delete exam.skipped[id];
  return exam;
}
export function skip(exam, id) {
  delete exam.answers[id];
  exam.skipped[id] = true;
  return exam;
}
export function goTo(exam, idx, now) {
  bank(exam, now);
  exam.idx = Math.max(0, Math.min(exam.ids.length - 1, idx));
  return exam;
}
export function finish(exam, now) {
  if (exam.endedAt == null) { bank(exam, now); exam.endedAt = now; }
  return exam;
}

/* ---------- timer math ---------- */
export const elapsedMs = (exam, now) => Math.max(0, (exam.endedAt ?? now) - exam.startedAt);
/** null when there is no time limit. */
export const remainingMs = (exam, now) => (exam.limitMs == null ? null : Math.max(0, exam.limitMs - elapsedMs(exam, now)));
export const isExpired = (exam, now) => exam.limitMs != null && elapsedMs(exam, now) >= exam.limitMs;
export function formatClock(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ---------- scoring ---------- */
const blank = (v) => String(v ?? '').trim() === '';

/** True when nothing was answered for this exercise. answer: strings[] (inputs) | strings[][] (answerSets) | index (choice) */
export function isBlank(ex, answer) {
  if (answer == null) return true;
  if (validAnswerSets(ex.answerSets)) return !Array.isArray(answer) || answer.every((r) => !Array.isArray(r) || r.every(blank));
  if (!Array.isArray(ex.inputs) && ex.choice) return !(Number.isInteger(answer) && answer >= 0);
  return !Array.isArray(answer) || answer.every(blank);
}

/** 'right' | 'wrong' | 'skipped' using the same checkers as the practice pages. */
export function gradeQuestion(ex, answer) {
  if (isBlank(ex, answer)) return 'skipped';
  if (validAnswerSets(ex.answerSets)) {
    return matchSets(answer, ex.answerSets.sets, ex.answerSets.tolerance ?? 0.01).solved ? 'right' : 'wrong';
  }
  if (Array.isArray(ex.inputs)) return checkAll(answer, ex.inputs).every(Boolean) ? 'right' : 'wrong';
  return answer === ex.choice.correct ? 'right' : 'wrong';
}

/** Full report. byId: id => exercise (missing exercises are ignored). */
export function gradeExam(exam, byId, now) {
  const items = [];
  const perTopic = {};
  for (const id of exam.ids) {
    const ex = byId(id);
    if (!ex) continue;
    const status = gradeQuestion(ex, exam.answers[id]);
    const ms = exam.times && Number.isFinite(exam.times[id]) ? exam.times[id] : null;
    items.push({ id, topic: ex.topic, status, ms });
    const t = (perTopic[ex.topic] ||= { right: 0, total: 0 });
    t.total++;
    if (status === 'right') t.right++;
  }
  const right = items.filter((i) => i.status === 'right').length;
  let weakest = null;
  for (const [topic, t] of Object.entries(perTopic)) {
    const ratio = t.right / t.total;
    if (!weakest || ratio < weakest.ratio) weakest = { topic, ratio };
  }
  return {
    right, total: items.length, percent: items.length ? Math.round((right / items.length) * 100) : 0,
    usedMs: elapsedMs(exam, now), perTopic, items, weakest: weakest ? weakest.topic : null,
  };
}

/**
 * Extra report data from the learner's own history (attempts = raw attempt log, may be empty/corrupt).
 * Exam answers are always hint-free; `assisted` marks questions that needed hints or the solution in earlier practice.
 */
export function examInsights(report, exam, attempts = []) {
  const log = cleanLog(attempts);
  const target = targetMs(exam);
  const helped = new Set(log.filter((a) => a.hintsUsed > 0 || a.outcome === 'hinted' || a.outcome === 'solution').map((a) => a.exerciseId));
  const questions = report.items.map((it) => ({
    id: it.id, status: it.status, ms: it.ms, targetMs: target,
    over: it.ms != null && it.ms > target, assisted: helped.has(it.id),
  }));
  const timed = questions.filter((q) => q.ms != null);
  const byTopic = {};
  for (const it of report.items) if (it.status !== 'right') (byTopic[it.topic] ||= []).push(it.id);
  const review = Object.entries(byTopic)
    .map(([topic, ids]) => ({ topic, ids, ratio: report.perTopic[topic].right / report.perTopic[topic].total }))
    .sort((a, b) => a.ratio - b.ratio || (a.topic < b.topic ? -1 : 1));
  const ids = new Set(report.items.map((i) => i.id));
  const mine = log.filter((a) => ids.has(a.exerciseId));
  const reasons = countReasons(mine.some((a) => a.errorReason) ? mine : log).slice(0, 3);
  return {
    targetMs: target, questions, review, reasons,
    avgMs: timed.length ? Math.round(timed.reduce((s, q) => s + q.ms, 0) / timed.length) : null,
    overCount: questions.filter((q) => q.over).length,
    rightFree: questions.filter((q) => q.status === 'right' && !q.assisted).length,
    rightAssisted: questions.filter((q) => q.status === 'right' && q.assisted).length,
  };
}

/** Single-slot interval: start() always replaces the previous one, so re-rendering can never orphan a timer. */
export function createTicker(setIv = setInterval, clearIv = clearInterval) {
  let id = null;
  const stop = () => { if (id != null) clearIv(id); id = null; };
  const start = (fn, ms = 1000) => { stop(); id = setIv(fn, ms); };
  return { start, stop, active: () => id != null };
}
