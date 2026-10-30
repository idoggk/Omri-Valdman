// Pure state logic of the guided "solve me step by step" stepper. No DOM.
//
// step = { q, options:[...], correct:int, explain, wrongExplain?:[...] }
// state = { i: current step, picked: [option index per answered step], mistakes: number, done: boolean }

export function validGuided(steps) {
  return Array.isArray(steps) && steps.length >= 1 && steps.length <= 8 && steps.every((s) =>
    s && typeof s.q === 'string' && Array.isArray(s.options) && s.options.length >= 2 &&
    Number.isInteger(s.correct) && s.correct >= 0 && s.correct < s.options.length &&
    (s.explain == null || typeof s.explain === 'string') &&
    (s.wrongExplain == null || Array.isArray(s.wrongExplain)));
}

export const startGuided = () => ({ i: 0, picked: [], mistakes: 0, done: false });

/** True while the current step has been answered (right or wrong). */
export const answered = (state) => state.picked.length > state.i;

/** Picks an option for the current step; picking again after answering is ignored. */
export function pick(state, steps, optionIdx) {
  if (state.done || answered(state) || !(optionIdx >= 0 && optionIdx < steps[state.i].options.length)) return state;
  const right = optionIdx === steps[state.i].correct;
  return { ...state, picked: [...state.picked, optionIdx], mistakes: state.mistakes + (right ? 0 : 1) };
}

/** Feedback for the current (answered) step. */
export function feedback(state, steps) {
  if (!answered(state)) return null;
  const s = steps[state.i];
  const choice = state.picked[state.i];
  const ok = choice === s.correct;
  const why = ok ? s.explain : (Array.isArray(s.wrongExplain) && s.wrongExplain[choice]) || '';
  return { ok, choice, correct: s.correct, explain: s.explain || '', why };
}

/** Moves on after a step has been answered. A wrong answer must be followed by retry() or next(). */
export function next(state, steps) {
  if (state.done || !answered(state)) return state;
  if (state.i + 1 >= steps.length) return { ...state, done: true };
  return { ...state, i: state.i + 1 };
}

/** After a wrong answer: try the same step again. */
export function retry(state, steps) {
  const f = feedback(state, steps);
  if (!f || f.ok) return state;
  return { ...state, picked: state.picked.slice(0, state.i) };
}

export const progress = (state, steps) => ({ current: Math.min(state.i + 1, steps.length), total: steps.length });
