import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installFakeDom } from './fake-dom.mjs';
import { toggleSign, toggleInput, attachSignKey } from '../js/signkey.js';
import { isCorrect, parse } from '../js/check.js';

const root = (f) => fileURLToPath(new URL('../' + f, import.meta.url));

test('toggleSign: empty, plain, negative, decimal, unicode minus, plus', () => {
  assert.equal(toggleSign(''), '-');
  assert.equal(toggleSign('5'), '-5');
  assert.equal(toggleSign('-5'), '5');
  assert.equal(toggleSign('5.2'), '-5.2');
  assert.equal(toggleSign('−12.6'), '12.6');
  assert.equal(toggleSign('+3'), '-3');
  assert.equal(toggleSign(toggleSign('7')), '7');
});

test('toggleInput keeps focus and updates the value', () => {
  const dom = installFakeDom();
  try {
    const input = document.createElement('input');
    let focused = 0;
    input.focus = () => { focused++; };
    input.value = '5';
    toggleInput(input);
    assert.equal(input.value, '-5');
    assert.equal(focused, 1);
    input.value = '';
    toggleInput(input);
    assert.equal(input.value, '-');
  } finally { dom.restore && dom.restore(); }
});

test('button prevents default on pointerdown/mousedown and toggles on click', () => {
  const dom = installFakeDom();
  try {
    const input = document.createElement('input');
    input.setAttribute('inputmode', 'decimal');
    let placed = null;
    input.after = (b) => { placed = b; };
    input.value = '2.5';
    const btn = attachSignKey(input);
    assert.equal(placed, btn);
    assert.equal(input.getAttribute('enterkeyhint'), 'done');
    assert.equal(btn.textContent, '±');
    assert.ok(btn.getAttribute('aria-label'));
    for (const type of ['pointerdown', 'mousedown']) {
      let prevented = false;
      btn.dispatch(type, { preventDefault() { prevented = true; } });
      assert.ok(prevented, type);
    }
    btn.click();
    assert.equal(input.value, '-2.5');
    assert.equal(attachSignKey(input), null, 'only once per input');
  } finally { dom.restore && dom.restore(); }
});

test('check.js accepts signed values and comma decimals', () => {
  assert.ok(isCorrect('-12.6', -12.6));
  assert.ok(isCorrect('−12.6', -12.6));
  assert.ok(isCorrect('+3', 3));
  assert.ok(isCorrect('3,5', 3.5));
  assert.ok(isCorrect('-3,5', -3.5));
  assert.equal(parse('-'), null);
});

test('every numeric answer input is created through the shared helper', () => {
  const dir = root('js');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readFileSync(root('js/' + f), 'utf8');
    if (f === 'signkey.js') continue;
    // numeric answer inputs must use inputmode decimal (the shape the installed observer decorates)
    for (const m of src.matchAll(/h\('input',[\s\S]*?\}\)/g)) {
      const attrs = m[0];
      if (/type:\s*'text'/.test(attrs) && !/maxlength|aria-label': 'הערה/.test(attrs)) {
        assert.match(attrs, /inputmode:\s*'decimal'/, `${f}: text answer input without inputmode decimal: ${attrs.slice(0, 90)}`);
      }
    }
  }
  const app = readFileSync(root('js/app.js'), 'utf8');
  assert.match(app, /installSignKeys\(\)/);
  assert.ok(readFileSync(root('sw.js'), 'utf8').includes("'js/signkey.js'"));
});
