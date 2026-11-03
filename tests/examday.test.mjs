import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const X = await import('../js/examday.js');
const F = await import('../js/fbuilder.js');
const UI = await import('../js/examday-ui.js');

const catalogue = JSON.parse(readFileSync(new URL('../data/formula-catalogue.json', import.meta.url), 'utf8'));
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

test('timer with an injected clock: start, pause, resume, finish', () => {
  let t = 1000;
  const timer = X.createTimer({ now: () => t, total: 300000 });
  assert.equal(timer.started(), false);
  assert.equal(timer.remainingMs(), 300000);
  timer.start();
  t += 60000;
  assert.equal(timer.elapsedMs(), 60000);
  assert.equal(X.clock(timer.remainingMs()), '4:00');
  timer.pause();
  t += 999999; // paused time does not count
  assert.equal(timer.elapsedMs(), 60000);
  assert.equal(timer.running(), false);
  timer.resume();
  t += 239999;
  assert.equal(timer.finished(), false);
  assert.equal(X.clock(timer.remainingMs()), '0:01');
  t += 1;
  assert.equal(timer.finished(), true);
  assert.equal(timer.remainingMs(), 0);
  t += 50000;
  assert.equal(timer.elapsedMs(), 300000); // never beyond the total
  timer.start(); // a finished timer cannot restart
  assert.equal(timer.running(), false);
  timer.reset();
  assert.equal(timer.remainingMs(), 300000);
  assert.equal(X.clock(299500), '5:00');
  assert.equal(X.clock(0), '0:00');
});

test('5 random formulas: distinct, only equivalence-checked kinds, spread over topics, deterministic with a seed', () => {
  const a = X.pickFormulas(catalogue.items, seeded(1));
  const b = X.pickFormulas(catalogue.items, seeded(1));
  const c = X.pickFormulas(catalogue.items, seeded(2));
  assert.equal(a.length, 5);
  assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
  assert.notDeepEqual(a.map((q) => q.id), c.map((q) => q.id));
  assert.equal(new Set(a.map((q) => q.id)).size, 5);
  assert.ok(a.every((q) => q.kind === 'expr'));
  assert.equal(new Set(a.map((q) => q.topic)).size, 5); // 10 topics, so one formula per topic
  assert.equal(X.pickFormulas(catalogue.items.slice(0, 2), seeded(1)).length, 2);
  assert.deepEqual(X.pickFormulas(null), []);
});

test('formula equivalence check accepts the reference in another form and rejects a trap', () => {
  const item = catalogue.items.find((q) => q.id === 'fc-pow-mul');
  assert.equal(F.checkAnswer(item, 'a^n*a^m').correct, true);
  assert.equal(F.checkAnswer(item, 'a^(m*n)').correct, false);
});

test('time allocation is computed from marks and adds up to the exam time', () => {
  const r = X.allocateTime(90, [25, 25, 25, 25]);
  assert.equal(r.ok, true);
  assert.equal(r.read, 5);
  assert.equal(r.review, 9);
  assert.deepEqual(r.perQuestion.map((q) => q.minutes), [19, 19, 19, 19]); // 76 working minutes
  const total = (x) => x.read + x.review + x.perQuestion.reduce((s, q) => s + q.minutes, 0);
  assert.equal(total(r), 90);
  const u = X.allocateTime(180, [10, 20, 30, 40]);
  assert.ok(u.perQuestion[3].minutes > u.perQuestion[0].minutes * 3.5);
  assert.equal(total(u), 180);
  const odd = X.allocateTime(95, [33, 33, 34]);
  assert.equal(total(odd), 95);
  assert.equal(X.allocateTime(5, [10]).ok, false);
  assert.equal(X.allocateTime(90, []).ok, false);
});

test('marks parsing', () => {
  assert.deepEqual(X.parseMarks('25, 25 20;30'), [25, 25, 20, 30]);
  assert.equal(X.parseMarks(''), null);
  assert.equal(X.parseMarks('25, x'), null);
  assert.equal(X.parseMarks('0, 5'), null);
  assert.equal(X.parseMarks('-5'), null);
});

test('completion count and last date are saved, merged and shown only in the last two weeks', () => {
  const s = X.emptyState();
  assert.match(X.statusText(s, 1e9), /עוד לא עשיתם/);
  const day = 86400000;
  const now = Date.UTC(2026, 10, 20);
  X.recordCompletion(s, { now: now - 3 * day, seconds: 280, formulas: { ok: 4, n: 5 } });
  X.recordCompletion(s, { now, seconds: 300, formulas: { ok: 9, n: 99 } });
  assert.equal(s.count, 2);
  assert.equal(s.last, now);
  assert.deepEqual(s.lastFormulas, { ok: 5, n: 5 });
  assert.match(X.statusText(s, now), /2 פעמים.*היום/);
  assert.match(X.statusText(s, now + 2 * day), /לפני 2 ימים/);
  const m = JSON.parse(X.mergeExamday(JSON.stringify({ v: 1, count: 5, last: 10 }), JSON.stringify({ v: 1, count: 3, last: 99, lastSeconds: 7 })));
  assert.equal(m.count, 5);
  assert.equal(m.last, 99);
  assert.equal(m.lastSeconds, 7);
  assert.equal(X.sanitize({ count: 'x', last: -1 }).count, 0);
  assert.equal(X.inWindow(14), true);
  assert.equal(X.inWindow(15), false);
  assert.equal(X.inWindow(0), true);
  assert.equal(X.inWindow(-1), false);
  assert.equal(X.inWindow(null), false);
});

test('page: shows 5 formulas, the checklists and saves a completion', async () => {
  dom.store.clear();
  const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8')) });
  const ctx = { show: dom.show, fetchFn };
  F.resetCatalogueCache();
  await UI.viewExamDay(ctx);
  const text = () => dom.root.textContent.replace(/[⁦⁩]/g, '');
  assert.match(text(), /5 נוסחאות מהזיכרון/);
  assert.match(text(), /ציוד/);
  assert.match(text(), /g = 10 מ\/ש²/);
  assert.match(text(), /שאפו|נשימה רגועה/);
  assert.match(text(), /שאלה 4 \(25 נקודות\): 19 דקות/);
  dom.root.byText('button', 'סיימתי את החזרה').click();
  assert.equal(X.load().count, 1);
  assert.match(text(), /נשמר/);
});
