// Hostile payloads and valid "local" samples for the corrupt-backup fuzz tests (restore.test.mjs, backup.test.mjs).
import * as B from '../../js/backup.js';
import * as NB from '../../js/notebook.js';
import * as D from '../../js/derive.js';
import * as J from '../../js/journal.js';
import * as X from '../../js/examday.js';
import * as C from '../../js/counter.js';
import * as R from '../../js/replay.js';
import * as Bl from '../../js/blind.js';
import * as Rc from '../../js/recovery.js';
import * as P from '../../js/pressure.js';
import { LOG_KEY } from '../../js/srs.js';
import { FEEDBACK_KEY } from '../../js/feedback.js';

/** 12 raw strings a corrupted, truncated or tampered backup/local value could hold. */
export const HOSTILE = [
  ['bad json', '{bad json'],
  ['null', 'null'],
  ['number', '42'],
  ['empty array', '[]'],
  ['string', '"a string"'],
  ['empty string', ''],
  ['prototype keys', '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"entries":{"__proto__":{"id":"x","title":"y","count":1}},"tasks":{"__proto__":{"done":true}},"logs":{"__proto__":{"kind":"booklet","events":[]}},"pending":{"__proto__":{"score":5,"kind":"booklet"}}}'],
  ['wrong-typed fields', JSON.stringify({ v: 'x', entries: 5, tasks: [], records: 's', history: { a: 1 }, logs: 7, pending: [1], active: 'no', on: 'yes', count: 'many', last: {}, items: null })],
  ['array of junk', JSON.stringify([null, 1, 'a', [], {}, { id: {}, exerciseId: [], ts: 'x', outcome: 5 }])],
  ['huge strings', JSON.stringify({ entries: { x: { title: 't'.repeat(3e6), note: 'n'.repeat(3e6) } }, history: [{ id: 'i'.repeat(1e6) }], tasks: { ['k'.repeat(1e6)]: { done: true } }, records: ['r'.repeat(1e6)] })],
  ['deep nesting', '['.repeat(3000) + ']'.repeat(3000)],
  ['infinite numbers', '{"count":1e999,"last":-1e999,"ts":null,"entries":[{"ts":1e999}],"tasks":{"a":{"tries":1e999,"ts":-5}},"history":[{"id":"h","finishedAt":1e999}]}'],
];

const derive = D.emptyState();
D.markRead(derive, 'dv-m-01', 1000);
const rung = (pct) => ({ pct, uids: ['a'], results: {}, seconds: 5, startedAt: 1, finishedAt: 2, used: 0 });

/** One entry per merge function: its storage key, a valid local value and a regex that must still match the merged value. */
export const MERGES = [
  { name: 'mergeAttempts', key: LOG_KEY, fn: B.mergeAttempts, local: JSON.stringify([{ exerciseId: 'LOCAL-ex', ts: 100, outcome: 'alone' }]), sentinel: /LOCAL-ex/ },
  { name: 'mergeFeedback', key: FEEDBACK_KEY, fn: B.mergeFeedback, local: JSON.stringify({ v: 1, records: [{ id: 'LOCAL-fb', ts: 5, exerciseId: 'e1', mode: 'exercise', topic: 't', rating: 3, hardTags: [], correct: true }] }), sentinel: /LOCAL-fb/ },
  { name: 'mergeNotebook', key: NB.KEY, fn: NB.mergeNotebook, local: JSON.stringify({ v: 1, entries: { 'LOCAL-nb': { title: 'x', count: 1, lastTs: 5 } } }), sentinel: /LOCAL-nb/ },
  { name: 'mergeDerive', key: D.KEY, fn: D.mergeDerive, local: JSON.stringify(derive), sentinel: /dv-m-01/ },
  { name: 'mergeJournal', key: J.KEY, fn: J.mergeJournal, local: JSON.stringify({ v: 1, entries: [], pending: { 'LOCAL-pend': { score: 50, kind: 'booklet', ts: 5 } } }), sentinel: /LOCAL-pend/ },
  { name: 'mergeExamday', key: X.KEY, fn: X.mergeExamday, local: JSON.stringify({ v: 1, count: 7, last: 10 }), sentinel: /"count":7/ },
  { name: 'mergeCounter', key: C.KEY, fn: C.mergeCounter, local: JSON.stringify({ v: 1, tasks: { 'ce-01': { done: true, tries: 2, ts: 9 } } }), sentinel: /ce-01/ },
  { name: 'mergeReplay', key: R.KEY, fn: R.mergeReplay, local: JSON.stringify({ v: 1, logs: { 'LOCAL-rp': { kind: 'booklet', startedAt: 1, finishedAt: 9, events: [{ t: 1, type: 'open', q: 'a' }] } } }), sentinel: /LOCAL-rp/ },
  { name: 'mergeBlind', key: Bl.KEY, fn: Bl.mergeBlind, local: JSON.stringify({ v: 1, active: null, history: [{ id: 'LOCAL-bl', ts: 1, uids: ['a'], results: {}, wrong: {}, finishedAt: 5 }] }), sentinel: /LOCAL-bl/ },
  { name: 'mergeRecovery', key: Rc.KEY, fn: Rc.mergeRecovery, local: JSON.stringify({ v: 1, active: null, history: [{ id: 'LOCAL-rc', ts: 1, uids: ['a', 'b', 'c', 'd'], results: {}, log: { kind: 'recovery', events: [] }, finishedAt: 5 }] }), sentinel: /LOCAL-rc/ },
  { name: 'mergePressure', key: P.KEY, fn: P.mergePressure, local: JSON.stringify({ v: 1, on: true, active: null, history: [{ id: 'LOCAL-pr', ts: 1, rungs: [rung(1), rung(0.85), rung(0.7)], finishedAt: 5 }] }), sentinel: /LOCAL-pr/ },
];

/** The merged value must be a string of valid JSON and must not have polluted Object.prototype. */
export function assertSane(assert, out, label) {
  assert.equal(typeof out, 'string', label);
  JSON.parse(out);
  assert.equal(({}).polluted, undefined, label + ': Object.prototype polluted');
  assert.equal(Object.keys(Object.prototype).length, 0, label + ': Object.prototype gained keys');
}
