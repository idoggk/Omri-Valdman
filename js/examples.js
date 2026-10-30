// Worked examples and formula sheet: data validation and tiny pure state. No DOM.

export function validExample(e) {
  return !!e && typeof e.id === 'string' && typeof e.topic === 'string' && typeof e.title === 'string' &&
    Array.isArray(e.steps) && e.steps.length > 0 && e.steps.every((s) => typeof s === 'string');
}

/** Keeps only valid examples; anything that is not an array gives []. */
export function cleanExamples(arr) {
  return Array.isArray(arr) ? arr.filter(validExample) : [];
}

/** Keeps only topics whose value has a sections array; anything else gives {}. */
export function cleanFormulas(data) {
  const out = {};
  const topics = data && typeof data === 'object' && data.topics && typeof data.topics === 'object' ? data.topics : {};
  for (const [id, t] of Object.entries(topics)) {
    if (!t || typeof t !== 'object') continue;
    const sections = (Array.isArray(t.sections) ? t.sections : []).filter((s) => s && Array.isArray(s.items));
    const mistakes = (Array.isArray(t.mistakes) ? t.mistakes : []).filter((m) => typeof m === 'string');
    if (sections.length || mistakes.length) out[id] = { title: typeof t.title === 'string' ? t.title : id, sections, mistakes };
  }
  return out;
}

/** Steps revealed so far for an example: starts at 0; "next step" reveals one more, up to the total. */
export const revealNext = (shown, total) => Math.min(total, shown + 1);
