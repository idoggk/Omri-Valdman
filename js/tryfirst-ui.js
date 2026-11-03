// Draws the "try first" toggle and prompt for one exercise page and hides / shows the hint controls it is given.
// The state machine lives in js/tryfirst.js; this file only wires it to the DOM.
import { h } from './dom.js';
import { createGate, loadOn, saveOn, PROMPT } from './tryfirst.js';

/**
 * lockables: nodes (hint buttons, hint boxes, method cards, solution buttons) that stay hidden while the gate is locked.
 * Returns { gate, bar, attempt, refresh }: put `bar` near the top of the page and call `attempt()` on the first typed
 * value or check press. `opts.gate` / `opts.save` are for tests.
 */
export function tryFirst(lockables = [], opts = {}) {
  const gate = opts.gate || createGate({ on: loadOn() });
  const save = opts.save || saveOn;
  const nodes = lockables.filter(Boolean); // grows through add(): multi-part pages reveal new controls part by part
  const prompt = h('p', { class: 'notice', role: 'status' }, '✍️ ', PROMPT);
  let timer = null;

  function refresh() {
    const locked = gate.locked();
    nodes.forEach((n) => { n.hidden = locked; });
    prompt.hidden = !locked;
    if (timer) { clearTimeout(timer); timer = null; }
    if (locked) {
      timer = setTimeout(refresh, gate.remainingMs() + 20);
      if (timer && timer.unref) timer.unref(); // never keep a test process alive
    }
  }
  // a toggle button (not a checkbox / input: the pages' answer inputs stay the only inputs)
  const toggle = h('button', { class: 'chip', type: 'button', style: 'min-height:44px', 'aria-pressed': String(gate.isOn()) });
  const label = () => { toggle.textContent = gate.isOn() ? 'קודם מנסים: דלוק' : 'קודם מנסים: כבוי'; toggle.setAttribute('aria-pressed', String(gate.isOn())); };
  label();
  toggle.addEventListener('click', () => { gate.setOn(!gate.isOn()); save(gate.isOn()); label(); refresh(); });
  const bar = h('div', { class: 'panel', 'aria-label': 'מצב קודם מנסים' },
    h('div', { class: 'btn-row' }, toggle, h('span', { class: 'muted' }, 'מצב ״קודם מנסים״: הרמזים נסתרים עד שמכניסים ניסיון (או אחרי דקה)')),
    prompt);
  refresh();
  return {
    gate, bar, refresh,
    attempt() { gate.attempt(); refresh(); },
    add(node) { if (node) { nodes.push(node); refresh(); } },
  };
}
