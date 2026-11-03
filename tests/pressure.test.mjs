import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

installFakeDom();
const P = await import('../js/pressure.js');
const Bl = await import('../js/blind.js');

const rd = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const pool = Bl.buildPool({
  mathhard: ['radical', 'exponent', 'rational', 'param', 'circle'].flatMap((f) => rd(`mathhard-${f}.json`)),
  logs: ['1', '2', '3'].flatMap((n) => rd(`logs-ex-${n}.json`)), multipart: rd('multipart.json'), ladder: rd('ladder-math.json').stages,
});
const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('optional and off by default', () => {
  assert.equal(P.load(mem()).on, false);
  assert.equal(P.isOn(mem()), false);
  assert.equal(P.sanitize({ on: 'yes' }).on, false);
});

test('rungs: 100 / 85 / 70 percent, different items on each rung, balanced budgets, deterministic', () => {
  const fams = P.families(pool);
  assert.ok(fams.length >= 2);
  const s = P.makeSession(pool, fams[0].id, 8, new Set(), NOW);
  assert.deepEqual(s.rungs.map((r) => r.pct), [1, 0.85, 0.7]);
  const all = s.rungs.flatMap((r) => r.uids);
  assert.equal(all.length, 9);
  assert.equal(new Set(all).size, 9);
  const ids = all.map((u) => pool.find((p) => p.uid === u).id);
  assert.equal(new Set(ids).size, 9);
  const budgets = s.rungs.map((r) => r.uids.reduce((a, u) => a + pool.find((p) => p.uid === u).budget, 0));
  assert.ok(Math.max(...budgets) - Math.min(...budgets) <= Math.max(...budgets) * 0.4, JSON.stringify(budgets));
  assert.deepEqual(s.rungs.map((r, i) => r.seconds), s.rungs.map((r, i) => Math.round(budgets[i] * P.RUNGS[i])));
  assert.deepEqual(P.buildRungs(pool, fams[0].id, 8), P.buildRungs(pool, fams[0].id, 8));
  assert.ok(s.rungs.every((r) => r.uids.every((u) => pool.find((p) => p.uid === u).id && Bl.groupOf(pool.find((p) => p.uid === u).topic) === fams[0].id)));
});

test('finishing rungs: accuracy and time are kept apart, no combined score', () => {
  const fam = P.families(pool)[0].id;
  const s = P.makeSession(pool, fam, 3, new Set(), NOW);
  const right = (u) => { const it = pool.find((p) => p.uid === u); return it.kind === 'number' ? String(it.answer) : it.kind === 'inputs' ? it.inputs.map((i) => i.answer) : it.kind === 'canon' && it.answer.kind === 'number' ? { rows: [it.answer.value] } : it.kind === 'canon' && it.answer.kind === 'set' ? { rows: it.answer.values } : undefined; };
  const r0 = s.rungs[0];
  P.startRung(r0, NOW);
  const rd0 = Object.fromEntries(r0.uids.map((u) => [u, right(u)]));
  const out0 = P.finishRung(pool, s, 0, rd0, 3, NOW + 100000);
  assert.ok(out0);
  assert.equal(P.finishRung(pool, s, 0, rd0, 3, NOW + 200000), null); // a rung is finished once
  const sum0 = P.rungSummary(r0);
  assert.equal(sum0.seconds, Math.min(r0.seconds, 100));
  assert.ok(sum0.accuracy >= 0 && sum0.accuracy <= 1);
  // time over the allowance is capped, missing readings are unanswered
  const r1 = s.rungs[1];
  P.startRung(r1, NOW);
  P.finishRung(pool, s, 1, {}, 3, NOW + 10 ** 7);
  const sum1 = P.rungSummary(r1);
  assert.equal(sum1.accuracy, 0);
  assert.equal(sum1.seconds, r1.seconds);
  assert.equal(sum1.usedShare, 1);
  assert.equal(s.finishedAt, null);
  P.startRung(s.rungs[2], NOW);
  P.finishRung(pool, s, 2, {}, 3, NOW + 5000);
  assert.ok(s.finishedAt);
  const sum = P.summarize(s);
  assert.equal(sum.rows.length, 3);
  for (const k of Object.keys(sum)) assert.ok(!/score|points/i.test(k), `no combined score field: ${k}`);
  for (const r of sum.rows) assert.ok(!('score' in r));
  assert.match(sum.verdict, /./);
});

test('verdict follows the accuracy drop, not the speed', () => {
  const mkRung = (pct, right, used) => ({ pct, uids: ['a', 'b', 'c', 'd'], seconds: 100, used, results: Object.fromEntries(['a', 'b', 'c', 'd'].map((u, i) => [u, { correct: i < right, score: i < right ? 1 : 0, total: 1, skipped: false }])) });
  const drop = P.summarize({ family: 'radicals', rungs: [mkRung(1, 4, 90), mkRung(0.85, 3, 85), mkRung(0.7, 2, 70)] });
  assert.match(drop.verdict, /הדיוק ירד/);
  const steady = P.summarize({ family: 'radicals', rungs: [mkRung(1, 4, 90), mkRung(0.85, 4, 40), mkRung(0.7, 4, 30)] });
  assert.match(steady.verdict, /הדיוק נשמר/);
  assert.equal(steady.rows[2].accuracy, 1);
  assert.equal(steady.rows[2].seconds, 30);
});

test('state: sanitize and restore merge keep the local switch', () => {
  const s = P.makeSession(pool, P.families(pool)[0].id, 4, new Set(), NOW);
  const st = mem();
  P.save({ ...P.emptyState(), on: true, active: s }, st);
  assert.equal(P.load(st).on, true);
  assert.equal(P.load(st).active.rungs.length, 3);
  const finished = { ...s, id: 'p-done', finishedAt: NOW + 9, rungs: s.rungs.map((r) => ({ ...r, finishedAt: NOW + 9 })) };
  const merged = JSON.parse(P.mergePressure(JSON.stringify({ ...P.emptyState(), on: false }), JSON.stringify({ ...P.emptyState(), on: true, history: [finished] })));
  assert.equal(merged.on, false);
  assert.equal(merged.history.length, 1);
  assert.equal(P.mergePressure('x', 'y'), JSON.stringify(P.emptyState()));
});
