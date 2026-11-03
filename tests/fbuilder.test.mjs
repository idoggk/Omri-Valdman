import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const F = await import('../js/fbuilder.js');
const UI = await import('../js/fbuilder-ui.js');
const NB = await import('../js/notebook.js');
const B = await import('../js/backup.js');
const S = await import('../js/srs.js');
const store = await import('../js/store.js');
const { verifyCatalogue } = await import('../tools/verify-formulas.mjs');

const cat = JSON.parse(readFileSync(new URL('../data/formula-catalogue.json', import.meta.url), 'utf8'));
const item = (id) => cat.items.find((q) => q.id === id);
const fetchFn = async () => ({ ok: true, json: async () => cat });
const fake = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };

test('catalogue passes the independent verifier (reference values and really-different traps)', () => {
  const r = verifyCatalogue(cat);
  assert.deepEqual(r.errs, []);
  assert.ok(r.numeric >= 40);
});

test('every reference is accepted and every trap is rejected and recognised', () => {
  for (const q of cat.items.filter((x) => x.kind === 'expr')) {
    const ok = F.checkAnswer(q, q.ref);
    assert.ok(ok.valid && ok.correct, `${q.id}: reference rejected`);
    for (const t of q.traps) {
      const r = F.checkAnswer(q, t.expr);
      assert.ok(r.valid && !r.correct, `${q.id}: trap ${t.expr} accepted`);
      assert.equal(r.trap && r.trap.expr, t.expr, `${q.id}: trap not recognised`);
    }
  }
});

test('equivalence, not string match: other correct forms are accepted', () => {
  assert.ok(F.checkAnswer(item('fc-cos2'), '2*cos(x)^2-1').correct);
  assert.ok(F.checkAnswer(item('fc-cos2'), '1 - 2*sin(x)^2').correct);
  assert.ok(F.checkAnswer(item('fc-pow-mul'), 'a^n*a^m').correct);
  assert.ok(F.checkAnswer(item('fc-log-quot'), '-(log(y)-log(x))').correct);
  assert.ok(F.checkAnswer(item('fc-quad-root'), '(-b+sqrt(b^2-4*a*c))/(2*a)').correct);
  assert.ok(F.checkAnswer(item('fc-quad-root'), '-b/(2*a)+sqrt(b^2-4*a*c)/(2*a)').correct);
  assert.ok(F.checkAnswer(item('fc-k-x'), 'v0*t+0.5*a*t^2').correct);
  assert.ok(!F.checkAnswer(item('fc-quad-root'), '(-b-sqrt(b^2-4*a*c))/(2*a)').correct, 'the other root is a different formula');
});

test('whitespace, unicode minus and times signs are normalised', () => {
  assert.ok(F.checkAnswer(item('fc-quad-vsum'), '  − b / a ').correct);
  assert.ok(F.checkAnswer(item('fc-sin2'), '2 × sin( x ) × cos( x )').correct);
  assert.ok(F.checkAnswer(item('fc-sin2'), '2*SIN(x)*cos(x)').valid === false, 'function names are case sensitive');
});

test('implicit multiplication is rejected with a clear message (never guessed)', () => {
  const q = item('fc-sin2');
  for (const bad of ['2sin(x)cos(x)', '2x', 'x(2)', '(x)(x)', '2(x)', 'sin(x)cos(x)']) {
    const r = F.checkAnswer(q, bad);
    assert.equal(r.valid, false, bad);
    assert.equal(r.code, 'implicit', `${bad}: ${r.code}`);
    assert.match(r.error, /\*/);
  }
  assert.equal(F.checkAnswer(item('fc-k-x'), 'v0t').code, 'unknown', 'v0t is not a variable');
});

test('syntax errors are explained and use up nothing', () => {
  const q = item('fc-sin2');
  assert.equal(F.checkAnswer(q, '').code, 'empty');
  assert.equal(F.checkAnswer(q, '   ').code, 'empty');
  assert.equal(F.checkAnswer(q, 'sin x').code, 'function');
  assert.equal(F.checkAnswer(q, '2*(sin(x)').code, 'syntax');
  assert.equal(F.checkAnswer(q, '2*sin(x))').code, 'syntax');
  assert.equal(F.checkAnswer(q, '2*sin(x)*').code, 'syntax');
  assert.equal(F.checkAnswer(q, '2*sin(z)').code, 'unknown');
  assert.equal(F.checkAnswer(q, 'sin(x)$').code, 'char');
  assert.equal(F.checkAnswer(q, 'x'.repeat(200)).code, 'long');
});

test('precedence: unary minus, power is right associative, division is left associative', () => {
  const run = (src, env = {}) => F.parseFormula(src, ['x', 'a', 'b', 'c']).fn(env);
  assert.equal(run('-x^2', { x: 3 }), -9);
  assert.equal(run('2^-1'), 0.5);
  assert.equal(run('2^3^2'), 512);
  assert.equal(run('a/b/c', { a: 24, b: 4, c: 3 }), 2);
  assert.equal(run('a-b-c', { a: 10, b: 3, c: 2 }), 5);
  assert.equal(run('2*x^2', { x: 3 }), 18);
});

test('sample points are deterministic and cover 20 valid points', () => {
  const q = item('fc-tan2');
  const a = F.samplePoints(q), b = F.samplePoints(q);
  assert.equal(a.length, F.CHECK_POINTS);
  assert.deepEqual(a, b);
});

test('state: right answers enter the sheet, wrong ones queue Leitner cards due at once', () => {
  const st = F.emptySaved();
  F.recordCheck(st, 'fc-sin2', true, 1000);
  assert.ok(F.onSheet(st, 'fc-sin2'));
  assert.equal(st.cards['fc-sin2'], undefined);
  F.recordCheck(st, 'fc-cos2', false, 2000);
  assert.ok(!F.onSheet(st, 'fc-cos2'));
  assert.equal(st.cards['fc-cos2'].box, 0);
  assert.deepEqual(F.dueQueue(st, cat.items, 2000).map((q) => q.id), ['fc-cos2']);
  F.recordCheck(st, 'fc-cos2', true, 3000); // retyped right later
  assert.ok(F.onSheet(st, 'fc-cos2'));
  assert.equal(st.cards['fc-cos2'].box, 1);
  assert.deepEqual(F.dueQueue(st, cat.items, 3000), [], 'the card is due after a day, not now');
  assert.equal(F.dueQueue(st, cat.items, 3000 + 2 * 86400000).length, 1);
  assert.ok(!F.buildQueue(st, cat.items).some((q) => ['fc-sin2', 'fc-cos2'].includes(q.id)));
  assert.equal(F.buildQueue(st, cat.items, 'trig').every((q) => q.topic === 'trig'), true);
  const groups = F.sheetGroups(st, cat);
  assert.deepEqual(groups.map((g) => g.topic.id), ['trig']);
  assert.equal(groups[0].items.length, 2);
});

test('persistence: round trip, junk is dropped, corrupt storage gives an empty state', () => {
  const s = fake();
  const st = F.emptySaved();
  F.recordCheck(st, 'fc-sin2', true, 5);
  F.recordCheck(st, 'fc-sin3', false, 6);
  F.saveSaved(st, s);
  assert.deepEqual(F.loadSaved(s), st);
  const dirty = F.sanitizeSaved({ sheet: { 'fc-ok': { ts: 1, tries: 2 }, other: { ts: 1 } }, cards: { 'fc-ok': { box: 99, due: -5 }, bad: { box: 1 } }, stats: 5 });
  assert.deepEqual(Object.keys(dirty.sheet), ['fc-ok']);
  assert.deepEqual(Object.keys(dirty.cards), ['fc-ok']);
  assert.equal(dirty.cards['fc-ok'].box, 5);
  s.setItem(F.KEY, '{not json');
  assert.deepEqual(F.loadSaved(s), F.emptySaved());
});

test('backup: the new key is known and the saved sheet survives a backup round trip', () => {
  assert.ok(F.KEY in B.KNOWN_KEYS);
  const s = fake();
  const st = F.emptySaved();
  F.recordCheck(st, 'fc-sin2', true, 5);
  F.saveSaved(st, s);
  const code = B.buildBackup(s, 10);
  assert.ok(JSON.parse(code).data[F.KEY]);
});

test('a wrong formula goes to the attempt log and the error notebook through the notebook API', async () => {
  dom.store.clear();
  store.resetCache();
  F.resetCatalogueCache();
  const res = await F.loadCatalogue(fetchFn);
  assert.ok(res.ok);
  const ctx = { topics: [], exercises: [], byId: () => null, hard: null, hardTitle: (id) => id };
  const q = item('fc-sin2');
  UI.applyResult(ctx, q, false, 12);
  const log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.at(-1).exerciseId, 'fm-fc-sin2');
  assert.equal(log.at(-1).topic, 'formulas');
  assert.equal(log.at(-1).outcome, 'wrong');
  const nb = JSON.parse(dom.store.get(NB.KEY));
  const e = nb.entries['fm-fc-sin2'];
  assert.ok(e, 'notebook entry created');
  assert.match(e.title, /סינוס של זווית כפולה/);
  assert.match(e.key, /2\*sin\(x\)\*cos\(x\)/);
  assert.equal(e.href, '#/formulas');
  const saved = F.loadSaved();
  assert.equal(saved.cards['fc-sin2'].box, 0);
  UI.applyResult(ctx, q, true, 9);
  assert.ok(F.onSheet(F.loadSaved(), 'fc-sin2'));
  assert.equal(JSON.parse(dom.store.get('omri-study-attempts-v1')).at(-1).outcome, 'alone');
});

test('formula attempts are an engine topic with a Hebrew title and link', async () => {
  const E = await import('../js/engine.js');
  assert.match(E.topicTitle('formulas'), /נוסחאות/);
  assert.equal(E.topicHref('formulas'), '#/formulas');
  assert.equal(E.itemHref('fm-fc-sin2', 'formulas'), '#/formulas');
  assert.ok(!S.isReservedTopic('formulas'));
});

test('print css: the sheet prints on A4 in two columns', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /@page\s*\{\s*size:\s*A4/);
  const printBlock = css.slice(css.lastIndexOf('@media print'));
  assert.match(printBlock, /\.fs-sheet\s*\{[^}]*column-count:\s*2/);
  assert.match(printBlock, /\.fs-group[^{]*\{[^}]*break-inside:\s*avoid/);
});

test('routes, hub tile, precache and the screen', async () => {
  const N = await import('../js/nav.js');
  assert.equal(N.resolveRoute('#/formulas/build/trig').name, 'formulas');
  assert.equal(N.resolveRoute('#/booklet/paper/math/4/7').name, 'booklet');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['js/fbuilder.js', 'js/fbuilder-ui.js', 'data/formula-catalogue.json']) assert.ok(sw.includes(`'${f}'`), f);
  // screen: right answer shows the green mark text, wrong shows the correct form
  dom.store.clear();
  store.resetCache();
  const ctx = { topics: [], exercises: [], byId: () => null, hard: null, hardTitle: (id) => id, show: dom.show, fetchFn };
  await UI.viewFormulas(ctx, 'build', 'trig');
  const text = () => dom.root.textContent.replace(/[⁦-⁩]/g, '');
  assert.match(text(), /1 מתוך 9/);
  const input = dom.root.all((n) => n.tagName === 'INPUT')[0];
  input.value = '2*sin(x)';
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'בדיקה')[0].click();
  assert.match(text(), /לא נכון/);
  assert.match(text(), /2\*sin\(x\)\*cos\(x\)/);
  assert.match(text(), /חסר הגורם cos/);
});
