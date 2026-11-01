// Multi-part exam questions (parts א-ה where later parts use earlier results).
// Pure logic (evalFormula, classifyPart, points, sanitize) is DOM-free and shared with tools/verify-multipart.mjs.
// A wrong part whose value equals the part's formula applied to the student's OWN earlier answers is
// "carried forward": the method was right, only an earlier result was off.
import { h } from './dom.js';
import { sanitizeHtml, sanitizeSvg } from './sanitize.js';
import { isolateTitle, isolateFormulasHtml } from './bidi.js';
import { feedbackCard } from './feedback-ui.js';

export const KEY = 'omri-study-multipart-v1';
export const TOL = 0.01;
export const CARRIED_POINTS = 0.5;
export const LETTERS = { a: 'א', b: 'ב', c: 'ג', d: 'ד', e: 'ה', f: 'ו' };
export const CHECKLIST = ['נתונים: כתבתי את כל הנתונים והנעלמים עם יחידות', 'צירים וסימנים: קבעתי כיוון חיובי (y למעלה) ושמתי סימן לכל רכיב',
  'משוואה: כתבתי את הנוסחה לפני שהצבתי מספרים', 'הצבה: הצבתי את הערכים (גם מסעיף קודם) וחישבתי', 'יחידות: ווידאתי שיחידות התשובה נכונות ושהיא הגיונית'];

/* ---------- formula evaluation (no eval): numbers, names, + - * / ^, unary -, sqrt(), abs(), atand() (degrees), parentheses ---------- */
export function evalFormula(src, vars) {
  const toks = String(src).match(/\d+\.?\d*|[A-Za-z_]\w*|[-+*/^(),]|\S/g) || [];
  let i = 0;
  const peek = () => toks[i];
  const take = (t) => { if (t != null && toks[i] !== t) throw new Error(`expected ${t} in "${src}"`); return toks[i++]; };
  function atom() {
    const t = take();
    if (t === undefined) throw new Error(`unexpected end in "${src}"`);
    if (/^\d/.test(t)) return Number(t);
    if (t === '(') { const v = expr(); take(')'); return v; }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        take('(');
        const v = expr();
        take(')');
        if (t === 'sqrt') return Math.sqrt(v);
        if (t === 'abs') return Math.abs(v);
        if (t === 'atand') return (Math.atan(v) * 180) / Math.PI; // angle in degrees
        throw new Error(`unknown function ${t}`);
      }
      if (!Object.prototype.hasOwnProperty.call(vars, t) || !Number.isFinite(vars[t])) throw new Error(`unknown variable ${t}`);
      return vars[t];
    }
    throw new Error(`bad token ${t}`);
  }
  function unary() { if (peek() === '-') { take(); return -unary(); } return power(); }
  function power() { const b = atom(); if (peek() === '^') { take(); return Math.pow(b, unary()); } return b; }
  function term() {
    let v = unary();
    while (peek() === '*' || peek() === '/') v = take() === '*' ? v * unary() : v / unary();
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  }
  const out = expr();
  if (i < toks.length) throw new Error(`trailing "${toks[i]}" in "${src}"`);
  return out;
}

/** Names of earlier parts used by a formula (single lowercase letters a-f that are part ids, not given names). */
export function formulaRefs(formula, partIds) {
  return [...new Set((String(formula).match(/[A-Za-z_]\w*/g) || []).filter((n) => partIds.includes(n)))];
}

const close = (x, y, tol = TOL) => Math.abs(x - y) <= tol + 1e-9;

/**
 * Classifies a typed answer for part `p` of question `q`. `mine` maps earlier part id -> the student's number
 * (missing/null = skipped). Returns 'correct' | 'carried' | 'wrong'.
 */
export function classifyPart(q, p, value, mine = {}) {
  if (!Number.isFinite(value)) return 'wrong';
  if (close(value, p.answer)) return 'correct';
  const vars = { ...q.given };
  let differs = false;
  for (const id of p.uses) {
    const t = q.parts.find((x) => x.id === id);
    const own = Number.isFinite(mine[id]) ? mine[id] : t.answer;
    if (!close(own, t.answer)) differs = true;
    vars[id] = own;
  }
  if (!differs) return 'wrong';
  let expected;
  try { expected = evalFormula(p.formula, vars); } catch (e) { return 'wrong'; }
  return Number.isFinite(expected) && close(value, expected) ? 'carried' : 'wrong';
}

export const pointsOf = (statuses) => Object.values(statuses).reduce((s, x) => s + (x === 'correct' ? 1 : x === 'carried' ? CARRIED_POINTS : 0), 0);

/** "12", "-0.75", "3,5", "−4" -> number; anything else -> NaN. */
export function parseNumber(s) {
  const t = String(s ?? '').trim().replace(/[−–]/g, '-').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export function validQuestion(q) {
  return q && typeof q.id === 'string' && typeof q.stem === 'string' && q.given && typeof q.given === 'object'
    && Array.isArray(q.parts) && q.parts.length >= 2
    && q.parts.every((p) => p && typeof p.id === 'string' && typeof p.ask === 'string' && Number.isFinite(p.answer)
      && Array.isArray(p.uses) && typeof p.formula === 'string' && (typeof p.solution === 'string' || (Array.isArray(p.solution) && p.solution.length > 0 && p.solution.every((x) => typeof x === 'string'))));
}

/* ---------- saved attempts: { v:1, items: { id: { attempts, best, last: {partId: status}, ts } } } ---------- */
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const STATUSES = ['correct', 'carried', 'wrong'];
export function sanitizeSaved(raw) {
  const out = { v: 1, items: {} };
  if (!isRec(raw) || !isRec(raw.items)) return out;
  for (const [id, e] of Object.entries(raw.items)) {
    if (!isRec(e)) continue;
    const last = {};
    if (isRec(e.last)) for (const [k, v] of Object.entries(e.last)) if (STATUSES.includes(v)) last[k] = v;
    out.items[id] = {
      attempts: Number.isFinite(e.attempts) && e.attempts > 0 ? Math.floor(e.attempts) : 0,
      best: Number.isFinite(e.best) && e.best > 0 ? e.best : 0, last, ts: Number.isFinite(e.ts) ? e.ts : 0,
    };
  }
  return out;
}
export function loadSaved() {
  try { return sanitizeSaved(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return sanitizeSaved(null); }
}
export function recordAttempt(id, statuses) {
  const d = loadSaved();
  const it = d.items[id] || (d.items[id] = { attempts: 0, best: 0, last: {}, ts: 0 });
  it.attempts++; it.last = { ...statuses }; it.ts = Date.now();
  it.best = Math.max(it.best, pointsOf(statuses));
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
  return it;
}

/* ---------- views ---------- */
let cache = null;
export const resetMultipartCache = () => { cache = null; };
export async function loadMultipartData(fetchFn = (u, o) => fetch(u, o)) {
  if (cache) return { ok: true, data: cache };
  try {
    const res = await fetchFn('data/multipart.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    if (!Array.isArray(d)) throw new Error('not an array');
    cache = d.filter(validQuestion);
    return { ok: true, data: cache };
  } catch (e) {
    return { ok: false, data: null };
  }
}

const TITLE = '🧮 שאלה בכמה סעיפים';
const rich = (tag, html, attrs = {}) => h(tag, { ...attrs, rawhtml: isolateFormulasHtml(sanitizeHtml(String(html ?? ''))) });
const crumbs = (href = '#/practice-hub', label = '→ חזרה לתרגול') => h('p', { class: 'crumbs' }, h('a', { href }, label));
const stepsOf = (s) => (Array.isArray(s) ? s : [s]);
/** Optional pre-generated SVG (tools/diagrams.mjs) as a sanitized figure, or null. */
function figureEl(svg, label) {
  const clean = typeof svg === 'string' ? sanitizeSvg(svg) : '';
  return clean ? h('figure', { class: 'diagram', role: 'img', 'aria-label': label, html: clean }) : null;
}
const fmt = (n) => String(Math.round(n * 100) / 100);
export const TIERS = [
  { id: 'warmup', label: 'חימום', badge: 'חימום', note: 'שאלות קצרות להתחלה: גוף אחד, 4-5 סעיפים.' },
  { id: 'exam', label: 'רמת מבחן', badge: 'רמת מבחן', note: 'שאלות כמו במבחן המכינה: 5-6 סעיפים שנשענים זה על זה, שני גופים, גרפים וזוויות. מסודרות מהקל אל הקשה: השאלה האחרונה היא הקשה ביותר.' },
];
/** Questions without a tier field are warm-up. */
export const tierOf = (q) => (q && q.tier === 'exam' ? 'exam' : 'warmup');
const GIVEN_LABELS = { v0: ['v₀', "מ'/ש"], h0: ['h₀', "מ'"], H: ['H', "מ'"], t1: ['t', "ש'"], g: ['g', "מ'/ש²"] };

export async function viewMultipart(ctx, id) {
  document.title = 'שאלה בכמה סעיפים – Brain Gains';
  ctx.show(crumbs(), h('h1', {}, TITLE), h('p', { class: 'muted', role: 'status' }, 'טוען…'));
  const res = await loadMultipartData(ctx.fetchFn);
  if (!res.ok) {
    return ctx.show(crumbs(), h('h1', {}, TITLE),
      h('p', { class: 'error', role: 'alert' }, 'לא ניתן לטעון את השאלות. בדקו את החיבור לאינטרנט (או פתחו פעם אחת עם חיבור כדי לשמור לשימוש לא מקוון) ונסו שוב.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => viewMultipart(ctx, id) }, 'נסו שוב')));
  }
  const q = id ? res.data.find((x) => x.id === id) : null;
  return q ? runQuestion(ctx, res.data, q) : list(ctx, res.data);
}

function list(ctx, data) {
  const saved = loadSaved().items;
  ctx.show(crumbs(), h('h1', {}, TITLE),
    h('p', { class: 'muted' }, 'שאלות מבחן ארוכות: כל סעיף נשען על תוצאות של סעיפים קודמים. טעות שעוברת הלאה מקבלת קרדיט על השיטה.'),
    ...TIERS.map((tier) => {
      const items = data.filter((x) => tierOf(x) === tier.id);
      if (!items.length) return null;
      return h('section', { 'aria-label': tier.label },
        h('h2', {}, tier.label), h('p', { class: 'muted' }, tier.note),
        h('ul', { class: 'ex-list' }, items.map((x) => {
          const s = saved[x.id];
          const full = s && s.best >= x.parts.length;
          return h('li', {}, h('a', { class: 'ex-item', href: `#/multipart/${x.id}` },
            h('span', { class: 't' }, isolateTitle(x.title || x.id)),
            h('span', { class: 'muted' }, `${tier.badge} · ${x.parts.length} סעיפים`),
            h('span', { class: `tick o-${full ? 'alone' : 'none'}`, role: 'img', 'aria-label': s ? `שיא ${fmt(s.best)} מתוך ${x.parts.length}` : 'טרם נפתר' },
              s ? `${fmt(s.best)}/${x.parts.length}` : '○')));
        })));
    }));
}

function givensLine(q) {
  const items = [];
  for (const [k, v] of Object.entries(q.given)) {
    if (k === 'sin' || k === 'cos') continue;
    const [sym, unit] = (q.givenLabels && q.givenLabels[k]) || GIVEN_LABELS[k] || [k, ''];
    items.push(h('span', { dir: 'ltr', class: 'chip' }, `${sym} = ${v}${unit ? ' ' + unit : ''}`));
  }
  return h('p', {}, h('strong', {}, 'נתונים: '), items.flatMap((x, i) => (i ? [' ', x] : [x])));
}

function runQuestion(ctx, data, q) {
  document.title = `${isolateTitle(q.title || q.id)} – Brain Gains`;
  const next = data[data.indexOf(q) + 1];
  const mine = {}; // part id -> student's number (or null when skipped)
  const statuses = {};
  const t0 = Date.now();
  const ticked = new Set();
  const tickStatus = h('span', { class: 'muted', 'aria-live': 'polite' }, `סומנו 0 מתוך ${CHECKLIST.length}`);
  const checklist = h('section', { class: 'panel', 'aria-label': 'רשימת בדיקה למבנה התשובה' },
    h('strong', {}, 'לפני שמגישים סעיף: מבנה תשובה (סימון עצמי)'),
    h('ul', { class: 'ex-list' }, CHECKLIST.map((text, i) => h('li', {},
      h('label', { style: 'display:flex;gap:10px;align-items:center;min-height:44px' },
        h('input', {
          type: 'checkbox', style: 'width:22px;height:22px',
          onchange: (ev) => { if (ev.target.checked) ticked.add(i); else ticked.delete(i); tickStatus.textContent = `סומנו ${ticked.size} מתוך ${CHECKLIST.length}`; },
        }), text)))),
    tickStatus);
  const partsBox = h('div');
  const summaryBox = h('div', { 'aria-live': 'polite' });

  const partEls = [];
  function revealPart(i) {
    const p = q.parts[i];
    const input = h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', autocomplete: 'off', 'aria-label': `תשובה לסעיף ${LETTERS[p.id] || p.id}`, style: 'min-height:44px;width:8em' });
    const out = h('div', { 'aria-live': 'polite' });
    const uses = p.uses.length ? h('p', { class: 'muted' }, `נשען על סעיף: ${p.uses.map((u) => LETTERS[u] || u).join(', ')}`) : null;
    const checkBtn = h('button', { class: 'btn primary', type: 'button', style: 'min-height:44px' }, 'בדיקה');
    const skipBtn = h('button', { class: 'btn', type: 'button', style: 'min-height:44px' }, 'אין לי תשובה: הציגו פתרון');
    const box = h('section', { class: 'panel', 'aria-label': `סעיף ${LETTERS[p.id] || p.id}` },
      h('p', {}, h('strong', {}, `${LETTERS[p.id] || p.id}. `), rich('span', p.ask)), uses,
      h('div', { class: 'btn-row' }, input, p.unit ? h('span', { class: 'muted' }, p.unit) : null, checkBtn, skipBtn), out);

    function finishPart(status, value) {
      statuses[p.id] = status;
      mine[p.id] = value;
      input.disabled = true; checkBtn.disabled = true; skipBtn.disabled = true;
      const msg = {
        correct: ['ok', 'נכון!'],
        carried: ['ok', `שגיאה מועברת: השיטה נכונה. הערך שהצבתם מסעיף קודם שגוי, ובהצבתו הגעתם לתוצאה נכונה לפיו. התשובה הנכונה: ${fmt(p.answer)}${p.unit ? ' ' + p.unit : ''} (ניקוד חלקי).`],
        wrong: ['bad', value == null ? 'הנה הפתרון.' : 'לא מדויק. ראו את הפתרון.'],
      }[status];
      out.replaceChildren(h('div', { class: `feedback ${msg[0]}`, role: status === 'wrong' ? 'alert' : 'status' }, msg[1]));
      if (status !== 'correct') out.append(h('div', { class: 'panel' }, h('strong', {}, 'פתרון: '), ...stepsOf(p.solution).map((st) => h('div', { steps: st })), figureEl(p.diagram, `סרטוט הפתרון לסעיף ${LETTERS[p.id] || p.id}`),
        h('p', { dir: 'ltr', class: 'muted' }, `${LETTERS[p.id] || p.id} = ${fmt(p.answer)}${p.unit ? ' ' + p.unit : ''}`)));
      if (i + 1 < q.parts.length) revealPart(i + 1); else finish();
    }
    checkBtn.addEventListener('click', () => {
      const v = parseNumber(input.value);
      if (!Number.isFinite(v)) { out.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'יש להקליד מספר (למשל 12, -0.75 או 3.5).')); return; }
      finishPart(classifyPart(q, p, v, mine), v);
    });
    skipBtn.addEventListener('click', () => finishPart('wrong', null));
    partEls.push(box);
    partsBox.append(box);
  }

  function finish() {
    recordAttempt(q.id, statuses);
    const pts = pointsOf(statuses);
    const last = q.parts[q.parts.length - 1];
    const finalOk = statuses[last.id] === 'correct';
    summaryBox.replaceChildren(
      h('div', { class: `feedback ${pts === q.parts.length ? 'ok' : 'bad'}`, role: 'status' },
        `${fmt(pts)} מתוך ${q.parts.length} נקודות. התשובה הסופית ${finalOk ? 'נכונה' : statuses[last.id] === 'carried' ? 'שגויה, אך השיטה נכונה (שגיאה מועברת)' : 'שגויה'}.`),
      h('p', { class: 'muted' }, 'פירוט: ' + q.parts.map((p) => `${LETTERS[p.id] || p.id} ${{ correct: '✓', carried: '≈ שיטה', wrong: '✗' }[statuses[p.id]]}`).join(' · ')),
      feedbackCard({
        exerciseId: q.id, topic: 'physics', mode: 'multipart', attemptId: t0,
        context: () => ({ correct: pts === q.parts.length, hintsUsed: 0, solutionViewed: q.parts.some((p) => statuses[p.id] !== 'correct'), secondsSpent: Math.round((Date.now() - t0) / 1000) }),
      }),
      h('div', { class: 'btn-row' },
        next ? h('a', { class: 'btn primary', href: `#/multipart/${next.id}` }, 'השאלה הבאה ←') : null,
        h('a', { class: 'btn', href: '#/multipart' }, 'לרשימת השאלות')));
  }

  revealPart(0);
  ctx.show(crumbs('#/multipart', '→ לרשימת השאלות'), h('h1', {}, isolateTitle(q.title || q.id)),
    rich('p', q.stem), figureEl(q.diagram, q.title || q.id), givensLine(q), checklist, partsBox, summaryBox);
}
