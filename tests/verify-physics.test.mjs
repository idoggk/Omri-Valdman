import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { models, checkExercise, checkAll, checkGuided } from '../tools/verify-physics.mjs';

const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  expected.forEach((e, i) => assert.ok(Math.abs(actual[i] - e) < 1e-9, `#${i}: ${actual[i]} != ${e}`));
};

test('free fall models', () => {
  close(models.free_fall_from_height({ h: 80 }), [4, 40]);
  close(models.free_fall_for_time({ t: 5 }), [125, 50]);
  close(models.distance_in_nth_second({ n: 3 }), [20, 25]);
  close(models.last_second_distance({ d: 35 }), [4, 80]);
  close(models.free_fall_ratio({ tA: 2, k: 4 }), [4, 40]);
});

test('vertical throw models', () => {
  close(models.vertical_throw_up({ v0: 20 }), [2, 20, 4]);
  close(models.vertical_throw_by_flight_time({ T: 6 }), [30, 45]);
  close(models.vertical_throw_down_from_height({ h: 75, v0: 10 }), [3, 40]);
  close(models.vertical_throw_from_height({ h: 25, v0: 20 }), [5, 30, 45]);
  close(models.two_body_meet_vertical({ H: 100, v0: 25 }), [4, 20]);
  close(models.vertical_height_times({ v0: 30, h: 40 }), [2, 4, 10]);
  close(models.speed_at_height({ v0: 20, h: 15 }), [10, 5]);
  assert.throws(() => models.vertical_height_times({ v0: 10, h: 100 }));
});

test('horizontal models', () => {
  close(models.const_velocity_meet({ d: 1000, v1: 20, v2: 30 }), [20, 400]);
  close(models.const_velocity_overtake({ gap: 200, v_fast: 25, v_slow: 15 }), [20, 500]);
  close(models.head_start_catch({ v_slow: 4, v_fast: 10, t0: 30 }), [20, 200]);
  close(models.const_accel_from_rest({ a: 2, t: 10 }), [20, 100]);
  close(models.accel_with_initial_speed_dist({ v0: 10, a: 2, x: 96 }), [22, 6]);
  close(models.accel_from_speeds_time({ v0: 20, v: 30, t: 5 }), [2, 125]);
  close(models.braking_only({ v: 30, a: 5 }), [6, 90]);
  close(models.braking_with_reaction({ v: 20, a: 5, tr: 1.5 }), [30, 40, 70]);
  close(models.accel_then_cruise({ a: 2, vmax: 20, D: 600 }), [10, 100, 35]);
  close(models.horizontal_launch({ h: 0.8, vx: 3 }), [0.4, 1.2, 5]);
  close(models.horizontal_launch_from_range({ h: 7.2, R: 6 }), [1.2, 5, 13]);
});

const sample = () => JSON.parse(JSON.stringify(JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'))[0]));

test('shipped data is valid: 94 exercises (70 level 3 + 12 level 1 + 12 level 2), 46 vertical + 48 horizontal', () => {
  const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkAll(list), []);
  assert.equal(list.length, 94);
  assert.equal(list.filter((e) => e.topic === 'phys-vertical').length, 46);
  assert.equal(list.filter((e) => e.topic === 'phys-horizontal').length, 48);
  for (const t of ['phys-vertical', 'phys-horizontal']) for (const lvl of [1, 2]) assert.equal(list.filter((e) => e.topic === t && e.level === lvl).length, 6, t + lvl);
  const lv = (n) => list.filter((e) => e.level === n).length;
  assert.equal(lv(3), 70);
  assert.ok(lv(3) > lv(1) + lv(2), 'level 3 must be the majority');
  for (const e of list) assert.ok(e.diagram.startsWith('<svg'), e.id);
});

test('multi-step vertical models', () => {
  close(models.rocket_cutoff({ a: 8, t1: 5 }), [40, 100, 180, 15, 60]);
  close(models.two_stones_different_times({ h: 80, dt: 2 }), [30, 50, 40]);
  close(models.meet_different_start({ v0: 30, H: 105, dt: 1 }), [5, 25, -20, 40]);
  close(models.bolt_in_elevator({ v: 4, hc: 1.8 }), [0.6, 6, 0.6, -2]);
  close(models.balloon_release({ h: 75, v: 10 }), [80, 5, 40, 125]);
  close(models.last_k_seconds({ d: 100, k: 2 }), [6, 180, 60]);
  close(models.compare_two_throws({ h: 60, v0: 20 }), [6, 2, 4, 40]);
  close(models.known_pass_speed({ h: 40, v1: 10 }), [30, 45, 6, 2]);
  close(models.vt_vertical_graph({ v0: 20, vEnd: -30, T: 5 }), [-10, 2, 20, 25]);
  close(models.vt_elevator_graph({ t1: 3, v: 6, t2: 10, t3: 2 }), [2, -3, 75, 5]);
  close(models.window_pass({ w: 15, dt: 1 }), [10, 5, 20]);
  close(models.parachute_fall({ t1: 5, a: 5, vland: 5 }), [125, 247.5, 372.5, 14]);
});

test('multi-step horizontal and 2D models', () => {
  close(models.three_stage_trip({ a1: 2, v: 20, tc: 36, a3: 5 }), [40, 860, 50, 17.2]);
  close(models.vt_graph_car({ t1: 5, v: 10, t2: 3, t3: 4 }), [2, -2.5, 75, 6.25]);
  close(models.chase_reaction({ v: 12, a: 1.5, tr: 5 }), [20, 25, 300, 30]);
  close(models.braking_ratio({ v1: 20, d1: 40, v2: 30 }), [5, 90, 6]);
  close(models.projectile_37({ v0: 50 }), [6, 240, 45]);
  close(models.projectile_cliff_53({ v0: 25, h: 44.8 }), [5.6, 84, 39, 64.8]);
  close(models.projectile_45({ v0: 30, x: 30 }), [90, 22.5, 20]);
  close(models.projectile_60({ v0: 20, v1: 15 }), [10, 15, 8.75]);
  close(models.projectile_30_down({ v0: 20, h: 75 }), [10, 3, 40]);
  close(models.moving_target({ h: 45, d0: 102, u: 6 }), [3, 40, 50]);
  close(models.plane_drop({ h: 180, vp: 80, vs: 30 }), [6, 480, 300, 100]);
  close(models.catch_up_accel({ a: 3, v: 15 }), [5, 37.5, 10, 150]);
  close(models.braking_obstacle({ v: 20, tr: 0.5, a: 5, D: 47.5 }), [10, 37.5, 5, 3.5]);
  close(models.table_roll({ v0: 5, a: 2, L: 4, h: 0.8 }), [3, 1.4, 1.2, 5]);
});

test('checker rejects a missing or unsafe diagram, a leaking early tip, and complex wording', () => {
  const noDiagram = sample();
  delete noDiagram.diagram;
  assert.match(checkExercise(noDiagram).join('\n'), /diagram missing/);
  const unsafe = sample();
  unsafe.diagram = unsafe.diagram.replace('</svg>', '<script>alert(1)</script></svg>');
  assert.match(checkExercise(unsafe).join('\n'), /diagram: contains forbidden/);
  const leak = sample();
  leak.tips[0] = `התשובה היא ${leak.inputs[1].answer}`;
  assert.match(checkExercise(leak).join('\n'), /tip 1 contains the requested answer/);
  const cx = sample();
  cx.solution[1] += ' ונקבל מספר מרוכב';
  assert.match(checkExercise(cx).join('\n'), /complex-number wording/);
});

test('numbers glued to letters in a tip (v0, 2gh) are not treated as stated answers', () => {
  const ex = sample();
  ex.tips[1] = 'השתמשו ב-v0 וב-2gh ובמקדם 5t';
  assert.ok(!checkExercise(ex).some((e) => e.includes('tip 2 contains')));
});

test('checker rejects a wrong answer', () => {
  const ex = sample();
  ex.inputs[0].answer = String(Number(ex.inputs[0].answer) + 1);
  ex.inputs[0].tolerance = 0.05;
  assert.ok(checkExercise(ex).some((e) => e.includes('differs from recomputed')));
});

test('checker rejects bad structure', () => {
  const ex = sample();
  ex.tips.pop();
  ex.solution = ex.solution.slice(0, 2);
  ex.inputs[1].unit = '';
  ex.inputs[1].tolerance = 5;
  const errs = checkExercise(ex).join('\n');
  assert.match(errs, /tips must have exactly 3/);
  assert.match(errs, /at least 3 steps/);
  assert.match(errs, /unit missing/);
  assert.match(errs, /exceeds 2%/);
});

test('checker rejects leaking tip, Latin units, and >2 decimals', () => {
  const ex = sample();
  ex.tips[2] = `התשובה היא ${ex.inputs[0].answer}`;
  ex.unit = 'm/s';
  ex.inputs[1].unit = 'm/s';
  ex.statement += ' במהירות 20 m/s';
  ex.inputs[0].answer = '4.123';
  const errs = checkExercise(ex).join('\n');
  assert.match(errs, /Hebrew unit/);
  assert.match(errs, /Latin unit/);
  assert.match(errs, /plain decimal/);
  const leak = sample();
  leak.tips[2] = `התשובה היא ${leak.inputs[0].answer}`;
  assert.match(checkExercise(leak).join('\n'), /tip 3 contains the requested answer/);
});

test('every shipped answer has at most 2 decimals', () => {
  const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  for (const ex of list) for (const i of ex.inputs) assert.match(i.answer, /^-?\d+(\.\d{1,2})?$/);
});

test('checker rejects duplicate ids and unknown models', () => {
  const a = sample();
  const b = sample();
  assert.ok(checkAll([a, b]).some((e) => e.includes('duplicate id')));
  b.id = 'phys-vertical-099';
  b.verify.model = 'nope';
  assert.ok(checkAll([a, b]).some((e) => e.includes('unknown model')));
});

test('exam-level vertical models', () => {
  close(models.elevator_throw_relative({ u: 5, w: 10, h: 20 }), [2, 31.25, 4, 25]);
  close(models.overtake_fall({ d: 45, dt: 1 }), [5, 3, 12.5, 32.5]);
  close(models.vt_free_fall_graph({ t1: 4, t2: 8, vland: 8, t3: 10, vq: 20 }), [8, 6.5, 192, 19.2]);
  close(models.balloon_two_packages({ h: 40, u: 10, dt: 2, w: 15 }), [4, 3, 1, 90]);
  close(models.same_throw_delay({ v0: 40, y: 75 }), [3, 5, 2, 10]);
  close(models.well_sound({ T: 4.2, c: 400 }), [4, 80, 0.2, 40]);
  close(models.two_stage_rocket({ a1: 5, t1: 3, a2: 3, t2: 5 }), [30, 135, 180, 17]);
  close(models.diver_plunge({ h: 10, v0: 5, d: 4.5 }), [11.25, 15, 25, 2.6]);
  close(models.meet_at_apex({ H: 120, w: 10 }), [3, 30, 45, 40]);
  close(models.tower_last_second({ v0: 10, d: 35 }), [40, 5, 75, 80]);
});

test('exam-level horizontal models', () => {
  close(models.projectile_wall({ vx: 16, vy: 18, x: 48 }), [3, 9, 20, 0.75]);
  close(models.platform_landing_53({ v0: 25, hp: 15 }), [1, 3, 45, 10]);
  close(models.two_car_graph({ vA: 15, vB: 25, tB: 10 }), [2.5, 6, 45, 12.5]);
  close(models.train_accel_platform({ v0: 10, t1: 8, t2: 18, P: 230 }), [1, 112, 28, 19]);
  close(models.overtake_oncoming_stop({ vc: 25, vt: 15, g1: 8, Lt: 16, Lc: 4, g2: 12, vo: 20, ao: 6.25 }), [4, 100, 32, 132]);
  close(models.dog_between_walkers({ d: 120, vA: 3, vB: 5, vd: 15 }), [15, 6, 10, 225]);
  close(models.rear_end({ v: 25, a1: 6, a2: 4, tr: 1, g: 30 }), [4, 1, 13, 12]);
  close(models.river_two_ways({ vb: 5, vc: 3, w: 120 }), [24, 72, 30, 0.75]);
  close(models.cliff_moving_boat({ H: 60, vy: 20, D: 156, u: 4 }), [6, 30, 50, 80]);
  close(models.double_catch({ v: 30, a: 2, d0: 125 }), [5, 25, 50, 100]);
  assert.throws(() => models.double_catch({ v: 10, a: 2, d0: 125 }));
  assert.throws(() => models.rear_end({ v: 25, a1: 6, a2: 4, tr: 1, g: 500 }));
});

test('shipped data: 70 exercises, 20 exam-level ones among the level-3 exercises with 5+ solution steps and 4 or fewer inputs', () => {
  const all = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  const list = all.filter((e) => e.level === 3);
  assert.equal(list.length, 70);
  const fresh = list.filter((e) => /^phys-vertical-0(2[5-9]|3\d)$|^phys-horizontal-0(2[7-9]|3\d)$/.test(e.id));
  assert.equal(fresh.length, 20);
  for (const e of fresh) {
    assert.ok(e.solution.length >= 5, `${e.id} needs 5+ solution steps`);
    assert.ok(e.inputs.length >= 2 && e.inputs.length <= 4, `${e.id} sub-questions`);
  }
  assert.ok(fresh.filter((e) => e.guided).length >= 10, 'at least 10 new exercises are guided');
  const old3 = list.filter((e) => !fresh.includes(e) && e.level === 3 && e.guided);
  assert.ok(old3.length >= 8, 'at least 8 existing level-3 exercises are guided');
  assert.ok(fresh.filter((e) => /סימלי/.test(e.statement)).length >= 8, 'at least 8 ask for a symbolic setup');
  assert.equal(new Set(all.map((e) => e.id)).size, 94);
});

const guidedSample = () =>
  JSON.parse(JSON.stringify(JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8')).find((e) => e.guided)));

test('guided schema is validated', () => {
  assert.deepEqual(checkGuided(guidedSample().guided), []);
  const bad = (mutate) => {
    const g = guidedSample().guided;
    mutate(g);
    return checkGuided(g);
  };
  assert.match(bad((g) => (g[0].options = ['רק אחת'])).join('\n'), /2-4 items/);
  assert.match(bad((g) => (g[0].options = ['א', 'ב', 'ג', 'ד', 'ה'])).join('\n'), /2-4 items/);
  assert.match(bad((g) => (g[0].correct = 9)).join('\n'), /valid option index/);
  assert.match(bad((g) => (g[1].explain = '  ')).join('\n'), /explain/);
  assert.match(bad((g) => (g[1].wrongExplain = ['אחד'])).join('\n'), /wrongExplain length/);
  assert.match(bad((g) => g.splice(2)).join('\n'), /3-6 steps/);
  assert.match(bad((g) => delete g[0].q).join('\n'), /q missing/);
  assert.deepEqual(bad((g) => delete g[0].wrongExplain), []);
  const ex = JSON.parse(JSON.stringify(JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8')).find((e) => e.guided)));
  ex.guided[0].correct = -1;
  assert.match(checkExercise(ex).join('\n'), /guided: step 1/);
});

test('upgraded vertical models (hand-checked values)', () => {
  close(models.two_drops_same_landing({ H1: 125, H2: 80 }), [5, 4, 1, 40]);
  close(models.free_fall_time_parts({ T: 6 }), [180, 100, 3, 30]);
  close(models.throw_flight_time_levels({ T: 8, hq: 60 }), [40, 80, 20, 4]);
  close(models.nth_second_given({ d: 75 }), [8, 320, 70, 65]);
  close(models.half_speed_height({ h: 60 }), [40, 80, 2, 4]);
  close(models.roof_throw_averages({ h: 25, v0: 20 }), [65, 13, 5, 30]);
  close(models.down_throw_beats_drop({ h: 125, tB: 4, ts: 3 }), [5, 11.25, 51.25, 33.75]);
  close(models.thrown_then_dropped({ h: 75, v0: 10 }), [2, 5, 30, 10]);
  close(models.meet_vertical_after_apex({ H: 100, v0: 25 }), [4, 20, 40, 1.5]);
  close(models.last_second_then_throw({ d: 35, w: 30 }), [4, 80, 2, 50]);
  close(models.drop_height_ratio({ dt: 4, k: 9 }), [20, 2, 60, 160]);
  close(models.vt_roof_throw_graph({ v0: 30, vEnd: -40, T: 7 }), [-10, 45, 35, 125]);
  close(models.vt_elevator_chase({ t1: 3, v: 6, t2: 10, t3: 2, vB: 9, t0: 3 }), [2, 75, 6, 27]);
  assert.throws(() => models.meet_vertical_after_apex({ H: 100, v0: 100 }));
  assert.throws(() => models.vt_elevator_chase({ t1: 3, v: 6, t2: 10, t3: 2, vB: 9, t0: 30 }));
});

test('upgraded horizontal models (hand-checked values)', () => {
  close(models.delayed_meet({ d: 1500, v1: 20, v2: 30, t0: 15 }), [39, 780, 24, 1200]);
  close(models.accel_nth_second({ n: 4, d: 21, m: 8 }), [6, 24, 48, 45]);
  close(models.brake_to_line({ v0: 30, D: 75, x: 48 }), [6, 5, 18, 2]);
  close(models.convoy_overtake({ vf: 25, vs: 15, g: 10, L: 140, mid: 70 }), [15, 375, 225, 8]);
  close(models.head_start_finish({ v_slow: 4, v_fast: 10, t0: 30, D: 500 }), [20, 200, 45, 180]);
  close(models.accel_chase_max_gap({ v0: 10, a: 2, u: 16, d0: 16 }), [3, 25, 8, 26]);
  close(models.train_passes_pole({ v1: 5, v2: 35, L: 150, t: 6 }), [4, 7.5, 25, 282]);
  close(models.table_wall({ h: 1.8, vx: 8, xw: 4 }), [0.6, 4.8, 10, 0.55]);
  close(models.opposite_throws({ h: 45, vA: 9, vB: 16 }), [3, 75, 1.2, 30]);
  close(models.max_safe_speed({ D: 60, a: 5, tr: 1, v2: 15 }), [20, 40, 5, 2.5]);
  close(models.race_accel_cruise({ a: 2, vmax: 20, D: 600, u: 16 }), [35, 25, 37.5, 40]);
  close(models.roof_landing_range({ H: 45, h2: 25, x1: 12, x2: 30 }), [2, 6, 15, 25]);
  close(models.vt_reverse_graph({ t1: 4, v: 12, t2: 2, t3: 6, w: 6 }), [-3, 72, 66, 6.5]);
  close(models.dry_wet_braking({ v: 20, tr: 0.5, a1: 8, a2: 5, D: 40 }), [35, 50, 10, 2.5]);
  close(models.kick_37_wall({ v0: 50, xw: 80, yq: 25 }), [6, 240, 40, 4]);
  close(models.projectile_45_levels({ R: 160, yq: 38.4, xq: 100 }), [40, 64, 32, 37.5]);
  close(models.projectile_down_37({ v0: 50, h: 236.25, xq: 80 }), [4.5, 180, 85, 156.25]);
  assert.throws(() => models.race_accel_cruise({ a: 2, vmax: 20, D: 600, u: 18 }));
});

test('difficulty after the upgrade: at least 70% level-3, 5+ steps and 3-4 parts for every upgraded exercise, 20+ guided', () => {
  const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  assert.ok(list.filter((e) => e.level === 3).length >= 0.7 * list.length);
  assert.ok(list.filter((e) => e.guided).length >= 20);
  const upgraded = list.filter((e) => /^phys-vertical-0(0\d|10|12|2[12])$|^phys-horizontal-0(0\d|1[0-2]|14|16|17|19|21)$/.test(e.id));
  assert.equal(upgraded.length, 30);
  for (const e of upgraded) {
    assert.equal(e.level, 3, e.id);
    assert.ok(e.inputs.length >= 3 && e.inputs.length <= 4, `${e.id} sub-questions`);
    assert.ok(e.solution.length >= 5, `${e.id} solution steps`);
    assert.ok(e.statement.length > 220, `${e.id} is not a one-liner`);
  }
});

test('level 1 and 2 exercises: 6 per topic and level, L1 has one unknown, half or more guided, new models are right', () => {
  const list = JSON.parse(readFileSync(new URL('../data/physics.json', import.meta.url), 'utf8'));
  for (const e of list.filter((x) => x.level === 1)) assert.equal(e.inputs.length, 1, e.id);
  for (const e of list.filter((x) => x.level === 2)) assert.ok(e.inputs.length >= 2 && e.inputs.length <= 3, e.id);
  const easy = list.filter((x) => x.level < 3);
  assert.equal(easy.length, 24);
  assert.ok(easy.filter((x) => x.guided).length >= 12);
  close(models.l1_ff_time({ h: 45 }), [3]);
  close(models.l1_ff_speed_h({ h: 80 }), [40]);
  close(models.l1_launch_range({ h: 45, vx: 8 }), [24]);
  close(models.l1_launch_vx({ h: 80, R: 48 }), [12]);
  close(models.l1_brake_dist({ v: 20, a: 5 }), [40]);
  close(models.l1_meet_time({ d: 240, v1: 14, v2: 10 }), [10]);
});
