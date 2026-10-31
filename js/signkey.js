// Plus/minus key for numeric answer fields. The iOS decimal keypad has no minus sign, so every
// <input inputmode="decimal"> gets a "±" button next to it that toggles a leading minus.
// One choke point: installSignKeys() watches the document and decorates every such input,
// whichever view created it.

const MINUS_RE = /^[-−‒–—־﹣－]/;

/** Pure: returns the value with the leading sign toggled ("" -> "-", "5" -> "-5", "-5" -> "5", "+5" -> "-5"). */
export function toggleSign(value) {
  const v = String(value ?? '').replace(/^\s+/, '');
  if (MINUS_RE.test(v)) return v.slice(1);
  if (v.startsWith('+')) return '-' + v.slice(1);
  return '-' + v;
}

/** Toggles the sign in the field, keeps focus and the caret relative to the digits. */
export function toggleInput(input) {
  const before = String(input.value ?? '');
  const next = toggleSign(before);
  const caret = typeof input.selectionEnd === 'number' ? input.selectionEnd : before.length;
  const delta = next.length - before.length;
  input.value = next;
  if (typeof input.focus === 'function') input.focus();
  if (typeof input.setSelectionRange === 'function') {
    const pos = Math.max(0, Math.min(next.length, caret + delta));
    try { input.setSelectionRange(pos, pos); } catch { /* unsupported input type */ }
  }
  if (typeof Event === 'function' && typeof input.dispatchEvent === 'function') {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function makeSignButton(input, doc = document) {
  const btn = doc.createElement('button');
  btn.setAttribute('type', 'button');
  btn.setAttribute('class', 'btn signkey');
  btn.setAttribute('aria-label', 'הוספה או הסרה של סימן מינוס (פלוס/מינוס)');
  btn.setAttribute('title', 'פלוס/מינוס');
  btn.textContent = '±';
  // keep the keypad open and the field focused: stop the button from taking focus
  const keep = (e) => e.preventDefault();
  btn.addEventListener('pointerdown', keep);
  btn.addEventListener('mousedown', keep);
  btn.addEventListener('click', () => toggleInput(input));
  return btn;
}

export function isNumericAnswerInput(el) {
  return !!el && el.tagName === 'INPUT' && el.getAttribute('inputmode') === 'decimal';
}

/** Adds the button right after the input (once). */
export function attachSignKey(input, doc = document) {
  if (!isNumericAnswerInput(input) || input.__signkey) return null;
  if (!input.getAttribute('enterkeyhint')) input.setAttribute('enterkeyhint', 'done');
  const btn = makeSignButton(input, doc);
  input.__signkey = btn;
  if (typeof input.after === 'function') input.after(btn);
  else if (input.parentNode) input.parentNode.insertBefore(btn, input.nextSibling);
  return btn;
}

export function installSignKeys(root = document) {
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (isNumericAnswerInput(node)) attachSignKey(node);
    if (node.querySelectorAll) node.querySelectorAll('input[inputmode="decimal"]').forEach((i) => attachSignKey(i));
  };
  scan(root.documentElement || root);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(scan);
  });
  obs.observe(root.documentElement || root, { childList: true, subtree: true });
  return obs;
}
