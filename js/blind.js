// Blind weakness tournament (#/blind). 12 mixed questions from the existing practice banks, with NO topic or difficulty labels,
// no hints, one attempt each and a time per question. Afterwards the hidden weak spots are ranked by independent accuracy,
// time against the budget and error type, and the three weakest topics are named. Pure logic: banks, clock and storage are injected.
// js/blind-ui.js draws it.
//
// Attempts go to the attempt log under topic 'blind-<topic>' (the exercise id is the bank's own id, so "seen in the last 7 days" and the
// error notebook see them; the ceiling detector counts them with the topic they come from, see js/ceiling.js).
// Questions never come from the reserved pools: transfer (tr-), booklet (bk-), the recovery pool (rh-) or the pressure pool.
import { safeSetItem } from './storage.js';
import { canonSpec, studentCanon, sameCanon } from './mathhard.js';
import { parseNumber, TOL } from './multipart.js';
import { isCorrect } from './check.js';
import { answerOf, checkUnitsAnswer, expectedText } from './units.js';
import { rangesOf, correctIndex, rangeLabel } from './estimate.js';
import { budgetOf, QUICK_WRONG_SECONDS } from './ceiling.js';
import { mulberry32 } from './booklet.js';

export const KEY = 'omri-study-blind-v1';
export const SIZE = 12;
export const RECENT_DAYS = 7;
export const DAY_MS = 86400000;
export const MAX_HISTORY = 10;
export const MIN_CONFIDENT = 3; // fewer questions in a topic than this = a low-confidence ranking
export const RESERVED_PREFIXES = ['tr-', 'bk-', 'rh-', 'pl-'];
export const blindTopic = (topic) => `blind-${topic}`;
export const isBlindTopic = (t) => typeof t === 'string' && t.startsWith('blind-');
export const baseTopic = (t) => (isBlindTopic(t) ? t.slice(6) : t);

/** Weakness groups: the hidden topic of a question as shown in the ranking (Hebrew). */
export const GROUPS = [
  { id: 'radicals', label: 'שורשים ומשוואות עם שורש', topics: ['math-rad', 'math-hard-radical'] },
  { id: 'exp-log', label: 'חזקות, מעריכי ולוגריתמים', topics: ['math-pow', 'math-lg', 'math-hard-exponent', 'logs'] },
  { id: 'rational-param', label: 'אי־שוויונות רציונליים ופרמטר', topics: ['math-hard-rational', 'math-hard-param', 'math-par'] },
  { id: 'systems', label: 'מערכות משוואות', topics: ['math-3', 'math-4'] },
  { id: 'circle', label: 'מעגל וגאומטריה אנליטית', topics: ['math-hard-circle'] },
  { id: 'trig', label: 'טריגונומטריה והוכחות', topics: ['trig'] },
  { id: 'mechanics', label: 'פיזיקה: תנועה ושאלות מבחן', topics: ['phys-vertical', 'phys-horizontal', 'multipart', 'recover-physics'] },
  { id: 'sanity', label: 'יחידות, הערכה ובדיקת שפיות', topics: ['units', 'estimate', 'recover-math'] },
];
export const groupOf = (topic) => (GROUPS.find((g) => g.topics.includes(baseTopic(topic))) || GROUPS[GROUPS.length - 1]).id;
export const groupLabel = (id) => (GROUPS.find((g) => g.id === id) || { label: id }).label;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const plain = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- normalised items ----------
 * { uid, id, src, topic, kind: 'canon'|'inputs'|'number'|'choice', budget, html?, ask?, eq?, answer?, inputs?, options?, answerIdx?, shuffle?, unit?, desc }
 * `id` is the bank's own exercise id; `uid` is unique per question (several steps of one trig proof share an id). */
const seedFrom = (str) => { let a = 7; for (const ch of String(str)) a = (Math.imul(a, 31) + ch.charCodeAt(0)) | 0; return a; };

export function fromMathHard(list) {
  return (list || []).filter((e) => isRec(e) && e.answer && Array.isArray(e.eq)).map((e) => ({
    uid: e.id, id: e.id, src: 'mathhard', topic: `math-hard-${e.family}`, kind: 'canon', level: e.tier, budget: budgetOf(`math-hard-${e.family}`),
    ask: e.ask, eq: e.eq, answer: e.answer, desc: { steps: e.steps, href: `#/mathhard/${e.id}` },
  }));
}
export function fromLogs(list) {
  return (list || []).filter((e) => isRec(e) && e.answer && Array.isArray(e.eq)).map((e) => ({
    uid: e.id, id: e.id, src: 'logs', topic: 'logs', kind: 'canon', level: e.tier, budget: budgetOf('logs'),
    ask: e.ask, eq: e.eq, answer: e.answer, desc: { steps: e.steps, href: `#/logs/ex/${e.id}` },
  }));
}
export function fromLadder(stages) {
  const out = [];
  for (const s of stages || []) {
    for (const it of s.items || []) {
      if (!isRec(it) || it.ref || !Array.isArray(it.inputs) || !it.inputs.length || typeof it.statement !== 'string') continue;
      out.push({
        uid: it.id, id: it.id, src: 'ladder', topic: it.topic || 'math-3', kind: 'inputs', budget: 60 * (2 + it.inputs.length), html: it.statement,
        inputs: it.inputs.map((i) => ({ label: i.label, unit: i.unit || '', answer: i.answer, tolerance: Number.isFinite(i.tolerance) ? i.tolerance : 0.01 })),
        desc: { steps: [it.inputs.map((i) => `${i.label} = ${i.answer}${i.unit ? ' ' + i.unit : ''}`).join(', ')], href: '#/ladder/math' },
      });
    }
  }
  return out;
}
export function fromMultipart(list) {
  const out = [];
  for (const q of list || []) {
    if (!isRec(q) || q.diagram) continue;
    const p = (q.parts || []).find((x) => Array.isArray(x.uses) && x.uses.length === 0);
    if (!p) continue;
    out.push({
      uid: `${q.id}.${p.id}`, id: q.id, src: 'multipart', topic: 'multipart', kind: 'number', budget: 240, html: q.stem, ask: p.ask, unit: p.unit || '', answer: p.answer,
      desc: { steps: Array.isArray(p.solution) ? p.solution : [p.solution], href: `#/multipart/${q.id}` },
    });
  }
  return out;
}
export function fromProofs(proofs) {
  const out = [];
  for (const p of proofs || []) {
    (p.steps || []).forEach((st, i) => {
      if (!isRec(st) || typeof st.ok !== 'string' || !Array.isArray(st.bad) || st.bad.length < 2) return;
      const cur = i === 0 ? p.lhs : p.steps[i - 1].ok;
      out.push({
        uid: `trig-${p.id}-s${i + 1}`, id: `trig-${p.id}`, src: 'trig', topic: 'trig', kind: 'choice', budget: 90, shuffle: true,
        eq: [cur], goal: `${p.lhs} = ${p.rhs}`, ask: `מוכיחים שהזהות ${p.lhs} = ${p.rhs} נכונה. הביטוי הנוכחי מופיע למטה. מהי השורה הבאה בהוכחה?`,
        options: [st.ok, ...st.bad.map((b) => b.to)], answerIdx: 0, desc: { steps: [`${st.ok}`, st.why || ''], href: `#/trig/proof/${p.id}` },
      });
    });
  }
  return out;
}
export function fromRecover(list) {
  return (list || []).filter((q) => isRec(q) && Array.isArray(q.steps) && Number.isInteger(q.firstWrong)).map((q) => ({
    uid: q.id, id: q.id, src: 'recover', topic: q.subject === 'physics' ? 'recover-physics' : 'recover-math', kind: 'choice', budget: 180, shuffle: false,
    html: q.statement, steps: q.steps, ask: 'בפתרון שלמטה יש טעות אחת. באיזה שלב היא מופיעה לראשונה?',
    options: q.steps.map((_, i) => `שלב ${i + 1}`), answerIdx: q.firstWrong,
    desc: { steps: [q.correctedStep, q.whyWrong], href: `#/recover/${q.id}` },
  }));
}
export function fromUnits(list) {
  const out = [];
  for (const q of list || []) {
    let a;
    try { a = answerOf(q); } catch (e) { continue; }
    const base = { uid: q.id, id: q.id, src: 'units', topic: 'units', budget: 75, ask: q.prompt, desc: { steps: [expectedText(q), q.why], href: '#/units' }, units: q };
    if (a.kind === 'choice') out.push({ ...base, kind: 'choice', options: a.choices, answerIdx: a.index, shuffle: q.type === 'unit' || q.type === 'graph' || q.type === 'qty' });
    else out.push({ ...base, kind: 'unitsnum', unit: a.unit });
  }
  return out;
}
export function fromEstimate(list) {
  return (list || []).filter((q) => isRec(q) && q.mode === 'choice').map((q) => ({
    uid: q.id, id: q.id, src: 'estimate', topic: 'estimate', kind: 'choice', budget: 60, shuffle: false,
    ask: `${q.prompt} (בלי מחשבון: בחרו את הטווח הסביר)`, options: rangesOf(q).map((_, i) => rangeLabel(q, i)), answerIdx: correctIndex(q),
    desc: { steps: q.steps, href: '#/estimate' },
  }));
}

/** data = { mathhard, logs, ladder (stages), multipart, proofs, recover, units, estimate } -> normalised pool. Missing banks are skipped. */
export function buildPool(data = {}) {
  return [
    ...fromMathHard(data.mathhard), ...fromLogs(data.logs), ...fromLadder(data.ladder), ...fromMultipart(data.multipart),
    ...fromProofs(data.proofs), ...fromRecover(data.recover), ...fromUnits(data.units), ...fromEstimate(data.estimate),
  ].filter((it) => !RESERVED_PREFIXES.some((p) => it.id.startsWith(p)));
}

/* ---------- choice presentation and grading ---------- */
/** Options in the order shown (seeded shuffle when the item allows it) and the index of the right one in that order. */
export function presentChoice(item, seed) {
  const idx = item.options.map((_, i) => i);
  if (item.shuffle) {
    const rnd = mulberry32(seedFrom(`${seed}:${item.uid}`));
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  }
  return { options: idx.map((i) => item.options[i]), correct: idx.indexOf(item.answerIdx) };
}

/** input: canon -> widget.read(); inputs -> [text]; number/unitsnum -> text; choice -> shown index. -> { valid, correct, score, total, error? } */
export function gradeBlind(item, input, seed = 1) {
  const bad = (error) => ({ valid: false, error });
  if (item.kind === 'canon') {
    const r = studentCanon(item.answer.kind, input);
    if (!r.ok) return bad(r.error);
    const ok = sameCanon(r.canon, canonSpec(item.answer));
    return { valid: true, correct: ok, score: ok ? 1 : 0, total: 1 };
  }
  if (item.kind === 'inputs') {
    const vals = Array.isArray(input) ? input : [];
    const marks = item.inputs.map((s, i) => isCorrect(vals[i], s.answer, s.tolerance));
    const score = marks.filter(Boolean).length;
    if (!vals.some((v) => String(v || '').trim())) return bad('כתבו תשובה לפחות באחד הסעיפים, או לחצו על "אין לי תשובה".');
    return { valid: true, correct: score === marks.length, score, total: marks.length };
  }
  if (item.kind === 'number') {
    const v = parseNumber(input);
    if (!Number.isFinite(v)) return bad('כתבו מספר (למשל 12 או -0.5).');
    const ok = Math.abs(v - item.answer) <= TOL + 1e-9;
    return { valid: true, correct: ok, score: ok ? 1 : 0, total: 1 };
  }
  if (item.kind === 'unitsnum') {
    const r = checkUnitsAnswer(item.units, input);
    if (!r.valid) return bad(r.error || 'כתבו מספר.');
    return { valid: true, correct: r.correct, score: r.correct ? 1 : 0, total: 1 };
  }
  if (item.kind === 'choice') {
    const { correct } = presentChoice(item, seed);
    if (!Number.isInteger(input) || input < 0 || input >= item.options.length) return bad('בחרו תשובה.');
    return { valid: true, correct: input === correct, score: input === correct ? 1 : 0, total: 1 };
  }
  return bad('שאלה לא נתמכת.');
}
export const skipBlind = (item) => ({ valid: true, correct: false, skipped: true, score: 0, total: item.kind === 'inputs' ? item.inputs.length : 1 });

/* ---------- deterministic picker ---------- */
/** uids/ids attempted in the last RECENT_DAYS days (any mode). */
export function recentIds(log, now) {
  const since = now - RECENT_DAYS * DAY_MS;
  return new Set((Array.isArray(log) ? log : []).filter((a) => a && a.ts >= since && typeof a.exerciseId === 'string').map((a) => a.exerciseId));
}

/**
 * pickSession(pool, seed, { recent: Set of ids, reserved: Set of ids }) -> uids (length SIZE, or fewer when the pool is small).
 * Round-robin over the weakness groups in a seeded order, then over the banks inside a group; items seen in the last 7 days come last;
 * never two questions with the same exercise id. The same seed, pool and recent set always give the same session.
 */
export function pickSession(pool, seed, { recent = new Set(), reserved = new Set() } = {}) {
  const rnd = mulberry32(seedFrom(`blind:${seed}`));
  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const usable = pool.filter((it) => !reserved.has(it.id) && !RESERVED_PREFIXES.some((p) => it.id.startsWith(p)));
  const queues = new Map();
  for (const g of GROUPS) {
    const mine = shuffle(usable.filter((it) => groupOf(it.topic) === g.id));
    // fresh items first, recently seen ones only as a fallback; the sort is stable so the shuffle order survives inside each class
    const ordered = [...mine.filter((it) => !recent.has(it.id)), ...mine.filter((it) => recent.has(it.id))];
    // interleave banks inside the group so one bank does not take every slot
    const bySrc = new Map();
    for (const it of ordered) { if (!bySrc.has(it.src)) bySrc.set(it.src, []); bySrc.get(it.src).push(it); }
    const mixed = [];
    for (let i = 0; mixed.length < ordered.length; i++) for (const l of bySrc.values()) if (i < l.length) mixed.push(l[i]);
    // keep recency order: fresh before recent regardless of interleave
    queues.set(g.id, [...mixed.filter((it) => !recent.has(it.id)), ...mixed.filter((it) => recent.has(it.id))]);
  }
  const groupOrder = shuffle(GROUPS.map((g) => g.id));
  const picked = [];
  const ids = new Set();
  for (let round = 0; picked.length < SIZE && round < SIZE * 2; round++) {
    let any = false;
    for (const gid of groupOrder) {
      if (picked.length >= SIZE) break;
      const q = queues.get(gid);
      while (q.length && ids.has(q[0].id)) q.shift();
      if (!q.length) continue;
      const it = q.shift();
      ids.add(it.id); picked.push(it.uid); any = true;
    }
    if (!any) break;
  }
  return shuffle(picked); // hide the grouping: the order of the session is mixed too
}

/* ---------- ranking ---------- */
export const ERROR_TYPES = {
  skipped: 'דילגתם (אין תשובה)',
  guess: 'תשובה שגויה מהירה מאוד (נראה כמו ניחוש)',
  wrong: 'טעות אחרי חשיבה',
  partial: 'תשובה חלקית',
  slow: 'נכון, אבל לאט מהזמן המתוכנן',
};

/** Error type of one result (null when it was right and on time). */
export function errorType(r, budget) {
  if (r.skipped) return 'skipped';
  if (r.correct) return r.seconds > budget ? 'slow' : null;
  if (r.score > 0 && r.score < r.total) return 'partial';
  return r.seconds < QUICK_WRONG_SECONDS ? 'guess' : 'wrong';
}

/**
 * rank(items, results) -> { groups: [{ id, label, n, accuracy, overBudget, guessRate, weakness, lowConfidence, errors }], weakest: [top 3 with weakness > 0], seconds, budget, correct }
 * weakness = 0.7 * (1 - independent accuracy) + 0.15 * share over the time budget + 0.15 * share of skips / quick guesses.
 */
export function rank(items, results) {
  const by = new Map();
  let seconds = 0, budget = 0, correct = 0;
  for (const it of items) {
    const r = results[it.uid];
    if (!r) continue;
    const g = groupOf(it.topic);
    if (!by.has(g)) by.set(g, { id: g, label: groupLabel(g), n: 0, score: 0, total: 0, over: 0, guess: 0, errors: {} });
    const row = by.get(g);
    row.n += 1; row.score += r.score; row.total += r.total;
    if (r.seconds > it.budget) row.over += 1;
    const et = errorType(r, it.budget);
    if (et === 'skipped' || et === 'guess') row.guess += 1;
    if (et) row.errors[et] = (row.errors[et] || 0) + 1;
    seconds += r.seconds; budget += it.budget; if (r.correct) correct += 1;
  }
  const groups = [...by.values()].map((r) => {
    const accuracy = r.total ? r.score / r.total : 0;
    const overBudget = r.n ? r.over / r.n : 0;
    const guessRate = r.n ? r.guess / r.n : 0;
    return { id: r.id, label: r.label, n: r.n, accuracy, overBudget, guessRate, errors: r.errors, lowConfidence: r.n < MIN_CONFIDENT,
      weakness: Math.round((0.7 * (1 - accuracy) + 0.15 * overBudget + 0.15 * guessRate) * 1000) / 1000 };
  }).sort((a, b) => b.weakness - a.weakness || (a.id < b.id ? -1 : 1));
  return { groups, weakest: groups.filter((g) => g.weakness > 0).slice(0, 3), seconds, budget, correct };
}

/* ---------- attempts and notebook ---------- */
/** Attempt-log record: 'alone' only for a fully right answer; skips are 'solution' (abandoned), everything else 'wrong'. */
export const attemptFor = (item, grade, seconds) => ({
  exerciseId: item.id, topic: blindTopic(item.topic), outcome: grade.skipped ? 'solution' : grade.correct ? 'alone' : 'wrong', hintsUsed: 0, seconds: Math.round(nn(seconds)),
});

/* ---------- saved state: { v:1, active: session|null, history: [session] } ---------- */
// session = { id, seed, ts, uids, results: { uid: { correct, score, total, seconds, skipped, ts, id } }, finishedAt, wrong: { uid: { id, topic, title, key, href } } }
const cleanResult = (r) => (isRec(r) ? { correct: r.correct === true, score: Math.floor(nn(r.score)), total: Math.max(1, Math.floor(nn(r.total))), seconds: Math.round(nn(r.seconds)), skipped: r.skipped === true, ts: nn(r.ts) } : null);
const cleanWrong = (w) => (isRec(w) && typeof w.id === 'string'
  ? { id: w.id.slice(0, 80), topic: String(w.topic || '').slice(0, 60), title: String(w.title || '').slice(0, 120), key: String(w.key || '').slice(0, 600), href: typeof w.href === 'string' && /^#\//.test(w.href) ? w.href.slice(0, 120) : '' } : null);
export function cleanSession(s) {
  if (!isRec(s) || typeof s.id !== 'string' || !s.id || s.id.length > 60 || !Array.isArray(s.uids) || !s.uids.length) return null;
  const uids = s.uids.filter((u) => typeof u === 'string' && u.length <= 80).slice(0, SIZE);
  const results = {}, wrong = {};
  for (const u of uids) {
    const r = isRec(s.results) ? cleanResult(s.results[u]) : null;
    if (r) results[u] = r;
    const w = isRec(s.wrong) ? cleanWrong(s.wrong[u]) : null;
    if (w) wrong[u] = w;
  }
  return { id: s.id, seed: Number.isInteger(s.seed) ? s.seed : 1, ts: nn(s.ts), uids, results, wrong, finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : null };
}
export const emptyState = () => ({ v: 1, active: null, history: [] });
export function sanitize(raw) {
  const out = emptyState();
  if (!isRec(raw)) return out;
  const a = cleanSession(raw.active);
  out.active = a && !a.finishedAt ? a : null;
  if (Array.isArray(raw.history)) out.history = raw.history.map(cleanSession).filter((s) => s && s.finishedAt).slice(-MAX_HISTORY);
  return out;
}
export function load(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptyState(); }
}
export const save = (state, storage = globalThis.localStorage) => safeSetItem(KEY, JSON.stringify(state), storage);

/** Active session, or a new one (saved) for `seed`. null when the pool gives no questions. */
export function startSession(pool, seed, log, now = Date.now(), storage = globalThis.localStorage, reserved = new Set()) {
  const st = load(storage);
  if (st.active && st.active.uids.every((u) => pool.some((it) => it.uid === u))) return st.active;
  const uids = pickSession(pool, seed, { recent: recentIds(log, now), reserved });
  if (!uids.length) return null;
  st.active = { id: `b${seed}-${now}`, seed, ts: now, uids, results: {}, wrong: {}, finishedAt: null };
  save(st, storage);
  return st.active;
}
export const nextUid = (s) => (s ? s.uids.find((u) => !s.results[u]) || null : null);

/** Stores the one attempt of a question; false when it was already answered. Finishing the last one moves the session to the history. */
export function submit(pool, uid, grade, seconds, storage = globalThis.localStorage, now = Date.now()) {
  const st = load(storage);
  const s = st.active;
  const item = pool.find((it) => it.uid === uid);
  if (!s || !item || !s.uids.includes(uid) || s.results[uid]) return false;
  s.results[uid] = { correct: grade.correct === true, score: grade.score, total: grade.total, seconds: Math.round(nn(seconds)), skipped: grade.skipped === true, ts: now };
  if (!grade.correct) {
    s.wrong[uid] = { id: item.id, topic: blindTopic(item.topic), title: describeTitle(item), key: plain((item.desc.steps || []).filter(Boolean)[0] || '').slice(0, 300), href: item.desc.href || '' };
  }
  if (s.uids.every((u) => s.results[u])) {
    s.finishedAt = now;
    st.history = [...st.history, s].slice(-MAX_HISTORY);
    st.active = null;
  }
  return save(st, storage) !== false;
}
const describeTitle = (item) => plain(item.ask || item.html || item.id).slice(0, 70);

/** Notebook description of a wrong blind item by exercise id: { title, key, href } or null. */
export function describeBlind(id, storage = globalThis.localStorage) {
  const st = load(storage);
  const sessions = [...(st.active ? [st.active] : []), ...st.history].reverse();
  for (const s of sessions) for (const w of Object.values(s.wrong)) if (w.id === id) return { title: w.title, key: w.key, href: w.href };
  return null;
}

/** Restore merge (strings in, string out): history by session id (the later one wins), the active session of the newer device. */
export function mergeBlind(localRaw, backupRaw) {
  const parse = (r) => { try { return sanitize(JSON.parse(r)); } catch (e) { return emptyState(); } };
  const a = parse(localRaw), b = parse(backupRaw);
  const byId = new Map();
  for (const s of [...a.history, ...b.history]) { const c = byId.get(s.id); if (!c || s.finishedAt > c.finishedAt) byId.set(s.id, s); }
  const out = emptyState();
  out.history = [...byId.values()].sort((x, y) => x.finishedAt - y.finishedAt).slice(-MAX_HISTORY);
  const act = [a.active, b.active].filter(Boolean).sort((x, y) => y.ts - x.ts)[0] || null;
  out.active = act && !out.history.some((s) => s.id === act.id) ? act : null;
  return JSON.stringify(out);
}

/** Result data of a finished session from the pool: ranking plus per-question rows. */
export function resultData(pool, session) {
  const items = session.uids.map((u) => pool.find((it) => it.uid === u)).filter(Boolean);
  const r = rank(items, session.results);
  const rows = items.map((it) => {
    const res = session.results[it.uid] || { correct: false, score: 0, total: 1, seconds: 0, skipped: true };
    return { uid: it.uid, id: it.id, group: groupOf(it.topic), label: groupLabel(groupOf(it.topic)), correct: res.correct, seconds: res.seconds, budget: it.budget, error: errorType(res, it.budget) };
  });
  return { ...r, rows, questions: items.length };
}
