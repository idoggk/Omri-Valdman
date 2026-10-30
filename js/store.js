// Progress in localStorage; every access is guarded (private mode, disabled storage).
const KEY = 'omri-study-progress-v1';
let memory = { done: {}, tips: {} };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memory;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      memory = { done: data.done || {}, tips: data.tips || {} };
    }
  } catch (e) { /* use in-memory */ }
  return memory;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch (e) { /* ignore */ }
}

export function isDone(id) { return !!load().done[id]; }

export function markDone(id) {
  load().done[id] = true;
  save();
}

/** Highest number of tips opened for an exercise (0-3), or 'solution'. */
export function getTipsUsed(id) { return load().tips[id] || 0; }

export function setTipsUsed(id, n) {
  const m = load();
  if ((m.tips[id] || 0) < n) { m.tips[id] = n; save(); }
}

export function countDone(ids) {
  const m = load();
  return ids.filter((id) => m.done[id]).length;
}
