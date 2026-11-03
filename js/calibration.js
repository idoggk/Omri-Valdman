// Confidence betting: before solving a hard item the student may say "how likely am I to get full marks?" (50/70/90/100 percent).
// The prediction travels with the attempt record (`predicted`, optional). This module holds the pure calibration math
// (buckets, Brier score, verdict, confident-but-wrong list) and the on/off setting. #/calibration draws it (js/calibration-ui.js).
import { safeSetItem } from './storage.js';

export const KEY = 'omri-study-calib-v1';
export const CHIPS = [50, 70, 90, 100];
export const MIN_VERDICT = 20; // fewer predictions than this: no verdict, only 'no data yet'
export const VERDICT_GAP = 0.05; // mean predicted vs actual full-marks rate: more than 5 points apart = over/under confident
export const CONFIDENT = 90; // a prediction of this or more that failed is a "confident but wrong" item

/* ---------- setting: { v, on } (off by default; sprints never show the control) ---------- */
export function loadOn(storage = globalThis.localStorage) {
  try { const d = JSON.parse(storage.getItem(KEY)); return !!d && d.on === true; } catch (e) { return false; }
}
export function saveOn(on, storage = globalThis.localStorage) { return safeSetItem(KEY, JSON.stringify({ v: 1, on: !!on }), storage); }

/* ---------- attempts ---------- */
export const isPrediction = (a) => !!a && CHIPS.includes(a.predicted);

/**
 * Did the attempt get full marks? A record with a partial-credit `score` (booklet mocks) needs score 1; every other record
 * needs an independent solve without hints ('alone').
 */
export const fullMarks = (a) => (Number.isFinite(a.score) ? a.score >= 1 : a.outcome === 'alone' && !(a.hintsUsed > 0));

/** An attempt predicted at 90 or 100 percent that did not get full marks. */
export const confidentWrong = (a) => isPrediction(a) && a.predicted >= CONFIDENT && !fullMarks(a);

const round = (x, d = 100) => Math.round(x * d) / d;
const predictions = (log) => (Array.isArray(log) ? log : []).filter(isPrediction);

/** One row per chip: { chip, n, full, rate } (rate null with n = 0). */
export function buckets(log) {
  const rows = CHIPS.map((chip) => ({ chip, n: 0, full: 0, rate: null }));
  for (const a of predictions(log)) {
    const r = rows[CHIPS.indexOf(a.predicted)];
    r.n++;
    if (fullMarks(a)) r.full++;
  }
  for (const r of rows) r.rate = r.n ? round(r.full / r.n) : null;
  return rows;
}

/** Mean squared gap between the stated probability and what happened (0 = perfect, 0.25 = always saying 50%, 1 = worst). null with no data. */
export function brier(log) {
  const p = predictions(log);
  if (!p.length) return null;
  return round(p.reduce((s, a) => s + (a.predicted / 100 - (fullMarks(a) ? 1 : 0)) ** 2, 0) / p.length, 1000);
}

/** Plain Hebrew meaning of a Brier score. */
export function brierText(b) {
  if (b === null) return 'עוד אין נתונים.';
  if (b <= 0.1) return 'ציון מצוין: ההערכות שלכם קרובות מאוד למה שקרה בפועל.';
  if (b <= 0.2) return 'ציון טוב: ההערכות שלכם מכוונות נכון ברוב המקרים.';
  if (b <= 0.25) return 'ציון בינוני: בערך כמו מי שתמיד עונה 50 אחוז. ההערכות עוד לא אומרות הרבה על מה שיקרה.';
  return 'ציון גבוה מדי: ההערכות שלכם רחוקות ממה שקרה. כדאי לחזור לחשוב על כל הערכה לפני הפתרון.';
}
export const BRIER_EXPLAIN = 'ציון בריאר מודד כמה ההערכות שלכם מדויקות. לכל ניסיון לוקחים את ההסתברות שאמרתם (למשל 0.9), מחסירים 1 אם קיבלתם ציון מלא ו־0 אם לא, ומעלים בריבוע. הציון הוא הממוצע. ככל שהוא קרוב ל־0 כך טוב יותר; 0.25 הוא מה שמקבלים כשתמיד עונים 50 אחוז.';

/**
 * { kind, n, predictedMean, actualRate, gap }. kind: 'nodata' (fewer than MIN_VERDICT predictions),
 * 'over' (the mean prediction is above the actual full-marks rate by more than VERDICT_GAP), 'under' (below by more), 'calibrated'.
 */
export function verdict(log) {
  const p = predictions(log);
  if (p.length < MIN_VERDICT) return { kind: 'nodata', n: p.length, predictedMean: null, actualRate: null, gap: null };
  const predictedMean = p.reduce((s, a) => s + a.predicted / 100, 0) / p.length;
  const actualRate = p.filter(fullMarks).length / p.length;
  const gap = predictedMean - actualRate;
  return { kind: gap > VERDICT_GAP ? 'over' : gap < -VERDICT_GAP ? 'under' : 'calibrated', n: p.length, predictedMean: round(predictedMean), actualRate: round(actualRate), gap: round(gap) };
}
export const VERDICT_TEXT = {
  nodata: 'עוד אין מספיק נתונים לפסק דין (צריך לפחות 20 הערכות).',
  over: 'ביטחון יתר: אתם מעריכים את עצמכם גבוה ממה שקורה בפועל. לפני המבחן כדאי לבדוק עוד פעם, ולהניח שהסיכוי לציון מלא נמוך ממה שהרגשתם.',
  under: 'ביטחון נמוך מדי: אתם מצליחים יותר ממה שחשבתם. אפשר להרשות לעצמכם להאמין יותר בפתרון הראשון.',
  calibrated: 'כיול טוב: ההערכות שלכם מתאימות לתוצאות בפועל.',
};

/** Confident-but-wrong attempts, newest first, one per exercise (the latest one). */
export function confidentWrongItems(log) {
  const seen = new Set();
  const out = [];
  for (const a of (Array.isArray(log) ? log : []).filter(confidentWrong).sort((x, y) => y.ts - x.ts)) {
    if (seen.has(a.exerciseId)) continue;
    seen.add(a.exerciseId);
    out.push(a);
  }
  return out;
}
