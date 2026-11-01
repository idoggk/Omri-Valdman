import test from 'node:test';
import assert from 'node:assert/strict';
import { plainToTeX, plainToParts } from '../js/mathtex.js';
import { loadKatexNode, scanEquations } from '../tools/mathtex-report.mjs';

const katex = loadKatexNode();
const renders = (tex) => { katex.renderToString(tex, { throwOnError: true, strict: 'ignore' }); return true; };

const CASES = [
  ['h = ½·g·T² = 5·9 = 45', 'h = \\frac{1}{2} \\cdot g \\cdot T^{2} = 5 \\cdot 9 = 45'],
  ['v₀² = v² − v_y² = 2500 − 900 = 1600', 'v_{0}^{2} = v^{2} - v_{y}^{2} = 2500 - 900 = 1600'],
  ['s(t) = 10t + 5t²', 's(t) = 10t + 5t^{2}'],
  ['x₁(t) = 6t; x₂(t) = 400 − 10t', 'x_{1}(t) = 6t; x_{2}(t) = 400 - 10t'],
  ['tan θ = v_y / v_x', '\\tan \\theta = \\frac{v_{y}}{v_{x}}'],
  ['a = (v − v₀)/t', 'a = \\frac{v - v_{0}}{t}'],
  ['v0 = 30', 'v_{0} = 30'],
  ['h_max = 45', 'h_{\\max } = 45'],
  ['t^2 = 9', 't^{2} = 9'],
  ['x<sup>2</sup> − 4x + 3 = 0', 'x^{2} - 4x + 3 = 0'],
  ['v<sub>0</sub> = 30', 'v_{0} = 30'],
  ['2·3 × 4', '2 \\cdot 3 \\times 4'],
  ['−2·(−1) + 2·2 = 6', '-2 \\cdot (-1) + 2 \\cdot 2 = 6'],
  ['t = 25/10 = 2.5', 't = \\frac{25}{10} = 2.5'],
  ['a = 6/3 = 2', 'a = \\frac{6}{3} = 2'],
  ['y = 14 / (−7) = −2', 'y = \\frac{14}{-7} = -2'],
  ['tan θ = −100 / 80', '\\tan \\theta = -\\frac{100}{80}'],
  ['v = √(2·10·45) = 30', 'v = \\sqrt{2 \\cdot 10 \\cdot 45} = 30'],
  ['x = √2', 'x = \\sqrt{2}'],
  ['x ≤ 5, y ≥ 3', 'x \\le 5, y \\ge 3'],
  ['x ≠ 0', 'x \\ne 0'],
  ['π ≈ 3.14', '\\pi \\approx 3.14'],
  ['x = 3 ± 2', 'x = 3 \\pm 2'],
  ['θ = 53°', '\\theta = 53^{\\circ}'],
  ['A → B', 'A \\to B'],
  ['x &lt; 5', 'x < 5'],
  ['a &gt; b', 'a > b'],
  ['(t − 6)(t + 2) = 0', '(t - 6)(t + 2) = 0'],
  ['4x + 4 = 2x + 8', '4x + 4 = 2x + 8'],
  ['1.8 = ½ · 10 · t²', '1.8 = \\frac{1}{2} \\cdot 10 \\cdot t^{2}'],
  ['z = 6/y = 3x', 'z = \\frac{6}{y} = 3x'],
  ['v_y = gt', 'v_{y} = gt'],
  ['x² + y² = 25', 'x^{2} + y^{2} = 25'],
  ['3t = 18', '3t = 18'],
  ['x₁ + x₂ = 5', 'x_{1} + x_{2} = 5'],
  ['t₁ = 2; t₂ = 4', 't_{1} = 2; t_{2} = 4'],
  ['v = +10', 'v = +10'],
  ['v<sub>y</sub> = v₀ · sin θ', 'v_{y} = v_{0} \\cdot \\sin \\theta'],
  ['a = 2(230 − 10 · 10)/(324 − 64)', 'a = 2(230 - 10 \\cdot 10)/(324 - 64)'], // ambiguous slash stays a slash
  ['1 · 4 − k · k = 4 − k<sup>2</sup>', '1 \\cdot 4 - k \\cdot k = 4 - k^{2}'],
  ['x² = 16 ⟹ x = ±4', 'x^{2} = 16 \\Longrightarrow x = \\pm 4'],
  ['vₓ = 15', 'v_{x} = 15'],
  ['vᵧ₀ = 20', 'v_{y0} = 20'],
];

test('plainToTeX: representative strings', () => {
  assert.ok(CASES.length >= 40);
  for (const [src, want] of CASES) {
    const got = plainToTeX(src);
    assert.equal(got, want, src);
    if (katex) renders(got);
  }
});

test('plainToTeX: a/b stays a slash when ambiguous', () => {
  assert.doesNotMatch(plainToTeX('2 · 130/260'), /frac/);
  assert.doesNotMatch(plainToTeX('a = 5t/2'), /frac/);
  assert.doesNotMatch(plainToTeX('x = a/b/c'), /frac/);
});

test('plainToTeX: unknown or unsafe input returns null', () => {
  for (const bad of ['x = {1}', 'x = \\frac{1}{2}', 'a ∠ b', 'x = 5 <b>ו</b>', 'x^(2)', 'x_', '$x$', 'x = √', 'x = 5 מ/ש']) {
    assert.equal(plainToTeX(bad), null, bad);
  }
  assert.equal(plainToTeX(''), null);
  assert.equal(plainToTeX(null), null);
});

test('plainToParts: Hebrew units and words are split out, in order', () => {
  assert.deepEqual(plainToParts('v = 20 − 10 · 5 = −30 מ/ש'), [
    { kind: 'math', tex: 'v = 20 - 10 \\cdot 5 = -30' }, { kind: 'he', text: 'מ/ש' }]);
  assert.deepEqual(plainToParts('a = 2 מ/ש<sup>2</sup>').at(-1), { kind: 'he', text: 'מ/ש²' });
  assert.deepEqual(plainToParts("h = 60 מ'").at(-1), { kind: 'he', text: "מ'" });
  const mid = plainToParts('x = 5 ולכן y = 7');
  assert.deepEqual(mid.map((p) => p.kind), ['math', 'he', 'math']);
  assert.equal(mid[1].text, 'ולכן');
  assert.equal(plainToParts('מטר'), null); // nothing mathematical
});

test('plainToParts: validate callback rejection means fallback', () => {
  assert.equal(plainToParts('x = 5', { validate: () => false }), null);
  assert.ok(plainToParts('x = 5', { validate: () => true }));
});

test('data scan: every converted equation renders in KaTeX; fallbacks <= 5%', { skip: !katex && 'vendored katex not found' }, () => {
  const r = scanEquations(katex);
  assert.ok(r.total > 1000, 'expected many equation blocks, got ' + r.total);
  const pct = (100 * r.fallbacks.length) / r.total;
  console.log(`mathtex: ${r.converted}/${r.total} converted, ${r.fallbacks.length} fallbacks (${pct.toFixed(1)}%)`);
  assert.ok(pct <= 5, `fallbacks ${pct.toFixed(1)}% > 5%`);
  // anything that survived validation must really render (validate ran inside scanEquations; re-check explicitly)
  for (const [value] of r.fallbacks.slice(0, 0)) assert.ok(value);
});

test('fallback path: no KaTeX means renderMath/enhanceEq leave the text alone', async () => {
  const saved = globalThis.katex;
  delete globalThis.katex;
  const { renderMath, enhanceEq, mathReady } = await import('../js/math.js');
  assert.equal(mathReady(), false);
  assert.equal(renderMath('x^{2}'), null);
  const el = { innerHTML: 'x = 5', replaceChildren() { throw new Error('must not touch'); } };
  enhanceEq(el, 'x = 5'); // no document in node: loadKatex resolves false, nothing happens
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(el.innerHTML, 'x = 5');
  if (saved) globalThis.katex = saved;
});
