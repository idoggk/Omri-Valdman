import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagrams, diagramFor, validateSvg, svg, arrow, dim, ground, ball, car, building, vtGraph, curve } from '../tools/diagrams.mjs';
import { models } from '../tools/verify-physics.mjs';

const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));

test('every model has a diagram builder and vice versa', () => {
  assert.deepEqual(Object.keys(diagrams).sort(), Object.keys(models).sort());
});

test('every exercise has a stored diagram equal to the generated one', () => {
  for (const ex of list) assert.equal(ex.diagram, diagramFor(ex), ex.id);
});

test('generation is deterministic', () => {
  for (const ex of list) assert.equal(diagramFor(ex), diagramFor(JSON.parse(JSON.stringify(ex))), ex.id);
});

test('every diagram is well-formed, safe and readable', () => {
  for (const ex of list) {
    assert.deepEqual(validateSvg(ex.diagram), [], ex.id);
    assert.match(ex.diagram, /viewBox="0 0 320 \d+"/, ex.id);
    assert.match(ex.diagram, /<title>[^<]*[֐-׿][^<]*<\/title>/, ex.id);
    assert.ok(!/<script|\son\w+=|javascript:|href=/i.test(ex.diagram), ex.id);
    assert.ok(!/NaN|undefined|Infinity/.test(ex.diagram), `${ex.id} contains an invalid number`);
    assert.ok(ex.diagram.includes('currentColor'), ex.id);
    assert.ok(/var\(--accent/.test(ex.diagram), ex.id);
  }
});

test('numbers on the figure come from the exercise params and appear in the statement', () => {
  const ex = list.find((e) => e.id === 'phys-vertical-001');
  assert.ok(ex.diagram.includes("h = 80 מ'"));
  const rocket = list.find((e) => e.id === 'phys-vertical-013');
  assert.ok(rocket.diagram.includes('a = 8') && rocket.statement.includes('8 מ/ש²'));
  const g = list.find((e) => e.id === 'phys-horizontal-014');
  assert.ok(g.diagram.includes('(5, 10)') && g.diagram.includes('(8, 10)'));
  const changed = diagrams.free_fall_from_height({ h: 45 });
  assert.ok(changed.includes("h = 45 מ'") && !changed.includes('h = 80'));
});

test('validateSvg rejects bad input', () => {
  const good = svg('בדיקה', 50, '<line x1="0" y1="0" x2="1" y2="1"/>');
  assert.deepEqual(validateSvg(good), []);
  assert.ok(validateSvg('').length);
  assert.ok(validateSvg(good.replace('</svg>', '<script>x</script></svg>')).length);
  assert.ok(validateSvg(good.replace('<line', '<line onclick="x"')).length);
  assert.ok(validateSvg(good.replace('<line', '<a href="javascript:x"><line')).length);
  assert.ok(validateSvg(good.replace('<title>בדיקה</title>', '')).length);
  assert.ok(validateSvg(good.replace(' viewBox="0 0 320 50"', '')).length);
  assert.ok(validateSvg(good.replace('</g>', '')).some((m) => /unbalanced|unclosed/.test(m)));
  assert.ok(validateSvg(good.replace('<line', '<image xlink:href="http://x/y.png"/><line')).length);
});

test('builders return balanced, finite fragments', () => {
  const parts = [arrow(0, 0, 10, 10, 'a'), dim(0, 0, 0, 50, 'h'), ground(0, 100, 50), ball(5, 5), car(0, 50), building(0, 10, 20, 50), curve(0, 0, 1, 1, 1, 3), vtGraph({ pts: [[0, 0], [2, 4]], xmax: 2, vmin: 0, vmax: 4, xs: 1, vs: 1, title: 'גרף' })];
  for (const p of parts) assert.ok(!/NaN|undefined/.test(p));
  assert.deepEqual(validateSvg(svg('כותרת', 60, parts.slice(0, 7).join(''))), []);
});

test('CLI --check passes on the shipped data and --write is idempotent', () => {
  const script = fileURLToPath(new URL('../tools/diagrams.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK: 50 diagrams/);
});
