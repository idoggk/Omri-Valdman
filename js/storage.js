// One guarded write path for localStorage. A failed write (quota) shows a one-time visible banner so the
// learner knows progress was not saved, and unreadable JSON is stashed under '<key>-corrupt' before any
// overwrite so a bad read never silently destroys the only copy.

export const STORAGE_FULL_TEXT = 'האחסון מלא, ההתקדמות לא נשמרה';
export const corruptKey = (key) => key + '-corrupt';

let bannerShown = false;
/** Tests: allow the banner to show again. */
export function resetStorageBanner() { bannerShown = false; }

export function isQuotaError(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || ''));
}

/** Shows the banner once per page load (no-op outside a browser). Returns true when it was shown now. */
export function showStorageBanner(doc = globalThis.document) {
  if (bannerShown) return false;
  bannerShown = true;
  try {
    if (!doc || typeof doc.createElement !== 'function') return false;
    const el = doc.createElement('div');
    el.setAttribute('role', 'alert');
    el.setAttribute('class', 'storage-banner');
    el.setAttribute('style', 'position:sticky;top:0;z-index:1000;background:#b00020;color:#fff;padding:10px 14px;text-align:center;font-weight:bold');
    el.textContent = STORAGE_FULL_TEXT;
    const host = doc.body || doc.documentElement;
    if (host && typeof host.prepend === 'function') host.prepend(el);
    else if (host && typeof host.append === 'function') host.append(el);
  } catch (e) { /* the banner is best effort */ }
  return true;
}

/** Keeps the raw text of an unparseable stored value under '<key>-corrupt' (first one wins). */
export function stashCorrupt(key, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== 'string' || !raw) return false;
    try { JSON.parse(raw); return false; } catch (e) { /* corrupt: stash below */ }
    if (storage.getItem(corruptKey(key)) != null) return false;
    storage.setItem(corruptKey(key), raw);
    return true;
  } catch (e) { return false; }
}

/** localStorage.setItem that never throws. Returns true when the value was written. */
export function safeSetItem(key, value, storage = globalThis.localStorage) {
  try {
    stashCorrupt(key, storage);
    storage.setItem(key, value);
    return true;
  } catch (e) {
    if (isQuotaError(e)) showStorageBanner();
    return false;
  }
}
