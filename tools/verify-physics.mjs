// Verifies data/physics.json: structure, Hebrew fields, and recomputes every answer
// from verify.params with a named physics model (independent of the typed answers).
// Usage: node tools/verify-physics.mjs [path/to/physics.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const G = 10;

// Each model maps params -> array of numbers, in the same order as the exercise's inputs.
export const models = {
  free_fall_from_height: ({ h }) => {
    const t = Math.sqrt((2 * h) / G);
    return [t, G * t];
  },
  free_fall_for_time: ({ t }) => [(G * t * t) / 2, G * t],
  vertical_throw_up: ({ v0 }) => [v0 / G, (v0 * v0) / (2 * G), (2 * v0) / G],
  vertical_throw_by_flight_time: ({ T }) => [(G * T) / 2, (G * T * T) / 8],
  vertical_throw_down_from_height: ({ h, v0 }) => {
    const t = (-v0 + Math.sqrt(v0 * v0 + 2 * G * h)) / G;
    return [t, v0 + G * t];
  },
  vertical_throw_from_height: ({ h, v0 }) => {
    const v = Math.sqrt(v0 * v0 + 2 * G * h);
    return [(v0 + v) / G, v, h + (v0 * v0) / (2 * G)];
  },
  two_body_meet_vertical: ({ H, v0 }) => {
    const t = H / v0;
    return [t, H - (G * t * t) / 2];
  },
  last_second_distance: ({ d }) => {
    const t = (d + G / 2) / G;
    return [t, (G * t * t) / 2];
  },
  free_fall_ratio: ({ tA, k }) => {
    const tB = tA * Math.sqrt(k);
    return [tB, G * tB];
  },
  vertical_height_times: ({ v0, h }) => {
    const disc = v0 * v0 - 2 * G * h;
    if (disc < 0) throw new Error('the body never reaches this height');
    const s = Math.sqrt(disc);
    return [(v0 - s) / G, (v0 + s) / G, s];
  },
  speed_at_height: ({ v0, h }) => {
    const v2 = v0 * v0 - 2 * G * h;
    if (v2 < 0) throw new Error('the body never reaches this height');
    return [Math.sqrt(v2), v2 / (2 * G)];
  },
  distance_in_nth_second: ({ n }) => [
    (G * (n - 1) ** 2) / 2,
    (G * (n * n - (n - 1) ** 2)) / 2,
  ],
  const_velocity_meet: ({ d, v1, v2 }) => {
    const t = d / (v1 + v2);
    return [t, v1 * t];
  },
  const_velocity_overtake: ({ gap, v_fast, v_slow }) => {
    const t = gap / (v_fast - v_slow);
    return [t, v_fast * t];
  },
  head_start_catch: ({ v_slow, v_fast, t0 }) => {
    const t = (v_slow * t0) / (v_fast - v_slow);
    return [t, v_fast * t];
  },
  const_accel_from_rest: ({ a, t }) => [a * t, (a * t * t) / 2],
  accel_with_initial_speed_dist: ({ v0, a, x }) => {
    const v = Math.sqrt(v0 * v0 + 2 * a * x);
    return [v, (v - v0) / a];
  },
  accel_from_speeds_time: ({ v0, v, t }) => [(v - v0) / t, ((v0 + v) / 2) * t],
  braking_only: ({ v, a }) => [v / a, (v * v) / (2 * a)],
  braking_with_reaction: ({ v, a, tr }) => {
    const react = v * tr;
    const brake = (v * v) / (2 * a);
    return [react, brake, react + brake];
  },
  accel_then_cruise: ({ a, vmax, D }) => {
    const t1 = vmax / a;
    const x1 = (vmax * vmax) / (2 * a);
    return [t1, x1, t1 + (D - x1) / vmax];
  },
  horizontal_launch: ({ h, vx }) => {
    const t = Math.sqrt((2 * h) / G);
    return [t, vx * t, Math.hypot(vx, G * t)];
  },
  horizontal_launch_from_range: ({ h, R }) => {
    const t = Math.sqrt((2 * h) / G);
    return [t, R / t, Math.hypot(R / t, G * t)];
  },
};

const HEBREW = /[֐-׿]/;
// Owner rule: every answer is a real integer or a finite decimal with at most 2 decimals.
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;
// Latin unit labels (m, s, m/s, m/s², km/h ...) directly after a number or in a unit field.
const LATIN_UNIT = /(\d|^)\s*(km\/h|m\/s²?|m\/s\^2|km|m|s)(?![\p{L}\d])/iu;
const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ');
const numbersIn = (s) => (stripTags(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const hebrew = (s) => nonEmpty(s) && HEBREW.test(s);

export function checkExercise(ex, idx = 0) {
  const errs = [];
  const where = ex && ex.id ? ex.id : `#${idx}`;
  const err = (m) => errs.push(`${where}: ${m}`);
  if (!ex || typeof ex !== 'object') return [`${where}: not an object`];
  if (!/^phys-(vertical|horizontal)-\d{3}$/.test(ex.id || '')) err('bad id');
  if (!['phys-vertical', 'phys-horizontal'].includes(ex.topic)) err('bad topic');
  else if (ex.id && !ex.id.startsWith(ex.topic + '-')) err('id does not match topic');
  if (![1, 2, 3].includes(ex.level)) err('level must be 1, 2 or 3');
  if (!hebrew(ex.title)) err('title missing or not Hebrew');
  if (!hebrew(ex.statement)) err('statement missing or not Hebrew');
  if (!Array.isArray(ex.tips) || ex.tips.length !== 3) err('tips must have exactly 3 items');
  else ex.tips.forEach((t, i) => hebrew(t) || err(`tip ${i + 1} empty or not Hebrew`));
  if (!Array.isArray(ex.solution) || ex.solution.length < 3) err('solution needs at least 3 steps');
  else ex.solution.forEach((s, i) => hebrew(s) || err(`solution step ${i + 1} empty or not Hebrew`));
  if (!Array.isArray(ex.inputs) || ex.inputs.length === 0) {
    err('inputs missing');
    return errs;
  }
  for (const [field, text] of [['statement', ex.statement], ...(ex.solution || []).map((s, i) => [`solution step ${i + 1}`, s])]) {
    if (typeof text === 'string' && LATIN_UNIT.test(stripTags(text))) err(`${field}: Latin unit label, use Hebrew units (מ/ש, מ', ש')`);
  }
  // Tip 3 must not reveal any requested answer.
  if (Array.isArray(ex.tips) && typeof ex.tips[2] === 'string') {
    const nums = numbersIn(ex.tips[2]);
    for (const inp of ex.inputs) {
      if (nums.includes(Number(inp.answer))) err(`tip 3 contains the requested answer ${inp.answer} ("${inp.label}")`);
    }
  }
  for (const inp of ex.inputs) {
    if (!hebrew(inp.label)) err('input label missing or not Hebrew');
    if (!nonEmpty(inp.unit)) err(`input "${inp.label}": unit missing`);
    else if (LATIN_UNIT.test(inp.unit) || !HEBREW.test(inp.unit)) err(`input "${inp.label}": unit "${inp.unit}" must be a Hebrew unit label`);
    if (!DECIMAL.test(String(inp.answer))) {
      err(`input "${inp.label}": answer must be a plain decimal string`);
      continue;
    }
    const a = Number(inp.answer);
    if (typeof inp.tolerance !== 'number' || !(inp.tolerance > 0)) err(`input "${inp.label}": tolerance must be > 0`);
    else if (inp.tolerance > 0.02 * Math.abs(a) + 1e-12) err(`input "${inp.label}": tolerance ${inp.tolerance} exceeds 2% of ${a}`);
  }
  const v = ex.verify;
  if (!v || typeof v.model !== 'string' || !v.params || !v.expect) {
    err('verify block (model, params, expect) missing');
    return errs;
  }
  const model = models[v.model];
  if (!model) {
    err(`unknown model "${v.model}"`);
    return errs;
  }
  let out;
  try {
    out = model(v.params);
  } catch (e) {
    err(`model ${v.model} failed: ${e.message}`);
    return errs;
  }
  if (out.length !== ex.inputs.length) {
    err(`model ${v.model} returns ${out.length} values but there are ${ex.inputs.length} inputs`);
    return errs;
  }
  const expectKeys = Object.keys(v.expect);
  if (expectKeys.length !== ex.inputs.length) err('verify.expect must have one entry per input');
  ex.inputs.forEach((inp, i) => {
    const computed = out[i];
    const a = Number(inp.answer);
    if (!Number.isFinite(computed)) return err(`input "${inp.label}": model result not a finite real number`);
    if (Math.abs(computed * 100 - Math.round(computed * 100)) > 1e-6) err(`input "${inp.label}": recomputed ${computed} has more than 2 decimals`);
    if (Math.abs(computed - a) > (inp.tolerance ?? 0) + 1e-9) {
      err(`input "${inp.label}": answer ${a} differs from recomputed ${computed} (tolerance ${inp.tolerance})`);
    }
    if (!(inp.label in v.expect)) return err(`verify.expect lacks "${inp.label}"`);
    if (Math.abs(v.expect[inp.label] - computed) > 1e-6 * Math.max(1, Math.abs(computed))) {
      err(`verify.expect["${inp.label}"]=${v.expect[inp.label]} differs from recomputed ${computed}`);
    }
  });
  return errs;
}

export function checkAll(list) {
  if (!Array.isArray(list)) return ['top level must be an array'];
  const errs = [];
  const seen = new Set();
  list.forEach((ex, i) => {
    errs.push(...checkExercise(ex, i));
    if (ex && seen.has(ex.id)) errs.push(`${ex.id}: duplicate id`);
    if (ex) seen.add(ex.id);
  });
  return errs;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'physics.json');
  let list;
  try {
    list = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${file}: ${e.message}`);
    process.exit(1);
  }
  const errs = checkAll(list);
  if (errs.length) {
    console.error(`FAILED: ${errs.length} problem(s)`);
    errs.forEach((e) => console.error(' - ' + e));
    process.exit(1);
  }
  const by = (t) => list.filter((e) => e.topic === t).length;
  console.log(`OK: ${list.length} exercises (vertical ${by('phys-vertical')}, horizontal ${by('phys-horizontal')})`);
}
