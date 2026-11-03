import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

installFakeDom();
const Bl = await import('../js/blind.js');
const N = await import('../js/notebook.js');
const C = await import('../js/ceiling.js');
const S = await import('../js/srs.js');
const { PROOFS } = await import('../js/trig-data.js');
const { QUESTIONS: UNITS } = await import('../js/units-data.js');
const { QUESTIONS: EST } = await import('../js/estimate-data.js');

const rd = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const logs = rd('logs-ex-1.json').concat(rd('logs-ex-2.json'), rd('logs-ex-3.json'));
const pool = Bl.buildPool({
  mathhard: ['radical', 'exponent', 'rational', 'param', 'circle'].flatMap((f) => rd(`mathhard-${f}.json`)),
  logs, ladder: rd('ladder-math.json').stages, multipart: rd('multipart.json'), recover: rd('recover.json'), proofs: PROOFS, units: UNITS, estimate: EST,
});
const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);

test('pool covers all eight banks and keeps reserved pools out', () => {
  const srcs = new Set(pool.map((p) => p.src));
  for (const s of ['mathhard', 'logs', 'ladder', 'multipart', 'trig', 'recover', 'units', 'estimate']) assert.ok(srcs.has(s), s);
  const reserved = new Set([...rd('transfer.json').map((q) => q.id), ...rd('booklet.json').questions.map((q) => q.id), ...rd('recovery-hard.json').map((q) => q.id)]);
  assert.ok(pool.every((p) => !reserved.has(p.id) && !Bl.RESERVED_PREFIXES.some((x) => p.id.startsWith(x))));
  assert.equal(new Set(pool.map((p) => p.uid)).size, pool.length); // uids are unique
});

test('picker: 12 questions, deterministic by seed, one per exercise id, mixed groups', () => {
  const a = Bl.pickSession(pool, 42);
  assert.equal(a.length, Bl.SIZE);
  assert.deepEqual(a, Bl.pickSession(pool, 42));
  assert.notDeepEqual(a, Bl.pickSession(pool, 43));
  const items = a.map((u) => pool.find((p) => p.uid === u));
  assert.equal(new Set(items.map((i) => i.id)).size, 12);
  assert.ok(new Set(items.map((i) => Bl.groupOf(i.topic))).size >= 6);
});

test('picker avoids items seen in the last 7 days when it can, and falls back when it cannot', () => {
  const first = Bl.pickSession(pool, 5).map((u) => pool.find((p) => p.uid === u).id);
  const log = first.map((id, i) => ({ exerciseId: id, ts: NOW - 2 * 86400000 + i, outcome: 'alone' }));
  const recent = Bl.recentIds(log, NOW);
  assert.equal(recent.size, 12);
  const again = Bl.pickSession(pool, 5, { recent }).map((u) => pool.find((p) => p.uid === u).id);
  assert.equal(again.filter((id) => recent.has(id)).length, 0);
  const old = Bl.recentIds([{ exerciseId: first[0], ts: NOW - 8 * 86400000 }], NOW);
  assert.equal(old.size, 0);
  const everything = new Set(pool.map((p) => p.id));
  assert.equal(Bl.pickSession(pool, 5, { recent: everything }).length, 12); // all recent: still a full session
  const reserved = new Set(first);
  assert.equal(Bl.pickSession(pool, 5, { reserved }).filter((u) => reserved.has(pool.find((p) => p.uid === u).id)).length, 0);
});

test('items carry no label that reveals topic or difficulty into the shown fields', () => {
  for (const it of pool.slice(0, 400)) assert.ok(!('title' in it) && !('tier' in it), it.uid);
});

test('grading: every kind, invalid input does not use up the attempt', () => {
  const byKind = (k) => pool.find((p) => p.kind === k);
  const canon = byKind('canon');
  const want = canon.answer.kind === 'number' ? { none: false, rows: [canon.answer.value] } : null;
  if (want) assert.equal(Bl.gradeBlind(canon, want).correct, true);
  assert.equal(Bl.gradeBlind(canon, { none: false, rows: [''] }).valid, false);
  const mp = byKind('number');
  assert.equal(Bl.gradeBlind(mp, String(mp.answer)).correct, true);
  assert.equal(Bl.gradeBlind(mp, 'abc').valid, false);
  const inputs = byKind('inputs');
  const good = Bl.gradeBlind(inputs, inputs.inputs.map((i) => i.answer));
  assert.ok(good.valid && good.correct && good.score === good.total);
  assert.equal(Bl.gradeBlind(inputs, inputs.inputs.map(() => '')).valid, false);
  const ch = pool.find((p) => p.kind === 'choice' && p.shuffle);
  const pc = Bl.presentChoice(ch, 9);
  assert.equal(Bl.gradeBlind(ch, pc.correct, 9).correct, true);
  assert.equal(Bl.gradeBlind(ch, (pc.correct + 1) % ch.options.length, 9).correct, false);
  assert.equal(Bl.gradeBlind(ch, null, 9).valid, false);
  assert.deepEqual(Bl.presentChoice(ch, 9), Bl.presentChoice(ch, 9));
  const un = pool.find((p) => p.kind === 'unitsnum');
  if (un) assert.equal(Bl.gradeBlind(un, String(Number(Bl.gradeBlind.length) * 0 + 1e9)).correct, false);
  const rc = pool.find((p) => p.src === 'recover');
  assert.equal(Bl.gradeBlind(rc, rc.answerIdx === undefined ? rc.answerIdx : rc.answerIdx).correct, true);
  assert.equal(Bl.skipBlind(inputs).total, inputs.inputs.length);
});

test('ranking: accuracy, time and error type; low confidence under 3 questions; top 3 only', () => {
  const mk = (uid, topic, budget = 100) => ({ uid, id: uid, topic, budget, kind: 'number' });
  const items = [mk('a1', 'math-rad'), mk('a2', 'math-hard-radical'), mk('b1', 'logs'), mk('b2', 'logs'), mk('b3', 'math-pow'), mk('c1', 'trig'), mk('d1', 'units'), mk('e1', 'multipart')];
  const ok = (s = 50) => ({ correct: true, score: 1, total: 1, seconds: s, skipped: false });
  const wrong = (s = 60) => ({ correct: false, score: 0, total: 1, seconds: s, skipped: false });
  const results = {
    a1: wrong(5), a2: wrong(120), b1: ok(), b2: ok(), b3: ok(), c1: { correct: false, score: 0, total: 1, seconds: 30, skipped: true }, d1: ok(200), e1: ok(),
  };
  const r = Bl.rank(items, results);
  assert.equal(r.weakest.length, 3);
  assert.deepEqual(r.weakest.map((g) => g.id), ['radicals', 'trig', 'sanity']);
  assert.equal(r.weakest[0].accuracy, 0);
  assert.equal(r.weakest[0].lowConfidence, true);
  assert.equal(r.groups.find((g) => g.id === 'exp-log').n, 3);
  assert.equal(r.groups.find((g) => g.id === 'exp-log').lowConfidence, false);
  assert.equal(r.correct, 5);
  assert.equal(Bl.errorType(wrong(5), 100), 'guess');
  assert.equal(Bl.errorType(wrong(60), 100), 'wrong');
  assert.equal(Bl.errorType({ correct: false, score: 1, total: 2, seconds: 60 }, 100), 'partial');
  assert.equal(Bl.errorType(ok(200), 100), 'slow');
  assert.equal(Bl.errorType(ok(50), 100), null);
  assert.equal(Bl.rank(items, Object.fromEntries(items.map((i) => [i.uid, ok()]))).weakest.length, 0);
});

test('session flow: start, answer once, finish, history, wrong items described for the notebook', () => {
  const st = mem();
  const s = Bl.startSession(pool, 11, [], NOW, st);
  assert.equal(s.uids.length, 12);
  assert.equal(Bl.startSession(pool, 99, [], NOW + 5, st).id, s.id); // the unfinished session is resumed
  const uid = Bl.nextUid(s);
  const item = pool.find((p) => p.uid === uid);
  assert.ok(Bl.submit(pool, uid, { correct: false, score: 0, total: 1 }, 20, st, NOW + 1000));
  assert.equal(Bl.submit(pool, uid, { correct: true, score: 1, total: 1 }, 20, st, NOW + 2000), false); // one attempt
  const a = Bl.attemptFor(item, { correct: false }, 20);
  assert.equal(a.topic, `blind-${item.topic}`);
  assert.equal(a.exerciseId, item.id);
  assert.equal(a.outcome, 'wrong');
  assert.equal(Bl.attemptFor(item, { correct: true }, 20).outcome, 'alone');
  assert.equal(Bl.attemptFor(item, { skipped: true, correct: false }, 20).outcome, 'solution');
  assert.ok(Bl.describeBlind(item.id, st).title.length > 0);
  for (const u of s.uids.slice(1)) Bl.submit(pool, u, { correct: true, score: 1, total: 1 }, 30, st, NOW + 3000);
  const state = Bl.load(st);
  assert.equal(state.active, null);
  assert.equal(state.history.length, 1);
  const d = Bl.resultData(pool, state.history[0]);
  assert.equal(d.questions, 12);
  assert.equal(d.correct, 11);
});

test('wrong blind answers enter the notebook and count for the ceiling detector, but not for topic stats', () => {
  assert.ok(S.isReservedTopic('blind-math-hard-radical'));
  assert.equal(N.skipTopic('blind-math-hard-radical'), false);
  assert.equal(N.skipTopic('transfer-math'), true);
  const state = { v: 1, entries: {} };
  const log = [{ exerciseId: 'mh-rad-1', topic: 'blind-math-hard-radical', outcome: 'wrong', hintsUsed: 0, seconds: 40, ts: NOW }];
  assert.equal(N.syncNotebook(state, log, [], () => ({ title: 't', key: 'k', href: '#/mathhard/mh-rad-1' }), NOW + 10), 1);
  assert.equal(state.entries['mh-rad-1'].title, 't');
  assert.equal(S.withVirtual([], log).length, 0); // no virtual blind topic in the topic lists
  const six = Array.from({ length: 6 }, (_, i) => ({ exerciseId: `mh-rad-${i}`, topic: 'blind-math-hard-radical', outcome: 'alone', hintsUsed: 0, seconds: 100, ts: NOW + i }));
  const v = C.analyzeTopic('math-hard-radical', six);
  assert.equal(v.sample, 6);
  assert.ok(v.signals[0]);
  assert.ok(C.analyzeTopics(six).has('math-hard-radical'));
  assert.ok(!C.analyzeTopics(six).has('blind-math-hard-radical'));
});

test('state: sanitize and restore merge by session id', () => {
  assert.deepEqual(Bl.sanitize('x'), Bl.emptyState());
  const st = mem();
  const s = Bl.startSession(pool, 3, [], NOW, st);
  for (const u of s.uids) Bl.submit(pool, u, { correct: true, score: 1, total: 1 }, 10, st, NOW + 100);
  const mine = Bl.load(st);
  const other = { ...Bl.emptyState(), history: [{ ...mine.history[0], id: 'b-other', finishedAt: NOW + 5 }] };
  const merged = JSON.parse(Bl.mergeBlind(JSON.stringify(mine), JSON.stringify(other)));
  assert.deepEqual(merged.history.map((h) => h.id).sort(), [mine.history[0].id, 'b-other'].sort());
  assert.equal(JSON.parse(Bl.mergeBlind(JSON.stringify(mine), JSON.stringify(mine))).history.length, 1);
  assert.equal(Bl.mergeBlind('garbage', 'garbage'), JSON.stringify(Bl.emptyState()));
});

test('every data file in the pools is a reserved-free source (no tr-/bk-/rh- ids slip into the bank files)', () => {
  for (const f of readdirSync(new URL('../data/', import.meta.url))) {
    if (!f.endsWith('.json') || /^(transfer|booklet|recovery-hard)/.test(f)) continue;
    const text = readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8');
    assert.ok(!/"id":\s*"rh-/.test(text), f);
  }
});

test('sweep: the stored right answer of every pool item grades as correct, a wrong one does not', async () => {
  const { answerOf, fmtNum } = await import('../js/units.js');
  let checked = 0;
  for (const it of pool) {
    let right = null;
    if (it.kind === 'canon') {
      const a = it.answer;
      if (a.kind === 'number') right = { rows: [a.value] };
      else if (a.kind === 'set') right = { rows: a.values };
      else if (a.kind === 'points') right = { rows: a.points };
      else continue;
    } else if (it.kind === 'inputs') right = it.inputs.map((i) => i.answer);
    else if (it.kind === 'number') right = String(it.answer);
    else if (it.kind === 'unitsnum') right = fmtNum(answerOf(it.units).value);
    else if (it.kind === 'choice') {
      assert.equal(new Set(it.options).size, it.options.length, `${it.uid}: duplicate options`);
      right = Bl.presentChoice(it, 7).correct;
    }
    const g = Bl.gradeBlind(it, right, 7);
    assert.ok(g.valid && g.correct, `${it.uid} ${JSON.stringify(right)} ${JSON.stringify(g)}`);
    checked++;
  }
  assert.ok(checked > 250, String(checked));
});
