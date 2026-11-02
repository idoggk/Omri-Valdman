// #/mathhard logic: expression parser (no eval), relation chains, exact-answer canonical forms (sets, points,
// intervals with open/closed ends and unions), grading, wrong-answer diagnosis and saved progress. No DOM.
// Shared by js/mathhard-ui.js, tools/verify-mathhard.mjs and tests/mathhard.test.mjs.
import { normalize } from './check.js';

export const KEY = 'omri-study-mathhard-v1';
export const EPS = 1e-9;
export const TOL = 1e-6;

export const TIERS = [
  { id: 1, label: 'רמת שיעורי בית', badge: 'שיעורי בית' },
  { id: 2, label: 'קשה יותר', badge: 'קשה יותר' },
  { id: 3, label: 'מעבר לרמת מבחן', badge: 'מעל מבחן' },
];

export const FAMILIES = [
  {
    id: 'radical', title: 'משוואות ואי־שוויונות עם שורשים', icon: '√',
    method: ['מתחילים בתחום: כל ביטוי מתחת לשורש ≥ 0 (ובמכנה ≠ 0).',
      'מבודדים שורש אחד, ואז מעלים בריבוע. אם יש שני שורשים: מבודדים, מעלים בריבוע, ושוב מבודדים.',
      'ביטוי חוזר (x² + 5x, או x³)? מציבים t ופותרים בנפרד. אל תשכחו לחזור ל־x.',
      'הרמה בריבוע יוצרת שורשים זרים: חובה להציב כל פתרון חזרה במשוואה המקורית, או לבדוק שהצד עם השורש לא שלילי.'],
    generic: 'בדקו שלושה דברים: תחום, הצבה חזרה במשוואה המקורית, ושלא איבדתם פתרון בחילוק.',
  },
  {
    id: 'exponent', title: 'משוואות ואי־שוויונות מעריכיים', icon: 'aˣ',
    method: ['מביאים הכול לאותו בסיס (8 = 2³, 0.25 = 2⁻²) ומשווים מעריכים.',
      'בסיסים שונים שלא מתאחדים? מציבים t = aˣ ופותרים משוואה ריבועית. תמיד t > 0, ולכן פתרון t ≤ 0 נפסל.',
      'בסיס בין 0 ל־1 הופך את כיוון אי־השוויון כשעוברים למעריכים. בסיס גדול מ־1 משאיר.',
      'מעריך עם מכנה (x−3)/(3x−7): התחום הוא מכנה ≠ 0, ולא מחלקים במשתנה בלי לבדוק.'],
    generic: 'בדקו: בסיס אחד לכל הצדדים, t > 0, והאם הבסיס קטן מ־1 (היפוך סימן).',
  },
  {
    id: 'rational', title: 'אי־שוויונות רציונליים', icon: '÷',
    method: ['מעבירים הכול לצד אחד ומביאים למכנה משותף. לא מכפילים במכנה: הוא יכול להיות שלילי.',
      'מפרקים לגורמים, ומסמנים על ציר את כל האפסים של המונה והמכנה.',
      'טבלת סימנים: גורם בריבוע לא מחליף סימן. אפס של מונה נכלל רק באי־שוויון חלש. אפס של מכנה לא נכלל לעולם.',
      'שרשרת A ≤ B ≤ C: פותרים שתי אי־שוויונות בנפרד וחותכים את הפתרונות.'],
    generic: 'בדקו: מכנה משותף, טבלת סימנים, סוגריים עגולים בכל אפס של מכנה, וחיתוך בין שני החלקים בשרשרת.',
  },
  {
    id: 'param', title: 'משוואות עם פרמטר', icon: 'm',
    method: ['מזהים מתי המשוואה "משנה אופי": המקדם של x² מתאפס (המשוואה הופכת לליניארית) או מכנה מתאפס.',
      'משוואה ריבועית: Δ = b² − 4ac. Δ > 0: שני פתרונות, Δ = 0: פתרון אחד, Δ < 0: אין פתרון.',
      'ביטוי עם מכנה: בודקים אם פתרון נופל על הערך האסור, ואז הוא נפסל.',
      'כותבים את המקרים בנפרד (m = ..., m < ..., m > ...) ובסוף מחברים.'],
    generic: 'בדקו את המקרה המיוחד שבו מקדם x² מתאפס, את Δ, ואת הפתרונות שנפסלים בגלל מכנה.',
  },
  {
    id: 'circle', title: 'מעגלים ומערכות אנליטיות', icon: '◯',
    method: ['שני מעגלים: מחסרים את המשוואות הכלליות (x² + y² + ...). מתקבל ישר, ואז מציבים באחד המעגלים.',
      'מעגל וישר: מבודדים y (או x) מהישר ומציבים במעגל. Δ קובע כמה נקודות חיתוך יש.',
      'משיק: נקודה אחת בדיוק, כלומר Δ = 0, או מרחק מהמרכז לישר = רדיוס.',
      'מבדיקים כל נקודה בשתי המשוואות. אל תשכחו את הערך השני של y לכל x.'],
    generic: 'בדקו: האם צמדתם ל־x את ה־y הנכון, האם יש שתי נקודות, והאם כל נקודה מקיימת את שתי המשוואות.',
  },
];

/* ---------- expressions ---------- */
const TOKEN = /\d+\.?\d*|\.\d+|sqrt|cbrt|abs|[a-z]|[-+*/^()]/y;
const FN = { sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs };

/** Compiles an expression into (vars) => number. Variables are single letters; implicit multiplication is allowed. Throws on bad syntax. */
export function compileExpr(src) {
  const raw = String(src);
  let s = normalize(raw).replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt').replace(/[·×⋅]/g, '*')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4').replace(/\|([^|]+)\|/g, 'abs($1)');
  // "sqrt3" / "sqrtx" -> sqrt(3): wrap a bare argument
  s = s.replace(/(sqrt|cbrt)(\d+(?:\.\d+)?|[a-z](?![a-z]))/g, '$1($2)');
  const toks = [];
  let i = 0;
  while (i < s.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(s);
    if (!m) throw new Error(`bad character "${s[i]}" in "${raw}"`);
    toks.push(m[0]);
    i = TOKEN.lastIndex;
  }
  let p = 0;
  const peek = () => toks[p];
  const take = (t) => { if (t != null && toks[p] !== t) throw new Error(`expected ${t} in "${raw}"`); return toks[p++]; };
  const startsAtom = () => { const t = toks[p]; return t != null && (/^[\d.a-z]/.test(t) || t === '('); };
  function atom() {
    const t = take();
    if (t === undefined) throw new Error(`unexpected end in "${raw}"`);
    if (/^[\d.]/.test(t)) { const v = Number(t); return () => v; }
    if (t === '(') { const e = expr(); take(')'); return e; }
    if (FN[t]) { take('('); const e = expr(); take(')'); const f = FN[t]; return (vars) => f(e(vars)); }
    if (/^[a-z]$/.test(t)) return (vars) => (vars && Object.prototype.hasOwnProperty.call(vars, t) ? vars[t] : NaN);
    throw new Error(`bad token ${t} in "${raw}"`);
  }
  function power() { const b = atom(); if (peek() === '^') { take(); const e = unary(); return (v) => Math.pow(b(v), e(v)); } return b; }
  function unary() { if (peek() === '-') { take(); const e = unary(); return (v) => -e(v); } if (peek() === '+') { take(); return unary(); } return power(); }
  function term() {
    let l = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') { const op = take(); const r = unary(); const a = l; l = op === '*' ? (v) => a(v) * r(v) : (v) => a(v) / r(v); }
      else if (startsAtom()) { const r = power(); const a = l; l = (v) => a(v) * r(v); }
      else return l;
    }
  }
  function expr() {
    let l = term();
    while (peek() === '+' || peek() === '-') { const op = take(); const r = term(); const a = l; l = op === '+' ? (v) => a(v) + r(v) : (v) => a(v) - r(v); }
    return l;
  }
  const fn = expr();
  if (p < toks.length) throw new Error(`trailing "${toks[p]}" in "${raw}"`);
  return fn;
}

export const evalExact = (src, vars = {}) => compileExpr(src)(vars);

/** "a = b", "a ≤ b ≤ c": { sides: [fn], ops: ['=','<=',...] }. */
export function parseRelation(str) {
  const parts = String(str).replace(/≤/g, '<=').replace(/≥/g, '>=').split(/(<=|>=|<|>|=)/);
  const sides = [];
  const ops = [];
  parts.forEach((x, i) => { if (i % 2) ops.push(x); else sides.push(compileExpr(x)); });
  if (!ops.length) throw new Error(`no relation in "${str}"`);
  return { sides, ops };
}

/** Does the relation chain hold at vars? Undefined (non-finite) values make it false; equality and non-strict ends use a 1e-9 tolerance. */
export function holds(rel, vars) {
  const vals = rel.sides.map((f) => f(vars));
  if (!vals.every(Number.isFinite)) return false;
  return rel.ops.every((op, i) => {
    const a = vals[i];
    const b = vals[i + 1];
    const tol = EPS * (1 + Math.abs(a) + Math.abs(b));
    if (op === '=') return Math.abs(a - b) <= tol;
    if (op === '<=') return a <= b + tol;
    if (op === '>=') return a >= b - tol;
    if (op === '<') return a < b - tol;
    return a > b + tol;
  });
}

/* ---------- intervals ---------- */
export function parseEndpoint(s) {
  const t = normalize(s).replace(/^\+/, '');
  if (/^(inf|infinity|oo|∞)$/i.test(t)) return Infinity;
  if (/^-(inf|infinity|oo|∞)$/i.test(t)) return -Infinity;
  const v = evalExact(t);
  if (!Number.isFinite(v)) throw new Error(`bad endpoint "${s}"`);
  return v;
}

const near = (a, b) => (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= TOL * (1 + Math.abs(a) + Math.abs(b)));

/** "(-inf,-1] U [4,inf)", "{3}", "empty" -> [{lo,hi,lc,hc}] (not yet merged). */
export function parseIntervals(text) {
  const t = String(text ?? '').trim();
  if (!t || /^(empty|∅)$/i.test(t)) return [];
  return t.split(/\s*(?:∪|U)\s*/).map((piece) => {
    const one = /^\{(.+)\}$/.exec(piece.trim());
    if (one) { const v = parseEndpoint(one[1]); return { lo: v, hi: v, lc: true, hc: true }; }
    const r = /^([([])\s*(.+?)\s*,\s*(.+?)\s*([)\]])$/.exec(piece.trim());
    if (!r) throw new Error(`bad interval "${piece}"`);
    const lo = parseEndpoint(r[2]);
    const hi = parseEndpoint(r[3]);
    return { lo, hi, lc: r[1] === '[' && Number.isFinite(lo), hc: r[4] === ']' && Number.isFinite(hi) };
  });
}

/** Sorts, drops empty parts and merges overlapping / touching ones into the canonical union. */
export function normUnion(list) {
  const parts = list.filter((p) => p.lo < p.hi || (near(p.lo, p.hi) && p.lc && p.hc)).map((p) => ({ ...p }));
  parts.sort((a, b) => (near(a.lo, b.lo) ? (b.lc ? 1 : 0) - (a.lc ? 1 : 0) : a.lo - b.lo));
  const out = [];
  for (const p of parts) {
    const c = out[out.length - 1];
    if (c && (p.lo < c.hi && !near(p.lo, c.hi) || (near(p.lo, c.hi) && (c.hc || p.lc)))) {
      if (p.hi > c.hi && !near(p.hi, c.hi)) { c.hi = p.hi; c.hc = p.hc; } else if (near(p.hi, c.hi)) c.hc = c.hc || p.hc;
    } else out.push(p);
  }
  return out;
}

export function inUnion(parts, x) {
  return parts.some((p) => (x > p.lo + EPS || (p.lc && x >= p.lo - EPS)) && (x < p.hi - EPS || (p.hc && x <= p.hi + EPS)));
}

/** The gaps of a canonical union inside the real line. */
export function complementUnion(parts) {
  const out = [];
  let lo = -Infinity;
  let lc = false;
  for (const p of parts) {
    out.push({ lo, hi: p.lo, lc, hc: !p.lc });
    lo = p.hi; lc = !p.hc;
  }
  out.push({ lo, hi: Infinity, lc, hc: false });
  return normUnion(out);
}

/* ---------- answers ---------- */
const uniqSorted = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return s.filter((v, i) => i === 0 || !near(v, s[i - 1]));
};

/** Answer spec (from data) -> canonical numeric form. kinds: set {values}, number {value}, points {points}, interval {text}. */
export function canonSpec(a) {
  if (a.kind === 'set') return { kind: 'set', vals: uniqSorted(a.values.map((v) => evalExact(v))) };
  if (a.kind === 'number') return { kind: 'number', vals: [evalExact(a.value)] };
  if (a.kind === 'points') return { kind: 'points', pts: canonPoints(a.points.map((p) => p.map((v) => evalExact(v)))) };
  if (a.kind === 'interval') return { kind: 'interval', parts: normUnion(parseIntervals(a.text)) };
  throw new Error(`unknown answer kind ${a && a.kind}`);
}

export function canonPoints(pts) {
  const s = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return s.filter((p, i) => i === 0 || !(near(p[0], s[i - 1][0]) && near(p[1], s[i - 1][1])));
}

export function sameCanon(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'set' || a.kind === 'number') return a.vals.length === b.vals.length && a.vals.every((v, i) => near(v, b.vals[i]));
  if (a.kind === 'points') return a.pts.length === b.pts.length && a.pts.every((p, i) => near(p[0], b.pts[i][0]) && near(p[1], b.pts[i][1]));
  return a.parts.length === b.parts.length && a.parts.every((p, i) => {
    const q = b.parts[i];
    return near(p.lo, q.lo) && near(p.hi, q.hi) && (!Number.isFinite(p.lo) || p.lc === q.lc) && (!Number.isFinite(p.hi) || p.hc === q.hc);
  });
}

const cell = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return { blank: true };
  try { const v = evalExact(t); if (Number.isFinite(v)) return { v }; } catch (e) { /* fall through */ }
  return { bad: t };
};

/**
 * Student input -> { ok, canon } or { ok:false, error }.
 * input: { none?: true, rows: set/number: [string] | points: [[x,y]] | interval: [{lc,lo,hi,hc}] }.
 */
export function studentCanon(kind, input) {
  const rows = (input && input.rows) || [];
  const none = !!(input && input.none);
  const bad = (t) => ({ ok: false, error: `לא הצלחנו לקרוא את "${t}". כתבו מספר, שבר (3/4) או שורש (sqrt(7) או √7).` });
  if (kind === 'number') {
    const c = cell(rows[0]);
    if (c.blank) return { ok: false, error: 'יש להקליד מספר.' };
    if (c.bad) return bad(c.bad);
    return { ok: true, canon: { kind, vals: [c.v] } };
  }
  if (kind === 'set') {
    if (none) return { ok: true, canon: { kind, vals: [] } };
    const vals = [];
    for (const r of rows) { const c = cell(r); if (c.bad) return bad(c.bad); if (!c.blank) vals.push(c.v); }
    if (!vals.length) return { ok: false, error: 'הזינו לפחות פתרון אחד, או לחצו "אין פתרון".' };
    return { ok: true, canon: { kind, vals: uniqSorted(vals) } };
  }
  if (kind === 'points') {
    if (none) return { ok: true, canon: { kind, pts: [] } };
    const pts = [];
    for (const r of rows) {
      const cs = [cell(r[0]), cell(r[1])];
      if (cs.every((c) => c.blank)) continue;
      const b = cs.find((c) => c.bad);
      if (b) return bad(b.bad);
      if (cs.some((c) => c.blank)) return { ok: false, error: 'בכל נקודה יש למלא גם x וגם y.' };
      pts.push([cs[0].v, cs[1].v]);
    }
    if (!pts.length) return { ok: false, error: 'הזינו לפחות נקודה אחת, או לחצו "אין פתרון".' };
    return { ok: true, canon: { kind, pts: canonPoints(pts) } };
  }
  if (kind === 'interval') {
    if (none) return { ok: true, canon: { kind, parts: [] } };
    const parts = [];
    for (const r of rows) {
      const blank = !String(r.lo ?? '').trim() && !String(r.hi ?? '').trim();
      if (blank) continue;
      let lo;
      let hi;
      try { lo = parseEndpoint(r.lo); } catch (e) { return bad(r.lo); }
      try { hi = parseEndpoint(r.hi); } catch (e) { return bad(r.hi); }
      parts.push({ lo, hi, lc: !!r.lc && Number.isFinite(lo), hc: !!r.hc && Number.isFinite(hi) });
    }
    if (!parts.length) return { ok: false, error: 'הזינו קטע אחד לפחות, או לחצו "אין פתרון".' };
    if (parts.some((p) => p.lo > p.hi)) return { ok: false, error: 'בכל קטע הקצה השמאלי חייב להיות קטן מהימני (כותבים מהקטן אל הגדול).' };
    return { ok: true, canon: { kind, parts: normUnion(parts) } };
  }
  return { ok: false, error: 'סוג תשובה לא מוכר.' };
}

/** Why was it wrong? Matches the exercise's listed typical wrong answers, then falls back to structural diagnosis. */
export function diagnose(ex, got, want, family) {
  for (const w of ex.wrongs || []) {
    let c = null;
    try { c = canonSpec(w.answer); } catch (e) { c = null; }
    if (c && sameCanon(c, got)) return w.msg;
  }
  if ((got.kind === 'set' || got.kind === 'number') && want.kind === got.kind) {
    const extra = got.vals.filter((v) => !want.vals.some((w) => near(v, w)));
    const missing = want.vals.filter((w) => !got.vals.some((v) => near(v, w)));
    if (extra.length && !missing.length) return 'הוספתם ערך שאינו פתרון. בדקו הצבה חזרה במשוואה המקורית ואת התחום: כנראה שורש זר.';
    if (missing.length && !extra.length) return 'חסר פתרון. בדקו שלא חילקתם בביטוי שיכול להתאפס, ושלא פסלתם ערך שמתאים.';
  }
  if (got.kind === 'interval' && want.kind === 'interval') {
    const flip = complementUnion(want.parts);
    if (sameCanon({ kind: 'interval', parts: flip }, got)) return 'קיבלתם את המשלים של הפתרון: כנראה שכחתם להפוך את כיוון אי־השוויון (בסיס קטן מ־1, הכפלה או חילוק בביטוי שלילי) או שטעיתם בסימן בטבלה.';
    if (got.parts.length === want.parts.length && got.parts.every((p, i) => near(p.lo, want.parts[i].lo) && near(p.hi, want.parts[i].hi))) {
      return 'הקצוות נכונים, אבל הסוגריים לא: עגול כשהערך אסור או אי־השוויון חזק, מרובע כשהערך מקיים את אי־השוויון ונמצא בתחום.';
    }
  }
  return family ? family.generic : 'בדקו את התחום, את ההצבה חזרה ואת חישוב השלבים.';
}

/* ---------- display ---------- */
const nice = (s) => String(s).replace(/inf\b/g, '∞').replace(/\bU\b/g, '∪').replace(/sqrt\((\d+)\)/g, '√$1').replace(/sqrt\(/g, '√(')
  .replace(/cbrt\((\d+)\)/g, '∛$1').replace(/cbrt\(/g, '∛(').replace(/\*/g, '·').replace(/-/g, '−');

export function prettyAnswer(a, v = 'x') {
  if (a.kind === 'set') return a.values.length ? `${v} ∈ { ${a.values.map(nice).join(' ,  ')} }` : 'אין פתרון';
  if (a.kind === 'number') return `${v} = ${nice(a.value)}`;
  if (a.kind === 'points') return a.points.length ? a.points.map((p) => `(${p.map(nice).join(' ,  ')})`).join('   ') : 'אין פתרון';
  return a.text.trim() && a.text !== 'empty' ? `${v} ∈ ${nice(a.text)}` : 'אין פתרון';
}

export const prettyExpr = nice;

/* ---------- validation of one exercise record ---------- */
export function validExercise(e) {
  const a = e && e.answer;
  return !!e && typeof e.id === 'string' && FAMILIES.some((f) => f.id === e.family) && TIERS.some((t) => t.id === e.tier) &&
    typeof e.title === 'string' && typeof e.ask === 'string' && Array.isArray(e.eq) && e.eq.length > 0 &&
    Array.isArray(e.steps) && e.steps.length > 0 && Array.isArray(e.hints) && e.hints.length === 2 &&
    !!a && ['set', 'number', 'points', 'interval'].includes(a.kind);
}

/* ---------- saved progress ---------- */
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nn = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function sanitizeSaved(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e) || id.length > 80) continue;
    out.items[id] = { attempts: nn(e.attempts), solved: e.solved === true, alone: e.alone === true, hints: nn(e.hints), ts: Number.isFinite(e.ts) ? e.ts : 0 };
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return sanitizeSaved(null); }
}
/** attempt = { solved, hints, wrongs } for one visit; "alone" = solved with no hints and no wrong tries. */
export function recordAttempt(id, attempt, storage = globalThis.localStorage, now = Date.now()) {
  const d = loadSaved(storage);
  const it = d.items[id] || (d.items[id] = { attempts: 0, solved: false, alone: false, hints: 0, ts: 0 });
  it.attempts += 1;
  it.solved = it.solved || attempt.solved === true;
  it.alone = it.alone || (attempt.solved === true && !attempt.hints && !attempt.wrongs);
  it.hints = nn(attempt.hints);
  it.ts = now;
  try { storage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
  return it;
}

let cache = null;
export const resetMathHardCache = () => { cache = null; };
export const DATA_FILES = ['radical', 'exponent', 'rational', 'param', 'circle'].map((f) => `data/mathhard-${f}.json`);
export async function loadMathHardData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const parts = await Promise.all(DATA_FILES.map(async (f) => {
      const res = await fetchFn(f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (!Array.isArray(d)) throw new Error('not an array');
      return d.filter(validExercise);
    }));
    cache = parts.flat();
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}
