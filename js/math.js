// KaTeX (vendored, loaded lazily on first use). Every function degrades to "not available": callers keep the plain-text rendering.
import { plainToParts } from './mathtex.js';

const JS_URL = new URL('../vendor/katex/katex.min.js', import.meta.url).href;
const CSS_URL = new URL('../vendor/katex/katex.min.css', import.meta.url).href;
const OPTIONS = { throwOnError: false, strict: 'ignore', trust: false, output: 'html' };

let katex = globalThis.katex || null;
let loading = null;

/** Loads katex.min.js (and its css) once. Resolves true when available, false on any failure (offline cache miss). */
export function loadKatex() {
  if (katex) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const head = typeof document !== 'undefined' && document.head;
    if (!head) { resolve(false); return; }
    try {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = CSS_URL;
      head.append(css);
      const script = document.createElement('script');
      script.src = JS_URL;
      script.async = true;
      script.onload = () => { katex = globalThis.katex || null; if (!katex) loading = null; resolve(!!katex); };
      script.onerror = () => { loading = null; resolve(false); };
      head.append(script);
    } catch {
      loading = null;
      resolve(false);
    }
  });
  return loading;
}

export const mathReady = () => !!katex;

/** Renders TeX synchronously to a DOM node, or null when KaTeX is not loaded yet / the TeX is rejected. */
export function renderMath(tex, { display = false } = {}) {
  if (!katex || typeof document === 'undefined') return null;
  try {
    // throwOnError:true so a bad string yields null (caller keeps the text) instead of KaTeX's red error output
    const html = katex.renderToString(String(tex), { ...OPTIONS, throwOnError: true, displayMode: !!display });
    const el = document.createElement('span');
    el.className = 'eq-math';
    el.setAttribute('dir', 'ltr');
    el.innerHTML = html;
    return el;
  } catch {
    return null;
  }
}

/** True when katex is loaded and accepts the TeX (used as the converter's validator). */
export function texValid(tex) {
  if (!katex) return false;
  try { katex.renderToString(String(tex), { ...OPTIONS, throwOnError: true }); return true; } catch { return false; }
}

function build(parts) {
  const box = document.createElement('span');
  box.className = 'eq-math-line';
  box.setAttribute('dir', 'ltr');
  for (const p of parts) {
    let node;
    if (p.kind === 'math') node = renderMath(p.tex, { display: false });
    else {
      node = document.createElement('bdi');
      node.className = 'eq-he';
      node.setAttribute('dir', 'rtl');
      node.textContent = p.text;
    }
    if (!node) return null;
    box.append(node);
  }
  return box;
}

/**
 * Upgrades a plain-text equation block (already filled with its fallback text) to KaTeX once the library is
 * available. `value` is the eqblocks 'eq' value. Never throws, never blanks the element.
 */
export function enhanceEq(el, value) {
  let parts;
  try { parts = plainToParts(value); } catch { return; }
  if (!parts) return;
  const apply = () => {
    try {
      const node = build(parts);
      if (!node) return;
      el.replaceChildren(node);
      el.classList?.add('has-katex');
    } catch { /* keep the text */ }
  };
  if (katex) apply();
  else loadKatex().then((ok) => { if (ok) apply(); });
}
