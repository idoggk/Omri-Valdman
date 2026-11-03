import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const B = await import('../js/backup.js');

const LOG = 'omri-study-attempts-v1';
const FB = 'omri-study-feedback-v1';
const DAY = 86_400_000;

const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};
const att = (exerciseId, ts, extra = {}) => ({ exerciseId, ts, outcome: 'alone', ...extra });
const logOf = (s) => JSON.parse(s.getItem(LOG));
const rec = (id, ts) => ({ id, ts, exerciseId: 'e1', mode: 'exercise', topic: 't', rating: 3, hardTags: [], correct: true });
const backupOf = (init, now = 1000) => B.parseBackup(B.buildBackup(fake(init), now));

test('envelope: v1 files are accepted and migrated, v2 is current, newer and bad versions are rejected', () => {
  assert.equal(B.BACKUP_VERSION, 2);
  const mk = (v) => JSON.stringify({ app: 'brain-gains', v, ts: 1, data: { 'omri-study-drills-v1': '{"v":1}' } });
  const v1 = B.parseBackup(mk(1));
  assert.equal(v1.ok, true);
  assert.equal(v1.fromVersion, 1);
  assert.equal(B.parseBackup(mk(2)).fromVersion, 2);
  for (const bad of [0, 3, '1', 1.5, null]) assert.equal(B.parseBackup(mk(bad)).ok, false, String(bad));
  assert.equal(B.migrateEnvelope({ v: 1, data: {} }).v, 2);
  assert.equal(JSON.parse(B.buildBackup(fake({ 'omri-study-drills-v1': '{}' }))).v, 2);
});

test('the undo snapshot key is excluded from backups', () => {
  assert.ok(B.EXCLUDED_KEYS.includes(B.UNDO_KEY));
  assert.ok(!(B.UNDO_KEY in B.KNOWN_KEYS));
  const s = fake({ [B.UNDO_KEY]: '{}', 'omri-study-drills-v1': '{}' });
  assert.ok(!(B.UNDO_KEY in JSON.parse(B.buildBackup(s)).data));
});

test('attempts log is merged by (exerciseId, ts): union, local wins ties, sorted, nothing lost', () => {
  const local = fake({ [LOG]: JSON.stringify([att('a', 10), att('b', 30, { outcome: 'hinted' })]) });
  const parsed = backupOf({ [LOG]: JSON.stringify([att('a', 10, { outcome: 'solution' }), att('c', 20)]) });
  assert.deepEqual(B.restoreCounts(local, parsed), { local: 2, backup: 2, merged: 3 });
  assert.equal(B.restoreBackup(local, parsed, 5).ok, true);
  const log = logOf(local);
  assert.deepEqual(log.map((x) => `${x.exerciseId}:${x.ts}`), ['a:10', 'c:20', 'b:30']);
  assert.equal(log[0].outcome, 'alone', 'local row wins the tie');
});

test('feedback records are merged by id, newest records kept under the cap', () => {
  const local = fake({ [FB]: JSON.stringify({ v: 1, records: [rec('x', 5), rec('y', 9)] }) });
  const parsed = backupOf({ [FB]: JSON.stringify({ v: 1, records: [rec('y', 9), rec('z', 7)] }) });
  assert.equal(B.restoreBackup(local, parsed).ok, true);
  assert.deepEqual(JSON.parse(local.getItem(FB)).records.map((r) => r.id), ['x', 'z', 'y']);
  const many = (p, n, t0) => Array.from({ length: n }, (_, i) => rec(`${p}${i}`, t0 + i));
  const merged = JSON.parse(B.mergeFeedback(JSON.stringify({ records: many('l', 1500, 1) }), JSON.stringify({ records: many('b', 1500, 5000) })));
  assert.equal(merged.records.length, 2000);
  assert.equal(merged.records.at(-1).id, 'b1499');
});

test('the attempts cap is respected after a merge', () => {
  const rows = (p, n, t0) => Array.from({ length: n }, (_, i) => att(`${p}${i}`, t0 + i));
  const out = JSON.parse(B.mergeAttempts(JSON.stringify(rows('l', 3000, 1)), JSON.stringify(rows('b', 3000, 10000))));
  assert.ok(out.length <= 5000);
});

test('all other keys are replaced, keys missing from the backup are left alone', () => {
  const local = fake({ 'omri-study-drills-v1': '{"old":1}', 'omri-study-order-v1': '{"keep":1}' });
  const parsed = backupOf({ 'omri-study-drills-v1': '{"new":1}' });
  assert.equal(B.applyBackup(local, parsed), true);
  assert.equal(local.getItem('omri-study-drills-v1'), '{"new":1}');
  assert.equal(local.getItem('omri-study-order-v1'), '{"keep":1}');
});

test('idempotent: restoring the same file twice equals restoring it once', () => {
  const local = fake({
    [LOG]: JSON.stringify([att('a', 10), att('z', 99)]),
    [FB]: JSON.stringify({ v: 1, records: [rec('x', 5)] }),
    'omri-study-drills-v1': '{"old":1}',
  });
  const parsed = backupOf({
    [LOG]: JSON.stringify([att('a', 10), att('c', 20), att('d', 20)]),
    [FB]: JSON.stringify({ v: 1, records: [rec('y', 9)] }),
    'omri-study-drills-v1': '{"new":1}',
  });
  const dump = () => JSON.stringify(Object.fromEntries([...local.m].filter(([k]) => k !== B.UNDO_KEY).sort()));
  assert.equal(B.applyBackup(local, parsed), true);
  const once = dump();
  assert.equal(B.applyBackup(local, parsed), true);
  assert.equal(dump(), once);
  assert.equal(logOf(local).length, 4);
});

test('quota mid-restore: rolled back to the snapshot, failure reported, no undo left behind', () => {
  const initial = {
    [LOG]: JSON.stringify([att('a', 10)]),
    'omri-study-drills-v1': '{"old":1}',
    'omri-study-order-v1': '{"old":2}',
  };
  const local = fake(initial);
  let sets = 0;
  const realSet = local.setItem;
  local.setItem = (k, v) => {
    sets++;
    if (sets === 3) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    realSet(k, v);
  };
  const parsed = backupOf({
    [LOG]: JSON.stringify([att('n', 50)]),
    'omri-study-drills-v1': '{"new":1}',
    'omri-study-order-v1': '{"new":2}',
  });
  const res = B.restoreBackup(local, parsed);
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  for (const [k, v] of Object.entries(initial)) assert.equal(local.getItem(k), v, k);
  assert.equal(local.getItem(B.UNDO_KEY), null);
  assert.equal(B.applyBackup(fake(initial), { ok: false }), false);
});

test('undo: restores the pre-restore state for 24 h, once, and an expired snapshot is ignored', () => {
  const initial = { [LOG]: JSON.stringify([att('a', 10)]), 'omri-study-drills-v1': '{"old":1}' };
  const local = fake(initial);
  const parsed = backupOf({ [LOG]: JSON.stringify([att('n', 50)]), 'omri-study-drills-v1': '{"new":1}', 'omri-study-order-v1': '{"x":1}' });
  const t0 = 1_000_000;
  assert.equal(B.undoAvailable(local, t0), null);
  assert.equal(B.restoreBackup(local, parsed, t0).undo, true);
  assert.equal(B.undoAvailable(local, t0 + DAY - 1), t0);
  assert.equal(B.undoAvailable(local, t0 + DAY), null);
  assert.equal(B.undoRestore(local, t0 + DAY), false, 'expired');
  assert.equal(B.undoRestore(local, t0 + 5), true);
  assert.equal(local.getItem(LOG), initial[LOG]);
  assert.equal(local.getItem('omri-study-drills-v1'), '{"old":1}');
  assert.equal(local.getItem('omri-study-order-v1'), null, 'a key that did not exist before is removed again');
  assert.equal(B.undoAvailable(local, t0 + 6), null);
  assert.equal(B.undoRestore(local, t0 + 6), false);
});

test('a second restore replaces the undo snapshot (only one is kept)', () => {
  const local = fake({ 'omri-study-drills-v1': '{"a":1}' });
  B.restoreBackup(local, backupOf({ 'omri-study-drills-v1': '{"b":1}' }), 10);
  B.restoreBackup(local, backupOf({ 'omri-study-drills-v1': '{"c":1}' }), 20);
  assert.equal(B.undoAvailable(local, 30), 20);
  B.undoRestore(local, 30);
  assert.equal(local.getItem('omri-study-drills-v1'), '{"b":1}');
});

test('a full storage that cannot hold the undo copy still restores', () => {
  const local = fake({ 'omri-study-drills-v1': '{"a":1}' });
  const realSet = local.setItem;
  local.setItem = (k, v) => { if (k === B.UNDO_KEY) throw new Error('full'); realSet(k, v); };
  const res = B.restoreBackup(local, backupOf({ 'omri-study-drills-v1': '{"b":1}' }));
  assert.deepEqual([res.ok, res.undo], [true, false]);
  assert.equal(local.getItem('omri-study-drills-v1'), '{"b":1}');
});

test('share file: uses canShare/share with a File, falls back (unsupported) otherwise, abort is not a failure to copy', async () => {
  class F { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } }
  const calls = [];
  const nav = { canShare: () => true, share: async (d) => { calls.push(d); } };
  const ok = await B.shareBackupFile('{}', 'b.json', nav, F);
  assert.equal(ok.ok, true);
  assert.equal(calls[0].files[0].name, 'b.json');
  assert.equal((await B.shareBackupFile('{}', 'b.json', { share: async () => {} }, F)).unsupported, true);
  assert.equal((await B.shareBackupFile('{}', 'b.json', { canShare: () => false, share: async () => {} }, F)).unsupported, true);
  assert.equal((await B.shareBackupFile('{}', 'b.json', {}, F)).unsupported, true);
  const abort = await B.shareBackupFile('{}', 'b.json', { canShare: () => true, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }, F);
  assert.deepEqual([abort.ok, !!abort.unsupported], [false, false]);
});

test('persistence state is read from navigator.storage and never throws', async () => {
  assert.deepEqual(await B.storagePersistence({ storage: { persisted: async () => true } }), { supported: true, persisted: true });
  assert.deepEqual(await B.storagePersistence({ storage: { persisted: async () => false } }), { supported: true, persisted: false });
  assert.deepEqual(await B.storagePersistence({}), { supported: false, persisted: false });
  assert.deepEqual(await B.storagePersistence({ storage: { persisted: async () => { throw new Error('x'); } } }), { supported: false, persisted: false });
});

test('home reminder: only with >= 5 attempts and no backup or one 7+ days old', () => {
  assert.equal(B.homeReminderText(null, 4), null);
  assert.equal(B.homeReminderText(30, 4), null);
  assert.match(B.homeReminderText(null, 5), /עוד לא גיביתם/);
  assert.equal(B.homeReminderText(6, 50), null);
  assert.match(B.homeReminderText(7, 5), /לפני 7 ימים/);
});

test('backup screen: share button falls back to copy, preview shows timestamp and counts, restore then undo', async () => {
  dom.store.clear();
  dom.store.set(LOG, JSON.stringify([att('a', 10), att('b', 20)]));
  dom.store.set('omri-study-drills-v1', JSON.stringify({ v: 1, items: { x: {} } }));
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
  B.viewBackup({ show: dom.show });
  assert.ok(dom.root.byText('button', 'שתף קובץ גיבוי'));
  dom.root.byText('button', 'שתף קובץ גיבוי').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(dom.store.has(B.LAST_BACKUP_KEY), 'fell back to copy and recorded the backup');
  const code = B.buildBackup(globalThis.localStorage, Date.UTC(2026, 10, 1));
  dom.store.set(LOG, JSON.stringify([att('a', 10), att('q', 30), att('r', 40)]));
  const input = dom.root.all((n) => n.tagName === 'TEXTAREA' && n.attrs.placeholder)[0];
  input.value = code;
  dom.root.byText('button', 'בדוק קוד').click();
  assert.match(dom.root.textContent, /3 במכשיר הזה, 2 בגיבוי\. אחרי האיחוד יהיו 4/);
  assert.match(dom.root.textContent, /הגיבוי נוצר ב/);
  dom.root.byText('button', 'אשרו שחזור').click();
  assert.match(dom.root.textContent, /הגיבוי שוחזר/);
  assert.equal(JSON.parse(dom.store.get(LOG)).length, 4);
  dom.root.byText('button', 'בטלו את השחזור האחרון').click();
  assert.equal(JSON.parse(dom.store.get(LOG)).length, 3);
  assert.match(dom.root.textContent, /השחזור בוטל/);
});
