// Tiny DOM helpers shared by the views.
import { isolateFormulas, isolateFormulasHtml } from './bidi.js';
import { splitStep, eqHtml } from './eqblocks.js';
import { sanitizeHtml } from './sanitize.js';
import { enhanceEq } from './math.js';

/** Fills `el` with a solution step: Hebrew sentence lines, and every equation chain as its own ltr display block. */
export function fillStep(el, step) {
  const blocks = splitStep(sanitizeHtml(String(step ?? '')));
  if (blocks.length === 1 && blocks[0].kind === 'text') { el.innerHTML = isolateFormulasHtml(blocks[0].value); return; }
  for (const b of blocks) {
    const d = document.createElement('div');
    if (b.kind === 'eq') { d.className = 'eq-block'; d.setAttribute('dir', 'ltr'); d.innerHTML = eqHtml(b.value); enhanceEq(d, b.value); }
    else { d.className = 'step-text'; d.innerHTML = isolateFormulasHtml(b.value); }
    el.append(d);
  }
}

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = isolateFormulasHtml(v);
    else if (k === 'steps') fillStep(el, v);
    else if (k === 'rawhtml') el.innerHTML = isolateFormulasHtml(v); // already sanitized by the caller
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(isolateFormulas(kid)));
  }
  return el;
}

export const ltr = (text) => h('span', { dir: 'ltr' }, text);
