import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';

const dom = installFakeDom();
const L = await import('../js/ladder.js');
const U = await import('../js/ladder-ui.js');
const B = await import('../js/backup.js');
const nav = await import('../js/nav.js');
const { renderExercise } = await import('../js/exercise-view.js');
const store = await import('../js/store.js');

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const ladder = read('ladder.json');
const physics = read('physics.json');
const stages = ladder.stages;

// the shared fake DOM's replaceChildren() rejects plain strings, which the real DOM (and exercise-view.js) accepts
const Proto = Object.getPrototypeOf(document.createElement('x'));
const realReplace = Proto.replaceChildren;
Proto.replaceChildren = function (...kids) { return realReplace.apply(this, kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k))); };

const mk = (id, n) => ({ id, items: Array.from({ length: n }, (_, i) => ({ ref: `${id}-${i}` })) });
const alone = (ids) => (id) => (ids.includes(id) ? 'alone' : null);

test('ladder.json: six Hebrew stages, every ref resolves to a physics exercise, no duplicate ids per stage', () => {
  assert.equal(ladder.v, 1);
  assert.equal(ladder.g, 10);
  assert.deepEqual(stages.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  const ids = new Set(physics.map((e) => e.id));
  for (const s of stages) {
    assert.match(s.title, /[א-ת]/);
    assert.match(s.intro, /[א-ת]/);
    const refs = s.items.map(L.itemId);
    assert.equal(new Set(refs).size, refs.length, `duplicate in ${s.id}`);
    for (const it of s.items) if (!L.isInline(it)) assert.ok(ids.has(it.ref), `${s.id}: unknown ref ${it.ref}`);
    for (const it of s.items) if (L.isInline(it)) assert.ok(!ids.has(it.id), `${s.id}: inline id ${it.id} collides with physics.json`);
    if (!refs.length) assert.match(s.soon, /בקרוב/);
  }
  const all = L.allRefs(stages);
  assert.equal(new Set(all).size, all.length, 'an exercise appears in two stages');
  assert.deepEqual(stages.map((s) => s.items.length), [12, 22, 13, 12, 40, 8]);
});

test('needed(): ceil of 70%', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 10, 12, 22, 30].map(L.needed), [0, 1, 2, 3, 4, 7, 9, 16, 21]);
});

test('unlock rule: first stage open, next opens at the ceil threshold, only "alone" counts', () => {
  const st = [mk('a', 10), mk('b', 3)];
  const status = (ids) => L.ladderStatus(st, alone(ids), {}).map((e) => e.status);
  assert.deepEqual(status([]), ['unlocked', 'locked']);
  assert.deepEqual(status(['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5']), ['unlocked', 'locked']); // 6/10 < 7
  assert.deepEqual(status(['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6']), ['done', 'unlocked']); // 7/10
  const hinted = (id) => (id.startsWith('a-') ? 'hinted' : null);
  assert.deepEqual(L.ladderStatus(st, hinted, {}).map((e) => e.status), ['unlocked', 'locked']);
  assert.equal(L.ladderStatus(st, alone(['a-0']), {})[0].alone, 1);
});

test('unlock rule: empty stages are skipped, never block, and show as soon', () => {
  const st = [mk('a', 2), mk('b', 0), mk('c', 0), mk('d', 4)];
  assert.deepEqual(L.ladderStatus(st, alone([]), {}).map((e) => e.status), ['unlocked', 'soon', 'soon', 'locked']);
  assert.deepEqual(L.ladderStatus(st, alone(['a-0', 'a-1']), {}).map((e) => e.status), ['done', 'soon', 'soon', 'unlocked']);
  assert.deepEqual(L.ladderStatus([mk('x', 0), mk('y', 3)], alone([]), {}).map((e) => e.status), ['soon', 'unlocked']);
  assert.deepEqual(L.ladderStatus([], alone([]), {}), []);
});

test('skip flag opens exactly that stage, and is stored in its own key', () => {
  const st = [mk('a', 5), mk('b', 5), mk('c', 5)];
  assert.deepEqual(L.ladderStatus(st, alone([]), { b: true }).map((e) => e.status), ['unlocked', 'unlocked', 'locked']);
  assert.equal(L.ladderStatus(st, alone([]), { b: true })[1].skipped, true);
  L.setSkip('b');
  assert.deepEqual(JSON.parse(localStorage.getItem(L.LADDER_KEY)), { v: 1, skip: { b: true } });
  assert.deepEqual(L.loadLadder().skip, { b: true });
  L.setSkip('b', false);
  assert.deepEqual(L.loadLadder().skip, {});
  assert.deepEqual(L.sanitizeLadder({ skip: { a: true, b: 1, c: 'x' }, junk: 1 }), { v: 1, skip: { a: true } });
  assert.deepEqual(L.sanitizeLadder('garbage'), { v: 1, skip: {} });
  localStorage.setItem(L.LADDER_KEY, '{not json');
  assert.deepEqual(L.loadLadder(), { v: 1, skip: {} });
  localStorage.removeItem(L.LADDER_KEY);
});

test('backup: ladder key is allowlisted and round-trips', () => {
  assert.equal(L.LADDER_KEY, 'omri-study-ladder-v1');
  assert.ok(L.LADDER_KEY in B.KNOWN_KEYS);
  const v = JSON.stringify({ v: 1, skip: { S2: true } });
  const m = new Map([[L.LADDER_KEY, v], ['unrelated', 'x']]);
  const src = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, x) => m.set(k, String(x)) };
  const res = B.parseBackup(B.buildBackup(src, 3));
  assert.equal(res.ok, true);
  const dstMap = new Map();
  const dst = { getItem: (k) => (dstMap.has(k) ? dstMap.get(k) : null), setItem: (k, x) => dstMap.set(k, String(x)) };
  assert.equal(B.applyBackup(dst, res), true);
  assert.equal(dst.getItem(L.LADDER_KEY), v);
  assert.equal(dstMap.size, 2); // the key plus the undo snapshot
  assert.ok(dstMap.has(B.UNDO_KEY));
});

test('routes: #/ladder resolves, hub shows the ladder card first', () => {
  for (const h of ['#/ladder', '#/ladder/S1', '#/ladder/S1/3']) assert.equal(nav.resolveRoute(h).name, 'ladder');
  assert.deepEqual(nav.resolveRoute('#/ladder/S2/4').args, ['S2', '4']);
  assert.equal(nav.activeTab('#/ladder/S1'), 'practice');
  nav.viewHub({ topics: [], exercises: [], show: dom.show });
  const links = dom.root.all((n) => n.tagName === 'A');
  assert.equal(links[0].getAttribute('href'), '#/ladder');
  assert.match(links[0].textContent, /הסלם לרמת מבחן/);
});

const ctx = {
  show: dom.show,
  ladder: stages,
  topicOf: () => ({ title: 'פיזיקה' }),
  byId: (id) => physics.find((e) => e.id === id),
  renderExercise: (ex, o) => renderExercise(ex, o),
};
const hrefs = () => dom.root.all((n) => n.tagName === 'A').map((a) => a.getAttribute('href'));

test('UI: overview shows six cards with status, progress and soon note; locked stage offers skip', async () => {
  store.resetCache();
  localStorage.clear?.();
  await U.viewLadderRoute(ctx);
  const text = dom.root.textContent;
  assert.match(text, /0\/12 לבד/);
  assert.match(text, /0\/22 לבד/);
  assert.match(text, /🔓 פתוח/);
  assert.match(text, /🔒 נעול/);
  assert.match(text, /0\/13 לבד/);
  assert.match(text, /0\/8 לבד/);
  assert.equal((text.match(/⏳ בקרוב/g) || []).length, 0);
  assert.deepEqual(hrefs().filter((h) => /^#\/ladder\/S\d$/.test(h)), ['#/ladder/S1', '#/ladder/S2', '#/ladder/S3', '#/ladder/S4', '#/ladder/S5', '#/ladder/S6']);
  assert.deepEqual(hrefs().filter((h) => /^#\/ladder(\/math)?$/.test(h)), ['#/ladder', '#/ladder/math'], 'subject tabs: physics first (current), math second');

  await U.viewLadderRoute(ctx, 'S2'); // locked: no item list, skip button
  assert.match(dom.root.textContent, /השלב נעול/);
  assert.equal(hrefs().filter((h) => /^#\/ladder\/S2\/\d+$/.test(h)).length, 0);
  dom.root.byText('button', 'לדלג בכל זאת').click();
  assert.equal(hrefs().filter((h) => /^#\/ladder\/S2\/\d+$/.test(h)).length, 22);
  assert.deepEqual(L.loadLadder().skip, { S2: true });

  await U.viewLadderRoute(ctx, 'S6'); // locked behind S5
  assert.match(dom.root.textContent, /השלב נעול/);
  await U.viewLadderRoute(ctx, 'nope');
  assert.match(dom.root.textContent, /הסלם לרמת מבחן/);
});

test('UI: item page renders the exercise with nav, solving alone updates the stage progress', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  await U.viewLadderRoute(ctx, 'S1', '1');
  const ex = physics.find((e) => e.id === stages[0].items[0].ref);
  assert.match(dom.root.textContent, new RegExp(ex.title.slice(0, 8)));
  assert.ok(hrefs().includes('#/ladder/S1/2'));
  assert.ok(hrefs().includes('#/ladder/S1'));
  assert.ok(!hrefs().includes('#/ladder/S1/0'));
  const inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, ex.inputs.length);
  inputs.forEach((inp, i) => { inp.value = ex.inputs[i].answer; });
  // the shared fake DOM's classList only has toggle(); the renderer also calls add/remove
  dom.root.all((n) => n.classList).forEach((n) => { n.classList.add = (c) => n.classList.toggle(c, true); n.classList.remove = (c) => n.classList.toggle(c, false); });
  dom.root.querySelector('form').dispatch('submit');
  assert.match(dom.root.textContent, /נכון/);
  assert.equal(store.outcomeOf(ex.id), 'alone');
  await U.viewLadderRoute(ctx);
  assert.match(dom.root.textContent, /1\/12 לבד/);

  await U.viewLadderRoute(ctx, 'S1', '12'); // last item: finish link
  assert.ok(hrefs().includes('#/ladder'));
  assert.ok(hrefs().includes('#/ladder/S1/11'));
  await U.viewLadderRoute(ctx, 'S1', '99'); // out of range falls back to the stage list
  assert.match(dom.root.textContent, /1\/12 לבד/);
  await U.viewLadderRoute(ctx, 'S5', '1'); // locked stage never renders items
  assert.match(dom.root.textContent, /השלב נעול/);
});

test('UI: load failure shows an error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  await U.viewLadderRoute({ show: dom.show });
  assert.match(dom.root.textContent, /לא ניתן לטעון/);
  globalThis.fetch = realFetch;
});

/* ---- inline items (stage S3): their own outcome tracking in the ladder key ---- */
const s3 = stages.find((x) => x.id === 'S3');
const press = () => dom.root.all((n) => n.classList).forEach((n) => { n.classList.add = (c) => n.classList.toggle(c, true); n.classList.remove = (c) => n.classList.toggle(c, false); });

test('inline items: S3 holds 13 inline exercises with ids lad-s3-NN, no ref, same fields the renderer needs', () => {
  assert.equal(s3.items.length, 13);
  s3.items.forEach((it, i) => {
    assert.ok(L.isInline(it));
    assert.equal(it.id, `lad-s3-${String(i + 1).padStart(2, '0')}`);
    assert.equal(L.itemId(it), it.id);
    for (const k of ['topic', 'title', 'statement', 'diagram', 'inputs', 'tips', 'solution']) assert.ok(it[k], `${it.id}.${k}`);
    assert.ok(it.inputs.length >= 3 && it.inputs.length <= 5);
  });
});

test('inline state: shape is backward compatible and survives garbage', () => {
  localStorage.removeItem(L.LADDER_KEY);
  assert.deepEqual(L.sanitizeLadder({ v: 1, skip: { S2: true } }), { v: 1, skip: { S2: true } }); // old file: no items key
  assert.deepEqual(L.sanitizeLadder({ v: 1, skip: {}, items: 'junk' }), { v: 1, skip: {} });
  assert.deepEqual(L.sanitizeLadder({ v: 1, skip: {}, items: { ex: { x: { outcome: 'bogus' } } } }), { v: 1, skip: {} });
  const ok = L.sanitizeLadder({ v: 1, skip: {}, items: { ex: { 'lad-s3-01': { outcome: 'alone', attempts: 2, ts: 5 } }, att: {} } });
  assert.equal(ok.items.ex['lad-s3-01'].outcome, 'alone');
  assert.equal(L.inlineOutcome('lad-s3-01'), null);
  const sink = L.inlineSink('lad-s3-01');
  sink.setTips('lad-s3-01' && 2);
  assert.equal(sink.tips(), 2);
  sink.correct();
  assert.equal(sink.outcome(), 'hinted');
  assert.equal(L.inlineOutcome('lad-s3-01'), 'hinted');
  L.setSkip('S4'); // skip flags and items live side by side
  assert.deepEqual(L.loadLadder().skip, { S4: true });
  assert.equal(L.loadLadder().items.ex['lad-s3-01'].outcome, 'hinted');
  const s2 = L.inlineSink('lad-s3-02');
  s2.reveal();
  assert.equal(s2.outcome(), 'review');
  const lookup = L.outcomeLookup(stages, (id) => (id === 'phys-vertical-035' ? 'alone' : null));
  assert.equal(lookup('phys-vertical-035'), 'alone');
  assert.equal(lookup('lad-s3-01'), 'hinted');
  assert.equal(lookup('lad-s3-03'), null);
  localStorage.removeItem(L.LADDER_KEY);
});

test('inline state: "alone" counts toward the unlock rule, hinted does not', () => {
  localStorage.removeItem(L.LADDER_KEY);
  const st = [stages[1], s3, mk('next', 3)];
  const refAlone = (id) => (id.startsWith('phys-') ? 'alone' : null);
  const lookup = () => L.outcomeLookup(st, refAlone);
  assert.equal(L.ladderStatus(st, lookup(), {})[1].status, 'unlocked'); // S2 done via refs
  assert.equal(L.ladderStatus(st, lookup(), {})[2].status, 'locked');
  for (let i = 1; i <= 8; i++) L.inlineSink(`lad-s3-0${i}`).correct(); // 8 of 13 alone: below ceil(9.1)=10
  assert.equal(L.ladderStatus(st, lookup(), {})[1].alone, 8);
  assert.equal(L.ladderStatus(st, lookup(), {})[2].status, 'locked');
  for (const id of ['lad-s3-09', 'lad-s3-10']) L.inlineSink(id).correct();
  assert.equal(L.ladderStatus(st, lookup(), {})[1].status, 'done');
  assert.equal(L.ladderStatus(st, lookup(), {})[2].status, 'unlocked');
  L.inlineSink('lad-s3-10').setTips(1);
  assert.equal(L.ladderStatus(st, lookup(), {})[1].alone, 10, 'a tip opened after solving does not demote an existing outcome');
  localStorage.removeItem(L.LADDER_KEY);
});

test('UI: an inline S3 item renders with its graph, and a correct answer is recorded in the ladder key (not the main store)', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  L.setSkip('S3');
  await U.viewLadderRoute(ctx, 'S3');
  assert.match(dom.root.textContent, /0\/13 לבד/);
  assert.equal(hrefs().filter((h) => /^#\/ladder\/S3\/\d+$/.test(h)).length, 13);
  await U.viewLadderRoute(ctx, 'S3', '2');
  const it = s3.items[1];
  assert.match(dom.root.textContent, new RegExp(it.title.slice(0, 8)));
  const inputs = dom.root.all((n) => n.tagName === 'INPUT');
  assert.equal(inputs.length, it.inputs.length);
  inputs.forEach((inp, i) => { inp.value = it.inputs[i].answer; });
  press();
  dom.root.querySelector('form').dispatch('submit');
  assert.match(dom.root.textContent, /נכון/);
  assert.equal(L.inlineOutcome(it.id), 'alone');
  assert.equal(store.outcomeOf(it.id), null);
  assert.deepEqual(Object.keys(L.loadLadder().items.ex), [it.id]);
  await U.viewLadderRoute(ctx);
  assert.match(dom.root.textContent, /1\/13 לבד/);
  await U.viewLadderRoute(ctx, 'S3', '99');
  assert.match(dom.root.textContent, /1\/13 לבד/);
  localStorage.removeItem(L.LADDER_KEY);
});

// ---- stage S6: sketch parts
const s6 = stages.find((x) => x.id === 'S6');
const boxes = () => dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'checkbox');
const answerAll = (it) => {
  press();
  dom.root.all((n) => n.tagName === 'INPUT' && n.getAttribute('type') !== 'checkbox').forEach((inp, i) => { inp.value = it.inputs[i].answer; });
  dom.root.querySelector('form').dispatch('submit');
};

test('S6 data: >= 8 items, 5-6 parts each, every item has a sketch part with a 3-line checklist and a reference graph', () => {
  assert.ok(s6.items.length >= 8);
  for (const it of s6.items) {
    assert.match(it.id, /^lad-s6-[0-9]{2}$/);
    assert.ok(it.inputs.length + it.sketches.length >= 5 && it.inputs.length + it.sketches.length <= 6, it.id);
    assert.ok(it.sketches.length >= 1, it.id);
    for (const sk of it.sketches) {
      assert.equal(sk.checklist.length, 3, it.id);
      assert.match(sk.svg, /^<svg /, it.id);
    }
    assert.match(it.statement, /<br>ו\. /, it.id);
  }
});

test('S6 UI: the sketch part reveals the graph and the checklist, never blocks the numeric parts, and counts only when every box is ticked', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  L.setSkip('S6');
  const it = s6.items[0];
  await U.viewLadderRoute(ctx, 'S6', '1');
  assert.equal(boxes().length, 0, 'the checklist is hidden until the correct graph is shown');
  assert.equal(dom.root.querySelector('svg'), null);
  // numeric answers first: the item is not yet recorded, and the page says what is left
  answerAll(it);
  assert.match(dom.root.textContent, /נכון/);
  assert.equal(L.inlineOutcome(it.id), null);
  assert.match(dom.root.textContent, /נותר לסמן את סעיף השרטוט/);
  dom.root.byText('button', 'הצג את הגרף הנכון').click();
  assert.equal(boxes().length, 3);
  assert.match(dom.root.textContent, /בדיקה עצמית/);
  boxes()[0].checked = true; boxes()[0].dispatch('change');
  boxes()[1].checked = true; boxes()[1].dispatch('change');
  assert.equal(L.inlineOutcome(it.id), null, 'two of three boxes do not count');
  boxes()[2].checked = true; boxes()[2].dispatch('change');
  assert.equal(L.inlineOutcome(it.id), 'alone');
  assert.equal(store.outcomeOf(it.id), null);
  boxes()[1].checked = false; boxes()[1].dispatch('change');
  assert.equal(L.inlineOutcome(it.id), 'alone', 'unticking later does not undo a recorded outcome');
  localStorage.removeItem(L.LADDER_KEY);
});

test('S6 UI: ticking the sketch first, then solving, records the item; an unticked sketch with a revealed solution never gives "alone"', async () => {
  store.resetCache();
  localStorage.removeItem(L.LADDER_KEY);
  L.setSkip('S6');
  const it = s6.items[1];
  await U.viewLadderRoute(ctx, 'S6', '2');
  dom.root.byText('button', 'הצג את הגרף הנכון').click();
  boxes().forEach((b) => { b.checked = true; b.dispatch('change'); });
  assert.equal(L.inlineOutcome(it.id), null, 'a sketch alone records nothing');
  answerAll(it);
  assert.equal(L.inlineOutcome(it.id), 'alone');
  // item 3: numeric answers right but the sketch left unticked
  const it3 = s6.items[2];
  await U.viewLadderRoute(ctx, 'S6', '3');
  answerAll(it3);
  assert.equal(L.inlineOutcome(it3.id), null);
  const { sketchGate } = U;
  const gate = sketchGate(it3.sketches);
  assert.equal(gate.done(), false);
  localStorage.removeItem(L.LADDER_KEY);
});
