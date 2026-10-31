// Pure answer parsing / checking. No DOM access.

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXT_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function normalize(str) {
  let s = String(str ?? '');
  s = s.replace(/[٠-٩]/g, (c) => String(ARABIC_INDIC.indexOf(c)));
  s = s.replace(/[۰-۹]/g, (c) => String(EXT_INDIC.indexOf(c)));
  s = s.replace(/[−‒–—־﹣－]/g, '-'); // minus / dashes / maqaf
  s = s.replace(/[‎‏‪-‮⁦-⁩]/g, ''); // bidi marks
  s = s.replace(/[٫,]/g, '.'); // Arabic decimal separator, comma
  s = s.replace(/[⁄∕÷]/g, '/'); // fraction slash variants
  s = s.replace(/\s+/g, '');
  return s;
}

function parsePlain(s) {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** parse("3/2") -> 1.5 ; returns null for anything that is not a number. */
export function parse(str) {
  const s = normalize(str).replace(/(°|מעלות|מעלה)$/, ''); // a trailing angle unit is allowed: "-53.13 מעלות"
  if (s === '') return null;
  const slash = s.indexOf('/');
  if (slash === -1) return parsePlain(s);
  if (s.indexOf('/', slash + 1) !== -1) return null;
  const num = parsePlain(s.slice(0, slash));
  const den = parsePlain(s.slice(slash + 1));
  if (num === null || den === null || den === 0) return null;
  if (/^[+-]/.test(s.slice(slash + 1))) return null;
  return num / den;
}

/** expected may be a number or a string like "3/2". tolerance is absolute. */
export function isCorrect(input, expected, tolerance = 0.01) {
  const got = parse(input);
  const want = typeof expected === 'number' ? expected : parse(expected);
  if (got === null || want === null) return false;
  const tol = Number.isFinite(tolerance) ? tolerance : 0.01;
  return Math.abs(got - want) <= tol + 1e-12;
}

/** Returns an array of booleans, one per input spec. */
export function checkAll(values, inputs) {
  return inputs.map((spec, i) =>
    isCorrect(values[i], spec.answer, spec.tolerance ?? 0.01)
  );
}
