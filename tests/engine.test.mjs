// Audit batch A: standalone modes feed the attempt log, backup knows every key, storage guards, Hebrew/input fixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const store = await import('../js/store.js');
const SRS = await import('../js/srs.js');
const E = await import('../js/engine.js');
const ST = await import('../js/storage.js');
const BK = await import('../js/backup.js');
const MH = await import('../js/mathhard.js');
const MHUI = await import('../js/mathhard-ui.js');
const MP = await import('../js/multipart.js');
const LG = await import('../js/logs.js');
const LGUI = await import('../js/logs-ui.js');
const TR = await import('../js/trig.js');
const TRUI = await import('../js/trig-ui.js');
const SUM = await import('../js/summary.js');
const PR = await import('../js/practice-ui.js');
const WO = await import('../js/workout.js');
const SK = await import('../js/signkey.js');

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(read(u)) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn };
const reset = () => { dom.store.clear(); store.resetCache(); ST.resetStorageBanner(); dom.clock.now = 1_000_000; };
const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === label)[0].dispatch('click');
const boxes = () => dom.root.all((n) => n.tagName === 'INPUT' && !n.disabled);
const DAY = SRS.DAY_MS;

/* ---------- (1) feed the engine ---------- */
test('mathhard: a solve with a hint is recorded with topic math-hard-<family> and is due the next day', async () => {
  reset();
  await MHUI.viewMathHard(ctx, 'mh-rad-3');
  boxes()[0].value = '2';
  press('רמז 1');
  boxes()[1].value = '';
  press('בדיקה');
  const log = store.getAttempts();
  assert.equal(log.length, 1);
  assert.equal(log[0].exerciseId, 'mh-rad-3');
  assert.equal(log[0].topic, 'math-hard-radical');
  assert.equal(log[0].outcome, 'hinted');
  assert.equal(log[0].hintsUsed, 1);
  const t = log[0].ts;
  assert.deepEqual(SRS.dueReviews(log, t + DAY - 1), []);
  assert.deepEqual(SRS.dueReviews(log, t + DAY), ['mh-rad-3']);
});

test('mathhard: outcome mapping (alone / hinted / wrong) and no double record on a second click', async () => {
  assert.equal(E.visitOutcome({ solved: true, hints: 0, wrongs: 0 }), 'alone');
  assert.equal(E.visitOutcome({ solved: true, hints: 1, wrongs: 0 }), 'hinted');
  assert.equal(E.visitOutcome({ solved: true, hints: 0, wrongs: 2 }), 'hinted');
  assert.equal(E.visitOutcome({ solved: false, hints: 0, wrongs: 0 }), 'wrong');
  reset();
  await MHUI.viewMathHard(ctx, 'mh-rat-2');
  press('הצגת פתרון מלא');
  assert.equal(dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'הצגת פתרון מלא' && !n.disabled).length, 0);
  assert.equal(store.getAttempts().length, 1);
  assert.equal(store.getAttempts()[0].outcome, 'wrong');
});

test('weak topics list math-hard when accuracy is below 0.8, with Hebrew title and a working link in the summary', () => {
  const mk = (id, outcome, ts) => ({ exerciseId: id, topic: 'math-hard-radical', outcome, hintsUsed: 0, seconds: 5, ts });
  const log = SRS.cleanLog([mk('mh-rad-1', 'alone', 1), mk('mh-rad-2', 'wrong', 2), mk('mh-rad-3', 'wrong', 3), mk('mh-rad-1', 'hinted', 4)]);
  assert.equal(log[0].topic, 'math-hard-radical');
  const weak = SRS.weakTopics(log, SRS.withVirtual([], log));
  assert.equal(weak[0].topic, 'math-hard-radical');
  assert.ok(weak[0].accuracy < 0.8);
  const s = SUM.buildSummary({ attempts: log, exercises: [], topics: [], traps: [], formulas: null });
  assert.equal(s.weak.length, 1);
  assert.match(s.weak[0].title, /שורשים/);
  assert.equal(s.weak[0].href, '#/mathhard');
  // data topics keep their own link, real exercises are not duplicated
  const real = [{ id: 'm-1', topic: 'math-3', level: 1 }];
  assert.equal(SRS.withVirtual(real, SRS.cleanLog([{ exerciseId: 'm-1', topic: 'math-3', outcome: 'wrong' }])).length, 1);
});

test('multipart: finishing a question records one attempt with topic multipart', async () => {
  reset();
  MP.resetMultipartCache();
  await MP.viewMultipart(ctx, 'mp-2');
  for (let i = 0; i < 12 && dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === 'אין לי תשובה, להציג פתרון').length; i++) press('אין לי תשובה, להציג פתרון');
  const log = store.getAttempts();
  assert.equal(log.length, 1);
  assert.equal(log[0].exerciseId, 'mp-2');
  assert.equal(log[0].topic, 'multipart');
  assert.equal(log[0].outcome, 'wrong');
  assert.equal(E.multipartOutcome({ a: 'correct', b: 'correct' }), 'alone');
  assert.equal(E.multipartOutcome({ a: 'correct', b: 'carried' }), 'hinted');
  assert.equal(E.multipartOutcome({ a: 'correct', b: 'wrong' }), 'wrong');
});

test('logs: an exercise and a flashcard round are recorded with topic logs', async () => {
  reset();
  await LGUI.viewLogsRoute(ctx, 'ex', 'lg-1-06');
  boxes()[0].value = '7';
  boxes()[1].value = '';
  press('בדיקה');
  let log = store.getAttempts();
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].exerciseId, log[0].topic, log[0].outcome], ['lg-1-06', 'logs', 'alone']);
  await LGUI.viewLogsRoute(ctx, 'cards');
  for (let i = 0; i < 40 && dom.root.byText('button', 'הצג תשובה'); i++) { press('הצג תשובה'); press('ידעתי ✓'); }
  log = store.getAttempts();
  assert.deepEqual(log.map((a) => a.exerciseId), ['lg-1-06', 'logs-cards']);
  assert.equal(log[1].topic, 'logs');
});

test('trig: a flashcard round is recorded with topic trig', () => {
  reset();
  TRUI.viewTrigRoute(ctx, 'cards');
  for (let i = 0; i < 60 && dom.root.byText('button', 'הצג תשובה'); i++) { press('הצג תשובה'); press('ידעתי ✓'); }
  const log = store.getAttempts();
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].exerciseId, log[0].topic, log[0].outcome], ['trig-cards', 'trig', 'alone']);
});

test('every engine topic has a Hebrew title; progress screen renders them without throwing', async () => {
  reset();
  for (const f of MH.FAMILIES) assert.match(E.topicTitle(E.mathHardTopic(f.id)), /[א-ת]/);
  for (const t of [E.MULTIPART_TOPIC, E.TRIG_TOPIC, E.LOGS_TOPIC]) assert.match(E.topicTitle(t), /[א-ת]/);
  assert.equal(E.topicTitle('nope'), null);
  store.recordAttempt({ exerciseId: 'mh-rad-1', topic: 'math-hard-radical', outcome: 'wrong', hintsUsed: 0, seconds: 9 });
  store.recordAttempt({ exerciseId: 'mp-1', topic: 'multipart', outcome: 'hinted', hintsUsed: 0, seconds: 9 });
  PR.viewProgress({ topics: [{ id: 'math-3', title: 'שלושה נעלמים' }], exercises: [{ id: 'm-1', topic: 'math-3', level: 1 }], show: dom.show });
  const text = dom.root.textContent;
  assert.match(text, /מתמטיקה ברמה גבוהה: משוואות ואי־שוויונות עם שורשים/);
  assert.match(text, /שאלות בכמה סעיפים/);
  assert.match(text, /חזרות שהגיע זמנן|היעד הבא/);
  assert.equal(E.itemHref('mh-rad-1', 'math-hard-radical'), '#/mathhard/mh-rad-1');
  assert.equal(E.itemHref('lg-1-06', 'logs'), '#/logs/ex/lg-1-06');
  assert.equal(E.itemHref('trig-cards', 'trig'), '#/trig/cards');
  assert.equal(E.itemHref('m-1', 'math-3'), null);
});

/* ---------- (2) backup ---------- */
test('every omri-study-*-vN key literal in js/*.js is in KNOWN_KEYS or the exclusion list', () => {
  const found = new Set();
  for (const f of readdirSync(new URL('../js/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    for (const m of read('js/' + f).matchAll(/omri-study-[a-z-]+-v\d/g)) found.add(m[0]);
  }
  assert.ok(found.size >= 20);
  for (const k of found) assert.ok(k in BK.KNOWN_KEYS || BK.EXCLUDED_KEYS.includes(k), `not backed up: ${k}`);
  for (const k of ['omri-study-multipart-v1', 'omri-study-mathhard-v1', 'omri-study-trig-v1', 'omri-study-logs-v1']) assert.ok(k in BK.KNOWN_KEYS, k);
  for (const [k, label] of Object.entries(BK.KNOWN_KEYS)) assert.match(label, /[א-ת]/, k);
  for (const k of BK.EXCLUDED_KEYS) assert.ok(!(k in BK.KNOWN_KEYS), k);
});

test('backup -> wipe -> restore round-trips multipart, mathhard, trig and logs progress', () => {
  reset();
  MP.recordAttempt('mp-1', { a: 'correct', b: 'carried' });
  MH.recordAttempt('mh-rad-1', { solved: true, hints: 1, wrongs: 0 });
  MH.recordAttempt('lg-1-06', { solved: true, hints: 0, wrongs: 0 });
  const trig = TR.loadState();
  TR.gradeCard(trig, 'x', true);
  TR.saveState(trig);
  const logs = LG.loadCards();
  LG.saveCards(logs);
  const before = Object.fromEntries(Object.keys(BK.KNOWN_KEYS).map((k) => [k, localStorage.getItem(k)]));
  for (const k of ['omri-study-multipart-v1', 'omri-study-mathhard-v1', 'omri-study-trig-v1', 'omri-study-logs-v1']) assert.ok(before[k], k);
  const code = BK.buildBackup(localStorage);
  dom.store.clear();
  const parsed = BK.parseBackup(code);
  assert.ok(parsed.ok, parsed.error);
  assert.ok(parsed.preview.some((p) => p.key === 'omri-study-multipart-v1' && /[א-ת]/.test(p.label)));
  assert.ok(BK.applyBackup(localStorage, parsed));
  for (const [k, v] of Object.entries(before)) assert.equal(localStorage.getItem(k), v, k);
  assert.equal(MP.loadSaved().items['mp-1'].best, 1.5);
  assert.equal(MH.loadSaved().items['mh-rad-1'].solved, true);
});

/* ---------- (3) guards ---------- */
test('quota error: write returns false, banner shows once with the Hebrew text, nothing throws', () => {
  reset();
  document.body.children.length = 0;
  const real = localStorage.setItem;
  localStorage.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  try {
    assert.equal(ST.safeSetItem('omri-study-x-v1', '{}'), false);
    assert.equal(ST.safeSetItem('omri-study-x-v1', '{}'), false);
    const banners = document.body.children.filter((n) => n.getAttribute && n.getAttribute('role') === 'alert');
    assert.equal(banners.length, 1);
    assert.equal(banners[0].textContent, 'האחסון מלא, ההתקדמות לא נשמרה');
    // through the real store: no exception, the in-memory log still works
    store.recordAttempt({ exerciseId: 'mh-rad-1', topic: 'math-hard-radical', outcome: 'alone' });
    store.recordDrill('d1', null, true);
    assert.equal(store.getAttempts().length, 1);
    // other errors do not show the "full" banner
    ST.resetStorageBanner();
    document.body.children.length = 0;
    localStorage.setItem = () => { throw new Error('denied'); };
    assert.equal(ST.safeSetItem('k', 'v'), false);
    assert.equal(document.body.children.length, 0);
  } finally { localStorage.setItem = real; }
  assert.ok(ST.isQuotaError({ code: 22 }) && ST.isQuotaError({ name: 'QuotaExceededError' }) && !ST.isQuotaError(new Error('x')));
});

test('corrupt JSON is stashed under <key>-corrupt before an overwrite (first copy wins)', () => {
  reset();
  dom.store.set('omri-study-drills-v1', '{broken');
  store.recordDrill('d1', null, true);
  assert.equal(dom.store.get('omri-study-drills-v1-corrupt'), '{broken');
  assert.deepEqual(Object.keys(JSON.parse(dom.store.get('omri-study-drills-v1')).items), ['d1']);
  dom.store.set('omri-study-drills-v1', '{broken again');
  store.recordDrill('d2', null, true);
  assert.equal(dom.store.get('omri-study-drills-v1-corrupt'), '{broken');
  // valid JSON is never stashed
  dom.store.set('omri-study-mathhard-v1', '{"v":1,"items":{}}');
  MH.recordAttempt('mh-rad-1', { solved: true });
  assert.equal(dom.store.has('omri-study-mathhard-v1-corrupt'), false);
  assert.equal(ST.corruptKey('a'), 'a-corrupt');
});

test('attempt log is capped at 5000 rows; compaction keeps newest rows and the schedule of old exercises', () => {
  const rows = [{ exerciseId: 'old-1', outcome: 'alone', ts: 1, hintsUsed: 0, seconds: 0 }];
  for (let i = 0; i < 5200; i++) rows.push({ exerciseId: `e${i % 300}`, outcome: 'alone', ts: 10 + i, hintsUsed: 0, seconds: 0 });
  const out = SRS.compactLog(SRS.cleanLog(rows));
  assert.ok(out.length <= SRS.MAX_LOG_ROWS && out.length >= 4500);
  assert.equal(out[out.length - 1].ts, 10 + 5199);
  assert.ok(out.some((a) => a.exerciseId === 'old-1'), 'old exercise keeps its latest row');
  assert.equal(SRS.compactLog([1, 2, 3]).length, 3);
  // through createLog
  const mem = new Map();
  const log = SRS.createLog({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  for (let i = 0; i < SRS.MAX_LOG_ROWS + 30; i++) log.add({ exerciseId: `e${i % 50}`, outcome: 'alone', ts: i + 1 });
  assert.ok(log.all().length <= SRS.MAX_LOG_ROWS);
  assert.ok(JSON.parse(mem.get(SRS.LOG_KEY)).length <= SRS.MAX_LOG_ROWS);
});

test('service worker precaches the new modules', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'js/storage.js'") && sw.includes("'js/engine.js'"));
});

/* ---------- (4) Hebrew and input ---------- */
test('wording: neutral level-up line, multipart buttons, header, no gendered leftovers', () => {
  const ex = [{ id: 'a', topic: 't', level: 1 }, { id: 'b', topic: 't', level: 2 }];
  const log = ['a', 'a', 'a'].map((id, i) => ({ exerciseId: id, outcome: 'alone', hintsUsed: 0, seconds: 1, ts: i + 1 }));
  const line = WO.levelLine(log, ex, [{ exerciseId: 'a', rating: 1, ts: 5 }], () => 'פיזיקה');
  assert.match(line, /רמת האימון עלתה בפיזיקה/);
  assert.doesNotMatch(line, /עלית|דירגת/);
  const mp = read('js/multipart.js');
  assert.ok(mp.includes('אין לי תשובה, להציג פתרון') && !mp.includes('אין לי תשובה: הציגו'));
  assert.doesNotMatch(mp, /הערך שהצבתם מסעיף קודם שגוי, ובהצבתו/);
  const html = read('index.html');
  assert.match(html, /מכינה להנדסה/);
  assert.doesNotMatch(html, /יח״ל/);
});

test('trap badge is hidden before solving (list and exercise page) and shown after', async () => {
  const all = MH.DATA_FILES.flatMap((f) => JSON.parse(read(f)));
  const trapEx = all.find((e) => e.trap);
  assert.ok(trapEx);
  reset();
  await MHUI.viewMathHard(ctx);
  assert.doesNotMatch(dom.root.textContent, /⚠️ מלכודת/);
  await MHUI.viewMathHard(ctx, trapEx.id);
  assert.doesNotMatch(dom.root.textContent, /יש כאן מלכודת/);
  press('הצגת פתרון מלא');
  assert.match(dom.root.textContent, /מלכודת/);
  await MHUI.viewMathHard(ctx);
  assert.doesNotMatch(dom.root.textContent, /⚠️ מלכודת/, 'a skipped (unsolved) exercise still keeps the trap hidden');
  MH.recordAttempt(trapEx.id, { solved: true, hints: 0, wrongs: 0 });
  await MHUI.viewMathHard(ctx);
  assert.match(dom.root.textContent, /⚠️ מלכודת/);
});

test('numeric inputs of multipart, mathhard and logs are decimal inputs that get the minus key', async () => {
  reset();
  const check = () => {
    const ins = dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'text');
    assert.ok(ins.length > 0);
    for (const i of ins) {
      assert.ok(SK.isNumericAnswerInput(i), 'inputmode decimal');
      let placed = null;
      i.after = (b) => { placed = b; };
      assert.ok(SK.attachSignKey(i) && placed && placed.textContent === '±');
    }
  };
  MP.resetMultipartCache();
  await MP.viewMultipart(ctx, 'mp-1');
  check();
  await MHUI.viewMathHard(ctx, 'mh-rad-3');
  check();
  await LGUI.viewLogsRoute(ctx, 'ex', 'lg-1-06');
  check();
});
