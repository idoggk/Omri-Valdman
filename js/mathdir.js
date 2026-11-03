// One place for "math text inside an RTL page": every math/formula element is a dir=ltr isolate that wraps
// (and scrolls as a last resort) instead of clipping. CSS classes: .math-ltr (container), .math-inline (span).
import { h } from './dom.js';

/** Block container for an equation/step string (text or the small HTML subset of the data). Always dir=ltr. */
export const mathBlock = (steps, cls = '') => h('div', { class: `math-ltr ${cls}`.trim(), dir: 'ltr', steps });

/** Inline LTR isolate for a short formula inside Hebrew text. */
export const mathInline = (text, cls = '') => h('span', { class: `math-inline ${cls}`.trim(), dir: 'ltr' }, text);

/** Button whose label is math: dir=ltr on the button, label fixed to the start side so it reads left to right. */
export const mathButton = (label, attrs = {}) => h('button', { class: 'btn math-btn', type: 'button', dir: 'ltr', ...attrs }, label);

const NUMERIC = /^[-+−]?\d+(?:\.\d+)?$/;
const numeric = (s) => Number(String(s).replace('−', '-'));

/**
 * Order for the answer buttons of a blank: plain numbers go ascending (-2, -1, 1, 2), so the order itself
 * gives nothing away; anything else keeps the caller's order. Returns a new array.
 */
export function orderBlankOptions(entries, textOf = (e) => e) {
  const list = [...entries];
  if (list.length > 1 && list.every((e) => NUMERIC.test(String(textOf(e)).trim()))) {
    list.sort((a, b) => numeric(textOf(a)) - numeric(textOf(b)));
  }
  return list;
}
