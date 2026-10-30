// Bidi helpers for numbers/ranges inside Hebrew text. No DOM.
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
