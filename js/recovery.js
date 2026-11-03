// Recovery under pressure (#/recovery). A 20-minute mini-mock of 4 questions; the 2nd is a deliberately very hard, unfamiliar one
// from a separate pool of 8 ORIGINAL questions (data/recovery-hard.json, ids rh-01..rh-08, used nowhere else). The skill trained is
// skip-and-return: leave the hard question within its suggested budget, finish the others, come back if time allows.
// Pure logic: the clock, the banks and the storage are injected. js/recovery-ui.js draws it.
//
// The strategy is scored on accuracy-first facts (did you skip within the budget, did you return, how accurate were the questions
// before and after the hard one, how much time you recovered), never on speed alone.
import { safeSetItem } from './storage.js';
import { canonSpec } from './mathhard.js';
import { mulberry32 } from './booklet.js';
import { newLog, logEvent, buildTimeline, cleanLog } from './replay.js';

export const KEY = 'omri-study-recovery-v1';
export const DATA_FILE = 'data/recovery-hard.json';
export const ID_PREFIX = 'rh-';
export const MINUTES = 20;
export const TOTAL_MS = MINUTES * 60000;
export const SIZE = 4;
export const HARD_POS = 1; // 0-based: the 2nd question
export const SKIP_GRACE_S = 15; // leaving the hard question this much after its budget still counts as on time
export const MAX_HISTORY = 15;
export const recoveryTopic = (topic) => `recovery-${topic}`;

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);
const strs = (a) => Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === 'string');

/* ---------- the hard pool ---------- */
export function validHard(q) {
  if (!isRec(q) || typeof q.id !== 'string' || !q.id.startsWith(ID_PREFIX) || !['math', 'physics'].includes(q.subject)) return false;
  if (typeof q.title !== 'string' || typeof q.ask !== 'string' || !strs(q.steps) || !Array.isArray(q.eq)) return false;
  if (!Number.isFinite(q.budget) || !Number.isFinite(q.skipBudget) || !Number.isFinite(q.stuck) || q.skipBudget <= 0 || q.skipBudget >= q.budget) return false;
  try { canonSpec(q.answer); } catch (e) { return false; }
  return true;
}
let cache = null;
export const resetRecoveryCache = () => { cache = null; };
export async function loadHardData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn(DATA_FILE, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!Array.isArray(d)) throw new Error('not an array');
    cache = d.filter(validHard);
    return { ok: true, data: cache };
  } catch (e) { return { ok: false, data: null }; }
}

/** A hard record as a normalised question item (same shape as js/blind.js items, so the same widgets and grader apply). */
export const hardItem = (q) => ({
  uid: q.id, id: q.id, src: 'recovery', topic: 'hard', kind: 'canon', budget: q.budget, skipBudget: q.skipBudget, stuck: q.stuck,
  html: q.html || '', eq: q.eq, ask: q.ask, answer: q.answer, steps: q.steps, title: q.title, hard: true,
  desc: { steps: q.steps, href: '#/recovery' },
});

/** The 3 ordinary questions come from the normalised practice pool of js/blind.js: single-answer items of ordinary difficulty. */
export function ordinaryPool(pool) {
  return pool.filter((it) => ['canon', 'number'].includes(it.kind) && (it.src === 'multipart' || (it.src === 'mathhard' && (it.level || 1) <= 2) || (it.src === 'logs' && (it.level || 1) <= 3)));
}

/* ---------- session ---------- */
// session = { id, seed, ts, uids: [4], hardUid, results: { uid: { correct, score, total, seconds, skipped, ts } }, log: replay log, finishedAt }
export const emptyState = () => ({ v: 1, active: null, history: [] });

/**
 * makeSession(ordinary items, hard records, seed, history, now): uids [ordinary, HARD, ordinary, ordinary]. The hard question cycles through
 * the pool (the one least recently used comes first, ties by seeded order); ordinary questions avoid ids in `recent`.
 */
export function makeSession(ordinary, hards, seed, { history = [], recent = new Set() } = {}, now = Date.now()) {
  if (!hards.length || ordinary.length < SIZE - 1) return null;
  const rnd = mulberry32(seed * 6151 + 17);
  const lastUse = new Map();
  history.forEach((s, i) => lastUse.set(s.hardUid, i));
  const hard = [...hards].map((q, i) => ({ q, k: rnd(), u: lastUse.has(q.id) ? lastUse.get(q.id) : -1, i }))
    .sort((a, b) => a.u - b.u || a.k - b.k || a.i - b.i)[0].q;
  const mix = ordinary.map((it) => ({ it, k: rnd() + (recent.has(it.id) ? 1 : 0) })).sort((a, b) => a.k - b.k);
  const ids = new Set();
  const picks = [];
  for (const { it } of mix) { if (picks.length >= SIZE - 1) break; if (!ids.has(it.id)) { ids.add(it.id); picks.push(it.uid); } }
  if (picks.length < SIZE - 1) return null;
  const uids = [picks[0], hard.id, picks[1], picks[2]];
  const log = newLog('recovery', `recovery-${seed}-${now}`, now);
  return { id: `r${seed}-${now}`, seed, ts: now, uids, hardUid: hard.id, results: {}, log, finishedAt: null };
}

/** Logs an event of the session (opened / answered / skipped); returns the stored event or null. */
export const event = (session, type, uid, now) => logEvent(session.log, type, uid, now);

/** Ends the session (closing the log). Questions without an answer count as 0. Idempotent. */
export function finishSession(session, now) {
  if (session.finishedAt) return session;
  logEvent(session.log, 'finish', '', now);
  session.finishedAt = Math.max(now, session.log.finishedAt || 0);
  return session;
}

/** Time left in ms at `now` (never negative). */
export const timeLeft = (session, now) => Math.max(0, session.ts + TOTAL_MS - now);

/** Stores one first answer. False when the question was already answered or the session is over. */
export function recordResult(session, uid, grade, seconds, now) {
  if (!session.uids.includes(uid) || session.results[uid] || session.finishedAt) return false;
  session.results[uid] = { correct: grade.correct === true, score: grade.score, total: grade.total, seconds: Math.round(nn(seconds)), skipped: grade.skipped === true, ts: now };
  return true;
}

/* ---------- the strategy score ---------- */
const frac = (r) => (r && r.total ? r.score / r.total : 0);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Facts about the hard question's first visit, from the event log.
 * -> { opened, seconds (first visit), left: 'skip'|'moved'|'answered'|'finish'|'stayed'|null }
 */
export function firstVisit(log, hardUid) {
  const evs = log.events;
  const i = evs.findIndex((e) => e.q === hardUid && (e.type === 'open' || e.type === 'revisit'));
  if (i < 0) return { opened: false, seconds: 0, left: null };
  const rest = evs.slice(i + 1);
  const j = rest.findIndex((e) => e.q !== hardUid || e.type === 'answer' || e.type === 'skip');
  if (j < 0) return { opened: true, seconds: Math.round(Math.max(0, (log.finishedAt || evs[evs.length - 1].t) - evs[i].t) / 1000), left: 'stayed' };
  const e = rest[j];
  const left = e.type === 'finish' ? 'finish' : e.q === hardUid ? (e.type === 'skip' ? 'skip' : 'answered') : 'moved';
  return { opened: true, seconds: Math.round(Math.max(0, e.t - evs[i].t) / 1000), left };
}

/**
 * strategyScore(session, hardRec) -> { skippedInBudget, solvedFirst, returned, hardCorrect, before, after, recovered (seconds), points (0..4), verdict, lines[] }
 * points: 1 left the hard one within its budget (or solved it right away), 1 returned to it (or solved it), 1 accuracy after the hard one
 * is not much below the accuracy before it (0.25 slack), 1 finished inside the 20 minutes.
 */
export function strategyScore(session, hardRec) {
  const H = session.hardUid;
  const fv = firstVisit(session.log, H);
  const hardRes = session.results[H] || null;
  const afterLeave = (() => { // revisit events after the first departure
    const evs = session.log.events;
    const k = evs.findIndex((e) => e.q === H && (e.type === 'open' || e.type === 'revisit'));
    return k >= 0 && evs.slice(k + 1).some((e) => e.q === H && e.type === 'revisit');
  })();
  const solvedFirst = fv.left === 'answered' && !!hardRes && hardRes.correct;
  const left = fv.left === 'skip' || fv.left === 'moved';
  const skippedInBudget = left && fv.seconds <= hardRec.skipBudget + SKIP_GRACE_S;
  const skippedLate = left && !skippedInBudget;
  const before = frac(session.results[session.uids[0]]);
  const afterUids = session.uids.slice(HARD_POS + 1);
  const after = mean(afterUids.map((u) => frac(session.results[u])));
  const wall = ((session.log.finishedAt || session.finishedAt || session.ts) - session.log.startedAt);
  const inTime = wall <= TOTAL_MS + 5000;
  const returned = afterLeave;
  const hardCorrect = !!hardRes && hardRes.correct;
  const recovered = skippedInBudget ? Math.max(0, hardRec.stuck - fv.seconds) : 0;
  const points = (skippedInBudget || solvedFirst ? 1 : 0) + (returned || solvedFirst ? 1 : 0) + (after >= before - 0.25 ? 1 : 0) + (inTime ? 1 : 0);
  const lines = [];
  if (!fv.opened) lines.push('לא פתחתם את השאלה הקשה בכלל. במבחן אמיתי כדאי לפחות להסתכל על כל שאלה ולהחליט אם להתחיל.');
  else if (solvedFirst) lines.push(`פתרתם את השאלה הקשה נכון כבר בכניסה הראשונה (אחרי ${Math.round(fv.seconds / 60 * 10) / 10} דקות). לא היה צורך לדלג.`);
  else if (skippedInBudget) lines.push(`יצאתם מהשאלה הקשה אחרי ${Math.round(fv.seconds)} שניות, בתוך הזמן המומלץ (${hardRec.skipBudget} שניות). זו ההחלטה הנכונה כשאין דרך ברורה.`);
  else if (skippedLate) lines.push(`יצאתם מהשאלה הקשה רק אחרי ${Math.round(fv.seconds)} שניות, מעבר לזמן המומלץ (${hardRec.skipBudget} שניות). בפעם הבאה קבעו לעצמכם שעון: אם אין כיוון אחרי ${Math.round(hardRec.skipBudget / 60)} דקות, מדלגים.`);
  else lines.push(`נשארתם בשאלה הקשה ${Math.round(fv.seconds)} שניות עד שהגשתם, ולא יצאתם ממנה. הגשה שגויה אחרי זמן ארוך עולה בנקודות של שאלות קלות יותר.`);
  if (left) lines.push(returned ? 'חזרתם אל השאלה הקשה אחרי שסיימתם את האחרות. זה בדיוק הדפוס של מבחן טוב.' : 'לא חזרתם אל השאלה הקשה. אם נשאר זמן, חזרה עם ראש מנוקה לפעמים פותחת את הבעיה.');
  lines.push(`דיוק לפני השאלה הקשה: ${Math.round(before * 100)}%, אחריה: ${Math.round(after * 100)}%. ${after >= before - 0.25 ? 'השאלה הקשה לא פגעה בשאלות שאחריה.' : 'הדיוק ירד אחרי השאלה הקשה: כנראה שנשאר פחות זמן וריכוז. זה הסימן שהיה כדאי לצאת קודם.'}`);
  if (recovered > 0) lines.push(`חסכתם בערך ${Math.round(recovered / 60 * 10) / 10} דקות לעומת מי שנשאר בשאלה הקשה עד ${Math.round(hardRec.stuck / 60)} דקות.`);
  const verdict = points >= 4 ? 'אסטרטגיה מצוינת: ידעתם מתי לעזוב, ואיך לחזור.'
    : points === 3 ? 'אסטרטגיה טובה, עם נקודה אחת לשיפור.'
      : points === 2 ? 'אסטרטגיה חלקית: חלק מהכלים עבדו, וחלק עדיין לא.'
        : 'השאלה הקשה שלטה במבחן. נסו שוב עם חוק פשוט: יוצאים אחרי שלוש דקות בלי כיוון.';
  return { opened: fv.opened, seconds: fv.seconds, left: fv.left, skippedInBudget, skippedLate, solvedFirst, returned, hardCorrect, before, after, recovered, inTime, points, max: 4, verdict, lines };
}

/** Timeline of the mock (reuses the replay engine): per question seconds and the lessons. */
export function timelineOf(session, labels) {
  return buildTimeline(session.log, session.uids.map((u, i) => ({ key: u, label: labels[i] || `שאלה ${i + 1}`, marks: u === session.hardUid ? 1 : 1, earned: session.results[u] ? session.results[u].score / Math.max(1, session.results[u].total) : 0 })));
}

/* ---------- saved state ---------- */
const cleanResult = (r) => (isRec(r) ? { correct: r.correct === true, score: Math.floor(nn(r.score)), total: Math.max(1, Math.floor(nn(r.total))), seconds: Math.round(nn(r.seconds)), skipped: r.skipped === true, ts: nn(r.ts) } : null);
export function cleanSession(s) {
  if (!isRec(s) || typeof s.id !== 'string' || !s.id || s.id.length > 60 || !Array.isArray(s.uids) || s.uids.length !== SIZE || !s.uids.every((u) => typeof u === 'string' && u.length <= 80)) return null;
  const log = cleanLog({ ...(isRec(s.log) ? s.log : {}), kind: 'recovery' }, `recovery-${s.id}`.slice(0, 60));
  if (!log) return null;
  const results = {};
  for (const u of s.uids) { const r = isRec(s.results) ? cleanResult(s.results[u]) : null; if (r) results[u] = r; }
  const hardUid = typeof s.hardUid === 'string' && s.uids.includes(s.hardUid) ? s.hardUid : s.uids[HARD_POS];
  return { id: s.id, seed: Number.isInteger(s.seed) ? s.seed : 1, ts: nn(s.ts), uids: s.uids, hardUid, results, log, finishedAt: Number.isFinite(s.finishedAt) ? s.finishedAt : null };
}
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

/** Moves a finished active session into the history (saved). */
export function archive(state, session) {
  state.history = [...state.history.filter((s) => s.id !== session.id), session].sort((a, b) => a.finishedAt - b.finishedAt).slice(-MAX_HISTORY);
  state.active = null;
  return state;
}

/** Restore merge (strings in, string out): history by session id, the active session of the newer device. */
export function mergeRecovery(localRaw, backupRaw) {
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
