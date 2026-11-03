import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validate, loadDeriveFiles, verifyTask } from '../tools/verify-derive.mjs';

const dom = installFakeDom();
const D = await import('../js/derive.js');
const UI = await import('../js/derive-ui.js');
const store = await import('../js/store.js');
const nav = await import('../js/nav.js');
const B = await import('../js/backup.js');
const E = await import('../js/engine.js');
const S = await import('../js/srs.js');
const P = await import('../js/plan.js');

const tasks = loadDeriveFiles();
const byId = (id) => tasks.find((t) => t.id === id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8')) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn };
const reset = () => { dom.store.clear(); store.resetCache(); };
const T0 = Date.UTC(2026, 10, 4, 9, 0, 0);
const DAY = D.DAY_MS || 86400000;
const text = () => dom.root.textContent.replace(/[⁦⁩]/g, '');

test('verifier: 24 tasks (12 math, 12 physics) pass; every line and every wrong candidate is checked numerically', () => {
  const { errors, stats } = validate();
  assert.deepEqual(errors, []);
  assert.equal(stats.tasks, 24);
  assert.equal(stats.math, 12);
  assert.equal(stats.physics, 12);
  assert.ok(stats.lines >= 100 && stats.wrongs >= 300 && stats.solve >= 5);
  for (const t of tasks) {
    assert.ok(t.steps.length >= 4 && t.steps.length <= 7, t.id);
    assert.ok(t.steps.every((s) => s.w.length === 3), t.id);
  }
});

test('verifier fails when a step is false, a wrong candidate is true, or a solution set changes', () => {
  const run = (id, mutate) => { const t = clone(byId(id)); mutate(t); const errs = []; verifyTask(t, errs); return errs; };
  assert.ok(run('dv-m-01', (t) => { t.steps[2].f = 'sin(a)^2 = 1 + cos(a)^2'; }).some((m) => /not true/.test(m)));
  assert.ok(run('dv-m-01', (t) => { t.steps[1].w[0].f = 'cos(2*a) = cos(a)^2 - sin(a)^2'; }).some((m) => /duplicates|true everywhere/.test(m)));
  assert.ok(run('dv-m-01', (t) => { t.steps[1].w[0].f = 'cos(2*a) = 1 - 2*sin(a)^2'; }).some((m) => /true everywhere/.test(m)));
  assert.ok(run('dv-m-08', (t) => { t.steps[3].f = 'S*(q-1) = q^n + 1'; }).some((m) => /not true/.test(m)));
  assert.ok(run('dv-m-06', (t) => { t.steps[2].f = '(x + b/(2*a))^2 = b^2/(4*a^2) + c/a'; }).some((m) => /same solutions/.test(m)));
  assert.ok(run('dv-m-06', (t) => { t.steps[1].w[0].f = 'x^2 + (b/a)*x = -c/a'; }).some((m) => /same solutions as the correct/.test(m)));
  assert.ok(run('dv-p-05', (t) => { t.steps[4].f = 't = (d - vB*t0)/(vA + vB)'; }).some((m) => /same solutions|goalF/.test(m)));
  assert.ok(run('dv-p-04', (t) => { t.steps[1].w[0].e = 'nonsense'; }).some((m) => /unknown error type/.test(m)));
  assert.ok(run('dv-p-04', (t) => { t.goalF = 'v^2 = v0^2 + a*x'; }).some((m) => /goalF/.test(m)));
  assert.ok(run('dv-p-04', (t) => { t.steps.pop(); t.steps.pop(); }).some((m) => /invalid task/.test(m)));
  assert.ok(validate(tasks.slice(1)).errors.some((m) => /expected 12 math/.test(m)));
});

test('expression engine: log_b, ln, sums, statements with or/and', () => {
  const f = D.exprFn('log_2(8) + ln(1)');
  assert.ok(Math.abs(f({}) - 3) < 1e-12);
  const g = D.exprFn('sum(i;1;n;i^2)');
  assert.equal(g({ n: 4 }), 30);
  assert.ok(Number.isNaN(g({ n: 400 })));
  const st = D.parseStatement('x = 1 or x = 2');
  assert.equal(st.truth({ x: 2 }), true);
  assert.equal(st.truth({ x: 3 }), false);
  assert.throws(() => D.parseStatement('x + 1'), /relation/);
  assert.equal(D.pretty('cos(2*a) = 2*cos(a)^2 - 1', { a: 'α' }), 'cos(2·α) = 2·cos(α)<sup>2</sup> − 1');
  assert.match(D.pretty('v0*t + a*t^2/2', {}), /v<sub>0<\/sub>·t/);
});

/* ---------- scheduler ---------- */
test('scheduler: read -> due in 1 day; clean recalls move boxes 1/3/7/14 days; a mistake goes back to tomorrow', () => {
  const st = D.emptyState();
  const id = 'dv-m-01';
  assert.equal(D.levelOf(st.tasks[id]), 0);
  assert.deepEqual(D.dueIds(st, T0 + 10 * DAY), []);
  D.markRead(st, id, T0);
  assert.equal(st.tasks[id].due, T0 + 1 * DAY);
  assert.equal(D.levelOf(st.tasks[id]), 1);
  assert.equal(D.isDue(st.tasks[id], T0 + DAY - 1), false);
  assert.equal(D.isDue(st.tasks[id], T0 + DAY), true);
  const gaps = [];
  let now = T0 + DAY;
  const levels = [];
  for (let i = 0; i < 4; i++) {
    levels.push(D.levelOf(st.tasks[id]));
    const e = D.applyResult(st, id, { clean: true }, now);
    gaps.push(Math.round((e.due - now) / DAY));
    now = e.due;
  }
  assert.deepEqual(gaps, [3, 7, 14, 14]);
  assert.deepEqual(levels, [1, 2, 3, 3]);
  assert.equal(st.tasks[id].b, 4);
  const down = D.applyResult(st, id, { clean: false }, now);
  assert.equal(down.b, 3);
  assert.equal(down.due, now + DAY);
  assert.equal(down.tries, 5);
});

test('scheduler: a clean run before the due time does not promote; unseen tasks are not due; new tasks list', () => {
  const st = D.emptyState();
  D.markRead(st, 'dv-p-04', T0);
  const early = D.applyResult(st, 'dv-p-04', { clean: true }, T0 + 1000);
  assert.equal(early.b, 0);
  assert.equal(early.due, T0 + DAY);
  assert.equal(early.clean, 1);
  assert.deepEqual(D.dueTasks(st, tasks, T0 + DAY).map((t) => t.id), ['dv-p-04']);
  assert.equal(D.newTasks(st, tasks).length, 23);
  assert.equal(D.dueIds(st, T0 + DAY)[0], 'dv-p-04');
  D.markRead(st, 'dv-p-04', T0 + 5 * DAY); // reading again changes nothing
  assert.equal(st.tasks['dv-p-04'].due, T0 + DAY);
  assert.match(D.statusText(undefined, T0), /חדש/);
  assert.match(D.statusText(st.tasks['dv-p-04'], T0 + DAY), /לחזרה עכשיו/);
  assert.match(D.statusText(st.tasks['dv-p-04'], T0), /בעוד/);
});

test('persistence: save/load round trip, corrupt or hostile data is sanitized', () => {
  reset();
  const st = D.emptyState();
  D.markRead(st, 'dv-m-02', T0);
  assert.ok(D.save(st));
  assert.deepEqual(D.load(), st);
  dom.store.set(D.KEY, '{bad');
  assert.deepEqual(D.load(), D.emptyState());
  dom.store.set(D.KEY, JSON.stringify({ v: 1, tasks: { 'dv-m-01': { seen: true, b: 99, due: 'x', tries: -4 }, '<img>': { seen: true }, 'dv-p-01': 5 } }));
  const l = D.load();
  assert.deepEqual(Object.keys(l.tasks), ['dv-m-01']);
  assert.equal(l.tasks['dv-m-01'].b, D.MAX_BOX);
  assert.equal(l.tasks['dv-m-01'].due, null);
  assert.equal(l.tasks['dv-m-01'].tries, 0);
});

/* ---------- sessions ---------- */
test('level 1: wrong pick names the error type and keeps the step; correct pick moves on; a clean run needs no wrongs, hints or peeks', () => {
  const t = byId('dv-m-01');
  const s = D.createSession(t, 1, () => 0);
  assert.equal(s.pending.length, t.steps.length - 1);
  const c = s.candidates();
  assert.equal(c.length, 4);
  assert.equal(c.filter((x) => x.correct).length, 1);
  const badK = c.findIndex((x) => !x.correct);
  const r = s.pick(badK);
  assert.equal(r.ok, false);
  assert.ok(r.feedback.label.length > 3 && r.feedback.text.length > 10);
  assert.equal(s.pos, 0);
  assert.equal(s.wrongs, 1);
  assert.equal(s.pick(badK).cand, null); // the same wrong option cannot be counted twice
  assert.equal(s.wrongs, 1);
  assert.equal(s.pick(c.findIndex((x) => x.correct)).ok, true);
  assert.equal(s.pos, 1);
  assert.equal(s.result().clean, false);
  assert.equal(s.result().outcome, 'wrong');
  const clean = D.createSession(t, 1, () => 0.3);
  while (!clean.done()) clean.pick(clean.candidates().findIndex((x) => x.correct));
  assert.deepEqual(clean.result(), { clean: true, outcome: 'alone' });
  const hinted = D.createSession(t, 1, () => 0.3);
  assert.equal(hinted.hint(), t.steps[0].n);
  while (!hinted.done()) hinted.pick(hinted.candidates().findIndex((x) => x.correct));
  assert.deepEqual(hinted.result(), { clean: false, outcome: 'hinted' });
  const peek = D.createSession(t, 1);
  peek.peek();
  assert.equal(peek.done(), true);
  assert.equal(peek.result().outcome, 'solution');
});

test('wrong-pick feedback of every candidate has a known error type', () => {
  for (const t of tasks) for (let i = 0; i < t.steps.length; i++) for (const c of D.candidates(t, i, () => 0.5)) {
    if (c.correct) continue;
    const f = D.wrongFeedback(c);
    assert.ok(D.ERR[c.e], `${t.id}/${i}: ${c.e}`);
    assert.equal(f.label, D.ERR[c.e].label);
  }
});

test('level 2: hidden lines are typed; equivalent forms count, wrong, echo and true-but-other lines do not', () => {
  const t = byId('dv-m-01');
  const hidden = D.hiddenSteps(t);
  assert.ok(hidden.length >= 2 && !hidden.includes(t.steps.length - 1));
  const s = D.createSession(t, 2);
  assert.deepEqual(s.pending, hidden);
  assert.equal(hidden[0], 0);
  assert.equal(s.submit('').code, 'empty');
  assert.equal(s.submit('cos(a+a)').code, 'norel');
  assert.equal(s.submit('cos(a+a) = cos(a)*cos(a) + sin(a)*sin(a)').code, 'wrong');
  assert.equal(s.wrongs, 1);
  assert.equal(s.submit('cos(a+a) = cos(a+a)').code, 'true-other');
  assert.equal(s.pos, 0);
  const ok = s.submit('cos(a)*cos(a) - sin(a)*sin(a) = cos(a+a)'); // sides swapped, still the same line
  assert.equal(ok.ok, true);
  assert.equal(s.pos, 1);
  const cur = s.current();
  assert.ok(cur > 0);
  assert.equal(s.submit(t.steps[cur].f.replace(/ /g, '')).ok, true);
});

test('typed check: physics lines use the givens; solve-mode lines accept a multiple of the equation', () => {
  const p = byId('dv-p-04');
  assert.equal(D.checkTyped(p, p.steps[0], 'v^2 = (v0+a*t)^2').ok, true);
  assert.equal(D.checkTyped(p, p.steps[0], '(v0+a*t)^2 = v^2').ok, true);
  assert.equal(D.checkTyped(p, p.steps[0], 'v^2 = v0^2 + a^2*t^2').ok, false);
  const q = byId('dv-p-08');
  assert.equal(D.checkTyped(q, q.steps[3], '(m1-m2)*g = (m1+m2)*a').ok, true);
  assert.equal(D.checkTyped(q, q.steps[3], '2*(m1-m2)*g = 2*(m1+m2)*a').ok, true);
  assert.equal(D.checkTyped(q, q.steps[3], '(m1-m2)*g = (m1-m2)*a').ok, false);
  assert.equal(D.checkTyped(q, q.steps[3], 'drop table').ok, false);
  assert.equal(D.checkTyped(q, q.steps[3], 'x'.repeat(200)).code, 'syntax');
});

test('level 3: the blank page asks for the three key lines in order', () => {
  const t = byId('dv-p-04');
  const s = D.createSession(t, 3);
  assert.deepEqual(s.pending, [...t.key].sort((a, b) => a - b));
  for (const i of s.pending) assert.equal(s.submit(t.steps[i].f).ok, true);
  assert.equal(s.done(), true);
  assert.deepEqual(s.result(), { clean: true, outcome: 'alone' });
});

test('every task: all steps are accepted as typed lines of themselves (or are marked untyped), keys are typeable', () => {
  for (const t of tasks) {
    for (const k of t.key) assert.ok(D.typeable(t.steps[k]), `${t.id} key ${k}`);
    for (const s of t.steps) if (D.typeable(s)) assert.equal(D.checkTyped(t, s, s.f).ok, true, `${t.id}: ${s.f}`);
  }
});

/* ---------- backup merge ---------- */
test('mergeDerive: union by task id, the entry updated last wins, counters keep the larger value', () => {
  const a = D.emptyState();
  const b = D.emptyState();
  D.markRead(a, 'dv-m-01', T0);
  D.applyResult(a, 'dv-m-01', { clean: true }, T0 + DAY);
  D.markRead(a, 'dv-m-02', T0);
  D.markRead(b, 'dv-m-01', T0);
  D.markRead(b, 'dv-m-03', T0);
  const m = JSON.parse(D.mergeDerive(JSON.stringify(a), JSON.stringify(b)));
  assert.deepEqual(Object.keys(m.tasks).sort(), ['dv-m-01', 'dv-m-02', 'dv-m-03']);
  assert.equal(m.tasks['dv-m-01'].b, 1); // the local entry was updated later
  assert.equal(m.tasks['dv-m-01'].tries, 1);
  const rev = JSON.parse(D.mergeDerive(JSON.stringify(b), JSON.stringify(a)));
  assert.equal(rev.tasks['dv-m-01'].b, 1); // the backup entry was updated later
  assert.equal(JSON.parse(D.mergeDerive('{bad', JSON.stringify(a))).tasks['dv-m-02'].seen, true);
});

test('backup: the derive key is known, backed up, and restore merges it by task id', () => {
  assert.ok(Object.hasOwn(B.KNOWN_KEYS, D.KEY));
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
  const local = D.emptyState();
  D.markRead(local, 'dv-m-01', T0);
  D.markRead(local, 'dv-p-01', T0);
  D.applyResult(local, 'dv-p-01', { clean: true }, T0 + DAY);
  mem.set(D.KEY, JSON.stringify(local));
  const incoming = D.emptyState();
  D.markRead(incoming, 'dv-m-05', T0);
  D.markRead(incoming, 'dv-p-01', T0 + 2 * DAY); // read-only entry updated later than the local one
  const other = new Map([[D.KEY, JSON.stringify(incoming)]]);
  const code = B.buildBackup({ getItem: (k) => (other.has(k) ? other.get(k) : null) }, T0 + 3 * DAY);
  const parsed = B.parseBackup(code);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.preview.some((p) => p.key === D.KEY));
  const res = B.restoreBackup(storage, parsed, T0 + 3 * DAY);
  assert.equal(res.ok, true);
  const merged = JSON.parse(mem.get(D.KEY));
  assert.deepEqual(Object.keys(merged.tasks).sort(), ['dv-m-01', 'dv-m-05', 'dv-p-01']);
  assert.equal(merged.tasks['dv-p-01'].tries, 1);
});

/* ---------- integration: attempts, home path, plan ---------- */
test('topic derive is practice, not independent mastery: reserved, titled and linked', () => {
  assert.equal(S.isReservedTopic('derive'), true);
  assert.match(E.topicTitle('derive'), /גזירה/);
  assert.equal(E.topicHref('derive'), '#/derive');
  assert.equal(E.itemHref('dv-m-03', 'derive'), '#/derive/t/dv-m-03');
});

test('home path and plan list due derivations', () => {
  assert.equal(nav.dailyPath({ now: T0 }).some((s) => s.id === 'derive'), false);
  const p = nav.dailyPath({ now: T0, deriveDue: 2 });
  const step = p.find((s) => s.id === 'derive');
  assert.equal(step.href, '#/derive');
  assert.match(step.label, /2 גזירות/);
  assert.match(nav.dailyPath({ now: T0, deriveDue: 1 }).find((s) => s.id === 'derive').label, /1 גזירה לחזרה|גזירה אחת|1 גזירה/);
  assert.equal(P.buildPlan({ now: T0, dueDerive: 3 }).due.derive, 3);
  assert.equal(P.buildPlan({ now: T0 }).due.derive, 0);
  reset();
  const st = D.emptyState();
  D.markRead(st, 'dv-m-01', T0 - 3 * DAY);
  D.save(st);
  assert.equal(D.dueCount(globalThis.localStorage, T0), 1);
  assert.equal(D.dueCount(globalThis.localStorage, T0 - 3 * DAY), 0);
});

/* ---------- UI ---------- */
const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent.includes(label))[0].dispatch('click');

test('UI: hub, first read, and a level-1 session that records a derive attempt', async () => {
  reset();
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    await UI.viewDeriveRoute(ctx);
    assert.match(text(), /גזירה מהזיכרון/);
    assert.ok(dom.root.all((n) => n.tagName === 'A' && (n.attrs.href || '').startsWith('#/derive/t/')).length >= 24);
    await UI.viewDeriveRoute(ctx, 't', 'dv-m-01');
    assert.match(text(), /קראתי, מחר משחזרים/);
    press('קראתי');
    assert.equal(D.load().tasks['dv-m-01'].seen, true);
    assert.equal(store.getAttempts().length, 0); // reading is not an attempt
    // a day later: level 1
    const st = D.load();
    st.tasks['dv-m-01'].due = Date.now() - 1000;
    D.save(st);
    await UI.viewDeriveRoute(ctx, 't', 'dv-m-01');
    assert.match(text(), /בחירת הצעד הבא/);
    const t = byId('dv-m-01');
    const pickBtn = (k) => dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs['aria-label'] === `אפשרות ${k + 1}`)[0];
    assert.equal(dom.root.all((n) => n.tagName === 'BUTTON' && /^אפשרות/.test(n.attrs['aria-label'] || '')).length, 4);
    // hints are hidden until the first attempt (try-first lock)
    const hintBtn = dom.root.all((n) => n.tagName === 'BUTTON' && n.textContent === 'רמז')[0];
    assert.equal(hintBtn.hidden, true);
    // one wrong pick first
    const order0 = D.candidates(t, 0, () => 0);
    const wrongK = order0.findIndex((c) => !c.correct);
    pickBtn(wrongK).dispatch('click');
    assert.match(text(), /טעות|סימן|פונקציה|החלפת/);
    assert.equal(hintBtn.hidden, false);
    for (let i = 0; i < t.steps.length - 1; i++) {
      const order = D.candidates(t, i, () => 0);
      pickBtn(order.findIndex((c) => c.correct)).dispatch('click');
    }
    assert.match(text(), /לא נקי הפעם/);
    const log = store.getAttempts();
    assert.equal(log.length, 1);
    assert.equal(log[0].topic, 'derive');
    assert.equal(log[0].exerciseId, 'dv-m-01');
    assert.equal(log[0].outcome, 'wrong');
    const after = D.load().tasks['dv-m-01'];
    assert.equal(after.b, 0);
    assert.ok(after.due > Date.now());
  } finally {
    Math.random = realRandom;
  }
});

test('UI: a clean level-1 run when due promotes the box and the level; load failure shows a retry', async () => {
  reset();
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const st = D.emptyState();
    D.markRead(st, 'dv-p-04', Date.now() - 2 * DAY);
    D.save(st);
    D.resetDeriveCache();
    await UI.viewDeriveRoute(ctx, 't', 'dv-p-04');
    const t = byId('dv-p-04');
    for (let i = 0; i < t.steps.length - 1; i++) {
      const k = D.candidates(t, i, () => 0).findIndex((c) => c.correct);
      dom.root.all((n) => n.tagName === 'BUTTON' && n.attrs['aria-label'] === `אפשרות ${k + 1}`)[0].dispatch('click');
    }
    assert.match(text(), /בלי טעות, בלי רמז ובלי להציץ/);
    const e = D.load().tasks['dv-p-04'];
    assert.equal(e.b, 1);
    assert.equal(D.levelOf(e), 2);
    assert.equal(store.getAttempts()[0].outcome, 'alone');
    D.resetDeriveCache();
    await UI.viewDeriveRoute({ ...ctx, fetchFn: async () => ({ ok: false, status: 500 }) });
    assert.match(text(), /לא ניתן לטעון/);
    assert.ok(dom.root.byText('button', 'נסו שוב'));
  } finally {
    Math.random = realRandom;
    D.resetDeriveCache();
  }
});

test('UI: level 2 typing and the peek button', async () => {
  reset();
  const st = D.emptyState();
  D.markRead(st, 'dv-m-01', Date.now() - 5 * DAY);
  st.tasks['dv-m-01'].b = 1;
  st.tasks['dv-m-01'].due = Date.now() - 1000;
  D.save(st);
  await UI.viewDeriveRoute(ctx, 't', 'dv-m-01');
  assert.match(text(), /הקלדת השורות המוסתרות/);
  const input = dom.root.all((n) => n.tagName === 'INPUT')[0];
  input.value = 'cos(a+a) = cos(a)*cos(a) + sin(a)*sin(a)';
  press('בדיקה');
  assert.match(text(), /לא שקולה/);
  input.value = 'cos(a+a) = cos(a)*cos(a) - sin(a)*sin(a)';
  press('בדיקה');
  assert.match(text(), /נכון\./);
  press('להציג את הגזירה המלאה');
  assert.match(text(), /לא נקי הפעם/);
  const log = store.getAttempts();
  assert.equal(log.at(-1).outcome, 'solution');
  assert.equal(D.load().tasks['dv-m-01'].b, 0);
});

test('cleanup', () => dom.restore());
