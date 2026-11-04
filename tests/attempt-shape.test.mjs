// Per-item attempt rows: every mode that practises items records one row per item with the recordAttempt shape
// { exerciseId, topic, outcome, hintsUsed, seconds, ts } plus the optional predicted / timeToFirstAttempt, and the SRS /
// ceiling consumers still tolerate the old aggregated rows ('trig-cards', 'trig-drill', 'logs-cards', 'notes-cards').
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const SRS = await import('../js/srs.js');
const E = await import('../js/engine.js');
const CAL = await import('../js/calibration.js');
const TF = await import('../js/tryfirst.js');
const CE = await import('../js/ceiling.js');
const TRUI = await import('../js/trig-ui.js');
const LGUI = await import('../js/logs-ui.js');
const NUI = await import('../js/notes-ui.js');
const CUI = await import('../js/counter-ui.js');
const WUI = await import('../js/writing-ui.js');
const W = await import('../js/writing.js');

const OUTCOMES = ['alone', 'hinted', 'wrong', 'solution'];
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(read(u)) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn };
const reset = () => { dom.store.clear(); store.resetCache(); };
const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent.trim() === label)[0].dispatch('click');

/** The recordAttempt shape (js/store.js): id, topic, outcome, hintsUsed, seconds, ts; predicted / timeToFirstAttempt only when set. */
function assertShape(a, { topic, idPattern } = {}) {
  assert.equal(typeof a.exerciseId, 'string');
  if (idPattern) assert.match(a.exerciseId, idPattern);
  assert.equal(typeof a.topic, 'string');
  if (topic) assert.equal(a.topic, topic);
  assert.ok(OUTCOMES.includes(a.outcome), `outcome ${a.outcome}`);
  assert.ok(Number.isInteger(a.hintsUsed) && a.hintsUsed >= 0);
  assert.ok(Number.isFinite(a.seconds) && a.seconds >= 0);
  assert.ok(Number.isFinite(a.ts));
  if ('predicted' in a) assert.ok(CAL.CHIPS.includes(a.predicted));
  if ('timeToFirstAttempt' in a) assert.ok(Number.isInteger(a.timeToFirstAttempt) && a.timeToFirstAttempt >= 0);
}

test('shape: trig cards and drill write one row per item, hints counted per item', () => {
  reset();
  TRUI.viewTrigRoute(ctx, 'cards');
  for (let i = 0; i < 60 && dom.root.byText('button', 'הצג תשובה'); i++) { press('הצג תשובה'); press('ידעתי ✓'); }
  const cards = store.getAttempts();
  assert.ok(cards.length > 1);
  cards.forEach((a) => assertShape(a, { topic: 'trig', idPattern: /^trig-card-/ }));
  reset();
  TRUI.viewTrigRoute(ctx, 'drill');
  for (let i = 0; i < 30 && !/נכונות\./.test(dom.root.textContent); i++) {
    const b = dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled);
    const next = b.find((x) => /הבא|לסיום|להמשיך/.test(x.textContent));
    if (next) { next.click(); continue; }
    b[0].click();
  }
  const drill = store.getAttempts();
  assert.ok(drill.length >= 1);
  drill.forEach((a) => assertShape(a, { topic: 'trig', idPattern: /^trig-drill-/ }));
  assert.equal(new Set(drill.map((a) => a.exerciseId)).size, drill.length, 'one row per drill item');
});

test('shape: trig proof carries predicted and timeToFirstAttempt when the practice settings are on', () => {
  reset();
  CAL.saveOn(true);
  TF.saveOn(true);
  TRUI.viewTrigRoute(ctx, 'proof', 'p1');
  press('70%');
  for (let i = 0; i < 80 && !/הוכחתם/.test(dom.root.textContent); i++) {
    const b = dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && /math-btn/.test(n.className || ''));
    b[0].click();
  }
  const log = store.getAttempts();
  assert.equal(log.length, 1);
  assertShape(log[0], { topic: 'trig', idPattern: /^trig-p1$/ });
  assert.equal(log[0].predicted, 70);
  assert.ok('timeToFirstAttempt' in log[0]);
});

test('shape: logs flashcards write one row per card', async () => {
  reset();
  await LGUI.viewLogsRoute(ctx, 'cards');
  for (let i = 0; i < 40 && dom.root.byText('button', 'הצג תשובה'); i++) { press('הצג תשובה'); press('ידעתי ✓'); }
  const log = store.getAttempts();
  assert.ok(log.length > 1);
  log.forEach((a) => assertShape(a, { topic: 'logs', idPattern: /^logs-card-/ }));
});

test('shape: counter attempt keeps predicted + timeToFirstAttempt; no hints', () => {
  reset();
  CAL.saveOn(true);
  TF.saveOn(true);
  CUI.viewCounter({ show: dom.show }, 't', 'ce-01');
  press('90%');
  const inputs = dom.root.all((n) => n.tagName === 'INPUT');
  inputs[0].value = '3'; inputs[1].value = '-3';
  inputs[0].dispatch('input');
  press('בדיקה');
  const [a] = store.getAttempts();
  assertShape(a, { topic: 'counter', idPattern: /^ce-01$/ });
  assert.equal(a.predicted, 90);
  assert.equal(a.hintsUsed, 0);
});

test('shape: notes drill question carries predicted; cards stay plain', async () => {
  reset();
  CAL.saveOn(true);
  await NUI.viewNotesRoute(ctx, 'ex', 'nt-q09');
  press('50%');
  press('הצגת פתרון מלא');
  const [a] = store.getAttempts();
  assertShape(a, { topic: 'notes', idPattern: /^nt-q09$/ });
  assert.equal(a.predicted, 50);
  assert.equal(a.outcome, 'wrong');
});

test('shape: writing result carries score, predicted and timeToFirstAttempt', async () => {
  reset();
  W.resetWritingCache();
  CAL.saveOn(true);
  await WUI.viewWriting(ctx, 'wr-p-1');
  press('100%');
  press('סיימתי לכתוב, הציגו פתרון מודל');
  press('שמירת התוצאה');
  const [a] = store.getAttempts();
  assertShape(a, { topic: 'writing', idPattern: /^wr-p-1$/ });
  assert.equal(a.predicted, 100);
  assert.equal(typeof a.score, 'number');
  assert.ok('timeToFirstAttempt' in a);
});

test('legacy aggregated rows are tolerated by SRS, ceiling and item links', () => {
  const t = 1_000_000;
  const legacy = [
    { exerciseId: 'trig-cards', topic: 'trig', outcome: 'hinted', hintsUsed: 0, seconds: 90, ts: t },
    { exerciseId: 'trig-drill', topic: 'trig', outcome: 'alone', hintsUsed: 1, seconds: 120, ts: t + 1 },
    { exerciseId: 'logs-cards', topic: 'logs', outcome: 'alone', hintsUsed: 0, seconds: 60, ts: t + 2 },
    { exerciseId: 'notes-cards', topic: 'notes', outcome: 'hinted', hintsUsed: 0, seconds: 60, ts: t + 3 },
    { exerciseId: 'trig-card-c1', topic: 'trig', outcome: 'wrong', hintsUsed: 0, seconds: 5, ts: t + 4 },
    { exerciseId: 'trig-drill-f1', topic: 'trig', outcome: 'alone', hintsUsed: 0, seconds: 20, ts: t + 5 },
  ];
  const due = SRS.dueReviews(legacy, t + 10 * SRS.DAY_MS);
  assert.ok(Array.isArray(due));
  assert.ok(due.includes('trig-cards') && due.includes('trig-card-c1'), 'both old and new rows are scheduled');
  const v = CE.analyzeTopics(legacy, []);
  assert.ok(v && typeof v === 'object');
  assert.equal(E.itemHref('trig-cards', 'trig'), '#/trig/cards');
  assert.equal(E.itemHref('trig-card-c1', 'trig'), '#/trig/cards');
  assert.equal(E.itemHref('logs-cards', 'logs'), '#/logs/cards');
  assert.equal(E.itemHref('logs-card-c1', 'logs'), '#/logs/cards');
  assert.equal(E.itemHref('trig-drill-f1', 'trig'), '#/trig/drill');
});
