// Backup basics that the home screen needs: the list of backed-up keys, building a backup string, and the backup reminders.
// Split out of js/backup.js so that the home route does not load the restore/merge code (and the nine modules whose
// merge handlers it registers). js/backup.js re-exports everything here, so existing imports keep working.
import { h } from './dom.js';
import * as store from './store.js';
export const BACKUP_APP = 'brain-gains';
export const BACKUP_VERSION = 2;
// Raised from 2 MB: a maximal notebook (400 entries) + replay logs + a 5000-row attempts log alone measure 2.05 MB (tests/backup.test.mjs),
// so the old cap could refuse the owner's own full backup. localStorage holds about 5M characters per origin, so 4 MB still bounds the memory a pasted code can use.
export const MAX_CODE_CHARS = 4_000_000;
export const SIZE_WARN_RATIO = 0.7;

/** Hebrew warning once a backup reaches 70% of what restore accepts; null below that. `chars` = length of the backup code. */
export function sizeWarning(chars) {
  if (!Number.isFinite(chars) || chars < MAX_CODE_CHARS * SIZE_WARN_RATIO) return null;
  const pctUsed = Math.min(999, Math.round((chars / MAX_CODE_CHARS) * 100));
  return `הגיבוי כבר גדול: ${pctUsed}% מהגודל המרבי שאפשר לשחזר. גבו עכשיו ושמרו את הקובץ. אם הוא יעבור את הגבול, אי אפשר יהיה לשחזר אותו.`;
}
/** Warning for the data currently on the device (or null). */
export function storageSizeWarning(storage = globalThis.localStorage) {
  try { return sizeWarning(buildBackup(storage).length); } catch (e) { return null; }
}
export const LAST_BACKUP_KEY = 'omri-study-lastbackup-v1'; // device-local, never part of a backup
export const UNDO_KEY = 'omri-study-undo-v1'; // snapshot taken before the last restore, device-local
export const UNDO_TTL = 86_400_000; // 24 h

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
  'omri-study-multipart-v1': 'שאלות בכמה סעיפים',
  'omri-study-mathhard-v1': 'מתמטיקה ברמה גבוהה ולוגריתמים: תרגילים',
  'omri-study-endless-v1': 'תרגול ללא הגבלה',
  'omri-study-transfer-v1': 'מבחן העברה',
  'omri-study-recover-v1': 'תקנו ותמשיכו',
  'omri-study-tryfirst-v1': 'מצב ״קודם מנסים״',
  'omri-study-notebook-v1': 'מחברת טעויות',
  'omri-study-writing-v1': 'כתיבת פתרון (ניקוד חלקי)',
  'omri-study-booklet-v1': 'חוברת מבחן: היסטוריית ציונים',
  'omri-study-fsheet-v1': 'הדף שלי: נוסחאות מהזיכרון',
  'omri-study-sprint-v1': 'ספרינטים באלגברה: רמות ושיאים',
  'omri-study-units-v1': 'יחידות וניתוח ממדים',
  'omri-study-estimate-v1': 'הערכה לפני חישוב',
  'omri-study-notes-v1': 'דגשים: כרטיסיות ותרגילים',
  'omri-study-derive-v1': 'גזירה מהזיכרון: לוח חזרות',
  'omri-study-plan-v1': 'ספירה לאחור: תאריך מבחן והגדרות',
  'omri-study-calib-v1': 'כיול: הגדרת הימור על ביטחון',
  'omri-study-journal-v1': 'יומן תחזית מול מציאות',
  'omri-study-examday-v1': 'שגרת יום המבחן',
  'omri-study-counter-v1': 'אתגר הדוגמה הנגדית',
  'omri-study-replay-v1': 'שחזור אסטרטגיה במבחנים',
  'omri-study-blind-v1': 'טורניר חולשות עיוור',
  'omri-study-recovery-v1': 'התאוששות תחת לחץ',
  'omri-study-pressure-v1': 'סולם לחץ (רשות)',
};

/** Keys the app writes that are deliberately not part of a backup (tests scan js/*.js against KNOWN_KEYS + this list). */
export const EXCLUDED_KEYS = [
  'omri-study-progress-v1', // legacy copy, migrated into progress-v2 on first load
  LAST_BACKUP_KEY, // device-local timestamp
  UNDO_KEY, // a restore snapshot must never be restored into another device or nest inside the next backup
  'omri-study-attempts-v1-corrupt', // raw copy of an unreadable attempts log, kept for manual recovery
];

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

/** One-line home-screen nudge: last backup older than 7 days (or none) with at least 5 attempts. Null otherwise. */
export function homeReminderText(days, attemptCount) {
  if (attemptCount < 5) return null;
  if (days == null) return 'עוד לא גיביתם את ההתקדמות. כדאי ליצור גיבוי.';
  return days >= 7 ? `הגיבוי האחרון היה לפני ${days} ימים. כדאי לגבות שוב.` : null;
}

export function homeReminder() {
  let days = null;
  let n = 0;
  try { days = daysSinceBackup(localStorage); n = store.getAttempts().length; } catch (e) { /* none */ }
  const text = [homeReminderText(days, n), storageSizeWarning()].filter(Boolean).join(' ');
  return text ? h('p', { class: 'muted backup-nag', role: 'status' }, text, ' ', h('a', { href: '#/backup' }, 'גיבוי והעברה')) : null;
}
