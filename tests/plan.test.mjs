import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.mjs';
import * as P from '../js/plan.js';
import * as B from '../js/backup.js';

const NOW = new Date(2026, 10, 3, 10, 0, 0).getTime(); // a Tuesday, local time
const dkey = (offset) => { const d = new Date(2026, 10, 3 + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (dayOffset, hour = 12) => new Date(2026, 10, 3 + dayOffset, hour).getTime();
const att = (id, topic, extra = {}) => ({ exerciseId: id, topic, ts: NOW, outcome: 'alone', hintsUsed: 0, seconds: 100, ...extra });
const withDate = (offset, extra = {}) => P.sanitizeSettings({ examDate: dkey(offset), ...extra });

test('validDate accepts real dates only', () => {
  assert.equal(P.validDate('2027-02-28'), true);
  for (const bad of ['2027-02-30', '2027-13-01', '27-02-01', '', null, undefined, '2027-2-1', 'abcd-ef-gh', '1999-01-01']) assert.equal(P.validDate(bad), false, String(bad));
});

test('daysUntil counts whole local days and survives clock time', () => {
  assert.equal(P.daysUntil(dkey(0), NOW), 0);
  assert.equal(P.daysUntil(dkey(1), at(0, 23)), 1);
  assert.equal(P.daysUntil(dkey(56), NOW), 56);
  assert.equal(P.daysUntil(dkey(-3), NOW), -3);
  assert.equal(P.daysUntil('nope', NOW), null);
});

test('phase boundaries by days left', () => {
  const phaseOf = (days) => P.horizon(withDate(days), NOW).phase.id;
  const table = [[120, 'foundation'], [64, 'foundation'], [57, 'foundation'], [56, 'repair'], [50, 'repair'], [43, 'repair'],
    [42, 'mixed'], [36, 'mixed'], [35, 'mixed'], [29, 'mixed'], [28, 'transfer'], [22, 'transfer'], [21, 'transfer'],
    [15, 'transfer'], [14, 'mocks'], [8, 'mocks'], [7, 'final'], [1, 'final'], [0, 'final'], [-5, 'final']];
  // 8 weeks = 56 days, 7 weeks = 49, ... weeks are ceil(days / 7): 43-49 days = 7 weeks (repair), 36-42 = 6 weeks (mixed)
  for (const [days, id] of table) assert.equal(phaseOf(days), id, `${days} days`);
});

test('long horizon shows a foundation phase, short horizon is compressed, no date is the neutral 8 weeks', () => {
  const long = P.horizon(withDate(100), NOW);
  assert.equal(long.weeks, 15);
  assert.equal(long.foundationWeeks, 7);
  assert.equal(long.compressed, false);
  assert.ok(P.timeline(long).some((t) => t.id === 'foundation' && t.active)); // 15 weeks left: the foundation phase is the active one
  assert.equal(long.phase.id, 'foundation');
  const short = P.horizon(withDate(20), NOW);
  assert.equal(short.compressed, true);
  assert.equal(short.phase.id, 'transfer');
  assert.ok(!P.timeline(short).some((t) => t.id === 'foundation'));
  const none = P.horizon(P.emptySettings(), NOW);
  assert.deepEqual([none.hasDate, none.weeks, none.phase.id, none.days, none.compressed], [false, 8, 'repair', null, false]);
  const past = P.horizon(withDate(-2), NOW);
  assert.deepEqual([past.past, past.phase.id, past.days], [true, 'final', -2]);
  const today = P.horizon(withDate(0), NOW);
  assert.deepEqual([today.past, today.days, today.phase.id], [false, 0, 'final']);
});

test('two exam dates: the nearer upcoming one drives the phase; a passed one does not', () => {
  const s = P.sanitizeSettings({ examDate: dkey(60), physicsDate: dkey(10) });
  const hz = P.horizon(s, NOW);
  assert.equal(hz.subject, 'physics');
  assert.equal(hz.phase.id, 'mocks');
  const s2 = P.sanitizeSettings({ examDate: dkey(-1), physicsDate: dkey(30) });
  assert.equal(P.horizon(s2, NOW).subject, 'physics');
  assert.equal(P.horizon(P.sanitizeSettings({ examDate: dkey(30) }), NOW).subject, 'math');
});

test('settings: defaults, clamping, ticks pruned, and a storage round trip', () => {
  const d = P.sanitizeSettings(null);
  assert.deepEqual([d.days, d.minutes, d.examDate, d.physicsDate], [6, 40, null, null]);
  const c = P.sanitizeSettings({ examDate: '2026-02-31', days: 99, minutes: 'x', ticks: { bad: ['a'], [dkey(0)]: ['workout', 'workout', 5] } });
  assert.deepEqual([c.examDate, c.days, c.minutes], [null, 6, 40]);
  assert.deepEqual(c.ticks, { [dkey(0)]: ['workout'] });
  assert.equal(P.sanitizeSettings({ days: 3, minutes: 25 }).days, 3);
  const store = {};
  const storage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  assert.equal(P.saveSettings({ examDate: dkey(30), days: 4, minutes: 55 }, storage), true);
  assert.deepEqual([P.loadSettings(storage).examDate, P.loadSettings(storage).days, P.loadSettings(storage).minutes], [dkey(30), 4, 55]);
  store[P.KEY] = '{not json';
  assert.equal(P.loadSettings(storage).days, 6);
  const t = P.toggleTick(P.emptySettings(), dkey(0), 'notebook', true);
  assert.deepEqual(t.ticks[dkey(0)], ['notebook']);
  assert.deepEqual(P.toggleTick(t, dkey(0), 'notebook', false).ticks, {});
});

test('the plan key is in the backup list', () => {
  assert.ok(P.KEY in B.KNOWN_KEYS);
  assert.match(B.KNOWN_KEYS[P.KEY], /[א-ת]/);
});

test('study weekdays: rest days drop Saturday first, 7 days has none', () => {
  assert.deepEqual(P.studyWeekdays(6), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(P.studyWeekdays(5), [0, 1, 2, 3, 4]);
  assert.equal(P.studyWeekdays(7).length, 7);
  assert.equal(P.studyWeekdays(1).length, 1);
  assert.equal(P.studyWeekdays('x').length, 6);
});

test('week starts on Sunday', () => {
  assert.equal(new Date(P.weekStart(NOW)).getDay(), 0);
  assert.equal(P.weekStart(NOW), new Date(2026, 10, 1).getTime());
});

const WEAK = [
  { topic: 'math-3', title: 'משוואות', href: '#/topic/math-3', score: 40, attempts: 5 },
  { topic: 'phys-vertical', title: 'זריקה אנכית', href: '#/topic/phys-vertical', score: 55, attempts: 4 },
  { topic: 'math-pow', title: 'חזקות', href: '#/topic/math-pow', score: 60, attempts: 3 },
];

test('every phase has a 7-slot sequence of known activities', () => {
  for (const p of P.PHASES) {
    const seq = P.SEQUENCES[p.id];
    assert.equal(seq.length, 7, p.id);
    for (const a of seq) assert.ok(a in P.ACTIVITIES, `${p.id}: ${a}`);
    assert.match(p.focus, /[א-ת]/);
    assert.ok(Object.keys(p.goals).length > 0);
  }
  for (const [id, a] of Object.entries(P.ACTIVITIES)) assert.match(a.href, /^#\//, id);
});

test('repair slots go to the weakest skills in order and fall back to a workout without data', () => {
  const s = P.adaptSlots('repair', 6, { weak: WEAK });
  const reps = s.filter((x) => x.act === 'repair');
  assert.deepEqual(reps.map((x) => x.topic), ['math-3', 'phys-vertical']);
  assert.match(reps[0].label, /משוואות/);
  assert.equal(reps[0].href, '#/topic/math-3');
  const bare = P.adaptSlots('repair', 6, {});
  assert.ok(!bare.some((x) => x.act === 'repair'));
  assert.equal(bare[0].act, 'workout');
  const finalSlots = P.adaptSlots('final', 7, { weak: WEAK });
  assert.ok(!finalSlots.some((x) => x.act === 'repair' || x.kind === 'hard' || x.kind === 'transfer' || x.kind === 'mock'));
});

test('a topic at its ceiling trades routine items for transfer and hard items, but keeps one routine item', () => {
  const plain = P.adaptSlots('foundation', 6, { weak: [WEAK[0]] });
  const routine = (list) => list.filter((x) => ['workout', 'sprint', 'units', 'estimate'].includes(x.act)).length;
  const one = P.adaptSlots('foundation', 6, { weak: [WEAK[0]], ceiling: [{ topic: 'math-3', title: 'משוואות' }] });
  assert.equal(routine(plain), 2);
  assert.equal(routine(one), 1);
  assert.ok(one.some((x) => x.act === 'transfer' && x.note));
  const many = P.adaptSlots('foundation', 6, { weak: [WEAK[0]], ceiling: [1, 2, 3, 4].map((n) => ({ topic: `t${n}`, title: `נושא ${n}` })) });
  assert.equal(routine(many), 1);
  assert.equal(many.length, 6);
  const finalSlots = P.adaptSlots('final', 7, { ceiling: [{ topic: 'x', title: 'x' }] });
  assert.deepEqual(finalSlots.map((x) => x.act), P.SEQUENCES.final);
});

test('mocks week holds two full-length mocks on separate days when 3+ days are available', () => {
  for (const n of [3, 5, 6, 7]) {
    const s = P.adaptSlots('mocks', n, { minutes: 40 });
    assert.equal(s.filter((x) => x.act === 'booklet').length, 2, `${n} days`);
    assert.equal(s.find((x) => x.act === 'booklet').minutes, 90);
  }
  const hz = P.horizon(withDate(10), NOW);
  const days = P.weekDays(P.sanitizeSettings({ examDate: dkey(10), days: 6 }), hz, [], NOW);
  const mockDays = days.filter((d) => d.slot && d.slot.act === 'booklet');
  assert.equal(mockDays.length, 2);
  assert.notEqual(mockDays[0].dayKey, mockDays[1].dayKey);
});

test('weekDays: seven entries, rest days have no slot, minutes follow the setting', () => {
  const s = P.sanitizeSettings({ examDate: dkey(50), days: 5, minutes: 30 });
  const days = P.weekDays(s, P.horizon(s, NOW), [], NOW);
  assert.equal(days.length, 7);
  assert.equal(days.filter((d) => d.rest).length, 2);
  assert.ok(days.filter((d) => d.rest).every((d) => !d.slot && !d.done));
  assert.equal(days.filter((d) => d.today).length, 1);
  assert.equal(days.find((d) => d.today).dayKey, dkey(0));
  for (const d of days.filter((x) => x.slot && x.slot.act !== 'booklet')) assert.ok(d.slot.minutes <= 30);
});

test('done marks come from the stored attempts of that day, or a manual tick', () => {
  const s = P.sanitizeSettings({ examDate: dkey(50), days: 7 });
  const hz = P.horizon(s, NOW); // repair phase: Sun repair, Mon mathhard, Tue trig, Wed repair, Thu logs, Fri multipart, Sat notebook
  const log = [
    att('mh-rad-1', 'math-hard-radical', { ts: at(-1) }), // Monday
    att('tg-1', 'trig', { ts: at(0) }), // today
    att('mp-1', 'multipart', { ts: at(0) }), // today, but multipart is Friday's slot
  ];
  const days = P.weekDays(s, hz, log, NOW);
  const byWd = (i) => days[i];
  assert.equal(byWd(1).slot.act, 'mathhard');
  assert.equal(byWd(1).done, true);
  assert.equal(byWd(2).slot.act, 'trig');
  assert.equal(byWd(2).done, true);
  assert.equal(byWd(5).slot.act, 'multipart');
  assert.equal(byWd(5).done, false);
  assert.equal(byWd(4).done, false);
  // a manual tick on a slot without a stored signal
  assert.equal(byWd(6).slot.act, 'notebook');
  assert.equal(byWd(6).done, false);
  const ticked = P.weekDays({ ...s, ticks: { [dkey(4)]: ['notebook'] } }, hz, log, NOW);
  assert.equal(ticked[6].done, true);
  // migrated rows never count
  const mig = P.weekDays(s, hz, [att('tg-2', 'trig', { ts: at(0), migrated: true })], NOW);
  assert.equal(mig[2].done, false);
});

test('repair slot is done by an attempt on that topic; a workout needs several ordinary attempts', () => {
  const slotR = { act: 'repair', topic: 'math-3', key: 'repair:math-3' };
  const topicOf = (id) => (id.startsWith('m-') ? 'math-3' : null);
  assert.equal(P.slotDone(slotR, [att('m-1', undefined)], topicOf), true);
  assert.equal(P.slotDone(slotR, [att('x-1', 'phys-vertical')], topicOf), false);
  const w = { act: 'workout', key: 'workout' };
  const few = [1, 2, 3, 4].map((n) => att(`m-${n}`, 'math-3'));
  assert.equal(P.slotDone(w, few, topicOf), false);
  assert.equal(P.slotDone(w, [...few, att('m-5', 'math-3')], topicOf), true);
  assert.equal(P.slotDone(w, [1, 2, 3, 4, 5].map((n) => att(`mh-${n}`, 'math-hard-radical')), topicOf), false);
});

test('readiness: only independent hint-free first attempts, no data -> null', () => {
  const none = P.readiness([], NOW);
  assert.deepEqual(none.math, { practice: null, transfer: null, mock: null });
  const topicOf = (id) => (id.startsWith('m-') ? 'math-3' : 'phys-vertical');
  const log = [];
  for (let i = 1; i <= 6; i++) log.push(att(`m-${i}`, undefined, { ts: at(-1, i), outcome: i <= 4 ? 'alone' : 'hinted', hintsUsed: i <= 4 ? 0 : 1 }));
  for (let i = 1; i <= 3; i++) log.push(att(`p-${i}`, undefined, { ts: at(-1, i) }));
  log.push(att('m-1', undefined, { ts: at(0), outcome: 'wrong' })); // a repeat is not a first attempt
  const r = P.readiness(log, NOW, { topicOf });
  assert.equal(r.math.practice.n, 6);
  assert.ok(Math.abs(r.math.practice.rate - 4 / 6) < 1e-9);
  assert.equal(r.physics.practice, null); // 3 first attempts < MIN_READY
  // old attempts fall out of the 28-day window
  const old = [1, 2, 3, 4, 5].map((i) => att(`m-${i}`, undefined, { ts: at(-40) }));
  assert.equal(P.readiness(old, NOW, { topicOf }).math.practice, null);
  // transfer and mock results
  const tr = [att('tr-m-01', 'transfer-math'), att('tr-m-02', 'transfer-math', { outcome: 'wrong' })];
  const mocks = [{ subject: 'math', ts: at(-9), fraction: 0.5 }, { subject: 'math', ts: at(-2), fraction: 0.72 }];
  const r2 = P.readiness(tr, NOW, { mocks });
  assert.deepEqual(r2.math.transfer, { ok: 1, n: 2 });
  assert.equal(r2.math.mock.last, 72);
  assert.deepEqual(r2.math.mock.history.map((m) => m.pct), [50, 72]);
  assert.equal(r2.physics.mock, null);
  // hints used in the first attempt never count as independent
  const hinted = [1, 2, 3, 4, 5].map((i) => att(`m-${i}`, undefined, { ts: at(-1, i), hintsUsed: 2 }));
  assert.equal(P.readiness(hinted, NOW, { topicOf }).math.practice.rate, 0);
});

test('weekly goals count this week only and the notebook goal needs known data', () => {
  const phase = P.PHASES.find((p) => p.id === 'repair'); // hard 3 + notebook
  const log = [
    att('mh-1', 'math-hard-radical', { ts: at(-1) }), att('mh-2', 'math-hard-rational', { ts: at(0) }), att('mp-1', 'multipart', { ts: at(0), hintsUsed: 1 }),
    att('mh-3', 'math-hard-circle', { ts: at(-20) }), // last month
  ];
  const g = P.weeklyGoals(phase, log, NOW, { dueNotebook: 0 });
  const hard = g.find((x) => x.id === 'hard');
  assert.deepEqual([hard.have, hard.target, hard.done], [2, 3, false]);
  assert.equal(g.find((x) => x.id === 'notebook').done, true);
  const unknown = P.weeklyGoals(phase, log, NOW, {});
  assert.deepEqual([unknown.find((x) => x.id === 'notebook').known, unknown.find((x) => x.id === 'notebook').done], [false, false]);
  const mocksGoal = P.weeklyGoals(P.PHASES.find((p) => p.id === 'mocks'), [], NOW, { mocks: [{ ts: at(0) }, { ts: at(-30) }], dueNotebook: 3 });
  assert.deepEqual([mocksGoal.find((x) => x.id === 'mocks').have, mocksGoal.find((x) => x.id === 'mocks').target], [1, 2]);
});

test('weekly sessions: days with activity or a tick, up to today, against the days target', () => {
  const s = P.sanitizeSettings({ days: 5, ticks: { [dkey(-2)]: ['notebook'] } });
  const log = [att('a', 'math-3', { ts: at(0) }), att('b', 'math-3', { ts: at(-1) }), att('c', 'math-3', { ts: at(-1, 15) }), att('d', 'math-3', { ts: at(-10) })];
  assert.deepEqual(P.weeklySessions(s, log, NOW), { done: 3, target: 5 });
  assert.deepEqual(P.weeklySessions(P.emptySettings(), [], NOW), { done: 0, target: 6 });
});

test('buildPlan with no data: neutral plan, nothing invented', () => {
  const plan = P.buildPlan({ settings: null, log: [], now: NOW, exercises: [] });
  assert.equal(plan.hz.hasDate, false);
  assert.equal(plan.hz.weeks, 8);
  assert.equal(plan.days.length, 7);
  assert.deepEqual(plan.weak, []);
  assert.deepEqual(plan.ceiling, []);
  assert.equal(plan.due.reviews, 0);
  assert.equal(plan.due.notebook, null);
  assert.deepEqual(plan.readiness.math, { practice: null, transfer: null, mock: null });
  assert.deepEqual(plan.sessions, { done: 0, target: 6 });
});

test('buildPlan finds weak topics from the log and schedules repair for them', () => {
  const exercises = [{ id: 'm-1', topic: 'math-3', level: 1 }, { id: 'm-2', topic: 'math-3', level: 1 }, { id: 'm-3', topic: 'math-3', level: 1 }];
  const log = exercises.map((e, i) => att(e.id, undefined, { ts: at(-3, i + 1), outcome: 'wrong' }));
  const plan = P.buildPlan({ settings: withDate(50), log, now: NOW, exercises, titleOf: (t) => `T:${t}` });
  assert.equal(plan.weak.length, 1);
  assert.equal(plan.weak[0].topic, 'math-3');
  assert.equal(plan.weak[0].title, 'T:math-3');
  assert.ok(plan.days.some((d) => d.slot && d.slot.act === 'repair' && d.slot.topic === 'math-3'));
  assert.ok(plan.due.reviews >= 1);
  assert.equal(plan.hz.phase.id, 'repair');
});

test('weakSkills skips reserved topics and topics with too few attempts', () => {
  const log = [att('t1', 'transfer-math', { outcome: 'wrong' }), att('t2', 'transfer-math', { outcome: 'wrong' }), att('t3', 'transfer-math', { outcome: 'wrong' }),
    att('s1', 'sprint-x', { outcome: 'wrong' }), att('s2', 'sprint-x', { outcome: 'wrong' }), att('s3', 'sprint-x', { outcome: 'wrong' }),
    att('q1', 'trig', { outcome: 'wrong' }), att('q2', 'trig', { outcome: 'wrong' })];
  assert.deepEqual(P.weakSkills(log, []), []);
});

test('homeSummary and the home card text', async () => {
  const dom = installFakeDom();
  const nav = await import('../js/nav.js');
  const none = nav.planCardText(P.homeSummary(null, [], NOW));
  assert.match(none.line, /תאריך/);
  assert.ok(!/\d/.test(none.title + none.line));
  const s = P.homeSummary(withDate(30), [att('a', 'math-3', { ts: at(0) })], NOW);
  assert.equal(s.days, 30);
  const t = nav.planCardText(s);
  assert.match(t.title, /30 ימים/);
  assert.match(t.line, /1 מתוך 6/);
  assert.match(nav.planCardText(P.homeSummary(withDate(-1), [], NOW)).title, /עבר/);
  assert.match(nav.planCardText(P.homeSummary(withDate(0), [], NOW)).title, /היום/);
  assert.match(nav.planCardText(P.homeSummary(withDate(1), [], NOW)).title, /יום אחד/);
  assert.equal(nav.resolveRoute('#/plan').name, 'plan');
  assert.equal(nav.activeTab('#/plan'), 'today');
  dom.restore();
});

test('plan screen renders in every phase and with no data (smoke)', async () => {
  const dom = installFakeDom();
  const ui = await import('../js/plan-ui.js');
  const text = (el) => (el.children ? el.children.map(text).join(' ') : '') + (el._text || el.data || '');
  for (const days of [null, 120, 50, 40, 25, 10, 3, -4]) {
    const settings = days === null ? P.emptySettings() : withDate(days);
    const els = ui.renderPlan(P.buildPlan({ settings, log: [], now: NOW, exercises: [] }));
    assert.ok(els.length >= 6, String(days));
    const all = els.map(text).join(' ');
    assert.match(all, /אין עדיין נתונים/);
    assert.match(all, /הערכות בלבד ולא תחזית/);
  }
  assert.equal(ui.daysText(0), 'היום');
  assert.equal(ui.daysText(12), 'עוד 12 ימים');
  assert.equal(ui.daysText(-3), 'עבר לפני 3 ימים');
  dom.restore();
});
