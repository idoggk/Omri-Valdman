// Single source of truth for "a run screen is open": timed or seeded sessions that must not be reloaded under the learner.
// Classic script (no import/export) so js/pwa.js can use it and nav.js can import it for its side effect.
// omriRunScreen(hash) -> null (not a run screen) or { hideTabs } (hideTabs: the bottom tab bar is hidden for distraction-free work).
(function (g) {
  var RUN_SEGMENT = { exam: 1, transfer: 1, blind: 1, recovery: 1, pressure: 1, sprint: 1 };
  g.omriRunScreen = function (hash) {
    var parts;
    try { parts = decodeURIComponent(String(hash || '').replace(/^#\/?/, '')).split('/').filter(Boolean); } catch (e) { return null; }
    var a = parts[0], b = parts[1];
    if (RUN_SEGMENT[a] === 1) return b === 'run' ? { hideTabs: true } : null;
    if (a === 'workout') return /^\d+$/.test(b || '') ? { hideTabs: true } : null;
    if (a === 'booklet') return b === 'paper' || b === 'enter' ? { hideTabs: false } : null;
    return null;
  };
})(globalThis);
