import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeElement } from './fake-dom.mjs';

const dom = installFakeDom();
const nav = await import('../js/nav.js');

// Every hash route that existed before the tab bar (v20) plus the new hub.
const OLD = {
  '#/': 'home', '': 'home', '#/topic/math-3': 'topic', '#/ex/m-1': 'ex', '#/progress': 'progress', '#/backup': 'backup',
  '#/summary': 'summary', '#/drills': 'drills', '#/endless': 'endless', '#/endless/math-3/1': 'endless',
  '#/order': 'order', '#/order/run': 'order', '#/methods': 'methods', '#/repair': 'repair', '#/repair/s1': 'repair',
  '#/checkpoints': 'checkpoints', '#/hunt': 'hunt', '#/workout/start': 'workout', '#/workout/3': 'workout',
  '#/workout/summary': 'workout', '#/exam': 'exam', '#/exam/run': 'exam', '#/exam/report': 'exam',
  '#/review/start': 'review-start', '#/review/done': 'review-done', '#/review/m-1': 'review',
  '#/practice-hub': 'practice-hub',
};

test('route table: every previously existing route still resolves', () => {
  for (const [hash, name] of Object.entries(OLD)) assert.equal(nav.resolveRoute(hash).name, name, hash);
  assert.equal(nav.resolveRoute('#/nope').name, 'notfound');
  assert.equal(nav.resolveRoute('#/topic').name, 'notfound');
  assert.equal(nav.resolveRoute('#/%E0%A4%A').name, 'notfound');
  assert.deepEqual(nav.resolveRoute('#/endless/math-3/1').args, ['math-3', '1']);
});

test('active tab by route', () => {
  assert.equal(nav.activeTab('#/'), 'today');
  assert.equal(nav.activeTab('#/workout/start'), 'today');
  assert.equal(nav.activeTab('#/practice-hub'), 'practice');
  assert.equal(nav.activeTab('#/topic/math-3'), 'practice');
  assert.equal(nav.activeTab('#/drills'), 'practice');
  assert.equal(nav.activeTab('#/progress'), 'progress');
  assert.equal(nav.activeTab('#/backup'), 'progress');
});

test('tab bar renders three Hebrew tabs and highlights the active one', () => {
  const el = new FakeElement('nav');
  nav.renderTabBar(el, '#/practice-hub');
  assert.deepEqual(el.children.map((a) => a.children[1].textContent), ['היום', 'תרגול', 'התקדמות']);
  assert.deepEqual(el.children.map((a) => a.getAttribute('href')), ['#/', '#/practice-hub', '#/progress']);
  const active = el.children.filter((a) => a.className.includes('active'));
  assert.equal(active.length, 1);
  assert.equal(active[0].getAttribute('href'), '#/practice-hub');
  assert.equal(active[0].getAttribute('aria-current'), 'page');
  assert.equal(el.hidden, false);
  nav.renderTabBar(el, '#/progress');
  assert.equal(el.children.find((a) => a.className.includes('active')).getAttribute('href'), '#/progress');
});

test('tab bar hidden in exam run and workout questions, visible elsewhere', () => {
  for (const h of ['#/exam/run', '#/workout/1', '#/workout/10']) assert.equal(nav.tabsHidden(h), true, h);
  for (const h of ['#/', '#/exam', '#/exam/report', '#/workout/summary', '#/workout/start', '#/ex/m-1', '#/practice-hub', '#/progress', '#/drills'])
    assert.equal(nav.tabsHidden(h), false, h);
  const el = new FakeElement('nav');
  nav.renderTabBar(el, '#/exam/run');
  assert.equal(el.hidden, true);
  assert.equal(el.getAttribute('aria-hidden'), 'true');
  nav.renderTabBar(el, '#/');
  assert.equal(el.hidden, false);
});

const EXS = [{ id: 'm-1', topic: 'math-3', title: 'Q', inputs: [{ label: 'x', answer: 1 }], level: 1 }];
const ctx = { topics: [{ id: 'math-3', title: 'מתמטיקה' }], exercises: EXS, byId: (id) => EXS.find((e) => e.id === id), show: dom.show };

test('practice hub: groups in learning order, counts on topic tiles', () => {
  nav.viewHub(ctx);
  const heads = dom.root.all((n) => n.tagName === 'H2').map((n) => n.textContent);
  assert.deepEqual(heads, ['לימוד', 'חיזוק יסודות', 'תרגול מונחה', 'מלכודות וטעויות', 'תרגול ללא הגבלה', 'מבחנים', 'עוד: מהירות, יחידות והערכה', 'גיבוי']);
  assert.ok(dom.root.byText('a', '1 תרגילים · הושלמו 0'));
  const hrefs = new Set(dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href')));
  for (const r of ['#/repair', '#/checkpoints', '#/methods', '#/order', '#/drills', '#/hunt', '#/review/start', '#/endless', '#/exam', '#/summary', '#/backup', '#/sprint', '#/units', '#/estimate', '#/topic/math-3'])
    assert.ok(hrefs.has(r), r);
});

test('home: one primary CTA to the workout, no tile grid', async () => {
  globalThis.fetch = async () => ({ ok: false });
  nav.viewHome(ctx);
  const cta = dom.root.byText('a', 'מתחילים אימון');
  assert.equal(cta.getAttribute('href'), '#/workout/start');
  assert.ok(cta.className.includes('primary'));
  assert.equal(dom.root.all((n) => n.className === 'cards').length, 0);
});

test('plan line and continue link', () => {
  assert.equal(nav.planLine({ due: 2, weak: 0, fresh: 3 }, 1), 'האימון של היום: 2 חזרות מתוזמנות · נושא חלש אחד · 3 תרגילים חדשים.');
  assert.equal(nav.continueHref(null, []), null);
  const w = { ids: ['a', 'b', 'c'], startedAt: 10 };
  assert.equal(nav.continueHref(w, []), null);
  assert.equal(nav.continueHref(w, [{ ts: 20, exerciseId: 'a', outcome: 'alone' }]), '#/workout/2');
  assert.equal(nav.continueHref(w, ['a', 'b', 'c'].map((id) => ({ ts: 20, exerciseId: id, outcome: 'alone' }))), null);
});
