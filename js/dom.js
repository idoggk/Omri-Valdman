// Tiny DOM helpers shared by the views.
import { isolateFormulas, isolateFormulasHtml } from './bidi.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = isolateFormulasHtml(v);
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
