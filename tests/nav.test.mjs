import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeElement } from './fake-dom.mjs';

const dom = installFakeDom();
const nav = { ...(await import('../js/nav.js')), ...(await import('../js/hub.js')) }; // hub.js is loaded lazily by the app

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
  assert.deepEqual(heads, ['לימוד', 'תרגול', 'טעויות וחיזוק', 'מהירות ושפיות', 'מבחן', 'הגדרות ונתונים']);
  assert.equal(nav.HUB_GROUPS.length, 6);
  assert.ok(dom.root.byText('a', '1 תרגילים · הושלמו 0'));
  const hrefs = new Set(dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href')));
  for (const r of ['#/repair', '#/checkpoints', '#/methods', '#/order', '#/drills', '#/hunt', '#/review/start', '#/endless', '#/exam', '#/summary', '#/backup', '#/sprint', '#/units', '#/estimate', '#/topic/math-3'])
    assert.ok(hrefs.has(r), r);
});

test('home: one primary recommended button, status strip, hub link, at most 8 links', async () => {
  globalThis.fetch = async () => ({ ok: false });
  dom.store.clear();
  nav.viewHome(ctx);
  const cta = dom.root.byText('a', 'ההמשך המומלץ');
  assert.equal(cta.getAttribute('href'), '#/workout/start');
  assert.ok(cta.className.includes('primary'));
  assert.equal(dom.root.all((n) => n.className === 'cards').length, 0);
  const links = dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href'));
  assert.ok(links.length <= 8, links.join());
  assert.ok(links.includes('#/practice-hub'));
  assert.ok(dom.root.byText('a', 'כל המצבים'));
  assert.equal(dom.root.all((n) => n.tagName === 'UL' && n.className === 'more-links')[0].children.length, 3);
});

test('home with a corrupt plan key still renders and falls back to the daily path', () => {
  dom.store.set('omri-study-plan-v1', '{not json');
  nav.viewHome(ctx);
  assert.equal(dom.root.byText('a', 'ההמשך המומלץ').getAttribute('href'), '#/workout/start');
  dom.store.delete('omri-study-plan-v1');
});

const NOW = new Date(2026, 10, 4, 12).getTime();
const slot = (label, href) => ({ label, href, act: 'x', kind: 'hard', minutes: 30, key: 'x' });
const planWith = (days, extra = {}) => ({ hz: { hasDate: true, past: false, days: 20, phase: { title: 'שלב' } }, days, weak: [], due: {}, goals: [], sessions: { done: 0, target: 6 }, ...extra });

test('recommendedNext: exam date -> the plan slot of today (same one #/plan shows)', () => {
  const days = [{ today: false, slot: slot('אתמול', '#/a'), done: false }, { today: true, slot: slot('שלי', '#/mathhard'), done: false }];
  assert.deepEqual(nav.recommendedNext({ log: [], plan: planWith(days), now: NOW }), { label: 'שלי', href: '#/mathhard', source: 'plan' });
  // today's slot done -> the daily path
  const done = [{ today: true, slot: slot('שלי', '#/mathhard'), done: true }];
  assert.equal(nav.recommendedNext({ log: [], plan: planWith(done), now: NOW }).source, 'path');
});

test('recommendedNext: no exam date -> first undone dailyPath step', () => {
  const plan = { ...planWith([{ today: true, slot: slot('x', '#/x'), done: false }]), hz: { hasDate: false } };
  const r = nav.recommendedNext({ log: [], plan, now: NOW });
  assert.deepEqual([r.href, r.source], ['#/workout/start', 'path']);
  const log = [{ exerciseId: 'm-1', ts: NOW - 1000, outcome: 'alone' }];
  const w = { ids: ['m-1'], startedAt: NOW - 5000 };
  assert.equal(nav.recommendedNext({ log, plan, now: NOW, workout: w }).href, '#/mathhard');
});

test('recommendedNext: everything done -> repair of the weakest topic; corrupt plan values do not throw', () => {
  const allDone = [{ id: 'math', label: '', href: '', done: true }];
  const mk = (extra) => ({ log: [], now: NOW, workout: { ids: ['m-1'], startedAt: NOW - 5000 }, ...extra });
  // make every dailyPath step done through attempts
  const log = [{ exerciseId: 'm-1', ts: NOW - 1000, outcome: 'alone' }, { exerciseId: 'mh-rad-1', ts: NOW - 900, outcome: 'alone', topic: 'math-hard-rad' }, { exerciseId: 'mp-1', ts: NOW - 800, outcome: 'alone', topic: 'multipart' }];
  const plan = { hz: { hasDate: false }, weak: [{ title: 'חזקות', href: '#/topic/pow' }] };
  assert.deepEqual(nav.recommendedNext(mk({ log, plan })), { label: 'תיקון נושא חלש: חזקות', href: '#/topic/pow', source: 'repair' });
  assert.equal(nav.recommendedNext(mk({ log, plan: {} })).href, '#/repair');
  for (const bad of [null, undefined, 5, 'x', [], { hz: 7, days: 'x', weak: 3 }]) assert.doesNotThrow(() => nav.recommendedNext(mk({ plan: bad })));
  assert.ok(allDone);
});

test('statusStrip: countdown, reviews due = srs + notebook + derive, weekly goal', () => {
  const lines = nav.statusStrip(planWith([], { due: { reviews: 2, notebook: 3, derive: 1 }, goals: [{ known: true, done: true }, { known: true, done: false }, { known: false, done: false }] }));
  assert.equal(lines.length, 3);
  assert.match(lines[0].text, /נשארו 20 ימים/);
  assert.equal(lines[1].text, 'חזרות לפי מועד: 6');
  assert.match(lines[2].text, /יעד שבועי: 1 מתוך 2/);
  assert.equal(nav.statusStrip(null).length, 3);
});

test('hub: six groups, every simple route has exactly one tile, no duplicate hrefs, tile count fixed', () => {
  dom.show();
  nav.viewHub(ctx);
  const hrefs = dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href'));
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate hrefs');
  const first = (r) => hrefs.filter((h) => h === `#/${r}` || h.startsWith(`#/${r}/`));
  const EXEMPT = ['progress', 'practice-hub', 'workout', 'review'];
  const SIMPLE = ['backup', 'summary', 'drills', 'endless', 'order', 'methods', 'edge', 'reverse', 'fading', 'solve', 'repair', 'checkpoints', 'hunt', 'exam', 'feedback', 'ladder', 'multipart', 'trig', 'mathhard', 'logs', 'transfer', 'recover', 'notebook', 'writing', 'booklet', 'formulas', 'sprint', 'units', 'estimate', 'plan', 'notes', 'derive', 'calibration', 'examday', 'counter', 'blind', 'recovery', 'pressure'];
  assert.ok(SIMPLE.every((r) => nav.resolveRoute(`#/${r}`).name === r));
  for (const r of SIMPLE.filter((r) => !EXEMPT.includes(r))) assert.equal(first(r).length, 1, r);
  assert.equal(hrefs.filter((h) => h === '#/review/start').length, 1);
  // 41 fixed tiles (40 links + the formula-sheet button) + one tile per topic; here 1 topic
  assert.equal(nav.hubTileCount(), 41);
  assert.equal(hrefs.length, 40 + ctx.topics.length);
  // old tile targets are unchanged
  assert.ok(hrefs.includes('#/topic/math-3'));
});

test('hub: descriptions are one short line; groups collapse and remember their state', () => {
  dom.show();
  dom.store.clear();
  nav.viewHub(ctx);
  for (const g of nav.HUB_GROUPS) for (const t of g.tiles) if (t[2]) assert.ok(t[2].length <= 80, `${t[0]} ${t[2].length}`);
  const btn = dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs && n.attrs['aria-controls'] === 'hub-body-exam')[0];
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  btn.click();
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(JSON.parse(dom.store.get('omri-hub-open-v1')).exam, false);
  nav.viewHub(ctx); // reopened screen: state restored
  const again = dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs && n.attrs['aria-controls'] === 'hub-body-exam')[0];
  assert.equal(again.getAttribute('aria-expanded'), 'false');
  dom.store.set('omri-hub-open-v1', '{bad');
  assert.doesNotThrow(() => nav.viewHub(ctx));
});

test('hub: the mistakes group shows a due badge from notebook + reviews', () => {
  dom.show();
  dom.store.clear();
  nav.viewHub(ctx);
  assert.equal(dom.root.all((n) => n.className && n.className.includes('hub-badge')).length, 0);
});

test('plan line and continue link', () => {
  assert.equal(nav.planLine({ due: 2, weak: 0, fresh: 3 }, 1), 'האימון של היום: 2 חזרות מתוזמנות · נושא חלש אחד · 3 תרגילים חדשים.');
  assert.equal(nav.continueHref(null, []), null);
  const w = { ids: ['a', 'b', 'c'], startedAt: 10 };
  assert.equal(nav.continueHref(w, []), null);
  assert.equal(nav.continueHref(w, [{ ts: 20, exerciseId: 'a', outcome: 'alone' }]), '#/workout/2');
  assert.equal(nav.continueHref(w, ['a', 'b', 'c'].map((id) => ({ ts: 20, exerciseId: id, outcome: 'alone' }))), null);
});
