// Multi-solution answers: unordered matching of entered rows against expected sets. No DOM.
import { isCorrect } from './check.js';

const blank = (v) => String(v ?? '').trim() === '';

/**
 * rows: array of arrays of strings (one array per row, one string per label).
 * sets: expected solutions, e.g. [["2","3"],["-1","0.5"]].
 * Returns { right:[row idx], wrong:[row idx], expected, solved }.
 * Empty rows are ignored. Each expected set can be used by at most one row (duplicates are wrong).
 */
export function matchSets(rows, sets, tolerance = 0.01) {
  const filled = [];
  rows.forEach((r, i) => { if (r.some((v) => !blank(v))) filled.push(i); });

  const fits = (i, j) => {
    const row = rows[i];
    const want = sets[j];
    return row.length === want.length && want.every((w, k) => !blank(row[k]) && isCorrect(row[k], w, tolerance));
  };

  const owner = new Array(sets.length).fill(-1); // expected set -> row
  const tryRow = (i, seen) => {
    for (let j = 0; j < sets.length; j++) {
      if (seen[j] || !fits(i, j)) continue;
      seen[j] = true;
      if (owner[j] === -1 || tryRow(owner[j], seen)) { owner[j] = i; return true; }
    }
    return false;
  };
  for (const i of filled) tryRow(i, new Array(sets.length).fill(false));

  const matched = new Set(owner.filter((i) => i !== -1));
  const right = filled.filter((i) => matched.has(i));
  const wrong = filled.filter((i) => !matched.has(i));
  return { right, wrong, expected: sets.length, solved: wrong.length === 0 && right.length === sets.length };
}

export function validAnswerSets(a) {
  return !!a && Array.isArray(a.labels) && a.labels.length > 0 &&
    Array.isArray(a.sets) && a.sets.length > 0 &&
    a.sets.every((s) => Array.isArray(s) && s.length === a.labels.length) &&
    Number.isInteger(a.count) && a.count >= a.sets.length;
}
