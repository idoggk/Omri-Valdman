// Pure exam logic: building a seeded set, scoring, timer math. No DOM, no storage.
import { checkAll } from './check.js';
import { matchSets, validAnswerSets } from './answersets.js';

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

/* ---------- exam state ---------- */
// { v:1, seed, ids:[], answers:{id: value}, skipped:{id:true}, idx, startedAt, limitMs|null, endedAt|null, recorded:boolean }

export function createExam({ ids, seed, limitMs, now }) {
  return { v: 1, seed, ids: ids.slice(), answers: {}, skipped: {}, idx: 0, startedAt: now, limitMs: limitMs ?? null, endedAt: null, recorded: false };
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
export function goTo(exam, idx) {
  exam.idx = Math.max(0, Math.min(exam.ids.length - 1, idx));
  return exam;
}
export function finish(exam, now) {
  if (exam.endedAt == null) exam.endedAt = now;
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
    items.push({ id, topic: ex.topic, status });
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
