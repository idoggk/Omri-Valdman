// PWA glue: service worker, update banner, share button, add-to-home-screen help.
// Everything is injected at runtime so no other file needs to change.
const HELP_KEY = 'omri-a2hs-help-seen';
const $ = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
};

const isStandalone = () =>
  (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const APP_VERSION = '40'; // keep equal to CACHE_VERSION in sw.js
const RELOAD_KEY = 'omri-sw-reloaded-' + APP_VERSION;
let hadControllerAtLoad = false;

function store(op, key, val, area = 'local') {
  try {
    const s = area === 'session' ? sessionStorage : localStorage;
    return op === 'get' ? s.getItem(key) : s.setItem(key, val);
  } catch { return null; }
}

function injectStyles() {
  const css = `
  .pwa-btn{font:inherit;min-height:44px;min-width:44px;padding:8px 14px;border-radius:var(--radius,14px);
    border:1px solid var(--border,#ccc);background:var(--card,#fff);color:var(--text,#111);cursor:pointer}
  .pwa-btn.primary{background:var(--accent,#2f6fb0);color:var(--accent-text,#fff);border-color:transparent}
  .pwa-btn:focus-visible,.pwa-link:focus-visible{outline:3px solid var(--accent,#2f6fb0);outline-offset:2px}
  .pwa-tools{display:inline-flex;flex-wrap:wrap;gap:8px;align-items:center;margin-inline-start:auto}
  .pwa-link{display:inline-flex;align-items:center;min-height:44px;padding:0 6px;color:var(--accent,#2f6fb0);
    background:none;border:0;font:inherit;text-decoration:underline;cursor:pointer}
  .pwa-toast,.pwa-banner{position:fixed;inset-inline:12px;z-index:1000;display:flex;gap:10px;align-items:center;
    justify-content:center;padding:12px 16px;border-radius:var(--radius,14px);background:var(--card,#fff);
    color:var(--text,#111);border:1px solid var(--border,#ccc);box-shadow:0 4px 18px rgba(0,0,0,.25)}
  .pwa-toast{bottom:calc(16px + env(safe-area-inset-bottom,0px))}
  .pwa-banner{top:calc(12px + env(safe-area-inset-top,0px))}
  dialog.pwa-dialog{max-width:min(92vw,480px);border:1px solid var(--border,#ccc);border-radius:var(--radius,14px);
    background:var(--card,#fff);color:var(--text,#111);padding:20px;line-height:1.7}
  dialog.pwa-dialog::backdrop{background:rgba(0,0,0,.55)}
  dialog.pwa-dialog h2{margin-top:0}
  dialog.pwa-dialog ol{padding-inline-start:1.4em}
  `;
  document.head.append($('style', { textContent: css }));
}

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.pwa-toast');
  if (!el) {
    el = $('div', { className: 'pwa-toast' });
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function share() {
  const data = { title: 'Brain Gains', text: 'Brain Gains – תרגול מתמטיקה ופיזיקה', url: location.href.split('#')[0] };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    toast('הקישור הועתק');
  } catch {
    toast('לא הצלחנו להעתיק. הקישור: ' + data.url);
  }
}

let deferredPrompt = null;
let installBtn = null;

function buildHelpDialog() {
  const dlg = $('dialog', { className: 'pwa-dialog' });
  dlg.setAttribute('aria-labelledby', 'pwa-help-title');
  const close = $('button', { className: 'pwa-btn primary', type: 'button', textContent: 'הבנתי' });
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.append(
    $('h2', { id: 'pwa-help-title', textContent: 'איך מוסיפים את Brain Gains למסך הבית' }),
    $('h3', { textContent: 'אייפון (Safari)' }),
    Object.assign($('ol'), {
      innerHTML: '<li>לוחצים על כפתור השיתוף בתחתית המסך.</li><li>גוללים למטה ובוחרים ״הוסף למסך הבית״ (Add to Home Screen).</li><li>לוחצים ״הוסף״ (Add).</li>',
    }),
    $('h3', { textContent: 'אנדרואיד (Chrome)' }),
    Object.assign($('ol'), {
      innerHTML: '<li>פותחים את התפריט (שלוש הנקודות).</li><li>בוחרים ״התקן אפליקציה״ (Install app) או ״הוסף למסך הבית״ (Add to Home screen).</li><li>מאשרים.</li>',
    }),
    $('p', { textContent: 'אחרי ההוספה Brain Gains נפתחת במסך מלא וגם עובדת בלי אינטרנט.' }),
    close,
  );
  document.body.append(dlg);
  return dlg;
}

let helpDlg;
function openHelp() {
  helpDlg ||= buildHelpDialog();
  if (typeof helpDlg.showModal === 'function') helpDlg.showModal(); else helpDlg.setAttribute('open', '');
  store('set', HELP_KEY, '1');
}

function injectTools() {
  const header = document.querySelector('.site-header') || document.body;
  const shareBtn = $('button', { className: 'pwa-btn', type: 'button', textContent: 'שתפו' });
  shareBtn.setAttribute('aria-label', 'שתפו את האתר');
  shareBtn.addEventListener('click', share);
  const helpLink = $('button', { className: 'pwa-link', type: 'button', textContent: 'איך מוסיפים למסך הבית' });
  helpLink.addEventListener('click', openHelp);
  installBtn = $('button', { className: 'pwa-btn primary', type: 'button', textContent: 'התקינו' });
  installBtn.hidden = true;
  installBtn.setAttribute('aria-label', 'התקינו את האפליקציה');
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* ignore */ }
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  const tools = $('span', { className: 'pwa-tools' }, installBtn, shareBtn);
  if (!isStandalone()) tools.append(helpLink);
  header.append(tools);
}

function showUpdateBanner(worker) {
  if (document.querySelector('.pwa-banner')) return;
  const btn = $('button', { className: 'pwa-btn primary', type: 'button', textContent: 'רעננו' });
  const banner = $('div', { className: 'pwa-banner' }, $('span', { textContent: 'יש גרסה חדשה – רעננו' }), btn);
  banner.setAttribute('role', 'status');
  btn.addEventListener('click', () => {
    if (worker) { try { worker.postMessage('skip-waiting'); } catch { /* ignore */ } }
    location.reload();
  });
  document.body.append(banner);
}

function injectVersion() {
  const el = $('footer', { className: 'app-version', textContent: 'גרסה ' + APP_VERSION });
  el.style.cssText = 'text-align:center;font-size:.75rem;opacity:.65;padding:12px 0 calc(12px + env(safe-area-inset-bottom,0px))';
  document.body.append(el);
}

// When a new worker takes over, reload once so a stale page updates itself.
function reloadOnTakeover() {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad) return; // first install: nothing stale to replace
    if (store('get', RELOAD_KEY, null, 'session')) return;
    store('set', RELOAD_KEY, '1', 'session');
    location.reload();
  });
}

// Called by app.js on an unknown route or a render error: a stale cached app is the likely cause right after a
// deploy. Look for a newer worker, activate it and reload ONCE per session (never loops on a truly missing route).
const HEAL_KEY = 'omri-selfheal-reloaded';
let swReg = null;

function waitInstalled(w, ms) {
  return new Promise((resolve) => {
    if (w.state === 'installed' || w.state === 'activated') return resolve(true);
    const t = setTimeout(() => resolve(false), ms);
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' || w.state === 'activated') { clearTimeout(t); resolve(true); }
    });
  });
}

async function selfHeal() {
  if (!swReg || store('get', HEAL_KEY, null, 'session')) return false;
  store('set', HEAL_KEY, '1', 'session');
  try {
    await swReg.update();
    const w = swReg.waiting || swReg.installing;
    if (!w || !(await waitInstalled(w, 8000))) return false;
    const taken = new Promise((res) => {
      navigator.serviceWorker.addEventListener('controllerchange', res);
      setTimeout(res, 1500);
    });
    try { w.postMessage('skip-waiting'); } catch { /* ignore */ }
    await taken;
    location.reload();
    return true;
  } catch { return false; }
}
window.omriSelfHeal = selfHeal;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!secure) return;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    hadControllerAtLoad = hadController;
    reloadOnTakeover();
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    swReg = reg;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && (hadController || navigator.serviceWorker.controller)) showUpdateBanner(w);
      });
    });
  } catch (e) {
    console.warn('service worker registration failed', e);
  }
}

function init() {
  injectStyles();
  injectTools();
  injectVersion();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  window.addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; });
  if (!isStandalone() && isMobile() && !store('get', HELP_KEY)) {
    // iOS has no install prompt, so show the instructions once; Android users also get the install button.
    setTimeout(openHelp, isIOS() ? 1500 : 4000);
  }
  registerSW();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
