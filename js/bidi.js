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

// A formula run: starts with a Latin letter, digit or "(", continues with Latin/digits/operators/superscripts/✓,
// and may contain spaces as long as another formula character (or a Hebrew unit right after a number) follows,
// so "a = b = c = d" and "h = 10·5 + 5·25 = 175 מ'" are ONE run. <sub>/<sup> tags travel inside a run as
// private-use placeholders (HTML mode only).
const SUBSUP = { '<sub>': '', '</sub>': '', '<sup>': '', '</sup>': '' };
const SUBSUP_BACK = Object.fromEntries(Object.entries(SUBSUP).map(([tag, ch]) => [ch, tag]));
const FC = 'A-Za-zα-ωΔ0-9²³¹⁰⁴-⁹₀-₉ₐ-ₜ½¼¾·×÷+\\-−=^/()<>≤≥.,°%\'_✓?\\ue000-\\ue003';
const UNITS = 'מ[\'׳]\\/ש|מ\\/ש|מ\\/שנ[\'׳]|מ[\'׳]|שנ[\'׳]|ש[\'׳]|מעלות|מטרים|מטר|שניות|ק"ג|ק״ג|קמ"ש|קמ״ש';
const FORMULA_RE = new RegExp(
  `[A-Za-zα-ωΔ0-9(\\ue000-\\ue003](?:[${FC}]|_[א-ת]+)*(?:[ \\u00a0]+(?:[${FC}]+|(?<=\\d[ \\u00a0]*)(?:${UNITS})(?![\\u0590-\\u05ff])))*`, 'g');
const EXISTING_ISOLATE_ALL = /⁦[^⁩]*⁩/g;
// literal "v_y" / "v0" inside a formula read as v with a subscript (HTML mode only)
const subscripts = (seg) => seg.replace(/\b([A-Za-z])_([A-Za-z0-9])\b/g, '$1$2').replace(/\b([vxy])0\b/g, '$1' + '0');
const EXISTING_ISOLATE_RE =/(⁦[^⁩]*⁩)/;
const TRAIL_RE = /[\s.,?·×÷+\-−=^/<>]+$/;
const count = (s, ch) => s.split(ch).length - 1;

function isolatePlain(s) {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(FORMULA_RE)) {
    // trailing sentence punctuation / spaces do not belong to the formula; neither do unmatched parentheses
    let run = m[0].replace(TRAIL_RE, '');
    let start = m.index;
    while (run.startsWith('(') && count(run, '(') > count(run, ')')) { run = run.slice(1); start++; }
    while (run.endsWith(')') && count(run, ')') > count(run, '(')) run = run.slice(0, -1);
    run = run.replace(TRAIL_RE, '');
    const hasLatinOrOp = /[A-Za-zα-ωΔ²³=^+×·÷<>≤≥✓\ue000-\ue003]/.test(run) || /\d\s*[-−]\s*\d/.test(run);
    if (!run || !hasLatinOrOp) continue; // plain numbers are fine inside RTL text
    out += isolateRanges(s.slice(last, start)) + ltrIsolate(run);
    last = start + run.length;
  }
  return out + isolateRanges(s.slice(last));
}

/**
 * Put every Latin/equation run in its own LTR isolate so "x² + y² ו·xy – ארבעה פתרונות" and
 * "h = s(5) = 10·5 + 5·25 = 175 מ'." keep their order; the final period/comma stays outside.
 * Idempotent: text that is already inside an isolate is left alone. Other numeric ranges are isolated too.
 */
export function isolateFormulas(text) {
  return String(text).split(EXISTING_ISOLATE_RE).map((part, i) => (i % 2 ? part : isolatePlain(part))).join('');
}

/** Same as isolateFormulas, alias used for exercise titles. */
export const isolateTitle = isolateFormulas;

/**
 * Like isolateFormulas, for HTML strings: only text between tags is touched, and character entities
 * (&lt; &nbsp; ...) are left whole so an entity name is never taken for a formula.
 */
export function isolateFormulasHtml(html) {
  const src = String(html).replace(/<\/?su[bp]>/gi, (t) => SUBSUP[t.toLowerCase()]);
  let ltrTag = null; // name of an open dir="ltr" element: its text is already left-to-right
  let depth = 0;
  return src.split(/(<[^>]*>|&#?\w+;)/)
    .map((part) => {
      if (part.startsWith('<')) {
        const m = part.match(/^<(\/?)([A-Za-z][\w-]*)([^>]*)>$/);
        if (m && ltrTag === null && !m[1] && (/\bdir\s*=\s*["']?ltr/i.test(m[3]) || m[2].toLowerCase() === 'svg') && !part.endsWith('/>')) { ltrTag = m[2].toLowerCase(); depth = 1; }
        else if (m && ltrTag === m[2].toLowerCase()) { depth += m[1] ? -1 : 1; if (depth === 0) ltrTag = null; }
        return part;
      }
      if (ltrTag !== null || /^&#?\w+;$/.test(part)) return part;
      return isolateFormulas(part).replace(EXISTING_ISOLATE_ALL, subscripts);
    }).join('')
    .replace(/[\ue000-\ue003]/g, (c) => SUBSUP_BACK[c]);
}

