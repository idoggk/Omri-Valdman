// Exam mode views: setup, running exam, report. State logic lives in exam.js, persistence in store.js.
import { h, ltr } from './dom.js';
import { isolateTitle } from './bidi.js';
import { validAnswerSets } from './answersets.js';
import * as X from './exam.js';
import * as store from './store.js';

const ticker = X.createTicker();
const stopTimer = () => ticker.stop();
const STATUS_UI = {
  right: { icon: '✓', label: 'נכון' },
  wrong: { icon: '✗', label: 'שגוי' },
  skipped: { icon: '–', label: 'דולג' },
};

/** ctx: { topics, exercises, byId, show, formulaButton } */
export function viewExam(ctx, part) {
  stopTimer();
  document.title = 'מצב מבחן – Brain Gains';
  const saved = store.loadExam();
  const exam = X.validExamState(saved) ? saved : null;
  if (part === 'report' && exam && exam.endedAt != null) return viewReport(ctx, exam);
  if (part === 'run' && exam && exam.endedAt == null) return viewRun(ctx, exam);
  if (exam && exam.endedAt != null && part !== 'new') return viewReport(ctx, exam);
  return viewSetup(ctx, exam && exam.endedAt == null ? exam : null);
}

/* ---------- setup ---------- */
function viewSetup(ctx, running) {
  const topicsWithContent = ctx.topics.filter((t) => ctx.exercises.some((e) => e.topic === t.id));
  const checks = topicsWithContent.map((t) => {
    const input = h('input', { type: 'checkbox', checked: true, value: t.id });
    return { t, input, label: h('label', { class: 'check' }, input, h('span', {}, t.title)) };
  });
  let count = 8;
  let mix = 'mixed';
  let noLimit = false;
  const minutes = h('input', {
    type: 'number', id: 'exam-minutes', min: '1', max: '300', inputmode: 'numeric', value: String(count * X.MINUTES_PER_QUESTION),
  });
  let minutesTouched = false;
  minutes.addEventListener('input', () => { minutesTouched = true; });
  const radioGroup = (name, opts, value, onchange) => h('div', { class: 'filters', role: 'radiogroup', 'aria-label': name },
    opts.map(([v, label]) => {
      const input = h('input', { type: 'radio', name, value: String(v), checked: v === value });
      input.addEventListener('change', () => onchange(v));
      return h('label', { class: 'chip radio-chip' }, input, ' ', label);
    }));
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const limitBox = h('input', { type: 'checkbox', id: 'exam-nolimit' });
  limitBox.addEventListener('change', () => { noLimit = limitBox.checked; minutes.disabled = noLimit; });

  let history = [];
  try { history = store.getAttempts(); } catch (e) { /* no history */ }
  const smartBox = h('input', { type: 'checkbox', id: 'exam-smart', checked: history.length > 0 });
  const smartOn = () => smartBox.checked;

  function start(pack) {
    const topics = pack ? topicsWithContent.map((t) => t.id) : checks.filter((c) => c.input.checked).map((c) => c.t.id);
    if (!topics.length) { err.textContent = 'בחרו לפחות נושא אחד.'; err.hidden = false; return; }
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const n = pack ? X.PACK_45.math + X.PACK_45.phys : count;
    const ids = pack || smartOn()
      ? X.buildSmartExamSet({
        exercises: ctx.exercises, topics, count: n, attempts: history, now: Date.now(), seed,
        quotas: pack ? { math: X.PACK_45.math, phys: X.PACK_45.phys } : null,
      })
      : X.buildExamSet({
        exercises: ctx.exercises, topics, count: n, mix, seed,
        isAlone: (id) => store.outcomeOf(id) === 'alone',
      });
    if (!ids.length) { err.textContent = 'אין מספיק תרגילים בנושאים שנבחרו.'; err.hidden = false; return; }
    const m = Number(minutes.value);
    let limitMs = noLimit ? null : (Number.isFinite(m) && m > 0 ? Math.round(m * 60000) : X.defaultTimeLimitMs(ids.length));
    if (pack) limitMs = X.PACK_45.minutes * 60000;
    store.saveExam(X.createExam({
      ids, seed, limitMs, now: Date.now(), paceMs: pack ? Math.round(limitMs / ids.length) : undefined,
    }));
    location.hash = '#/exam/run';
  }

  const countGroup = radioGroup('מספר שאלות', X.COUNTS.map((n) => [n, String(n)]), count, (v) => {
    count = v;
    if (!minutesTouched) minutes.value = String(v * X.MINUTES_PER_QUESTION);
  });
  ctx.show(
    h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית')),
    h('h1', {}, 'מצב מבחן'),
    h('p', { class: 'muted' }, 'שאלות אחת אחרי השנייה, בלי רמזים ובלי פתרון. התוצאות והפתרונות יופיעו רק בסוף.'),
    running ? h('div', { class: 'notice' },
      h('p', {}, 'יש מבחן שלא הסתיים.'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn primary', href: '#/exam/run' }, 'המשך מבחן'),
        h('button', { class: 'btn', type: 'button', onclick: () => { store.clearExam(); viewExam(ctx, 'new'); } }, 'זרוק והתחל חדש'))) : null,
    h('h2', {}, 'חבילה מוכנה'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', id: 'exam-pack', type: 'button', onclick: () => start(true) },
        `חבילת ${X.PACK_45.minutes} דקות מעורבת (${X.PACK_45.math} מתמטיקה + ${X.PACK_45.phys} פיזיקה)`)),
    h('p', { class: 'muted' }, 'שעון אחד לכל המבחן, עם קצב מומלץ לכל שאלה. השאלות נבחרות חכם לפי החולשות שלכם.'),
    h('h2', {}, 'או מבחן מותאם'),
    h('label', { class: 'check', for: 'exam-smart' }, smartBox,
      h('span', {}, 'מבחן חכם: דגש על נושאים חלשים ותרגילים שנכשלו לאחרונה, בעיקר רמה 3 ומעט רמה 2')),
    h('h2', {}, 'נושאים'),
    h('div', { class: 'checks' }, checks.map((c) => c.label)),
    h('h2', {}, 'מספר שאלות'), countGroup,
    h('h2', {}, 'רמת קושי'),
    radioGroup('רמת קושי', [['hard', 'קשה'], ['mixed', 'מעורב']], mix, (v) => { mix = v; }),
    h('h2', {}, 'זמן'),
    h('div', { class: 'time-row' },
      h('label', { for: 'exam-minutes' }, 'דקות: '), minutes,
      h('label', { class: 'check', for: 'exam-nolimit' }, limitBox, h('span', {}, 'ללא הגבלת זמן'))),
    h('p', { class: 'muted' }, `ברירת המחדל: ${X.MINUTES_PER_QUESTION} דקות לשאלה.`),
    err,
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', id: 'exam-start', type: 'button', onclick: () => start(false) }, 'התחל מבחן')));
}

/* ---------- running ---------- */
function answerWidget(ctx, ex, exam) {
  const saved = exam.answers[ex.id];
  const commit = (value) => {
    if (X.isExpired(exam, Date.now())) return endExam(ctx, exam);
    X.setAnswer(exam, ex.id, value); store.saveExam(exam);
  };
  if (validAnswerSets(ex.answerSets)) {
    const sets = ex.answerSets;
    const rows = Array.from({ length: sets.count }, (_, r) =>
      sets.labels.map((_, c) => h('input', {
        type: 'text', id: `q-${r}-${c}`, inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        value: (saved && saved[r] && saved[r][c]) || '',
      })));
    const read = () => rows.map((r) => r.map((i) => i.value));
    rows.flat().forEach((i) => i.addEventListener('input', () => commit(read())));
    return h('div', { class: 'fields' },
      h('p', { class: 'muted' }, `למערכת יש כמה פתרונות. מלאו פתרון בכל שורה (עד ${sets.count} שורות); הסדר לא משנה.`),
      rows.map((r, ri) => h('fieldset', { class: 'solution-row' }, h('legend', {}, `פתרון ${ri + 1}`),
        r.map((input, ci) => h('div', { class: 'field' },
          h('label', { for: input.id }, ltr(sets.labels[ci]), ' ='), h('div', { class: 'row' }, input))))));
  }
  if (Array.isArray(ex.inputs)) {
    const inputs = ex.inputs.map((spec, i) => h('input', {
      type: 'text', id: `q-${i}`, inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      value: (saved && saved[i]) || '',
    }));
    inputs.forEach((i) => i.addEventListener('input', () => commit(inputs.map((x) => x.value))));
    return h('div', { class: 'fields' }, ex.inputs.map((spec, i) => h('div', { class: 'field' },
      h('label', { for: `q-${i}` }, ltr(spec.label || `תשובה ${i + 1}`), ' ='),
      h('div', { class: 'row' }, inputs[i], spec.unit ? h('span', { class: 'unit' }, spec.unit) : null))));
  }
  const name = 'q-choice-' + ex.id;
  return h('fieldset', { class: 'options' }, h('legend', { class: 'muted' }, 'בחרו תשובה'),
    ex.choice.options.map((opt, i) => {
      const input = h('input', { type: 'radio', name, value: String(i), checked: saved === i });
      input.addEventListener('change', () => commit(i));
      return h('label', {}, input, h('span', { html: String(opt) }));
    }));
}

function viewRun(ctx, exam) {
  const questions = exam.ids.map((id) => ctx.byId(id)).filter(Boolean);
  if (!questions.length) { store.clearExam(); return viewSetup(ctx, null); }
  if (X.isExpired(exam, Date.now())) return endExam(ctx, exam);
  const idx = Math.min(exam.idx, questions.length - 1);
  const ex = questions[idx];
  const goto = (i) => { X.goTo(exam, i, Date.now()); store.saveExam(exam); viewRun(ctx, exam); };

  const clock = h('span', { class: 'clock', role: 'timer' });
  const tick = () => {
    if (!clock.isConnected) return stopTimer();
    const now = Date.now();
    if (X.isExpired(exam, now)) return endExam(ctx, exam);
    const rem = X.remainingMs(exam, now);
    clock.textContent = rem == null ? `⏱ ${X.formatClock(X.elapsedMs(exam, now))}` : `⏳ ${X.formatClock(rem)}`;
    clock.classList.toggle('low', rem != null && rem <= 60000);
  };

  const dots = h('ol', { class: 'dots', 'aria-label': 'התקדמות' }, questions.map((q, i) => {
    const has = !X.isBlank(q, exam.answers[q.id]);
    return h('li', {}, h('button', {
      type: 'button', class: `dot${i === idx ? ' current' : ''}${has ? ' answered' : exam.skipped[q.id] ? ' skipped' : ''}`,
      'aria-label': `שאלה ${i + 1}${has ? ', נענתה' : ''}`, 'aria-current': i === idx ? 'step' : null,
      onclick: () => goto(i),
    }, String(i + 1)));
  }));

  const confirmBox = h('div');
  const unanswered = () => questions.filter((q) => X.isBlank(q, exam.answers[q.id])).length;
  const askFinish = () => {
    const left = unanswered();
    confirmBox.replaceChildren(h('div', { class: 'panel confirm', role: 'alertdialog', 'aria-label': 'אישור סיום מבחן' },
      h('p', {}, left ? `נשארו ${left} שאלות ללא תשובה. לסיים את המבחן?` : 'לסיים את המבחן ולראות את התוצאות?'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => endExam(ctx, exam) }, 'כן, סיים'),
        h('button', { class: 'btn', type: 'button', onclick: () => confirmBox.replaceChildren() }, 'חזרה למבחן'))));
    confirmBox.querySelector('button').focus();
  };

  ctx.show(
    h('div', { class: 'exam-bar' },
      h('span', {}, `שאלה ${idx + 1} מתוך ${questions.length}`), clock),
    exam.limitMs != null ? h('p', { class: 'muted pace' }, `קצב מומלץ: ${X.formatClock(X.targetMs(exam))} דקות לשאלה`) : null,
    dots,
    h('h1', {}, h('span', {}, isolateTitle(ex.title || ex.id))),
    h('div', { class: 'panel statement', html: ex.statement || '' }),
    ctx.diagramFigure ? ctx.diagramFigure(ex) : null,
    h('form', { onsubmit: (ev) => ev.preventDefault() }, answerWidget(ctx, ex, exam)),
    h('div', { class: 'btn-row exam-nav' },
      h('button', { class: 'btn', type: 'button', disabled: idx === 0, onclick: () => goto(idx - 1) }, '→ הקודמת'),
      h('button', {
        class: 'btn', type: 'button',
        onclick: () => { X.skip(exam, ex.id); goto(Math.min(idx + 1, questions.length - 1)); },
      }, 'דלג'),
      h('button', { class: 'btn primary', type: 'button', disabled: idx === questions.length - 1, onclick: () => goto(idx + 1) }, 'הבאה ←')),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn danger', type: 'button', onclick: askFinish }, 'סיום מבחן')),
    confirmBox);
  tick();
  ticker.start(tick, 1000);
}

function endExam(ctx, exam) {
  stopTimer();
  X.finish(exam, exam.limitMs != null ? Math.min(Date.now(), exam.startedAt + exam.limitMs) : Date.now());
  if (!exam.recorded) {
    const report = X.gradeExam(exam, ctx.byId, exam.endedAt);
    store.recordExamResults(report.items.map((i) => ({ id: i.id, correct: i.status === 'right' })));
    exam.recorded = true;
  }
  store.saveExam(exam);
  if (location.hash !== '#/exam/report') location.hash = '#/exam/report';
  else viewReport(ctx, exam);
}

/* ---------- report ---------- */
function correctAnswerText(ex) {
  if (validAnswerSets(ex.answerSets)) {
    return ex.answerSets.sets.map((s) => s.map((v, i) => `${ex.answerSets.labels[i]} = ${v}`).join(', '));
  }
  if (Array.isArray(ex.inputs)) return [ex.inputs.map((s, i) => `${s.label || `תשובה ${i + 1}`} = ${s.answer}${s.unit ? ' ' + s.unit : ''}`).join(', ')];
  return [String(ex.choice.options[ex.choice.correct])];
}

function viewReport(ctx, exam) {
  document.title = 'תוצאות מבחן – Brain Gains';
  const r = X.gradeExam(exam, ctx.byId, exam.endedAt ?? Date.now());
  const topicTitle = (id) => (ctx.topics.find((t) => t.id === id) || { title: id }).title;
  const rows = r.items.map((it, n) => {
    const ex = ctx.byId(it.id);
    const ui = STATUS_UI[it.status];
    const sol = h('div');
    const btn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false' }, 'הצג פתרון');
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      btn.textContent = open ? 'הצג פתרון' : 'הסתר פתרון';
      sol.replaceChildren(...(open ? [] : [h('div', { class: 'panel' },
        Array.isArray(ex.solution) && ex.solution.length
          ? h('ol', { class: 'steps' }, ex.solution.map((s) => h('li', { html: s })))
          : h('p', { class: 'muted' }, 'אין פתרון מלא לתרגיל הזה.'))]));
    });
    return h('li', { class: `report-q ${it.status}` },
      h('div', { class: 'report-head' },
        h('span', { class: 'tick', role: 'img', 'aria-label': ui.label }, ui.icon),
        h('strong', {}, `${n + 1}. `, isolateTitle(ex.title || ex.id)), ' ', h('span', { class: 'muted' }, ui.label)),
      h('div', { class: 'muted' }, 'התשובה הנכונה: ', correctAnswerText(ex).map((t, i) => [i ? h('br') : null, ltr(t)])),
      h('div', { class: 'btn-row' }, btn), sol);
  });
  const topicRows = Object.entries(r.perTopic).map(([id, t]) =>
    h('li', {}, `${topicTitle(id)}: ${t.right} מתוך ${t.total}`));
  const weakest = r.weakest;
  let history = [];
  try { history = store.getAttempts(); } catch (e) { /* no history */ }
  const ins = X.examInsights(r, exam, history);
  const timeRows = ins.questions.map((q, n) => {
    const ex = ctx.byId(q.id);
    return h('li', { class: q.over ? 'over' : '' },
      `${n + 1}. `, isolateTitle(ex.title || ex.id), ': ',
      q.ms == null ? 'לא נמדד' : `${X.formatClock(q.ms)} מתוך יעד ${X.formatClock(q.targetMs)}${q.over ? ' (חריגה)' : ''}`,
      q.status === 'right' ? (q.assisted ? ' · נכון, אך בעבר נדרשה עזרה' : ' · נכון, בלי רמזים') : null);
  });
  const reviewRows = ins.review.map((t) => h('li', {}, h('strong', {}, topicTitle(t.topic)), ': ',
    t.ids.flatMap((id, i) => [i ? ', ' : '', h('a', { href: `#/ex/${id}` }, isolateTitle((ctx.byId(id) || { title: id }).title || id))])));
  ctx.show(
    h('h1', {}, 'תוצאות המבחן'),
    h('div', { class: 'panel score' },
      h('div', { class: 'score-big' }, `${r.right} / ${r.total}`),
      h('div', {}, `${r.percent}%`),
      h('div', { class: 'muted' }, `זמן: ${X.formatClock(r.usedMs)}`,
        exam.limitMs != null ? ` מתוך ${X.formatClock(exam.limitMs)}` : ' (ללא הגבלה)')),
    h('p', { class: 'muted' }, 'תרגילים שנענו נכון סומנו כ״נפתר לבד״; שגויים או שדולגו נכנסו לרשימת החזרה על טעויות.'),
    h('h2', {}, 'לפי נושא'), h('ul', {}, topicRows),
    weakest ? h('div', { class: 'notice' }, 'מה לתרגל עכשיו: ', h('strong', {}, topicTitle(weakest)), ' ',
      h('a', { href: `#/topic/${weakest}` }, 'לתרגול הנושא ←')) : null,
    h('h2', {}, 'זמן לכל שאלה'),
    h('p', { class: 'muted' }, `יעד לשאלה: ${X.formatClock(ins.targetMs)}`,
      ins.avgMs != null ? ` · ממוצע בפועל: ${X.formatClock(ins.avgMs)} · חריגות: ${ins.overCount}` : ''),
    h('ul', { class: 'time-list' }, timeRows),
    h('h2', {}, 'עם עזרה או בלי'),
    h('p', {}, `נכון ובלי עזרה בעבר: ${ins.rightFree} · נכון אך בעבר נדרשו רמזים או פתרון: ${ins.rightAssisted}`),
    h('p', { class: 'muted' }, 'במבחן עצמו אין רמזים, כך שכל תשובה כאן ניתנה בלי עזרה.'),
    h('h2', {}, 'נושאים לחזרה'),
    reviewRows.length ? h('ul', { class: 'review-topics' }, reviewRows) : h('p', { class: 'muted' }, 'אין נושאים לחזרה. כל התשובות נכונות!'),
    h('h2', {}, 'סיבות הטעויות השכיחות'),
    ins.reasons.length ? h('ul', { class: 'reasons-list' }, ins.reasons.map((x) => h('li', {}, `${x.label}: ${x.count}`)))
      : h('p', { class: 'muted' }, 'עדיין אין סיבות טעות מתועדות. אחרי טעות בתרגול אפשר לסמן את הסיבה.'),
    h('h2', {}, 'השאלות'), h('ol', { class: 'report-list' }, rows),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn', href: '#/summary' }, 'סיכום להדפסה'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { store.clearExam(); location.hash = '#/exam/new'; } }, 'מבחן חדש'),
      h('a', { class: 'btn', href: '#/' }, 'לדף הבית')));
}
