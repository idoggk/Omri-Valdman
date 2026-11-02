// Progress backup / restore. A backup is a compact JSON string with the raw localStorage values of
// this app's keys. Restore is strictly validated and never executes anything: the text is only
// JSON.parse'd (in try/catch) and each value is stored back as an opaque string.
import { h } from './dom.js';
import * as store from './store.js';

export const BACKUP_APP = 'brain-gains';
export const BACKUP_VERSION = 1;
export const MAX_CODE_CHARS = 2_000_000;
export const LAST_BACKUP_KEY = 'omri-study-lastbackup-v1'; // device-local, never part of a backup

export const KNOWN_KEYS = {
  'omri-study-progress-v2': 'התקדמות בתרגילים',
  'omri-study-attempts-v1': 'יומן ניסיונות',
  'omri-study-drills-v1': 'תרגולים מהירים',
  'omri-study-findmistake-v1': 'מצאו את הטעות',
  'omri-study-workout-v1': 'אימון פעיל',
  'omri-study-exam-v1': 'מבחן פעיל',
  'omri-study-order-v1': 'שיאים בסידור שלבים',
  'omri-study-checkpoints-v1': 'נקודות ביניים',
  'omri-study-methods-v1': 'בחירת שיטה',
  'omri-study-repair-v1': 'חיזוק יסודות',
  'omri-study-edgecases-v1': 'מקרי קצה',
  'omri-study-confidence-v1': 'ביטחון בפתרון מלא',
  'omri-study-reverse-v1': 'בעיות הפוכות',
  'omri-study-ladder-v1': 'הסלם לרמת מבחן',
  'omri-study-fading-v1': 'דוגמאות מתפוגגות',
  'omri-study-feedback-v1': 'משוב על קושי',
  'omri-study-trig-v1': 'זהויות טריגונומטריות',
  'omri-study-logs-v1': 'לוגריתמים: כרטיסיות',
};

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);
const DAY = 86_400_000;

/** Compact JSON string of every known key that has a value in `storage`. */
export function buildBackup(storage, now = Date.now()) {
  const data = {};
  for (const k of Object.keys(KNOWN_KEYS)) {
    let v = null;
    try { v = storage.getItem(k); } catch (e) { /* unreadable key is skipped */ }
    if (typeof v === 'string') data[k] = v;
  }
  return JSON.stringify({ app: BACKUP_APP, v: BACKUP_VERSION, ts: now, data });
}

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
  if (obj.v !== BACKUP_VERSION) return bad('גרסת הגיבוי אינה נתמכת.');
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
  return { ok: true, data, preview, ts: Number.isFinite(obj.ts) ? obj.ts : null };
}

/** Writes a parsed backup into storage. Returns true when every key was written. */
export function applyBackup(storage, parsed) {
  if (!parsed || !parsed.ok) return false;
  try {
    for (const [k, raw] of Object.entries(parsed.data)) storage.setItem(k, raw);
    return true;
  } catch (e) { return false; }
}

export function markBackedUp(storage, now = Date.now()) {
  try { storage.setItem(LAST_BACKUP_KEY, String(now)); } catch (e) { /* ignore */ }
}

/** Whole days since the last backup, or null when never (or unreadable). */
export function daysSinceBackup(storage, now = Date.now()) {
  try {
    const ts = Number(storage.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(ts) && ts > 0 ? Math.max(0, Math.floor((now - ts) / DAY)) : null;
  } catch (e) { return null; }
}

/** Reminder text for the progress page; null while there is no real history to protect. */
export function reminderText(days, attemptCount) {
  if (days == null) return attemptCount >= 5 ? 'עוד לא גיביתם את ההתקדמות. כדאי ליצור גיבוי קטן.' : null;
  const when = days === 0 ? 'היום' : days === 1 ? 'אתמול' : `לפני ${days} ימים`;
  const soft = days >= 7 && attemptCount >= 5 ? ' כדאי לגבות שוב.' : '';
  return `גיבוי אחרון: ${when}.${soft}`;
}

/** Small line (with link) appended to the progress page. */
export function reminderLine() {
  let days = null;
  let n = 0;
  try { days = daysSinceBackup(localStorage); n = store.getAttempts().length; } catch (e) { /* none */ }
  const text = reminderText(days, n);
  return text ? h('p', { class: 'muted', role: 'status' }, text, ' ', h('a', { href: '#/backup' }, 'גיבוי והעברה')) : null;
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

  const download = () => {
    const code = buildBackup(localStorage);
    try {
      const url = URL.createObjectURL(new Blob([code], { type: 'application/json' }));
      const a = h('a', { href: url, download: `brain-gains-backup-${new Date().toISOString().slice(0, 10)}.json`, class: 'btn' }, 'לחצו אם ההורדה לא התחילה');
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

  const preview = (text) => {
    const res = parseBackup(text);
    if (!res.ok) { previewBox.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, res.error, ' לא בוצע שום שינוי.')); return; }
    previewBox.replaceChildren(h('div', { class: 'panel' },
      h('strong', {}, 'מה יוחזר:'),
      h('ul', { class: 'reasons' }, res.preview.map((p) => h('li', {}, `${p.label}: ${p.count} רשומות`))),
      h('p', { class: 'muted' }, 'הנתונים האלה יחליפו את הנתונים שבמכשיר הזה.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          if (applyBackup(localStorage, res)) { store.resetCache(); previewBox.replaceChildren(h('div', { class: 'feedback ok', role: 'status' }, 'הגיבוי שוחזר.')); } else previewBox.replaceChildren(h('div', { class: 'feedback bad', role: 'alert' }, 'השחזור נכשל. ייתכן שהאחסון חסום.'));
        } }, 'אשרו שחזור'),
        h('button', { class: 'btn', type: 'button', onclick: () => previewBox.replaceChildren() }, 'ביטול'))));
  };

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_CODE_CHARS) return preview('x'.repeat(MAX_CODE_CHARS + 1)); // reuses the size error
    try { preview(await f.text()); } catch (e) { preview(''); }
  });

  ctx.show(crumbs(), h('h1', {}, 'גיבוי והעברה'),
    h('p', { class: 'muted' }, 'ההתקדמות נשמרת רק במכשיר הזה. כדי לא לאבד אותה או להעביר למכשיר אחר, צרו קוד גיבוי.'),
    last,
    h('section', { 'aria-labelledby': 'bk-h' },
      h('h2', { id: 'bk-h' }, 'יצירת גיבוי'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', type: 'button', onclick: copy }, 'העתק קוד התקדמות'),
        h('button', { class: 'btn', type: 'button', onclick: download }, 'הורד קובץ')),
      exportBox),
    status,
    h('section', { 'aria-labelledby': 'rs-h' },
      h('h2', { id: 'rs-h' }, 'שחזור'),
      h('p', { class: 'muted' }, 'הדביקו קוד או בחרו קובץ. לפני כל שינוי תוצג תצוגה מקדימה, ורק אישור שלכם יחליף נתונים.'),
      input, fileInput,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => preview(input.value) }, 'בדוק קוד')),
      previewBox));
}
