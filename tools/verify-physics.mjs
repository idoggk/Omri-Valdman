// Verifies data/physics.json: structure, Hebrew fields, and recomputes every answer
// from verify.params with a named physics model (independent of the typed answers).
// Usage: node tools/verify-physics.mjs [path/to/physics.json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { validateSvg } from './diagrams.mjs';

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

  // ---- multi-step vertical models
  // engine gives constant net acceleration a for t1, then free flight (up positive)
  rocket_cutoff: ({ a, t1 }) => {
    const v1 = a * t1;
    const h1 = (a * t1 * t1) / 2;
    const vImp = Math.sqrt(v1 * v1 + 2 * G * h1);
    return [v1, h1, h1 + (v1 * v1) / (2 * G), t1 + (v1 + vImp) / G, vImp];
  },
  // A dropped at t=0, B thrown down dt later, both land together: find v0 of B
  two_stones_different_times: ({ h, dt }) => {
    const tA = Math.sqrt((2 * h) / G);
    const tB = tA - dt;
    const v0 = (h - (G * tB * tB) / 2) / tB;
    return [v0, v0 + G * tB, G * tA];
  },
  // A thrown up from the ground at t=0; B dropped from H at t=dt. Up positive.
  meet_different_start: ({ v0, H, dt }) => {
    const t = (H - (G * dt * dt) / 2) / (v0 - G * dt);
    return [t, v0 * t - (G * t * t) / 2, v0 - G * t, G * (t - dt)];
  },
  bolt_in_elevator: ({ v, hc }) => {
    const t = Math.sqrt((2 * hc) / G);
    return [t, G * t, v * t - (G * t * t) / 2, v - G * t];
  },
  balloon_release: ({ h, v }) => {
    const vImp = Math.sqrt(v * v + 2 * G * h);
    const T = (v + vImp) / G;
    return [h + (v * v) / (2 * G), T, vImp, h + v * T];
  },
  last_k_seconds: ({ d, k }) => {
    const T = (d / (G / 2) + k * k) / (2 * k);
    return [T, (G * T * T) / 2, G * T];
  },
  compare_two_throws: ({ h, v0 }) => {
    const s = Math.sqrt(v0 * v0 + 2 * G * h);
    const tA = (v0 + s) / G;
    const tB = (-v0 + s) / G;
    return [tA, tB, tA - tB, s];
  },
  known_pass_speed: ({ h, v1 }) => {
    const v0 = Math.sqrt(v1 * v1 + 2 * G * h);
    return [v0, (v0 * v0) / (2 * G), (2 * v0) / G, (2 * v1) / G];
  },
  vt_vertical_graph: ({ v0, vEnd, T }) => {
    const a = (vEnd - v0) / T;
    return [a, v0 / -a, (v0 * v0) / (2 * -a), (-T * (v0 + vEnd)) / 2];
  },
  vt_elevator_graph: ({ t1, v, t2, t3 }) => {
    const H = v * (t1 / 2 + t2 + t3 / 2);
    return [v / t1, -v / t3, H, H / (t1 + t2 + t3)];
  },
  window_pass: ({ w, dt }) => {
    const vt = (w - (G * dt * dt) / 2) / dt;
    return [vt, (vt * vt) / (2 * G), vt + G * dt];
  },
  parachute_fall: ({ t1, a, vland }) => {
    const v1 = G * t1;
    const d1 = (G * t1 * t1) / 2;
    const d2 = (v1 * v1 - vland * vland) / (2 * a);
    return [d1, d2, d1 + d2, t1 + (v1 - vland) / a];
  },

  // ---- multi-step horizontal / 2D models
  three_stage_trip: ({ a1, v, tc, a3 }) => {
    const D = (v * v) / (2 * a1) + v * tc + (v * v) / (2 * a3);
    const T = v / a1 + tc + v / a3;
    return [(v * v) / (2 * a3), D, T, D / T];
  },
  vt_graph_car: ({ t1, v, t2, t3 }) => {
    const D = v * (t1 / 2 + t2 + t3 / 2);
    return [v / t1, -v / t3, D, D / (t1 + t2 + t3)];
  },
  // vehicle passes a stationary police car (constant v); police start after tr with acceleration a
  chase_reaction: ({ v, a, tr }) => {
    const s = (v + Math.sqrt(v * v + 2 * a * v * tr)) / a;
    return [s, s + tr, v * (s + tr), a * s];
  },
  braking_ratio: ({ v1, d1, v2 }) => {
    const a = (v1 * v1) / (2 * d1);
    return [a, (v2 * v2) / (2 * a), v2 / a];
  },
  // sin 37 = 0.6, cos 37 = 0.8
  projectile_37: ({ v0 }) => {
    const vx = 0.8 * v0;
    const vy = 0.6 * v0;
    const T = (2 * vy) / G;
    return [T, vx * T, (vy * vy) / (2 * G)];
  },
  // sin 53 = 0.8, cos 53 = 0.6, thrown upward from a cliff of height h
  projectile_cliff_53: ({ v0, h }) => {
    const vx = 0.6 * v0;
    const vy = 0.8 * v0;
    const vyEnd = Math.sqrt(vy * vy + 2 * G * h);
    const T = (vy + vyEnd) / G;
    return [T, vx * T, Math.hypot(vx, vyEnd), h + (vy * vy) / (2 * G)];
  },
  // sin 45 = cos 45 = 1/sqrt2: R = v0^2/g, H = v0^2/(4g), y(x) = x - g x^2 / v0^2
  projectile_45: ({ v0, x }) => [(v0 * v0) / G, (v0 * v0) / (4 * G), x - (G * x * x) / (v0 * v0)],
  // sin^2 60 = 0.75, cos 60 = 0.5
  projectile_60: ({ v0, v1 }) => {
    const vx = v0 / 2;
    const vy2 = v1 * v1 - vx * vx;
    return [vx, (0.75 * v0 * v0) / (2 * G), (0.75 * v0 * v0 - vy2) / (2 * G)];
  },
  // thrown 30 degrees below horizontal from a tower: vy0 = v0 / 2
  projectile_30_down: ({ v0, h }) => {
    const vy0 = v0 / 2;
    const vyEnd = Math.sqrt(vy0 * vy0 + 2 * G * h);
    return [vy0, (vyEnd - vy0) / G, vyEnd];
  },
  moving_target: ({ h, d0, u }) => {
    const t = Math.sqrt((2 * h) / G);
    const vx = (d0 + u * t) / t;
    return [t, vx, Math.hypot(vx, G * t)];
  },
  plane_drop: ({ h, vp, vs }) => {
    const t = Math.sqrt((2 * h) / G);
    return [t, vp * t, (vp - vs) * t, Math.hypot(vp, G * t)];
  },
  catch_up_accel: ({ a, v }) => [v / a, (v * v) / (2 * a), (2 * v) / a, (2 * v * v) / a],
  braking_obstacle: ({ v, tr, a, D }) => {
    const react = v * tr;
    const brake = D - react;
    const vImp = Math.sqrt(v * v - 2 * a * brake);
    return [react, brake, vImp, tr + (v - vImp) / a];
  },
  table_roll: ({ v0, a, L, h }) => {
    const ve = Math.sqrt(v0 * v0 - 2 * a * L);
    const tf = Math.sqrt((2 * h) / G);
    return [ve, (v0 - ve) / a + tf, ve * tf, Math.hypot(ve, G * tf)];
  },
};

const COMPLEX = /מרוכב|דמיוני|שורש\s+של\s+מינוס|√\s*\(?\s*[-−–]|imaginary|complex/i;
const HEBREW =/[֐-׿]/;
// Owner rule: every answer is a real integer or a finite decimal with at most 2 decimals.
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;
// Latin unit labels (m, s, m/s, m/s², km/h ...) directly after a number or in a unit field.
const LATIN_UNIT = /(\d|^)\s*(km\/h|m\/s²?|m\/s\^2|km|m|s)(?![\p{L}\d])/iu;
const stripTags = (s) => String(s).replace(/<[^>]*>/g, ' ');
// Stated values in a tip: standalone numbers; digits glued to letters (v0, 2gh, 5t) are coefficients/subscripts.
const numbersIn = (s) =>
  (String(s).replace(/<[^>]*>/g, '').match(/(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\p{L}\d])/gu) || []).map(Number);
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
  // No tip may reveal a requested answer.
  if (Array.isArray(ex.tips)) {
    ex.tips.forEach((tip, i) => {
      if (typeof tip !== 'string') return;
      const nums = numbersIn(tip);
      for (const inp of ex.inputs) {
        if (nums.includes(Math.abs(Number(inp.answer)))) err(`tip ${i + 1} contains the requested answer ${inp.answer} ("${inp.label}")`);
      }
    });
  }
  // Owner rule: no complex numbers anywhere.
  for (const [field, text] of [['title', ex.title], ['statement', ex.statement], ...(ex.tips || []).map((t, i) => [`tip ${i + 1}`, t]), ...(ex.solution || []).map((s, i) => [`solution step ${i + 1}`, s])]) {
    if (COMPLEX.test(stripTags(text))) err(`${field}: complex-number wording`);
  }
  // Diagram: inline SVG generated by tools/diagrams.mjs
  if (typeof ex.diagram !== 'string' || !ex.diagram) err('diagram missing');
  else validateSvg(ex.diagram).forEach((m) => err(`diagram: ${m}`));
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
