import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const K = await import('../js/booklet.js');
const UI = await import('../js/booklet-ui.js');
const B = await import('../js/backup.js');
const S = await import('../js/srs.js');
const C = await import('../js/ceiling.js');
const store = await import('../js/store.js');
const { verifyBooklet, loadBanks } = await import('../tools/verify-booklet.mjs');

const url = (p) => new URL(p, import.meta.url);
const data = JSON.parse(readFileSync(url('../data/booklet.json'), 'utf8'));
const qs = data.questions;
const fetchFn = async () => ({ ok: true, json: async () => data });
const fake = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };

test('pool: 12 original questions, 6 per subject, 4-6 parts, 25 marks, rubric lines add up', () => {
  assert.equal(qs.length, 12);
  for (const s of ['math', 'physics']) assert.equal(qs.filter((q) => q.subject === s).length, 6);
  for (const q of qs) {
    assert.ok(K.validQuestion(q), q.id);
    assert.ok(q.parts.length >= 4 && q.parts.length <= 6, q.id);
  }
});

test('pool exclusivity and independently recomputed answers (tools/verify-booklet.mjs logic)', () => {
  assert.deepEqual(verifyBooklet(data, loadBanks()), []);
  // none of the booklet ids appear in any other data file
  const ids = new Set(qs.map((q) => q.id));
  for (const f of readdirSync(url('../data/')).filter((n) => n.endsWith('.json') && n !== 'booklet.json')) {
    const text = readFileSync(url('../data/' + f), 'utf8');
    for (const id of ids) assert.ok(!text.includes(`"${id}"`), `${id} appears in ${f}`);
  }
});

test('the verifier really fails on a wrong stored answer and on a copied question', () => {
  const bad = JSON.parse(JSON.stringify(data));
  bad.questions.find((q) => q.id === 'bk-p1').parts[0].value = 13;
  assert.ok(verifyBooklet(bad, loadBanks()).some((e) => /bk-p1\.a/.test(e)));
  const banks = loadBanks();
  banks.texts.push(qs[0].stem + ' ' + qs[0].eq[0]);
  banks.texts.push(qs[1].parts[0].ask);
  assert.ok(verifyBooklet(data, banks).some((e) => /text overlaps/.test(e)));
});

test('allocate splits exactly by largest remainder', () => {
  assert.deepEqual(K.allocate([1, 1, 1], 100), [34, 33, 33]);
  assert.deepEqual(K.allocate([3, 4, 5, 5, 5, 3], 25), [3, 4, 5, 5, 5, 3]);
  assert.equal(K.allocate([3, 4, 5, 5, 5, 3], 34).reduce((a, b) => a + b, 0), 34);
  assert.deepEqual(K.allocate([0, 0], 10), [0, 0]);
});

test('papers are deterministic per seed and always total 100 marks', () => {
  for (const subject of ['math', 'physics']) {
    for (const count of K.COUNTS) {
      const seen = new Set();
      for (let seed = 1; seed <= 60; seed++) {
        const a = K.buildPaper(qs, subject, count, seed);
        assert.deepEqual(a, K.buildPaper(qs, subject, count, seed));
        assert.equal(a.total, 100);
        assert.equal(a.questions.length, count);
        assert.ok(a.questions.every((q) => q.id.startsWith(subject === 'math' ? 'bk-m' : 'bk-p')), 'only the chosen subject');
        assert.equal(new Set(a.questions.map((q) => q.id)).size, count, 'no repeated question');
        for (const q of a.questions) {
          assert.equal(q.parts.reduce((s, p) => s + p.marks, 0), q.total);
          for (const p of q.parts) {
            assert.ok(p.marks >= 1);
            assert.equal(p.rubric.reduce((s, r) => s + r[0], 0), p.marks, 'rubric scaled to the part marks');
            assert.ok(p.lines >= 3);
          }
        }
        seen.add(a.questions.map((q) => q.id).join());
      }
      assert.ok(seen.size > 5, `${subject}/${count}: different seeds give different papers`);
    }
  }
  assert.deepEqual(K.buildPaper(qs, 'math', 4, 5).questions.map((q) => q.total), [25, 25, 25, 25]);
  assert.deepEqual([...K.buildPaper(qs, 'math', 3, 5).questions.map((q) => q.total)].sort(), [33, 33, 34]);
  assert.equal(K.buildPaper(qs, 'chem', 4, 5), null);
  assert.equal(K.buildPaper(qs, 'math', 5, 5), null);
  assert.equal(K.buildPaper(qs, 'math', 4, 0), null);
  assert.equal(K.buildPaper(qs, 'math', 4, 1.5), null);
});

test('page-break hints: fits flag follows the estimated line count', () => {
  const p = K.buildPaper(qs, 'physics', 4, 9);
  for (const q of p.questions) assert.equal(q.fits, q.lines <= K.PAGE_LINES);
  assert.ok(K.answerLines(7) > K.answerLines(3));
});

test('self-marked scores are validated and recorded once per paper', () => {
  const paper = K.buildPaper(qs, 'math', 4, 11);
  const parts = K.paperParts(paper);
  assert.equal(parts.reduce((s, p) => s + p.max, 0), 100);
  const state = K.emptySaved();
  const full = Object.fromEntries(parts.map((p) => [p.key, p.max]));
  assert.equal(K.recordResult(state, paper, { ...full, [parts[0].key]: parts[0].max + 1 }).ok, false, 'above the maximum is rejected');
  assert.equal(K.recordResult(state, paper, { ...full, [parts[0].key]: 1.5 }).ok, false, 'non-integer rejected');
  assert.equal(K.recordResult(state, paper, { ...full, [parts[0].key]: -1 }).ok, false, 'negative rejected');
  assert.equal(state.results.length, 0);
  const r = K.recordResult(state, paper, full, 80, 1000);
  assert.ok(r.ok && r.isNew);
  assert.equal(r.entry.total, 100);
  assert.equal(r.entry.fraction, 1);
  assert.equal(r.entry.minutes, 80);
  const half = Object.fromEntries(parts.map((p, i) => [p.key, i % 2 ? '' : Math.floor(p.max / 2)]));
  const r2 = K.recordResult(state, paper, half, 0, 2000);
  assert.ok(r2.ok && !r2.isNew, 'the same paper updates its entry');
  assert.equal(state.results.length, 1);
  assert.ok(r2.entry.total < 100);
  const att = K.attemptFor(r2.entry);
  assert.equal(att.topic, 'booklet-math');
  assert.ok(att.exerciseId.startsWith('mock-math-4-11'));
  assert.equal(att.score, r2.entry.fraction);
  assert.notEqual(att.outcome, 'alone', 'self-marked work is never an independent solve');
  assert.equal(K.attemptFor({ ...r.entry, fraction: 0.3 }).outcome, 'wrong');
});

test('history is capped, sanitised and summarised per subject', () => {
  const s = fake();
  const st = K.emptySaved();
  for (let seed = 1; seed <= 35; seed++) {
    const paper = K.buildPaper(qs, seed % 2 ? 'math' : 'physics', 4, seed);
    const sc = Object.fromEntries(K.paperParts(paper).map((p) => [p.key, p.max]));
    K.recordResult(st, paper, sc, 0, seed);
  }
  assert.equal(st.results.length, K.MAX_HISTORY);
  K.saveSaved(st, s);
  assert.deepEqual(K.loadSaved(s), st);
  const dirty = K.sanitizeSaved({ results: [{ key: 'x', subject: 'math', count: 9, seed: -3, total: 5000, parts: { a: 3000, b: 2 } }, { subject: 'art' }, 5] });
  assert.equal(dirty.results.length, 1);
  assert.equal(dirty.results[0].total, 100);
  assert.deepEqual(dirty.results[0].parts, { b: 2 });
  assert.equal(dirty.results[0].count, 4);
  s.setItem(K.KEY, 'garbage');
  assert.deepEqual(K.loadSaved(s), K.emptySaved());
  const sum = K.historySummary(st);
  assert.equal(sum.math.best, 1);
  assert.ok(sum.math.n > 10 && sum.physics.n > 10);
});

test('backup: the history key is known and part of a backup', () => {
  assert.ok(K.KEY in B.KNOWN_KEYS);
  const s = fake();
  K.saveSaved(K.emptySaved(), s);
  assert.ok(JSON.parse(B.buildBackup(s, 1)).data[K.KEY]);
});

test('mock results stay out of topic stats and the ceiling verdicts, and show in the summary', () => {
  assert.ok(S.isReservedTopic('booklet-math') && S.isReservedTopic('booklet-physics'));
  assert.ok(C.isBookletTopic('booklet-math'));
  const log = [];
  for (let i = 0; i < 7; i++) log.push({ exerciseId: `mock-math-4-${i}`, ts: 1000 + i, outcome: 'hinted', hintsUsed: 0, seconds: 5000, topic: 'booklet-math', score: 0.8 });
  assert.equal(C.analyzeTopics(log).size, 0);
  assert.deepEqual(S.withVirtual([], log), []);
  const sum = K.bookletSummary(log);
  assert.equal(sum.math.mocks, 7);
  assert.equal(sum.math.avgScore, 0.8);
  assert.equal(K.bookletSummary([]), null);
});

test('print css: A4 page breaks that keep questions together, a stop page and a separate key', () => {
  const css = readFileSync(url('../styles.css'), 'utf8');
  assert.match(css, /@page\s*\{\s*size:\s*A4/);
  const print = css.slice(css.lastIndexOf('@media print'));
  assert.match(print, /\.bk-q\.fits\s*\{[^}]*break-inside:\s*avoid/);
  assert.match(print, /\.bk-q \+ \.bk-q\s*\{[^}]*break-before:\s*page/);
  assert.match(print, /\.bk-part\s*\{[^}]*break-inside:\s*avoid/);
  assert.match(print, /\.bk-stop\s*\{[^}]*break-before:\s*page[^}]*break-after:\s*page/);
  assert.match(print, /\.bk-toolbar[^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.bk-nokey \.bk-keyset\s*\{\s*display:\s*none/);
  assert.match(css, /\.bk-line\s*\{[^}]*border-bottom/);
});

test('screens: setup, paper (print button, stop page, key), results entry', async () => {
  dom.store.clear();
  store.resetCache();
  K.resetBookletCache();
  const ctx = { topics: [], exercises: [], show: dom.show, fetchFn };
  const text = () => dom.root.textContent.replace(/[⁦-⁩]/g, '');
  await UI.viewBooklet(ctx);
  assert.match(text(), /חוברת מבחן/);
  assert.match(text(), /עוד אין מבחנים/);

  await UI.viewBooklet(ctx, 'paper', 'physics', '4', '21');
  const paper = K.buildPaper(qs, 'physics', 4, 21);
  assert.match(text(), /מבחן בחוברת: פיזיקה/);
  assert.match(text(), /שם: _+/);
  assert.match(text(), /90 דקות/);
  assert.match(text(), /עצרו כאן/);
  for (const q of paper.questions) assert.match(text(), new RegExp(`שאלה ${q.n} \\(${q.total} נקודות\\)`));
  assert.equal(dom.root.all((n) => /\bbk-q\b/.test(n.className || '')).length, 4);
  assert.equal(dom.root.all((n) => (n.className || '') === 'bk-line').length, paper.questions.reduce((s, q) => s + q.parts.reduce((x, p) => x + p.lines, 0), 0));
  const rootEl = dom.root.all((n) => /\bbk-paper\b/.test(n.className || ''))[0];
  assert.match(rootEl.className, /bk-nokey/, 'the key is hidden until asked for');
  let printed = 0;
  globalThis.print = () => { printed++; };
  dom.root.all((n) => n.tagName === 'BUTTON' && /הדפסה/.test(n.textContent))[0].click();
  assert.equal(printed, 1);

  await UI.viewBooklet(ctx, 'enter', 'physics', '4', '21');
  const inputs = dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute && n.getAttribute('max') && n.getAttribute('step') === '1');
  assert.equal(inputs.length, K.paperParts(paper).length);
  inputs.forEach((el) => { el.value = String(el.getAttribute('max')); });
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'שמירת התוצאה')[0].click();
  assert.match(text(), /נשמר: 100 מתוך 100/);
  const log = JSON.parse(dom.store.get('omri-study-attempts-v1'));
  assert.equal(log.at(-1).topic, 'booklet-physics');
  assert.equal(log.at(-1).score, 1);
  assert.equal(K.loadSaved().results.length, 1);
  // entering again updates the same entry and does not add a second attempt
  inputs.forEach((el) => { el.value = '0'; });
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'שמירת התוצאה')[0].click();
  assert.equal(K.loadSaved().results.length, 1);
  assert.equal(K.loadSaved().results[0].total, 0);
  assert.equal(JSON.parse(dom.store.get('omri-study-attempts-v1')).length, log.length);
  // bad input is rejected with the maximum shown
  inputs[0].value = '99';
  dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent.trim() === 'שמירת התוצאה')[0].click();
  assert.match(text(), /בין 0 ל־/);

  await UI.viewBooklet(ctx);
  assert.match(text(), /פיזיקה/);
  assert.match(text(), /0\/100/);
});

test('routes and precache', async () => {
  const N = await import('../js/nav.js');
  assert.deepEqual(N.resolveRoute('#/booklet/enter/math/3/7'), { name: 'booklet', args: ['enter', 'math', '3', '7'] });
  const sw = readFileSync(url('../sw.js'), 'utf8');
  for (const f of ['js/booklet.js', 'js/booklet-ui.js', 'data/booklet.json']) assert.ok(sw.includes(`'${f}'`), f);
});
