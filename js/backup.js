// Progress backup / restore. A backup is a compact JSON string with the raw localStorage values of
// this app's keys. Restore is strictly validated and never executes anything: the text is only
// JSON.parse'd (in try/catch) and each value is stored back as an opaque string.
import { h } from './dom.js';
import * as store from './store.js';
import { cleanLog, compactLog, LOG_KEY } from './srs.js';
import { cleanList, FEEDBACK_KEY, FEEDBACK_CAP } from './feedback.js';
import { KEY as NOTEBOOK_KEY, mergeNotebook } from './notebook.js';
import { KEY as DERIVE_KEY, mergeDerive } from './derive-state.js';
import { KEY as JOURNAL_KEY, mergeJournal } from './journal.js';
import { KEY as EXAMDAY_KEY, mergeExamday } from './examday.js';
import { KEY as COUNTER_KEY, mergeCounter } from './counter.js';
import { KEY as REPLAY_KEY, mergeReplay } from './replay.js';
import { KEY as BLIND_KEY, mergeBlind } from './blind.js';
import { KEY as RECOVERY_KEY, mergeRecovery } from './recovery.js';
import { KEY as PRESSURE_KEY, mergePressure } from './pressure.js';

import { BACKUP_APP, BACKUP_VERSION, MAX_CODE_CHARS, SIZE_WARN_RATIO, LAST_BACKUP_KEY, UNDO_KEY, UNDO_TTL, KNOWN_KEYS, EXCLUDED_KEYS, buildBackup, markBackedUp, daysSinceBackup, reminderText, reminderLine, homeReminderText, homeReminder, sizeWarning, storageSizeWarning } from './backup-lite.js';
export * from './backup-lite.js';
const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const DAY = 86_400_000;

const countOf = (value) => {
  if (Array.isArray(value)) return value.length;
  if (isRec(value)) {
    // progress/drills/findmistake keep their records under one nested object; count the largest
    const nested = Object.values(value).filter(isRec).map((o) => Object.keys(o).length);
    return nested.length ? Math.max(...nested) : Object.keys(value).length;
  }
  return 0;
};

/** Validates a backup code. Returns {ok:true, data, preview, ts} or {ok:false, error}. Touches no storage. */
export function parseBackup(text) {
  const bad = (error) => ({ ok: false, error });
  if (typeof text !== 'string' || !text.trim()) return bad('הדביקו קוד גיבוי או בחרו קובץ.');
  const code = text.trim();
  if (code.length > MAX_CODE_CHARS) return bad('הקוד גדול מדי ולכן לא נטען.');
  let obj;
  try { obj = JSON.parse(code); } catch (e) { return bad('הקוד אינו תקין (ייתכן שהועתק חלקית).'); }
  if (!isRec(obj) || obj.app !== BACKUP_APP) return bad('זה לא קוד גיבוי של Brain Gains.');
  if (!Number.isInteger(obj.v) || obj.v < 1 || obj.v > BACKUP_VERSION) return bad('גרסת הגיבוי אינה נתמכת.');
  const fromVersion = obj.v;
  obj = migrateEnvelope(obj);
  if (!isRec(obj.data)) return bad('בגיבוי אין נתונים.');
  const data = {};
  const preview = [];
  for (const k of Object.keys(obj.data)) {
    if (!Object.hasOwn(KNOWN_KEYS, k)) return bad('בגיבוי יש מפתח לא מוכר, לכן הוא נדחה.');
    const raw = obj.data[k];
    if (typeof raw !== 'string') return bad('פורמט הנתונים בגיבוי שגוי.');
    let value;
    try { value = JSON.parse(raw); } catch (e) { return bad('חלק מהנתונים בגיבוי פגום.'); }
    if (!value || typeof value !== 'object') return bad('פורמט הנתונים בגיבוי שגוי.');
    data[k] = raw;
    preview.push({ key: k, label: KNOWN_KEYS[k], count: countOf(value) });
  }
  if (!preview.length) return bad('הגיבוי ריק.');
  return { ok: true, data, preview, ts: Number.isFinite(obj.ts) ? obj.ts : null, fromVersion };
}

/** Envelope migrations: MIGRATIONS[n] turns a version-n envelope into version n+1. v1 -> v2 changed no data shape (stub). */
export const MIGRATIONS = {
  1: (env) => ({ ...env, v: 2 }),
};

export function migrateEnvelope(env) {
  let cur = env;
  while (cur.v < BACKUP_VERSION) {
    const step = MIGRATIONS[cur.v];
    if (!step) break;
    cur = step(cur);
  }
  return cur;
}

const readKey = (storage, k) => { try { const v = storage.getItem(k); return typeof v === 'string' ? v : null; } catch (e) { return null; } };

/** Writes {key: string|null} (null = remove). All or nothing: on any throw the previous values are put back. */
function writeAll(storage, entries) {
  const before = new Map(Object.keys(entries).map((k) => [k, readKey(storage, k)]));
  const put = (k, v) => {
    if (v == null) { if (typeof storage.removeItem === 'function') storage.removeItem(k); } else storage.setItem(k, v);
  };
  try {
    for (const [k, v] of Object.entries(entries)) put(k, v);
    return { ok: true };
  } catch (e) {
    const stuck = [];
    for (const [k, v] of before) { try { put(k, v); } catch (e2) { stuck.push(k); } }
    return { ok: false, rolledBack: stuck.length === 0, stuck };
  }
}

const attemptKey = (a) => `${a.exerciseId}|${a.ts}`;

/** Union of two raw attempts logs by (exerciseId, ts); the local row wins a tie. Sorted by time (stable), compacted at the cap. */
export function mergeAttempts(localRaw, backupRaw) {
  const parse = (r) => { try { return cleanLog(JSON.parse(r)); } catch (e) { return []; } };
  const seen = new Set();
  const rows = [];
  for (const a of [...parse(localRaw), ...parse(backupRaw)]) {
    const k = attemptKey(a);
    if (!seen.has(k)) { seen.add(k); rows.push(a); }
  }
  const sorted = rows.map((a, i) => ({ a, i })).sort((x, y) => x.a.ts - y.a.ts || x.i - y.i).map((x) => x.a);
  return JSON.stringify(compactLog(sorted));
}

/** Union of two raw feedback stores by record id; the local record wins a tie. Newest FEEDBACK_CAP kept. */
export function mergeFeedback(localRaw, backupRaw) {
  const parse = (r) => { try { return cleanList(JSON.parse(r)); } catch (e) { return []; } };
  const seen = new Set();
  const rows = [];
  for (const r of [...parse(localRaw), ...parse(backupRaw)]) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  const sorted = rows.map((r, i) => ({ r, i })).sort((x, y) => x.r.ts - y.r.ts || x.i - y.i).map((x) => x.r);
  return JSON.stringify({ v: 1, records: sorted.slice(-FEEDBACK_CAP) });
}

const parseCount = (raw, fn) => { try { return fn(JSON.parse(raw)).length; } catch (e) { return 0; } };

/** What a restore would do to the attempts log: rows on this device, rows in the backup, rows after the union. */
export function restoreCounts(storage, parsed) {
  const local = readKey(storage, LOG_KEY);
  const incoming = parsed && parsed.data ? parsed.data[LOG_KEY] : null;
  return {
    local: local ? parseCount(local, cleanLog) : 0,
    backup: incoming ? parseCount(incoming, cleanLog) : 0,
    merged: incoming ? parseCount(local ? mergeAttempts(local, incoming) : incoming, cleanLog) : (local ? parseCount(local, cleanLog) : 0),
  };
}

/** Keys that are merged with the data on the device instead of replaced: [storage key, (localRaw, backupRaw) => merged raw]. */
const MERGERS = [
  [LOG_KEY, mergeAttempts], [FEEDBACK_KEY, mergeFeedback], [NOTEBOOK_KEY, mergeNotebook], [DERIVE_KEY, mergeDerive], [JOURNAL_KEY, mergeJournal],
  [EXAMDAY_KEY, mergeExamday], [COUNTER_KEY, mergeCounter], [REPLAY_KEY, mergeReplay], [BLIND_KEY, mergeBlind], [RECOVERY_KEY, mergeRecovery], [PRESSURE_KEY, mergePressure],
];

/**
 * Restores a parsed backup. Atomic: every known key is snapshotted first and put back if any write throws.
 * The attempts log, feedback records, the error notebook (by exerciseId) and the derivation schedule (by task id), the prediction journal (by entry id), the exam-day record and the counterexample progress (by task id) are merged with what is on the device; every other key is replaced.
 * One undo snapshot is kept for 24 h. Returns {ok, undo, rolledBack}.
 */
export function restoreBackup(storage, parsed, now = Date.now()) {
  if (!parsed || !parsed.ok) return { ok: false, undo: false, rolledBack: true };
  const snapshot = {};
  for (const k of Object.keys(KNOWN_KEYS)) snapshot[k] = readKey(storage, k);
  const entries = { ...parsed.data };
  try {
    for (const [key, merge] of MERGERS) {
      if (typeof parsed.data[key] === 'string' && snapshot[key] != null) entries[key] = merge(snapshot[key], parsed.data[key]);
    }
  } catch (e) { return { ok: false, undo: false, rolledBack: true }; }
  try { if (typeof storage.removeItem === 'function') storage.removeItem(UNDO_KEY); } catch (e) { /* frees space; ignore */ }
  const res = writeAll(storage, entries);
  if (!res.ok) return { ok: false, undo: false, rolledBack: res.rolledBack };
  let undo = false;
  try { storage.setItem(UNDO_KEY, JSON.stringify({ ts: now, snapshot })); undo = true; } catch (e) { /* no room for an undo copy: the restore itself stands */ }
  return { ok: true, undo, rolledBack: false };
}

/** Writes a parsed backup into storage. Returns true when every key was written (otherwise nothing changed). */
export function applyBackup(storage, parsed, now = Date.now()) {
  return restoreBackup(storage, parsed, now).ok;
}

/** Timestamp of a usable undo snapshot (younger than 24 h), else null. */
export function undoAvailable(storage, now = Date.now()) {
  const raw = readKey(storage, UNDO_KEY);
  if (!raw) return null;
  try {
    const u = JSON.parse(raw);
    return isRec(u) && isRec(u.snapshot) && Number.isFinite(u.ts) && now - u.ts >= 0 && now - u.ts < UNDO_TTL ? u.ts : null;
  } catch (e) { return null; }
}

/** Puts back the state from before the last restore. Atomic; the snapshot is dropped on success. */
export function undoRestore(storage, now = Date.now()) {
  if (undoAvailable(storage, now) == null) return false;
  let u;
  try { u = JSON.parse(readKey(storage, UNDO_KEY)); } catch (e) { return false; }
  const entries = {};
  for (const [k, v] of Object.entries(u.snapshot)) if (Object.hasOwn(KNOWN_KEYS, k) && (v == null || typeof v === 'string')) entries[k] = v;
  const res = writeAll(storage, entries);
  if (!res.ok) return false;
  try { if (typeof storage.removeItem === 'function') storage.removeItem(UNDO_KEY); else storage.setItem(UNDO_KEY, ''); } catch (e) { /* ignore */ }
  return true;
}

/** Whether the browser keeps this app's storage from being evicted: {supported, persisted}. Never throws. */
export async function storagePersistence(nav = globalThis.navigator) {
  try {
    if (!nav || !nav.storage || typeof nav.storage.persisted !== 'function') return { supported: false, persisted: false };
    return { supported: true, persisted: !!(await nav.storage.persisted()) };
  } catch (e) { return { supported: false, persisted: false }; }
}

/** Shares the backup as a file through the OS share sheet; resolves {ok, msg, unsupported?} and never throws. */
export async function shareBackupFile(json, filename, nav = globalThis.navigator, FileCtor = globalThis.File) {
  try {
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof FileCtor !== 'function') return { ok: false, unsupported: true, msg: 'השיתוף לא נתמך בדפדפן הזה.' };
    const file = new FileCtor([json], filename, { type: 'application/json' });
    if (!nav.canShare({ files: [file] })) return { ok: false, unsupported: true, msg: 'שיתוף קבצים לא נתמך בדפדפן הזה.' };
    await nav.share({ files: [file], title: 'Brain Gains – גיבוי התקדמות' });
    return { ok: true, msg: 'נפתח חלון השיתוף.' };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, msg: 'השיתוף בוטל.' };
    return { ok: false, unsupported: true, msg: 'השיתוף נכשל.' };
  }
}

const crumbs = () => h('p', { class: 'crumbs' }, h('a', { href: '#/' }, '→ חזרה לדף הבית'));

function textarea(attrs) {
  const t = h('textarea', { rows: '4', dir: 'ltr', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs });
  t.value = '';
  return t;
}

export function viewBackup(ctx) {
  document.title = 'גיבוי והעברה – Brain Gains';
  const status = h('div', { 'aria-live': 'polite' });
  const say = (kind, text) => status.replaceChildren(h('div', { class: `feedback ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, text));
  const exportBox = h('div');
  const lastLine = () => {
    const d = daysSinceBackup(localStorage);
    return d == null ? 'עוד לא נוצר גיבוי במכשיר הזה.' : `גיבוי אחרון: ${d === 0 ? 'היום' : d === 1 ? 'אתמול' : `לפני ${d} ימים`}.`;
  };
  const last = h('p', { class: 'muted' }, lastLine());
  const sizeWarn = storageSizeWarning();
  const sizeNote = sizeWarn ? h('p', { class: 'feedback bad', role: 'alert' }, sizeWarn) : null;
  const done = () => { markBackedUp(localStorage); last.textContent = lastLine(); };

  const showCode = (code, msg) => {
    const box = textarea({ readonly: '', 'aria-label': 'קוד גיבוי', rows: '5' });
    box.value = code;
    exportBox.replaceChildren(h('p', { class: 'muted' }, msg), box);
    try { if (box.focus) box.focus(); if (box.select) box.select(); } catch (e) { /* ignore */ }
  };

  const copy = async () => {
    const code = buildBackup(localStorage);
    try {
      await navigator.clipboard.writeText(code);
      showCode(code, 'הקוד הועתק. שמרו אותו במקום בטוח (למשל הודעה לעצמכם).');
      done();
      say('ok', 'הקוד הועתק ללוח.');
    } catch (e) {
      showCode(code, 'ההעתקה האוטומטית נחסמה. סמנו את הקוד והעתיקו אותו ידנית:');
      done();
      say('bad', 'לא הצלחנו להעתיק ללוח. אפשר להעתיק ידנית מהתיבה.');
    }
  };

  const fileName = () => `brain-gains-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const shareFile = async () => {
    const code = buildBackup(localStorage);
    const res = await shareBackupFile(code, fileName());
    if (res.ok) { done(); say('ok', res.msg); return; }
    if (res.unsupported) { // same fallback as the other buttons
      if (navigator.clipboard && navigator.clipboard.writeText) await copy(); else download();
      return;
    }
    say('bad', res.msg);
  };

  const persistLine = h('p', { class: 'muted persist-line' });
  storagePersistence().then((p) => {
    persistLine.textContent = !p.supported ? 'הדפדפן הזה לא מדווח אם האחסון מוגן ממחיקה, ולכן גיבוי קבוע חשוב במיוחד.'
      : p.persisted ? 'אחסון מוגן: כן. הדפדפן לא ימחק את ההתקדמות כשנגמר המקום.'
        : 'אחסון מוגן: לא. הדפדפן עלול למחוק נתונים כשנגמר המקום או אחרי זמן ארוך בלי שימוש, ולכן כדאי לגבות.';
  });

  const download = () => {
    const code = buildBackup(localStorage);
    try {
      const url = URL.createObjectURL(new Blob([code], { type: 'application/json' }));
      const a = h('a', { href: url, download: fileName(), class: 'btn' }, 'לחצו אם ההורדה לא התחילה');
      exportBox.replaceChildren(a);
      if (typeof a.click === 'function') a.click();
      done();
      say('ok', 'הקובץ מוכן. אם ההורדה לא התחילה, השתמשו בקישור.');
    } catch (e) {
      showCode(code, 'אי אפשר להוריד קובץ בדפדפן הזה. העתיקו את הקוד ידנית:');
      say('bad', 'ההורדה לא נתמכת כאן.');
    }
  };

  /* restore */
  const input = textarea({ 'aria-label': 'הדביקו כאן קוד גיבוי', placeholder: 'הדביקו כאן קוד גיבוי' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json,text/plain', 'aria-label': 'בחירת קובץ גיבוי' });
  const previewBox = h('div', { 'aria-live': 'polite' });

  const undoBox = h('div', { 'aria-live': 'polite' });
  const refreshUndo = () => {
    const ts = undoAvailable(localStorage);
    if (ts == null) { undoBox.replaceChildren(); return; }
    undoBox.replaceChildren(h('div', { class: 'panel' },
      h('p', { class: 'muted' }, `אפשר לבטל את השחזור האחרון (מ־${new Date(ts).toLocaleString('he-IL')}) עד 24 שעות.`),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const ok = undoRestore(localStorage);
        store.resetCache();
        refreshUndo();
        if (ok) previewBox.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'השחזור בוטל והנתונים חזרו למצבם הקודם.'));
        else previewBox.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, 'הביטול נכשל. לא שונה דבר.'));
      } }, 'בטלו את השחזור האחרון')));
  };

  const preview = (text) => {
    const res = parseBackup(text);
    if (!res.ok) { previewBox.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, res.error, ' לא בוצע שום שינוי.')); return; }
    const counts = restoreCounts(localStorage, res);
    const when = res.ts ? new Date(res.ts).toLocaleString('he-IL') : null;
    previewBox.replaceChildren(h('div', { class: 'panel' },
      h('strong', {}, 'מה יוחזר:'),
      when ? h('p', { class: 'muted' }, `הגיבוי נוצר ב־${when}.`) : null,
      h('p', {}, `ניסיונות בתרגילים: ${counts.local} במכשיר הזה, ${counts.backup} בגיבוי. אחרי האיחוד יהיו ${counts.merged}.`),
      h('ul', { class: 'reasons' }, res.preview.map((p) => h('li', {}, `${p.label}: ${p.count} רשומות`))),
      h('p', { class: 'muted' }, 'יומן הניסיונות והמשוב יתאחדו עם מה שיש במכשיר ולא יימחקו. שאר הנתונים יוחלפו בנתוני הגיבוי. אחרי השחזור תוכלו לבטל אותו במשך 24 שעות.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          const r = restoreBackup(localStorage, res);
          store.resetCache();
          if (r.ok) { previewBox.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'הגיבוי שוחזר.')); refreshUndo(); } else previewBox.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, r.rolledBack ? 'השחזור נכשל, ולכן לא שונה דבר. ייתכן שהאחסון מלא או חסום.' : 'השחזור נכשל וחלק מהנתונים אולי לא חזרו למצבם. בדקו את ההתקדמות.'));
        } }, 'אשרו שחזור'),
        h('button', { class: 'btn', type: 'button', onclick: () => previewBox.replaceChildren() }, 'ביטול'))));
  };

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_CODE_CHARS) return preview('x'.repeat(MAX_CODE_CHARS + 1)); // reuses the size error
    try { preview(await f.text()); } catch (e) { preview(''); }
  });

  refreshUndo();
  ctx.show(crumbs(), h('h1', {}, 'גיבוי והעברה'),
    h('p', { class: 'muted' }, 'ההתקדמות נשמרת רק במכשיר הזה. כדי לא לאבד אותה או להעביר למכשיר אחר, צרו קוד גיבוי.'),
    last, sizeNote, persistLine,
    h('section', { 'aria-labelledby': 'bk-h' },
      h('h2', { id: 'bk-h' }, 'יצירת גיבוי'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: copy }, 'העתק קוד התקדמות'),
        h('button', { class: 'btn', type: 'button', onclick: shareFile }, 'שתף קובץ גיבוי'),
        h('button', { class: 'btn', type: 'button', onclick: download }, 'הורד קובץ')),
      exportBox),
    status,
    h('section', { 'aria-labelledby': 'rs-h' },
      h('h2', { id: 'rs-h' }, 'שחזור'),
      h('p', { class: 'muted' }, 'הדביקו קוד או בחרו קובץ. לפני כל שינוי תוצג תצוגה מקדימה, ורק אישור שלכם יחליף נתונים.'),
      input, fileInput,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => preview(input.value) }, 'בדוק קוד')),
      previewBox, undoBox));
}
