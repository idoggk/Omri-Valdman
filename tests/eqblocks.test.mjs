import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { splitStep, eqHtml } from '../js/eqblocks.js';
import { installFakeDom } from './fake-dom.mjs';

installFakeDom();
const { h } = await import('../js/dom.js');

const vals = (step) => splitStep(step).map((b) => [b.kind, b.value]);

test('owner strings split into sentence + equation blocks', () => {
  assert.deepEqual(vals('גובה המצוק: h = ½·g·T² = 5·9 = 45 מטר.'), [['text', 'גובה המצוק:'], ['eq', 'h = ½·g·T² = 5·9 = 45 מטר']]);
  assert.deepEqual(vals("v₀² = v² − v_y² = 2500 − 900 = 1600, ולכן v₀ = 40 מ'/ש."),
    [['eq', 'v₀² = v² − v_y² = 2500 − 900 = 1600'], ['text', 'ולכן'], ['eq', "v₀ = 40 מ'/ש"]]);
  assert.deepEqual(vals("רכיב אנכי בפגיעה: v_y = g·T = 30 מ'/ש."), [['text', 'רכיב אנכי בפגיעה:'], ['eq', "v_y = g·T = 30 מ'/ש"]]);
  assert.deepEqual(vals('הרכיב האנכי של המהירות בפגיעה הוא g·T.'), [['text', 'הרכיב האנכי של המהירות בפגיעה הוא g·T.']]);
});

test('data spans, arrows and sub/sup', () => {
  assert.deepEqual(vals('<span dir="ltr">1225 = 25 + 300a</span> ⟵ <span dir="ltr">a = 1200/300 = 4 מ/ש²</span>.'),
    [['eq', '1225 = 25 + 300a'], ['eq', 'a = 1200/300 = 4 מ/ש²']]);
  assert.deepEqual(vals('אחרי <span dir="ltr">x = v<sub>0</sub>t</span>, אז סיימנו'), [['text', 'אחרי'], ['eq', 'x = v<sub>0</sub>t'], ['text', 'אז סיימנו']]);
  assert.deepEqual(vals('x &lt; 5 ולכן y'), [['eq', 'x &lt; 5'], ['text', 'ולכן y']]);
  assert.deepEqual(vals('<b>x = 5</b> כי'), [['text', '<b>x = 5</b> כי']]); // unknown markup is never cut apart
  assert.deepEqual(vals(''), []);
});

test('eqHtml: subscripts and rtl units', () => {
  assert.equal(eqHtml('v_y = g·T = 30 מ\'/ש'), 'v<sub>y</sub> = g·T = 30 <bdi dir="rtl">מ\'/ש</bdi>');
  assert.equal(eqHtml('v0² = 5'), 'v<sub>0</sub>² = 5');
  assert.equal(eqHtml('x = 5t'), 'x = 5t');
  assert.equal(eqHtml('v<sub>0</sub> = 3'), 'v<sub>0</sub> = 3');
});

test('h({steps}) builds blocks, stays a plain line without equations, sanitizes', () => {
  const li = h('li', { steps: 'גובה המצוק: h = 5·9 = 45 מטר.' });
  assert.equal(li.children.length, 2);
  assert.equal(li.children[0].className, 'step-text');
  assert.equal(li.children[1].className, 'eq-block');
  assert.equal(li.children[1].getAttribute('dir'), 'ltr');
  assert.ok(li.children[1].innerHTML.includes('<bdi dir="rtl">מטר</bdi>'));
  const plain = h('li', { steps: 'אין כאן משוואה' });
  assert.equal(plain.children.length, 0);
  const evil = h('li', { steps: 'x = 1 <script>alert(1)</script><img src=x onerror=alert(1)>' });
  assert.ok(!evil.all((n) => /<script|<img/i.test(n.innerHTML || '')).length);
});

// data scan: no empty block, no lost characters
const FIELDS = new Set(['solution', 'steps', 'tips', 'hints', 'explain', 'explanation', 'why', 'wrongExplain', 'takeaway']);
const norm = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/[⁦⁩\s.,;:!?⟵⟶←→–—]/g, '');
function collect(node, out, key) {
  if (typeof node === 'string') { if (FIELDS.has(key)) out.push(node); return; }
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out, key)); return; }
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collect(v, out, k);
}
test('data scan: every step splits into non-empty blocks and loses no characters', () => {
  const steps = [];
  for (const f of readdirSync(new URL('../data/', import.meta.url)).filter((n) => n.endsWith('.json'))) {
    collect(JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8')), steps, '');
  }
  assert.ok(steps.length > 300, `only ${steps.length} steps`);
  let withEq = 0;
  for (const s of steps) {
    const blocks = splitStep(s);
    assert.ok(blocks.every((b) => norm(b.value).length > 0), `empty block in: ${s}`);
    assert.equal(norm(blocks.map((b) => b.value).join('')), norm(s.replace(/<br\s*\/?>/gi, '')), `lost characters in: ${s}`);
    if (blocks.some((b) => b.kind === 'eq')) withEq++;
    for (const b of blocks) if (b.kind === 'eq') assert.ok(/[=≤≥<>]|&[lg]t;/.test(b.value), `eq without relation: ${b.value}`);
  }
  assert.ok(withEq > 100, `only ${withEq} steps with equations`);
});
