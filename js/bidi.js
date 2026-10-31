// Bidi helpers for numbers/ranges/formulas inside Hebrew text. No DOM.
const LRI = '⁦';
const PDI = '⁩';

/** Wrap text in a left-to-right isolate. */
export const ltrIsolate = (text) => LRI + text + PDI;

// numeric ranges such as 3–5, 3-5, 10–12.5 (hyphen, en dash, minus sign)
const RANGE_RE = /(?<![\d⁦])\d+(?:\.\d+)?(?:\s?[-–−]\s?\d+(?:\.\d+)?)+(?![\d⁩])/g;

/** Isolate numeric ranges so "3–5" is never displayed as "5–3" inside RTL text. */
export function isolateRanges(text) {
  return String(text).replace(RANGE_RE, (m) => ltrIsolate(m));
}

/** Isolate numeric ranges in the text parts of an HTML string (tags and attributes are left alone). */
export function isolateHtml(html) {
  return String(html).split(/(<[^>]*>)/).map((part) => (part.startsWith('<') ? part : isolateRanges(part))).join('');
}

// A formula run: starts with a Latin letter, digit or "(", continues with Latin/digits/operators/superscripts,
// and may contain single spaces as long as another formula character follows ("x² + y²", "v = 10 m/s").
const FC = 'A-Za-z0-9²³¹⁰⁴-⁹₀-₉·×÷+\\-−=^/()<>≤≥.,°%\'_';
const FORMULA_RE = new RegExp(`[A-Za-z0-9(][${FC}]*(?:[ \\u00a0]+[${FC}]+)*`, 'g');

/**
 * Titles/headings containing formulas: put each Latin/formula run in its own LTR isolate so
 * "x² + y² ו·xy – ארבעה פתרונות" keeps its formula order. Other numeric ranges are isolated too.
 */
export function isolateFormulas(text) {
  const s = String(text);
  let out = '';
  let last = 0;
  for (const m of s.matchAll(FORMULA_RE)) {
    let run = m[0];
    // a trailing sentence punctuation / space does not belong to the formula
    const trimmed = run.replace(/[\s.,]+$/, '');
    const hasLatinOrOp = /[A-Za-z²³=^+×·÷<>≤≥/]/.test(trimmed) || /\d\s*[-−]\s*\d/.test(trimmed);
    if (!trimmed || !hasLatinOrOp) continue; // plain numbers are fine inside RTL text
    out += isolateRanges(s.slice(last, m.index)) + ltrIsolate(trimmed);
    last = m.index + trimmed.length;
    run = trimmed;
  }
  return out + isolateRanges(s.slice(last));
}

/** Same as isolateFormulas, alias used for exercise titles. */
export const isolateTitle = isolateFormulas;

/**
 * Like isolateFormulas, for HTML strings: only text between tags is touched, and character entities
 * (&lt; &nbsp; ...) are left whole so an entity name is never taken for a formula.
 */
export function isolateFormulasHtml(html) {
  return String(html).split(/(<[^>]*>|&#?\w+;)/).map((part) => (part.startsWith('<') || /^&#?\w+;$/.test(part) ? part : isolateFormulas(part))).join('');
}
