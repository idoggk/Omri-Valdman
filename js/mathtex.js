// Converts the plain-text / small-HTML equation strings of the data (values of eqblocks 'eq' blocks) to TeX. No DOM.
// Anything not understood returns null, so callers keep the existing plain-text rendering.
// Hebrew words and units are not TeX (KaTeX has no Hebrew fonts): plainToParts splits them out as 'he' parts.

const OPEN = '\ue001';
const CLOSE = '\ue002';
const SUP_MARK = '\ue003';
const SUB_MARK = '\ue004';
const END_MARK = '\ue005';

const SUB_CHARS = '₀₁₂₃₄₅₆₇₈₉ₓᵧₙᵣⱼₐₑ';
const SUB_PLAIN = '0123456789xynrjae';
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const FUNCS = new Set(['tan', 'sin', 'cos', 'max', 'min', 'log', 'ln', 'cot']);
const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', θ: 'theta', λ: 'lambda', μ: 'mu', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'varphi', ω: 'omega', Δ: 'Delta', Σ: 'Sigma', Ω: 'Omega' };
const OPS = {
  '·': ' \\cdot ', '×': ' \\times ', '*': ' \\cdot ', '÷': ' \\div ', '−': '-', '–': '-', '≤': ' \\le ', '≥': ' \\ge ', '≠': ' \\ne ',
  '≈': ' \\approx ', '±': ' \\pm ', '∓': ' \\mp ', '°': '^{\\circ}', '→': ' \\to ', '∞': ' \\infty ', '⟹': ' \\Longrightarrow ', '⇒': ' \\Rightarrow ', '✓': '\\checkmark ', '%': '\\%',
  '½': '\\frac{1}{2}', '¼': '\\frac{1}{4}', '¾': '\\frac{3}{4}', '²': '^{2}', '³': '^{3}',
};
const HE = '[א-ת]';
const HE_RUN = new RegExp(`${HE}(?:[א-ת'׳"״/²³]|\\^${OPEN}[0-9]${CLOSE})*(?:\\s+${HE}(?:[א-ת'׳"״/²³])*)*`, 'g');
const ALLOWED = new RegExp(`^[A-Za-z0-9 .,;:!?'()\\[\\]=<>+\\-/|^_${OPEN}${CLOSE}·×*÷−–≤≥≠≈±∓°→∞√½¼¾²³⟹⇒✓${Object.keys(GREEK).join('')}]*$`);
const FRAC_BEFORE = /(?:^|[=+\-(\[,;<>]|\\(?:le|ge|ne|approx|pm|to))\s*$/;
const ATOM_LEFT = /(\d+(?:\.\d+)?|[A-Za-z](?:_\{[^{}]*\})?(?:\^\{[^{}]*\})?)\s*$/;
const ATOM_RIGHT = /^\s*(\d+(?:\.\d+)?|[A-Za-z](?:_\{[^{}]*\})?(?:\^\{[^{}]*\})?)/;

const ENT = { lt: '<', gt: '>', amp: '&', nbsp: ' ' };

/** HTML subset (sub, sup, entities) -> text with markers; null for anything else. */
function linearize(input) {
  let s = String(input ?? '').replace(/[\u2066-\u2069\u200e\u200f]/g, '');
  if (/<(?!\/?su[bp]>)/i.test(s.replace(/&lt;/g, ''))) return null;
  s = s.replace(/<sup>/gi, SUP_MARK).replace(/<sub>/gi, SUB_MARK).replace(/<\/su[bp]>/gi, END_MARK);
  s = s.replace(/&#?\w+;/g, (m) => {
    const name = m.slice(1, -1);
    if (name in ENT) return ENT[name];
    const code = name[0] === '#' ? Number(name[1] === 'x' ? '0' + name.slice(1) : name.slice(1)) : NaN;
    return Number.isFinite(code) ? String.fromCodePoint(code) : '\uffff';
  });
  s = s.replace(/[\u00a0\u202f\u2009]/g, ' ');
  if (/[{}\\$#~&`"\uffff]/.test(s)) return null;
  // marker pairs -> OPEN/CLOSE after the literal-brace check
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === SUP_MARK || ch === SUB_MARK) { if (depth) return null; depth = 1; out += (ch === SUP_MARK ? '^' : '_') + OPEN; } else if (ch === END_MARK) { if (!depth) return null; depth = 0; out += CLOSE; } else out += ch;
  }
  return depth ? null : out;
}

function matchParen(s, from, dir) { // index of the partner of the paren at `from`, or -1
  let d = 0;
  for (let i = from; i >= 0 && i < s.length; i += dir) {
    const c = s[i];
    if (c === '(') d += dir; else if (c === ')') d -= dir;
    if (d === 0) return i;
  }
  return -1;
}

function fractions(s) {
  let from = 0;
  for (;;) {
    const at = s.indexOf('/', from);
    if (at < 0) return s;
    from = at + 1;
    let left = s.slice(0, at);
    let right = s.slice(at + 1);
    let l, r;
    const lt = left.replace(/\s+$/, '');
    if (lt.endsWith(')')) {
      const open = matchParen(lt, lt.length - 1, -1);
      if (open < 0 || !FRAC_BEFORE.test(lt.slice(0, open))) continue;
      l = { start: open, text: lt.slice(open + 1, -1) };
    } else {
      const m = ATOM_LEFT.exec(lt);
      if (!m || !FRAC_BEFORE.test(lt.slice(0, m.index))) continue;
      l = { start: m.index, text: m[1] };
    }
    const rt = right.replace(/^\s+/, '');
    const lead = right.length - rt.length;
    if (rt.startsWith('(')) {
      const close = matchParen(rt, 0, 1);
      if (close < 0) continue;
      r = { end: lead + close + 1, text: rt.slice(1, close) };
      if (/^\s*[A-Za-z0-9(^_.\/]/.test(rt.slice(close + 1))) continue;
    } else {
      const m = ATOM_RIGHT.exec(right);
      if (!m) continue;
      r = { end: m[0].length, text: m[1] };
      if (/^\s*[A-Za-z0-9(^_.\/\\]/.test(right.slice(r.end))) continue;
    }
    if (!l.text.trim() || !r.text.trim()) continue;
    const head = s.slice(0, l.start);
    const piece = `\\frac{${l.text.trim()}}{${r.text.trim()}}`;
    s = head + piece + right.slice(r.end);
    from = head.length + piece.length;
  }
}

function sqrts(s) {
  for (;;) {
    const at = s.indexOf('√');
    if (at < 0) return s;
    const rest = s.slice(at + 1);
    let inner, len;
    if (rest.startsWith('(')) {
      const close = matchParen(rest, 0, 1);
      if (close < 0) return null;
      inner = rest.slice(1, close);
      len = close + 1;
    } else {
      const m = /^(\d+(?:\.\d+)?|[A-Za-z](?:_\{[^{}]*\})?(?:\^\{[^{}]*\})?)/.exec(rest);
      if (!m) return null;
      inner = m[1];
      len = m[0].length;
    }
    s = `${s.slice(0, at)}\\sqrt{${inner}}${rest.slice(len)}`;
  }
}

function convertMath(piece) {
  let s = piece.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(new RegExp(`[${SUB_CHARS}]+`, 'g'), (m) => `_${OPEN}${[...m].map((c) => SUB_PLAIN[SUB_CHARS.indexOf(c)]).join('')}${CLOSE}`)
    .replace(new RegExp(`[${SUP_DIGITS}]+`, 'g'), (m) => `^${OPEN}${[...m].map((c) => SUP_DIGITS.indexOf(c)).join('')}${CLOSE}`);
  s = s.replace(/([A-Za-zα-ω])_([A-Za-z0-9]+)/g, `$1_${OPEN}$2${CLOSE}`).replace(/\^(-?[A-Za-z0-9]+)/g, `^${OPEN}$1${CLOSE}`);
  if (/[_^](?!\ue001)/.test(s)) return null;
  // bare letter+digit (v0, x1) outside already-braced groups
  s = s.split(new RegExp(`([_^]${OPEN}[^${CLOSE}]*${CLOSE})`)).map((part, i) => (i % 2 ? part
    : part.replace(/(?<![A-Za-z0-9α-ω.])([A-Za-zα-ω])(\d)(?![\d.A-Za-zα-ω])/g, `$1_${OPEN}$2${CLOSE}`))).join('');
  if (!ALLOWED.test(s)) return null;
  s = s.replace(new RegExp(`_${OPEN}([A-Za-z]{2,})${CLOSE}`, 'g'), (m, w) => (FUNCS.has(w) ? m : `_${OPEN}\\mathrm${OPEN}${w}${CLOSE}${CLOSE}`));
  s = s.replace(new RegExp(OPEN, 'g'), '{').replace(new RegExp(CLOSE, 'g'), '}');
  s = s.replace(/(?<![A-Za-z\\])(?:tan|sin|cos|max|min|log|ln|cot)(?![A-Za-z])/g, (w) => `\\${w} `)
    .replace(/[α-ωΔΣΩ]/g, (c) => `\\${GREEK[c]} `)
    .replace(/[·×*÷−–≤≥≠≈±∓°→∞%½¼¾²³⟹⇒✓]/g, (c) => OPS[c]);
  s = fractions(s);
  if (s.includes('√')) { s = sqrts(s); if (s == null) return null; }
  if (/√/.test(s)) return null;
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Splits an equation value into [{kind:'math', tex} | {kind:'he', text}] in reading order, or null when any
 * part is not understood (or `opts.validate(tex)` rejects it). Hebrew parts are display text, never TeX.
 */
export function plainToParts(input, opts = {}) {
  const s = linearize(input);
  if (s == null) return null;
  const parts = [];
  let last = 0;
  const add = (mathText) => {
    const tex = convertMath(mathText);
    if (tex == null) return false;
    if (tex) {
      if (opts.validate && !opts.validate(tex)) return false;
      parts.push({ kind: 'math', tex });
    }
    return true;
  };
  for (const m of s.matchAll(HE_RUN)) {
    if (!add(s.slice(last, m.index))) return null;
    const text = m[0].replace(new RegExp(`\\^${OPEN}(\\d)${CLOSE}`, 'g'), (_, d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
    parts.push({ kind: 'he', text });
    last = m.index + m[0].length;
  }
  if (!add(s.slice(last))) return null;
  return parts.some((p) => p.kind === 'math') ? parts : null;
}

/** TeX for a purely mathematical equation string; null when it has Hebrew or anything not understood. */
export function plainToTeX(input, opts = {}) {
  const parts = plainToParts(input, opts);
  if (!parts || parts.some((p) => p.kind !== 'math')) return null;
  return parts.map((p) => p.tex).join(' ');
}
