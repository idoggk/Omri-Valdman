import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { isolateFormulas, isolateFormulasHtml, ltrIsolate } from '../js/bidi.js';

const dom = installFakeDom();
const D = await import('../js/drills-ui.js');
const M = await import('../js/findmistake-ui.js');

test('inline equation inside Hebrew gets one isolate', () => {
  const out = isolateFormulas('נתון ש x + y + z = 6 ולכן z חיובי');
  assert.ok(out.includes(ltrIsolate('x + y + z = 6')));
  assert.ok(out.startsWith('נתון ש '));
});

test('html: tags and entities are untouched, text equations isolated', () => {
  const out = isolateFormulasHtml('<p>אם x &lt; 3 אז <b>2x + y = 5</b></p>');
  assert.ok(out.includes('&lt;'));
  assert.ok(!out.includes('&' + '⁦'));
  assert.ok(out.includes('<b>' + ltrIsolate('2x + y = 5') + '</b>'));
  assert.equal(isolateFormulasHtml('<p>בלי נוסחאות</p>'), '<p>בלי נוסחאות</p>');
});

test('drills screen isolates the equation in the question', async () => {
  const data = { traps: [{ id: 't1', topic: 'math-3', trapId: 'tr', question: 'מה הערך של x + y + z = 6 כש z = 1?', options: ['x + y = 5', '7'], correct: 0, explain: 'כי x + y = 5.' }], sanity: [], cards: [] };
  const ctx = { show: dom.show, topics: [], exercises: [], fetchFn: async () => ({ ok: true, json: async () => data }) };
  D.resetDrillCache();
  await D.viewDrills(ctx);
  dom.root.byText('button', 'מלכודות נפוצות').click();
  assert.ok(dom.root.textContent.includes(ltrIsolate('x + y + z = 6')));
  const opt = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.includes('x + y = 5'))[0];
  assert.ok(opt.textContent.includes(ltrIsolate('x + y = 5')));
  opt.click();
  assert.ok(dom.root.textContent.includes(ltrIsolate('x + y = 5')));
});

test('find-the-mistake screen isolates equations in statement and steps', async () => {
  const data = [{ id: 'f1', topic: 'math-3', title: 't', statement: 'פתרו x + y + z = 6', steps: [{ text: 'מחסרים: x + y = 4' }, { text: 'לכן z = 2' }], firstWrong: 0, whyWrong: 'w', correctedStep: 'x + y = 4' }];
  M.resetFindMistakeCache();
  await M.viewHunt({ show: dom.show, fetchFn: async () => ({ ok: true, json: async () => data }) }, 'f1');
  const html = dom.root.all(() => true).map((n) => n.innerHTML).join('');
  assert.ok(html.includes(ltrIsolate('x + y + z = 6')));
  assert.ok(html.includes(ltrIsolate('x + y = 4')));
});

test('real data: no entity is broken by isolation', () => {
  const items = JSON.parse(readFileSync(new URL('../data/findmistake.json', import.meta.url), 'utf8'));
  for (const it of items) for (const t of [it.statement, ...it.steps.map((s) => s.text)]) {
    const out = isolateFormulasHtml(t).replace(/[⁦⁩]/g, '');
    assert.equal(out, t);
  }
});
