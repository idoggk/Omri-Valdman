import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagrams, diagramFor, validateSvg, layoutIssues, svg, txt, line, arrow, dim, ground, ball, car, building, vtGraph, curve, rect, previewHtml } from '../tools/diagrams.mjs';
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
    assert.ok(/var\(--dg-a, #/.test(ex.diagram), ex.id);
  }
});

test('numbers on the figure come from the exercise params and appear in the statement', () => {
  const ex = list.find((e) => e.id === 'phys-vertical-001');
  assert.ok(ex.diagram.includes('H₁ = 125') && ex.diagram.includes('H₂ = 80'));
  const rocket = list.find((e) => e.id === 'phys-vertical-013');
  assert.ok(rocket.diagram.includes('a = 8') && rocket.statement.includes('8 מ/ש²'));
  const g = list.find((e) => e.id === 'phys-horizontal-014');
  assert.ok(g.diagram.includes('(4, 12)') && g.diagram.includes('(6, 12)') && g.diagram.includes('(12, -6)'));
  const changed = diagrams.free_fall_from_height({ h: 45 });
  assert.ok(changed.includes('h = 45') && !changed.includes('h = 80'));
});

const plain = (s) => s.replace(/<[^>]*>/g, '').replace(/[⁦-⁩]/g, '');

test('bidi: every Hebrew label is built from separate isolated runs, never one mixed string', () => {
  for (const ex of list) {
    for (const [, inner] of ex.diagram.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
      if (!/[א-ת]/.test(inner)) continue;
      assert.ok(/<tspan direction="(rtl|ltr)" unicode-bidi="isolate">/.test(inner), `${ex.id}: Hebrew label without direction runs: ${plain(inner)}`);
      // ASCII apostrophe after a Hebrew letter is neutral and drifts to the line start: labels use the geresh
      assert.ok(!/[א-ת]'/.test(plain(inner)), `${ex.id}: ASCII apostrophe in ${plain(inner)}`);
    }
  }
});

test('bidi: runs are ordered by logic, with the colon glued to its Hebrew phrase', () => {
  const t = txt(100, 40, "סוף שלב 2: t₂ = 5 ש'");
  const runs = [...t.matchAll(/<tspan direction="(rtl|ltr)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(runs, ['ltr', 'rtl', 'rtl']); // expression (with nested unit), then the Hebrew clause
  assert.ok(t.indexOf('t₂ = 5') < t.indexOf('סוף שלב 2:'), 'visual order: expression left of the phrase');
  assert.ok(/סוף שלב 2:/.test(plain(t)) && plain(t).includes('ש׳'));
  const two = plain(txt(100, 40, "פער 8 מ' · משאית 16 מ'"));
  assert.ok(two.indexOf('משאית') < two.indexOf('·') && two.indexOf('·') < two.indexOf('פער'), 'a Hebrew line is emitted in reverse clause order');
  const ltr = txt(100, 40, 'v₀ = 20 מ/ש');
  assert.ok(ltr.indexOf('v₀ = 20') < ltr.indexOf('מ/ש'), 'unit follows its number in an LTR expression');
  assert.equal(txt(100, 40, 'v₀ = 0'), txt(100, 40, 'v₀ = 0'));
  assert.ok(!txt(100, 40, 'v₀ = 0').includes('<tspan'), 'pure Latin labels stay plain text');
});

test('layout measurement follows the runs (tags and isolate marks have no width)', () => {
  const wide = svg('בדיקה', 60, txt(160, 30, "t₂ = 5 ש' סוף שלב 2:"));
  assert.deepEqual(layoutIssues(wide), []);
  // a label of ~150 units centred at 160 must be measured by its visible text, so it fits the 320 box
  assert.deepEqual(layoutIssues(svg('בדיקה', 60, txt(160, 30, 'הזנב עובר את העמוד אחרי 8 ש׳', 'k', 'middle', true))), []);
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
  assert.match(r.stdout, /OK: 70 diagrams/);
});


test('every label is thin text with a white halo (never a dark outline) and every diagram is overlap-free', () => {
  for (const ex of list) {
    assert.deepEqual(layoutIssues(ex.diagram), [], ex.id);
    for (const t of ex.diagram.match(/<text\b[^>]*>/g) || []) {
      assert.ok(/stroke="#fff"/.test(t) && /paint-order="stroke"/.test(t) && /stroke-width="3"/.test(t) && /stroke-linejoin="round"/.test(t), `${ex.id}: label without white halo`);
      assert.ok(!/var\(--card/.test(t), `${ex.id}: halo must not follow the theme`);
    }
  }
});

// ---- synthetic scenes: the checker must fail on bad ones and pass on good ones
const wrap = (body, h = 120) => `<svg viewBox="0 0 320 ${h}" xmlns="http://www.w3.org/2000/svg"><g>${body}</g></svg>`;
const pin = (x, y, s, anc = 'middle', own = false) => txt(x, y, s, 'k', anc, true, own);

test('bad scene: label across a dimension line fails', () => {
  const bad = wrap(dim(160, 20, 160, 100, '') + pin(160, 64, "h = 44.8 מ'"));
  assert.match(layoutIssues(bad).join(), /arrow\/dimension line/);
});

test('bad scene: label straddling a filled rect edge fails, label fully inside a foreign rect fails', () => {
  const r = rect(100, 30, 60, 70, { fill: 'k' });
  assert.match(layoutIssues(wrap(r + pin(150, 60, "h = 44.8 מ'", 'start'))).join(), /rect/);
  assert.match(layoutIssues(wrap(r + pin(130, 60, 'שלום'))).join(), /inside a rect it does not own/);
});

test('bad scene: label on a trajectory or on an arrow head fails', () => {
  const traj = `<path d="M20 100Q160 -40 300 100" stroke="currentColor"/>`;
  assert.match(layoutIssues(wrap(traj + pin(160, 34, 'v₀ = 25 מ/ש'))).join(), /trajectory/);
  assert.match(layoutIssues(wrap(arrow(20, 60, 140, 60, 'a') + pin(132, 56, 'x', 'start'))).join(), /arrow/);
});

test('bad scene: text over text and text outside the viewBox fail', () => {
  assert.match(layoutIssues(wrap(pin(100, 40, 'אבגד') + pin(104, 42, 'הוזח'))).join(), /text/);
  assert.match(layoutIssues(wrap(pin(2, 40, 'אבגדהוזח', 'start'))).join(), /viewBox/);
  assert.match(layoutIssues(wrap(pin(100, 118, 'שלום'))).join(), /viewBox/);
});

test('good scenes pass: clear label, owned label fully inside its rect, label beside a line', () => {
  assert.deepEqual(layoutIssues(wrap(pin(100, 40, 'שלום'))), []);
  assert.deepEqual(layoutIssues(wrap(rect(80, 30, 120, 60, { fill: 'k' }) + pin(140, 64, 'בורג', 'middle', true))), []);
  assert.deepEqual(layoutIssues(wrap(dim(160, 20, 160, 100, '') + pin(172, 64, "h = 44.8 מ'", 'start'))), []);
  // owned label that pokes out of its rect still fails
  assert.match(layoutIssues(wrap(rect(80, 30, 40, 60, { fill: 'k' }) + pin(100, 64, 'בורג ארוך מאוד', 'middle', true))).join(), /rect/);
});

test('svg() relocates a colliding label to a clear spot, never emitting an overlap', () => {
  const fig = svg('בדיקה', 100, line(0, 38, 300, 38) + dim(100, 10, 100, 90, '') + txt(100, 40, 'v₀ = 20 מ/ש'));
  assert.deepEqual(layoutIssues(fig), []);
  assert.ok(!fig.includes('x="100" y="40"'));
});

test('svg() throws instead of emitting an unplaceable pinned label', () => {
  assert.throws(() => svg('בדיקה', 60, line(0, 30, 300, 30) + txt(100, 32, 'שלום', 'k', 'middle', true)), /overlap/);
});

test('preview page: static, RTL, every diagram in grid and at 320px, and current', () => {
  const html = readFileSync(new URL('../preview/diagrams.html', import.meta.url), 'utf8');
  assert.equal(html, previewHtml(list));
  assert.match(html, /dir="rtl"/);
  assert.ok(!/<script/i.test(html));
  assert.equal((html.match(/<svg /g) || []).length, list.length * 2);
  for (const ex of list) assert.ok(html.includes(ex.id) && html.includes(ex.title), ex.id);
  assert.match(html, /width:320px/);
});

test('freshness comparison ignores CRLF vs LF', async () => {
  const { lf, sameText } = await import('../tools/diagrams.mjs');
  const html = previewHtml(list.map((ex) => ({ ...ex, diagram: diagramFor(ex) })));
  assert.ok(!html.includes('\r'));
  assert.ok(sameText(html.replace(/\n/g, '\r\n'), html));
  assert.ok(sameText(html, html.replace(/\n/g, '\r\n')));
  for (const ex of list) assert.ok(sameText(ex.diagram.replace(/\n/g, '\r\n'), diagramFor(ex)), ex.id);
  assert.equal(lf('a\r\nb\rc\n'), 'a\nb\nc\n');
  assert.ok(!sameText('a\r\nb', 'a\nc'));
});
