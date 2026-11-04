import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.mjs';
import { validate, loadNotesFile, exactSign } from '../tools/verify-notes.mjs';

const dom = installFakeDom();
const N = await import('../js/notes.js');
const UI = await import('../js/notes-ui.js');
const store = await import('../js/store.js');
const engine = await import('../js/engine.js');
const nav = await import('../js/nav.js');
const fb = await import('../js/feedback.js');
const B = await import('../js/backup.js');
const T = await import('../js/trig.js');

const data = loadNotesFile();
const clone = () => JSON.parse(JSON.stringify(data));
const fetchFn = async (u) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL('../' + u, import.meta.url), 'utf8')) });
const ctx = { topics: [], exercises: [], byId: () => null, show: dom.show, fetchFn };
const press = (label) => dom.root.all((n) => n.tagName === 'BUTTON' && !n.disabled && n.textContent === label)[0].dispatch('click');
const boxes = () => dom.root.all((n) => n.tagName === 'INPUT' && !n.disabled);
const text = () => dom.root.textContent.replace(/[⁦⁩]/g, '');
const reset = () => { dom.store.clear(); store.resetCache(); };

test('verifier: 12 cards and 16 questions are verified over the real line', () => {
  const { errors, stats } = validate(data);
  assert.deepEqual(errors, []);
  assert.equal(stats.cards, 12);
  assert.equal(stats.questions, 16);
  assert.ok(stats.pos >= 12 && stats.signs >= 4);
});

test('exact sign reasoning: positive base to any power, sums, products, quotients, even powers', () => {
  const POS = [false, false, true];
  assert.deepEqual(exactSign('3^x'), POS);
  assert.deepEqual(exactSign('2^x + 5'), POS);
  assert.deepEqual(exactSign('(1/2)^x'), POS);
  assert.deepEqual(exactSign('5^(x-1)*(x^2+4)'), POS);
  assert.deepEqual(exactSign('x^2+1'), POS);
  assert.deepEqual(exactSign('x^2'), [false, true, true]);
  assert.deepEqual(exactSign('x-2'), [true, true, true]);
  assert.deepEqual(exactSign('-3^x'), [true, false, false]);
  assert.deepEqual(exactSign('x^2 - 4'), [true, true, true]);
});

test('verifier fails when a positivity claim, an answer, a rule or a count is wrong', () => {
  const run = (mutate) => { const d = clone(); mutate(d); return validate(d).errors; };
  assert.ok(run((d) => { d.cards[0].pos = ['x^2']; }).some((m) => /not provably positive/.test(m)));
  assert.ok(run((d) => { d.cards[0].pos = ['5^x - 1']; }).some((m) => /positive/.test(m)));
  assert.ok(run((d) => { d.cards[5].signs = ['3^x']; }).some((m) => /change sign/.test(m)));
  assert.ok(run((d) => { d.questions[0].answer = { kind: 'set', values: ['-3'] }; }).some((m) => /nt-q01/.test(m)));
  assert.ok(run((d) => { d.questions[1].answer = { kind: 'interval', text: '(0,inf)' }; }).some((m) => /nt-q02/.test(m)));
  assert.ok(run((d) => { d.questions[8].answer = { kind: 'interval', text: '(-inf,3)' }; }).some((m) => /nt-q09/.test(m)));
  assert.ok(run((d) => { d.questions[12].answer = { kind: 'number', value: '125' }; }).some((m) => /nt-q13/.test(m)));
  assert.ok(run((d) => { d.cards[11].mini.answer = { kind: 'set', values: ['3'] }; }).some((m) => /nt-c12/.test(m)));
  assert.ok(run((d) => { d.cards[9].ver = ['a^(log_a(x)) = 2*x']; }).some((m) => /not an identity/.test(m)));
  assert.ok(run((d) => { d.cards.pop(); }).some((m) => /expected 12 cards/.test(m)));
  assert.ok(run((d) => { d.questions.pop(); }).some((m) => /expected 16 questions/.test(m)));
  assert.ok(run((d) => { d.questions[2].id = d.questions[3].id; }).some((m) => /duplicate id/.test(m)));
});

test('content: the three exponential traps are all present (empty set, all of R, never true)', () => {
  const all = [...data.cards.map((c) => c.mini), ...data.questions];
  assert.ok(all.some((q) => q.check.type === 'solve' && q.answer.kind === 'set' && q.answer.values.length === 0));
  assert.ok(all.some((q) => q.answer.kind === 'interval' && q.answer.text === '(-inf,inf)'));
  assert.ok(all.some((q) => q.answer.kind === 'interval' && q.answer.text === 'empty'));
  assert.deepEqual(N.groupCounts(data.cards), [4, 4, 4]);
});

test('Leitner: intervals follow BOX_DAYS, wrong goes back to box 0, state survives save/load and garbage', () => {
  reset();
  const st = N.loadNotes();
  assert.deepEqual(st.cards, {});
  const t = 1_000_000_000_000;
  N.gradeCard(st, 'nt-c01', true, t);
  assert.equal(st.cards['nt-c01'].box, 1);
  assert.equal(st.cards['nt-c01'].due, t + 1 * N.DAY_MS);
  N.gradeCard(st, 'nt-c01', true, t);
  assert.equal(st.cards['nt-c01'].due, t + 2 * N.DAY_MS);
  for (let i = 0; i < 9; i++) N.gradeCard(st, 'nt-c01', true, t);
  assert.equal(st.cards['nt-c01'].box, N.MAX_BOX);
  assert.equal(st.cards['nt-c01'].due, t + N.BOX_DAYS[N.MAX_BOX] * N.DAY_MS);
  N.gradeCard(st, 'nt-c01', false, t);
  assert.equal(st.cards['nt-c01'].box, 0);
  assert.equal(st.cards['nt-c01'].lapses, 1);
  assert.equal(st.cards['nt-c01'].due, t);
  N.recordDrill(st, 'nt-q01', true, t);
  assert.ok(N.saveNotes(st) !== false);
  const back = N.loadNotes();
  assert.deepEqual(back.cards['nt-c01'], st.cards['nt-c01']);
  assert.equal(back.drills['nt-q01'].right, 1);
  dom.store.set(N.NOTES_KEY, '{not json');
  assert.deepEqual(N.loadNotes().cards, {});
  dom.store.set(N.NOTES_KEY, JSON.stringify({ cards: { x: { box: 99, due: -5 } } }));
  assert.equal(N.loadNotes().cards.x.box, N.MAX_BOX);
  assert.equal(N.loadNotes().cards.x.due, 0);
});

test('card grading: known only without hint, wrong try or peeking', () => {
  assert.equal(N.cardKnown({ solved: true }), true);
  assert.equal(N.cardKnown({ solved: true, hints: 1 }), false);
  assert.equal(N.cardKnown({ solved: true, wrongs: 1 }), false);
  assert.equal(N.cardKnown({ solved: false, peeked: true }), false);
  assert.equal(N.cardOutcome({ solved: true }), 'alone');
  assert.equal(N.cardOutcome({ solved: true, hints: 2 }), 'hinted');
  assert.equal(N.cardOutcome({ solved: false, peeked: true }), 'wrong');
});

test('registration: backup key, feedback mode, route, home link, engine title and item links', () => {
  assert.ok(N.NOTES_KEY in B.KNOWN_KEYS);
  assert.ok(fb.MODES.includes('notes'));
  assert.deepEqual(nav.resolveRoute('#/notes/cards'), { name: 'notes', args: ['cards'] });
  assert.deepEqual(nav.resolveRoute('#/notes'), { name: 'notes', args: [] });
  assert.equal(engine.topicTitle('notes'), 'דגשים: חזקות, כפל באי־שוויון ולוגריתמים');
  assert.equal(engine.topicHref('notes'), '#/notes');
  assert.equal(engine.itemHref('nt-c03', 'notes'), '#/notes/cards');
  assert.equal(engine.itemHref('nt-q03', 'notes'), '#/notes/ex/nt-q03');
  const src = readFileSync(new URL('../js/hub.js', import.meta.url), 'utf8');
  assert.match(src, /\['#\/notes'/);
  assert.match(readFileSync(new URL('../js/logs-ui.js', import.meta.url), 'utf8'), /tile\('#\/notes'/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['js/notes.js', 'js/notes-ui.js', 'js/mathdir.js', 'data/notes.json']) assert.ok(sw.includes(`'${f}'`), f);
});

test('UI: hub, read list and drill list render; math text is always inside an ltr element', async () => {
  reset();
  N.resetNotesCache();
  await UI.viewNotesRoute(ctx);
  assert.match(text(), /דגשים/);
  assert.match(text(), /12 כרטיסים|כרטיסיות דגשים/);
  await UI.viewNotesRoute(ctx, 'read');
  assert.match(text(), /חזקות חיוביות תמיד/);
  assert.ok(dom.root.all((n) => n.className && /math-ltr/.test(n.className)).length >= 12);
  await UI.viewNotesRoute(ctx, 'drill');
  assert.equal(dom.root.all((n) => n.tagName === 'A' && /#\/notes\/ex\//.test(n.getAttribute('href') || '')).length, 16);
  const unsafe = [];
  const inLtr = (n) => { for (let p = n; p; p = p.parent) if (p.attrs && p.attrs.dir === 'ltr') return true; return false; };
  await UI.viewNotesRoute(ctx, 'read');
  dom.root.walk((n) => {
    const own = n.tagName && (n._text != null ? n._text : '');
    const s = String(own).replace(/[⁦⁩]/g, '');
    if (/=/.test(s) && !/[֐-׿]/.test(s) && !inLtr(n)) unsafe.push(s);
  });
  assert.deepEqual(unsafe, []);
});

test('UI cards: a solved card moves up a box and records a notes attempt; a peeked card returns to box 0 and the queue', async () => {
  reset();
  N.resetNotesCache();
  // only nt-c01 and nt-c02 are due: the other ten were learnt and are due in a year
  const seeded = N.loadNotes();
  data.cards.slice(2).forEach((c) => N.gradeCard(seeded, c.id, true, Date.now() + 365 * N.DAY_MS));
  N.saveNotes(seeded);
  await UI.viewNotesRoute(ctx, 'cards');
  assert.match(text(), /קודם שאלה קצרה/);
  // first card in the queue is nt-c01, "5^x = -25": no solution
  press('אין פתרון');
  press('בדיקה');
  assert.match(text(), /נכון!/);
  assert.match(text(), /מלכודת/);
  let saved = JSON.parse(dom.store.get(N.NOTES_KEY));
  assert.equal(saved.cards['nt-c01'].box, 1);
  const log = store.getAttempts();
  assert.equal(log.at(-1).topic, 'notes');
  assert.equal(log.at(-1).exerciseId, 'nt-c01');
  assert.equal(log.at(-1).outcome, 'alone');
  press('הכרטיס הבא ←');
  // second card: peek at the solution -> counts as not known
  press('הצגת הכלל והפתרון');
  const second = 'nt-c02';
  saved = JSON.parse(dom.store.get(N.NOTES_KEY));
  assert.equal(saved.cards[second].box, 0);
  assert.equal(saved.cards[second].lapses, 1);
  assert.equal(store.getAttempts().at(-1).outcome, 'wrong');
  // the missed card comes back before the session ends
  assert.equal(second, 'nt-c02');
  press('הכרטיס הבא ←');
  assert.match(text(), /נשארו 1 /); // c02 is back, alone in the queue
  boxes()[0].value = '-inf';
  boxes()[1].value = 'inf';
  press('בדיקה');
  assert.match(text(), /נכון!/);
  saved = JSON.parse(dom.store.get(N.NOTES_KEY));
  assert.equal(saved.cards['nt-c02'].seen, 2);
  press('לסיום');
  assert.match(text(), /סיימנו/);
  assert.match(text(), /כמה היה קשה/);
});

test('UI cards: a wrong try, then a right one, grades the card as not known (box 0)', async () => {
  reset();
  N.resetNotesCache();
  await UI.viewNotesRoute(ctx, 'cards');
  boxes()[0].value = '25';
  press('בדיקה');
  assert.match(text(), /לא מדויק/);
  press('אין פתרון');
  press('בדיקה');
  assert.match(text(), /נכון!/);
  const saved = JSON.parse(dom.store.get(N.NOTES_KEY));
  assert.equal(saved.cards['nt-c01'].box, 0);
  assert.equal(store.getAttempts().at(-1).outcome, 'hinted');
});

test('UI drill: interval, set and number questions are graded exactly; progress and attempts are saved', async () => {
  reset();
  N.resetNotesCache();
  await UI.viewNotesRoute(ctx, 'ex', 'nt-q09');
  boxes()[0].value = '-inf';
  boxes()[1].value = '3';
  press('בדיקה');
  assert.match(text(), /לא מדויק/);
  assert.match(text(), /כפלתם ב־x \+ 1 בלי לדעת את סימנו/);
  const lo = boxes();
  lo[0].value = '-1';
  lo[1].value = '3';
  press('בדיקה');
  assert.match(text(), /נכון!/);
  assert.equal(JSON.parse(dom.store.get(N.NOTES_KEY)).drills['nt-q09'].right, 1);
  const a = store.getAttempts().at(-1);
  assert.equal(a.topic, 'notes');
  assert.equal(a.outcome, 'hinted');
  await UI.viewNotesRoute(ctx, 'ex', 'nt-q13');
  boxes()[0].value = '1/125';
  press('בדיקה');
  assert.match(text(), /נכון!/);
  await UI.viewNotesRoute(ctx, 'ex', 'nt-q01');
  press('אין פתרון');
  press('בדיקה');
  assert.match(text(), /נכון!/);
  assert.equal(store.getAttempts().at(-1).outcome, 'alone');
  await UI.viewNotesRoute(ctx, 'ex', 'nt-q12');
  boxes()[0].value = '2';
  boxes()[1].value = '1';
  press('בדיקה');
  assert.match(text(), /נכון!/);
  await UI.viewNotesRoute(ctx, 'ex', 'nt-q05');
  press('הצגת פתרון מלא');
  assert.match(text(), /פתרון/);
  assert.equal(JSON.parse(dom.store.get(N.NOTES_KEY)).drills['nt-q05'].wrong, 1);
  await UI.viewNotesRoute(ctx, 'ex', 'missing');
  assert.match(text(), /תרגילי דגשים/);
});

test('load failure shows a retry button; unknown state is sanitised through the trig scheme', async () => {
  N.resetNotesCache();
  const bad = { ...ctx, fetchFn: async () => ({ ok: false, status: 500 }) };
  await UI.viewNotesRoute(bad);
  assert.match(text(), /לא ניתן לטעון/);
  press('נסו שוב');
  N.resetNotesCache();
  assert.deepEqual(Object.keys(T.emptyState()).sort(), Object.keys(N.loadNotes()).sort());
});
