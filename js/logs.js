// #/logs logic: log-expression syntax on top of the mathhard parser (no second engine), tiers with method cards,
// data loading and validation, Leitner card state on top of trig.js. No DOM.
// Shared by js/logs-ui.js, tools/verify-logs.mjs and tests/logs.test.mjs.
// Source syntax in the data: log_2(x), log_x(x+2), log_(1/2)(x), lg(x) = log_10, ln(x) = log_e, |x| for absolute value.
import { compileExpr, parseRelation } from './mathhard.js';
import { safeSetItem } from './storage.js';
import {
  emptyState, sanitizeState, gradeCard, dueCards, requeueGap, boxCounts, MAX_BOX,
} from './trig.js';

export const LOGS_KEY = 'omri-study-logs-v1';
export const E = 2.718281828459045;
export { gradeCard, dueCards, requeueGap, boxCounts, MAX_BOX };

/** Data syntax -> mathhard syntax (log(base;arg)). Bases: number, one letter, or a parenthesised expression. */
export function lx(src) {
  return String(src)
    .replace(/log_\(([^()]+)\)\(/g, 'log($1;')
    .replace(/log_(\d+(?:\.\d+)?|[a-z])\(/g, 'log($1;')
    .replace(/\bln\(/g, `log(${E};`)
    .replace(/\blg\(/g, 'log(10;');
}
export const compileLog = (s) => compileExpr(lx(s));
export const parseLogRel = (s) => parseRelation(lx(s));

export const TIERS = [
  {
    id: 1, label: 'רמה 1: יסודות', badge: 'יסודות',
    method: ['״log בסיס a של b״ שואל: a בחזקת מה נותן b? כותבים a^? = b ועונים.',
      'המרה: log_a(b) = c אומר בדיוק a^c = b. אפשר ללכת לשני הכיוונים.',
      'לפני כל לוגריתם בודקים: הבסיס חיובי ושונה מ־1, והמספר שבתוך הלוגריתם חיובי.'],
    generic: 'שאלו: a בחזקת מה נותן b? כתבו את החזקות של הבסיס עד שמגיעים למספר.',
  },
  {
    id: 2, label: 'רמה 2: כללים', badge: 'כללים',
    method: ['מכפלה ← סכום, מנה ← הפרש, חזקה יורדת קדימה: log(xy) = log x + log y, log(x/y) = log x − log y, log(x^n) = n·log x.',
      'בלי מחשבון: מפרקים כל מספר לגורמים של הבסיס (72 = 8·9) ומחברים.',
      'בסיס שונה? מעבירים בסיס: log_a(x) = log_b(x) / log_b(a).'],
    generic: 'פרקו כל מספר לחזקות של אותו בסיס, החילו את הכללים, ורק בסוף חשבו.',
  },
  {
    id: 3, label: 'רמה 3: משוואות ותחום', badge: 'משוואות',
    method: ['שלב 1, תמיד ראשון: תחום. כל מה שבתוך לוגריתם חיובי, כל בסיס חיובי ושונה מ־1.',
      'מצמצמים ללוגריתם אחד בכל צד (או לוגריתם אחד שווה מספר) בעזרת כללי הסכום וההפרש.',
      'מעריכים: log_a(f) = c נותן f = a^c. אם בשני הצדדים log באותו בסיס, משווים את מה שבפנים.',
      'בודקים כל פתרון מול התחום. פתרון שנפל מחוץ לתחום הוא שורש זר ונפסל.'],
    generic: 'בדקו שכתבתם תחום, שצמצמתם ללוגריתם אחד, ושכל פתרון נבדק מול התחום.',
  },
  {
    id: 4, label: 'רמה 4: אי־שוויונות ופרמטר', badge: 'אי־שוויונות',
    method: ['תחום קודם. הפתרון הסופי הוא החיתוך של תחום ופתרון האי־שוויון.',
      'בסיס גדול מ־1: הלוגריתם עולה, כיוון האי־שוויון נשמר. בסיס בין 0 ל־1: הלוגריתם יורד, כיוון האי־שוויון מתהפך.',
      'משוואה מעריכית עם בסיסים שונים: לוקחים לוגריתם משני הצדדים, או מציבים t = a^x ופותרים משוואה ריבועית (תמיד t > 0).',
      'פרמטר: מציירים/מנתחים את הצד הלא תלוי בפרמטר ובודקים כמה פעמים הוא נחתך בערך הפרמטר.'],
    generic: 'בדקו: תחום, היפוך סימן בבסיס קטן מ־1, חיתוך סופי עם התחום, ו־t > 0.',
  },
  {
    id: 5, label: 'רמה 5: מעל מבחן', badge: 'מעל מבחן',
    method: ['לוגריתם בתוך לוגריתם: מתחילים מבחוץ, והתחום נבדק בכל שכבה.',
      'משוואה ריבועית בלוגריתם: מציבים t = log_a(x), פותרים t ואז חוזרים ל־x = a^t.',
      'מערכת של שני נעלמים: מאחדים למשוואה אחת עם לוגריתם (מכפלה/מנה), מקבלים קשר בין x ל־y ומציבים.',
      'בסיס משתנה: מפצלים למקרים x > 1 ו־0 < x < 1 (והבסיס חייב להיות חיובי ושונה מ־1).',
      'פונקציה עם לוגריתם: תחום (מה בפנים חיובי), פונקציה הפוכה (מבודדים x), חיתוך עם ישר (משוואה).'],
    generic: 'נתחו את התחום בכל שכבה, פצלו למקרים כשהבסיס משתנה, ובדקו את כל הפתרונות בתחום.',
  },
];

export const DATA_FILES = ['data/logs-lessons.json', 'data/logs-ex-1.json', 'data/logs-ex-2.json', 'data/logs-ex-3.json'];
export const ANSWER_KINDS = ['set', 'number', 'points', 'interval'];
export const CHECK_TYPES = ['value', 'solve', 'ineq', 'domain', 'param', 'system'];

const isArr = Array.isArray;
const isStr = (s) => typeof s === 'string' && s.length > 0;

export function validExercise(e) {
  const a = e && e.answer;
  return !!e && isStr(e.id) && TIERS.some((t) => t.id === e.tier) && isStr(e.title) && isStr(e.ask) && isArr(e.eq) && e.eq.length > 0 &&
    isArr(e.steps) && e.steps.length >= 2 && isArr(e.hints) && e.hints.length === 2 && !!a && ANSWER_KINDS.includes(a.kind) &&
    !!e.check && CHECK_TYPES.includes(e.check.type);
}

export function validLesson(l) {
  return !!l && isStr(l.id) && isStr(l.title) && isArr(l.intuition) && isArr(l.examples) && l.examples.length >= 2 &&
    isArr(l.quiz) && l.quiz.length === 3 && !!l.mistake && isArr(l.rules);
}

let cache = null;
export const resetLogsCache = () => { cache = null; };

/** { ok, lessons, cards, exercises }. Exercises keep file order. */
export async function loadLogsData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, ...cache };
  try {
    const [first, ...rest] = await Promise.all(DATA_FILES.map(async (f) => {
      const res = await fetchFn(f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }));
    if (!first || !isArr(first.lessons) || !isArr(first.cards)) throw new Error('bad lessons file');
    cache = {
      lessons: first.lessons.filter(validLesson),
      cards: first.cards.filter((c) => c && isStr(c.id) && isStr(c.name) && isStr(c.eq)),
      exercises: rest.flatMap((d) => (isArr(d) ? d.filter(validExercise) : [])),
    };
    return { ok: true, ...cache };
  } catch (e) {
    return { ok: false };
  }
}

/* ---------- Leitner state for the rule cards (same boxes as the trig cards, own storage key) ---------- */
export function loadCards(storage = globalThis.localStorage) {
  try { return sanitizeState(JSON.parse(storage.getItem(LOGS_KEY))); } catch (e) { return emptyState(); }
}
export function saveCards(state, storage = globalThis.localStorage) {
  return safeSetItem(LOGS_KEY, JSON.stringify(state), storage);
}

/** Typical-wrong-answer / structural feedback for the hub: how many exercises per tier. */
export const tierCounts = (exercises) => TIERS.map((t) => exercises.filter((e) => e.tier === t.id).length);
