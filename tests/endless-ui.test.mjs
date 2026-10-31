import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
// The shared fake classList only has toggle(); the exercise view also uses add()/remove().
const createElement = document.createElement;
document.createElement = (t) => {
  const el = createElement(t);
  el.classList.add = (c) => el.classList.toggle(c, true);
  el.classList.remove = (c) => el.classList.toggle(c, false);
  const replace = el.replaceChildren.bind(el);
  el.replaceChildren = (...k) => replace(...k.map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
  return el;
};
const store = await import('../js/store.js');
const E = await import('../js/endless-ui.js');
const X = await import('../js/exercise-view.js');
const P = await import('../js/practice-ui.js');
const { generate, listTemplates } = await import('../js/variants.js');

const KEY = 'omri-study-endless-v1';
const ctx = {
  topics: [], exercises: [], byId: () => null, show: dom.show,
  topicOf: () => null, renderExercise: X.renderExercise, newSeed: () => 4242,
};
const text = () => dom.root.textContent;
const btn = (t) => dom.root.byText('button', t);
const inputs = () => dom.root.all((n) => n.tagName === 'INPUT');
const fill = (vals) => inputs().forEach((el, i) => { el.value = vals[i]; });
const submit = () => dom.root.querySelector('form').dispatch('submit');
const fresh = (stored) => {
  dom.store.clear(); store.resetCache(); E.resetEndlessFilter();
  if (stored != null) dom.store.set(KEY, stored);
};

test('picker renders with empty, corrupted, garbage and populated storage', () => {
  for (const stored of [null, '{not json', '{"tpl":5}', '[1]', JSON.stringify({ v: 1, tpl: { 'm3-linear-int': { attempts: 3, alone: 1, hinted: 1 } } })]) {
    fresh(stored);
    E.viewEndless(ctx);
    assert.match(text(), /תרגול בלי די בריגים/);
    assert.ok(btn('3 נעלמים') && btn('4 נעלמים') && btn('תנועה אנכית') && btn('תנועה אופקית') && btn('הכול'));
    assert.ok(btn('התחילו לתרגל'));
  }
  assert.match(text(), /ניסיונות: 3 · נפתרו לבד: 1/);
});

test('picker: topic narrows the template filter and start opens a variant of that topic', () => {
  fresh(null);
  E.viewEndless(ctx);
  btn('4 נעלמים').click();
  const expected = listTemplates().filter((t) => t.topic === 'math-4');
  for (const t of expected) assert.ok(btn(t.title), t.title);
  assert.equal(btn('מערכת 3×3 עם פתרון שלם'), null);
  btn(expected[0].title).click();
  btn('התחילו לתרגל').click();
  assert.equal(location.hash, `#/endless/${expected[0].id}/4242`);
  btn('4 נעלמים'); // still rendered
});

test('variant view: same seed is the same exercise, wrong then right answer is counted', () => {
  fresh(null);
  const ex = generate('m3-linear-int', 77);
  E.viewEndless(ctx, 'm3-linear-int', '77');
  assert.match(text(), /וריאנט הבא/);
  assert.equal(inputs().length, ex.inputs.length);
  fill(ex.inputs.map(() => '12345'));
  submit();
  assert.match(text(), /יש טעות בתשובה/);
  fill(ex.inputs.map((s) => s.answer));
  submit();
  assert.match(text(), /נכון!/);
  assert.match(text(), /נפתר לבד/);
  assert.deepEqual(store.loadEndless().tpl['m3-linear-int'], { attempts: 1, alone: 1, hinted: 0 });
});

test('hints are ordered, then solving counts as with hints', () => {
  fresh(null);
  const ex = generate('ph-throw-up', 5);
  E.viewEndless(ctx, 'ph-throw-up', '5');
  assert.equal(btn('רמז 2').disabled, true);
  btn('רמז 1').click();
  assert.match(text(), /רמז 1:/);
  fill(ex.inputs.map((s) => s.answer));
  submit();
  assert.match(text(), /נפתר עם רמזים/);
  assert.deepEqual(store.loadEndless().tpl['ph-throw-up'], { attempts: 1, alone: 0, hinted: 1 });
});

test('full solution reveal works and counts as an attempt with help, not as a solve alone', () => {
  fresh(null);
  E.viewEndless(ctx, 'm4-linear', '9');
  btn('הציגו פתרון מלא').click();
  btn('כן, הציגו פתרון').click();
  assert.match(text(), /פתרון מלא/);
  assert.deepEqual(store.loadEndless().tpl['m4-linear'], { attempts: 1, alone: 0, hinted: 1 });
});

test('endless results stay out of the review queue, the attempt log and the main progress', () => {
  fresh(null);
  const ex = generate('m3-linear-int', 3);
  E.viewEndless(ctx, 'm3-linear-int', '3');
  fill(ex.inputs.map(() => '999'));
  submit();
  btn('הציגו פתרון מלא').click();
  btn('כן, הציגו פתרון').click();
  assert.deepEqual(store.getAttempts(), []);
  assert.deepEqual(store.reviewQueue([ex.id]), []);
  assert.equal(store.outcomeOf(ex.id), null);
  assert.ok(![...dom.store.keys()].some((k) => k !== KEY && /progress|attempts/.test(k)));
});

test('diagram is rendered when the variant has one', () => {
  fresh(null);
  const withDiagram = listTemplates().map((t) => generate(t.id, 11)).find((e) => typeof e.diagram === 'string');
  if (!withDiagram) return; // generator currently has no diagrams
  E.viewEndless(ctx, withDiagram.id.replace(/^var-/, '').replace(/-11$/, ''), '11');
  assert.ok(dom.root.all((n) => n.tagName === 'FIGURE').length >= 1);
});

test('next variant and same type again set a fresh seed in the URL', () => {
  fresh(null);
  E.viewEndless(ctx, 'ph-horizontal', '10');
  btn('עוד תרגיל מאותו סוג').click();
  assert.equal(location.hash, '#/endless/ph-horizontal/4242');
  E.viewEndless(ctx, 'ph-horizontal', '4242'); // same seed as the generated one: must still move on
  btn('עוד תרגיל מאותו סוג').click();
  assert.equal(location.hash, '#/endless/ph-horizontal/4243');
  // topic filter chosen in the picker is respected by "next variant"
  E.resetEndlessFilter();
  E.viewEndless(ctx);
  btn('3 נעלמים').click();
  E.viewEndless(ctx, 'ph-horizontal', '10');
  assert.ok(btn('וריאנט הבא')); // filter from picker persists
  btn('וריאנט הבא').click();
  assert.match(location.hash, /^#\/endless\/m3-/);
});

test('invalid links show a friendly message instead of throwing', () => {
  fresh(null);
  for (const [t, s] of [['nope', '1'], ['m3-linear-int', 'abc'], ['m3-linear-int', '-5'], ['m3-linear-int', '1e99'], ['m3-linear-int', undefined]]) {
    E.viewEndless(ctx, t, s);
    assert.match(text(), /התרגיל לא נמצא/);
  }
});

test('progress page shows the endless line with empty and populated storage', () => {
  fresh(null);
  P.viewProgress({ ...ctx, topics: [] });
  assert.match(text(), /עדיין לא תרגלתם תרגילים חדשים/);
  fresh(JSON.stringify({ v: 1, tpl: { a: { attempts: 4, alone: 2, hinted: 1 }, b: { attempts: 1, alone: 1, hinted: 0 } } }));
  P.viewProgress({ ...ctx, topics: [] });
  assert.match(text(), /ניסיונות: 5 · נפתרו לבד: 3 · נפתרו עם רמזים או פתרון: 1/);
});

test('store: sanitize drops garbage, recordEndless survives broken storage', () => {
  fresh('{"v":1,"tpl":{"x":{"attempts":-3,"alone":"7","hinted":2.9},"y":5}}');
  assert.deepEqual(store.loadEndless().tpl, { x: { attempts: 0, alone: 0, hinted: 2 } });
  fresh('###');
  store.recordEndless('m3-linear-int', { attempts: 1, alone: 1 });
  assert.deepEqual(store.endlessTotals(), { attempts: 1, alone: 1, hinted: 0 });
});

test('router, home tile and precache are wired', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /parts\[0\] === 'endless'/);
  assert.match(app, /♾️ תרגול בלי די בריגים/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['js/variants.js', 'js/endless-ui.js', 'js/exercise-view.js']) assert.ok(sw.includes(`'${f}'`), f);
});
