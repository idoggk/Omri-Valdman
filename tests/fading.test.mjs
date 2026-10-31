import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const F = await import('../js/fading-ui.js');
const B = await import('../js/backup.js');
const { validateFading, scopeOf } = await import('../tools/verify-fading.mjs');

const read = (f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'));
const examples = () => read('examples.json');
const fading = () => read('fading.json');

test('fading data: every example has key steps consistent with its own verified data; stages hide valid subsets', () => {
  assert.equal(examples().length, 14);
  assert.deepEqual(validateFading(fading(), examples()), []);
});

test('fading verifier catches wrong values, missing examples and bad structure', () => {
  const bad = (mut) => { const d = fading(); mut(d); return validateFading(d, examples()).join('\n'); };
  assert.match(bad((d) => { d.examples['ex-math-3-elim'][3].asks[0].value = 3; }), /ex-math-3-elim: step 4 "x": value 3 but example data gives 2/);
  assert.match(bad((d) => { d.examples['ex-phys-vertical-roof'][2].asks[1].value = 6; }), /ex-phys-vertical-roof/);
  assert.match(bad((d) => { delete d.examples['ex-phys-horizontal-vt']; }), /ex-phys-horizontal-vt: no key steps/);
  assert.match(bad((d) => { d.examples['ex-math-4-split'][0].asks[0].value = 6.123; }), /2 decimals/);
  assert.match(bad((d) => { d.examples['ex-math-3-quad'][1].step = 99; }), /invalid step/);
  assert.match(bad((d) => { d.examples['ex-math-3-quad'].pop(); d.examples['ex-math-3-quad'].pop(); }), /at least 3/);
  assert.match(bad((d) => { d.examples['nope'] = []; }), /unknown example id/);
  assert.ok(scopeOf(examples()[1]).S.length === 2);
});

test('stages hide: none, one, about half, all', () => {
  const keys = (n) => Array.from({ length: n }, (_, i) => ({ step: i }));
  for (let n = 3; n <= 7; n++) {
    assert.deepEqual(F.hiddenKeys(keys(n), 1), []);
    assert.equal(F.hiddenKeys(keys(n), 2).length, 1);
    const s3 = F.hiddenKeys(keys(n), 3).length;
    assert.ok(s3 > 1 && s3 < n, `n=${n}`);
    assert.equal(F.hiddenKeys(keys(n), 4).length, n);
  }
});

test('storage: own key in the backup allowlist, sanitizer keeps stage order', () => {
  assert.equal(F.FADING_KEY, 'omri-study-fading-v1');
  assert.ok(F.FADING_KEY in B.KNOWN_KEYS);
  const v = JSON.stringify({ v: 1, items: { a: { done: [true, false, false, false], revealed: [0, 0, 0, 0], ts: 1 } } });
  const m = new Map([[F.FADING_KEY, v]]);
  assert.equal(JSON.parse(B.buildBackup({ getItem: (k) => m.get(k) ?? null }, 1)).data[F.FADING_KEY], v);
  const s = F.sanitizeFading({ items: { a: { done: [true, false, true, true], revealed: [0, 'x', -1, 2] }, b: 5 } });
  assert.deepEqual(s.items.a.done, [true, false, false, false]);
  assert.deepEqual(s.items.a.revealed, [0, 0, 0, 2]);
  assert.equal(s.items.b, undefined);
  assert.deepEqual(F.sanitizeFading('garbage'), { v: 1, items: {} });
});

test('UI: list with 4-stage marks, stages unlock in order, immediate feedback, reveal after 2 misses, completion recorded', async () => {
  globalThis.localStorage.removeItem(F.FADING_KEY);
  const ctx = { show: dom.show, fading: fading().examples, fadingExamples: examples() };
  const stored = () => JSON.parse(localStorage.getItem(F.FADING_KEY)).items['ex-math-3-elim'];
  dom.root.replaceChildren();
  await F.viewFadingRoute(ctx);
  assert.match(dom.root.textContent, /0 מתוך 56 שלבים הושלמו/);
  assert.equal(dom.root.all((n) => n.tagName === 'A' && /^#\/fading\/ex-/.test(n.getAttribute('href') || '')).length, 14);

  await F.viewFadingRoute(ctx, 'ex-math-3-elim');
  const tab = (s) => dom.root.all((n) => n.tagName === 'BUTTON' && n.getAttribute('role') === 'tab')[s - 1];
  assert.ok(!tab(1).disabled && tab(2).disabled && tab(3).disabled && tab(4).disabled);
  dom.root.byText('button', 'הבנתי').click();
  assert.deepEqual(stored().done, [true, false, false, false]);
  assert.ok(!tab(2).disabled && tab(3).disabled);

  // stage 2: one hidden key step (key index 1 of 4 -> the coefficient of z)
  tab(2).click();
  let inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, 1);
  assert.ok(!dom.root.textContent.includes('(3x − 2x)')); // the hidden step text is not shown
  inputs[0].value = '7';
  dom.root.byText('button', 'בדיקה').click();
  assert.match(dom.root.textContent, /לא מדויק, נסו שוב/);
  assert.ok(dom.root.byText('button', 'הצגת התשובה').hidden);
  dom.root.byText('button', 'בדיקה').click();
  assert.ok(!dom.root.byText('button', 'הצגת התשובה').hidden);
  inputs[0].value = '3';
  dom.root.byText('button', 'בדיקה').click();
  assert.match(dom.root.textContent, /שלב 2 הושלם/);
  assert.deepEqual(stored().done, [true, true, false, false]);
  assert.equal(stored().revealed[1], 0);

  // stage 3: half of the key steps hidden
  tab(3).click();
  inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, 2);

  // stage 4: only the question, entries in order; the reveal button resolves an entry and is recorded
  inputs[0].value = '5'; inputs[1].value = '−28';
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'בדיקה').forEach((b) => b.click());
  assert.deepEqual(stored().done, [true, true, true, false]);
  tab(4).click();
  assert.ok(!dom.root.textContent.includes('נבחר לחסל'));
  inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, 6);
  assert.ok(!inputs[0].disabled && inputs[1].disabled && inputs[5].disabled);
  const answers = [5, 3, -28, 2, -1, 3];
  for (let i = 0; i < 6; i++) {
    assert.ok(!inputs[i].disabled, `entry ${i} unlocked`);
    if (i === 3) { // x: miss twice, then reveal
      inputs[i].value = '9';
      const btns = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'בדיקה');
      btns[i].click(); btns[i].click();
      dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'הצגת התשובה' && !n.hidden)[0].click();
    } else {
      inputs[i].value = String(answers[i]).replace('-', '−');
      dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'בדיקה')[i].click();
    }
  }
  assert.match(dom.root.textContent, /שלב 4 הושלם/);
  assert.deepEqual(stored().done, [true, true, true, true]);
  assert.equal(stored().revealed[3], 1);

  await F.viewFadingRoute(ctx, 'missing');
  assert.match(dom.root.textContent, /הדוגמה לא נמצאה/);
});
