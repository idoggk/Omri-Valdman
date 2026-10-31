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

  // ---- level-1 models: one formula, one unknown
  l1_ff_time: ({ h }) => [Math.sqrt((2 * h) / G)],
  l1_ff_speed_t: ({ t }) => [G * t],
  l1_ff_height_t: ({ t }) => [(G * t * t) / 2],
  l1_ff_speed_h: ({ h }) => [Math.sqrt(2 * G * h)],
  l1_up_time: ({ v0 }) => [v0 / G],
  l1_up_height: ({ v0 }) => [(v0 * v0) / (2 * G)],
  l1_launch_time: ({ h }) => [Math.sqrt((2 * h) / G)],
  l1_launch_range: ({ h, vx }) => [vx * Math.sqrt((2 * h) / G)],
  l1_launch_vx: ({ h, R }) => [R / Math.sqrt((2 * h) / G)],
  l1_accel_speed: ({ a, t }) => [a * t],
  l1_brake_dist: ({ v, a }) => [(v * v) / (2 * a)],
  l1_meet_time: ({ d, v1, v2 }) => [d / (v1 + v2)],

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

  // ---- exam-level vertical models
  // ball thrown up with w relative to an elevator rising at u from height h; ground frame afterwards
  elevator_throw_relative: ({ u, w, h }) => {
    const v0 = u + w;
    const vImp = Math.sqrt(v0 * v0 + 2 * G * h);
    return [(2 * w) / G, h + (v0 * v0) / (2 * G), (v0 + vImp) / G, vImp];
  },
  // A dropped at t=0; B thrown down with v0 at t=dt; B catches A at depth d
  overtake_fall: ({ d, dt }) => {
    const t = Math.sqrt((2 * d) / G);
    const tau = t - dt;
    const v0 = (d - (G * tau * tau) / 2) / tau;
    return [(G * dt * dt) / 2, t, v0, v0 + G * tau];
  },
  // free fall to t1, linear slow-down to vland at t2, constant speed to t3; vq = a speed asked about
  vt_free_fall_graph: ({ t1, t2, vland, t3, vq }) => {
    const v1 = G * t1;
    const a = (v1 - vland) / (t2 - t1);
    const H = (G * t1 * t1) / 2 + ((v1 + vland) / 2) * (t2 - t1) + vland * (t3 - t2);
    return [a, t1 + (v1 - vq) / a, H, H / t3];
  },
  // two packages from a balloon rising at u: A dropped at h, B thrown down w (relative) dt later
  balloon_two_packages: ({ h, u, dt, w }) => {
    const fall = (v, y) => (v + Math.sqrt(v * v + 2 * G * y)) / G;
    const tA = fall(u, h);
    const yb = h + u * dt;
    const tB = fall(u - w, yb);
    return [tA, tB, dt + tB - tA, yb + u * tB];
  },
  // two balls from the ground with the same v0; A descending meets B ascending at height y
  same_throw_delay: ({ v0, y }) => {
    const s = Math.sqrt(v0 * v0 - 2 * G * y);
    const t1 = (v0 - s) / G;
    const t2 = (v0 + s) / G;
    return [t1, t2, t2 - t1, s];
  },
  // stone dropped into a well, splash heard after T; sound speed c
  well_sound: ({ T, c }) => {
    const t = (c / G) * (Math.sqrt(1 + (2 * G * T) / c) - 1);
    const h = (G * t * t) / 2;
    return [t, h, h / c, G * t];
  },
  two_stage_rocket: ({ a1, t1, a2, t2 }) => {
    const v1 = a1 * t1;
    const h1 = (a1 * t1 * t1) / 2;
    const v2 = v1 + a2 * t2;
    const h2 = h1 + v1 * t2 + (a2 * t2 * t2) / 2;
    const H = h2 + (v2 * v2) / (2 * G);
    return [v2, h2, H, t1 + t2 + v2 / G + Math.sqrt((2 * H) / G)];
  },
  // jump up v0 from height h above water, stop after depth d (uniform slow-down)
  diver_plunge: ({ h, v0, d }) => {
    const v = Math.sqrt(v0 * v0 + 2 * G * h);
    const a = (v * v) / (2 * d);
    return [h + (v0 * v0) / (2 * G), v, a, (v0 + v) / G + v / a];
  },
  // A thrown down w from height H; B thrown up from the ground; they meet when B is at its apex
  meet_at_apex: ({ H, w }) => {
    const t = (-w + Math.sqrt(w * w + 4 * G * H)) / (2 * G);
    return [t, G * t, (G * t * t) / 2, w + G * t];
  },
  // thrown up v0 from a tower; d metres in the last second
  tower_last_second: ({ v0, d }) => {
    const vf = d + G / 2;
    const h = (vf * vf - v0 * v0) / (2 * G);
    return [vf, (v0 + vf) / G, h, h + (v0 * v0) / (2 * G)];
  },

  // ---- exam-level horizontal / 2D models
  projectile_wall: ({ vx, vy, x }) => {
    const t = x / vx;
    const vyEnd = vy - G * t;
    return [t, vy * t - (G * t * t) / 2, Math.hypot(vx, vyEnd), Math.abs(vyEnd) / vx];
  },
  // sin 53 = 0.8, cos 53 = 0.6, ball lands on a roof of height hp after the apex
  platform_landing_53: ({ v0, hp }) => {
    const vx = 0.6 * v0;
    const vy = 0.8 * v0;
    const s = Math.sqrt(vy * vy - 2 * G * hp);
    const t2 = (vy + s) / G;
    return [(vy - s) / G, t2, vx * t2, s];
  },
  // car A: constant vA; car B from rest, accelerates to vB at tB, then constant. Same start point.
  two_car_graph: ({ vA, vB, tB }) => {
    const a = vB / tB;
    const tc = (vB * tB) / (2 * (vB - vA));
    if (tc < tB) throw new Error('B must catch A after its acceleration phase');
    return [a, vA / a, (vA * vA) / (2 * a), tc];
  },
  // train front passes the pole (at the platform start) at v0, uniform acceleration; tail passes pole at t1, leaves platform at t2
  train_accel_platform: ({ v0, t1, t2, P }) => {
    const a = (2 * (P - v0 * (t2 - t1))) / (t2 * t2 - t1 * t1);
    const L = v0 * t1 + (a * t1 * t1) / 2;
    return [a, L, v0 + a * t2, (L + P) / t2];
  },
  overtake_oncoming_stop: ({ vc, vt, g1, Lt, Lc, g2, vo, ao }) => {
    const t = (g1 + Lt + Lc + g2) / (vc - vt);
    const stopT = vo / ao;
    const dOn = t >= stopT ? (vo * vo) / (2 * ao) : vo * t - (ao * t * t) / 2;
    return [t, vc * t, dOn, vc * t + dOn];
  },
  // walkers A and B approach from distance d; dog starts at A, runs to B, back to A, ...
  dog_between_walkers: ({ d, vA, vB, vd }) => {
    const tm = d / (vA + vB);
    const t1 = d / (vd + vB);
    const t2 = t1 + (vd * t1 - vA * t1) / (vd + vA);
    return [tm, t1, t2, vd * tm];
  },
  // lead car A (front) brakes at once; B follows at gap g, reacts after tr, brakes at a2 < a1 (both at speed v)
  rear_end: ({ v, a1, a2, tr, g }) => {
    const A = (a2 - a1) / 2;
    const B = -a2 * tr;
    const C = (a2 * tr * tr) / 2 + g;
    const disc = B * B - 4 * A * C;
    if (disc < 0) throw new Error('no collision');
    const roots = [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].filter((t) => t > tr).sort((p, q) => p - q);
    const t = roots[0];
    if (t === undefined || t > v / a1 || t - tr > v / a2) throw new Error('collision outside the common braking phase');
    const vA = v - a1 * t;
    const vB = v - a2 * (t - tr);
    return [t, vA, vB, vB - vA];
  },
  river_two_ways: ({ vb, vc, w }) => {
    const root = Math.sqrt(vb * vb - vc * vc);
    return [w / vb, (vc * w) / vb, w / root, vc / root];
  },
  // stone thrown up (vy) with horizontal speed from a cliff of height H at a boat starting D away, receding at u
  cliff_moving_boat: ({ H, vy, D, u }) => {
    const t = (vy + Math.sqrt(vy * vy + 2 * G * H)) / G;
    const vx = (D + u * t) / t;
    return [t, vx, Math.hypot(vx, vy - G * t), H + (vy * vy) / (2 * G)];
  },
  // car B (constant v) is d0 behind car A which starts from rest with acceleration a
  double_catch: ({ v, a, d0 }) => {
    const disc = v * v - 2 * a * d0;
    if (disc < 0) throw new Error('B never reaches A');
    const s = Math.sqrt(disc);
    return [(v - s) / a, (v + s) / a, a * ((v + s) / a), (v * v) / (2 * a) - d0];
  },

  // ---- upgraded (multi-part) vertical models
  // A dropped from H1, B dropped later from H2 < H1 so both land together: fall times, delay, gap at B's release
  two_drops_same_landing: ({ H1, H2 }) => {
    const tA = Math.sqrt((2 * H1) / G);
    const tB = Math.sqrt((2 * H2) / G);
    const dt = tA - tB;
    return [tA, tB, dt, H1 - (G * dt * dt) / 2 - H2];
  },
  // free fall for T: height, last 2 s, time of the lower three quarters (the top quarter takes T/2), mean speed
  free_fall_time_parts: ({ T }) => {
    const H = (G * T * T) / 2;
    return [H, H - (G * (T - 2) ** 2) / 2, T - T / 2, H / T];
  },
  // thrown up from the ground, in the air T: launch speed, apex, speed at height hq, time spent above hq
  throw_flight_time_levels: ({ T, hq }) => {
    const v0 = (G * T) / 2;
    const s = Math.sqrt(v0 * v0 - 2 * G * hq);
    return [v0, (v0 * v0) / (2 * G), s, (2 * s) / G];
  },
  // dropped from rest; d metres in some whole second n: find n, the height fallen by its end, speed at its start, previous second
  nth_second_given: ({ d }) => {
    const n = (d / (G / 2) + 1) / 2;
    return [n, (G * n * n) / 2, G * (n - 1), d - G];
  },
  // thrown up from the ground; at height h the speed is half the launch speed
  half_speed_height: ({ h }) => {
    const v0 = Math.sqrt((8 * G * h) / 3);
    return [v0, (v0 * v0) / (2 * G), v0 / (2 * G), v0 / G];
  },
  // thrown up from a roof of height h: path length, mean speed, mean velocity (magnitude), impact speed
  roof_throw_averages: ({ h, v0 }) => {
    const s = Math.sqrt(v0 * v0 + 2 * G * h);
    const T = (v0 + s) / G;
    const path = (v0 * v0) / (2 * G) + (s * s) / (2 * G);
    return [path, path / T, h / T, s];
  },
  // A dropped from h; B thrown down so that it lands tB after release; gap between them ts after release
  down_throw_beats_drop: ({ h, tB, ts }) => {
    const v0 = (h - (G * tB * tB) / 2) / tB;
    return [Math.sqrt((2 * h) / G), v0, v0 + G * tB, v0 * ts];
  },
  // thrown up from a roof; a second stone is dropped from the roof when the first is back at roof level
  thrown_then_dropped: ({ h, v0 }) => {
    const s = Math.sqrt(v0 * v0 + 2 * G * h);
    const t1 = (2 * v0) / G;
    const tL = (v0 + s) / G;
    const tau = tL - t1;
    return [t1, tL, h - (G * tau * tau) / 2, s - G * tau];
  },
  // A dropped from H, B thrown up from the ground below at v0 at the same moment: meeting time, height, speed of A, time since B's apex
  meet_vertical_after_apex: ({ H, v0 }) => {
    const t = H / v0;
    if (t <= v0 / G) throw new Error('B must already be descending at the meeting');
    return [t, H - (G * t * t) / 2, G * t, t - v0 / G];
  },
  // A dropped from rest, last second 35 m; B thrown down w from the same point: A's time, height, B's time (real root), B's impact speed
  last_second_then_throw: ({ d, w }) => {
    const T = (d + G / 2) / G;
    const H = (G * T * T) / 2;
    const s = Math.sqrt(w * w + 2 * G * H);
    return [T, H, (s - w) / G, s];
  },
  // A dropped from h, B dropped from k*h; landing times differ by dt
  drop_height_ratio: ({ dt, k }) => {
    const r = Math.sqrt(k);
    const tA = dt / (r - 1);
    const h = (G * tA * tA) / 2;
    return [h, tA, G * r * tA, k * h - h];
  },
  // v-t graph of a stone thrown from a roof: (0, v0) to (T, vEnd): slope, apex above the roof, roof height, path length
  vt_roof_throw_graph: ({ v0, vEnd, T }) => {
    const a = (vEnd - v0) / T;
    const tz = v0 / -a;
    const up = (v0 * tz) / 2;
    const down = (-vEnd * (T - tz)) / 2;
    return [a, up, down - up, up + down];
  },
  // elevator v-t trapezoid plus a second elevator started t0 later at constant vB from the same floor
  vt_elevator_chase: ({ t1, v, t2, t3, vB, t0 }) => {
    const H = v * (t1 / 2 + t2 + t3 / 2);
    const tc = (vB * t0 - (v * t1) / 2) / (vB - v);
    if (tc < t1 || tc > t1 + t2) throw new Error('the catch must happen in the constant-speed phase');
    return [v / t1, H, tc, vB * (tc - t0)];
  },

  // ---- upgraded (multi-part) horizontal / 2D models
  // car A leaves at 0, car B leaves t0 later from the other town: meeting time, A's distance, B's travel time, gap when B leaves
  delayed_meet: ({ d, v1, v2, t0 }) => {
    const t = (d + v2 * t0) / (v1 + v2);
    return [t, v1 * t, t - t0, d - v1 * t0];
  },
  // from rest with constant a; d metres in the n-th second: a, speed at end of n s, distance in n s, distance in the m-th second
  accel_nth_second: ({ n, d, m }) => {
    const a = (2 * d) / (2 * n - 1);
    return [a, a * n, (a * n * n) / 2, (a * (2 * m - 1)) / 2];
  },
  // brake from v0 and stop exactly after D: deceleration, stopping time, speed after x metres, time to reach x
  brake_to_line: ({ v0, D, x }) => {
    const a = (v0 * v0) / (2 * D);
    const v = Math.sqrt(v0 * v0 - 2 * a * x);
    return [a, v0 / a, v, (v0 - v) / a];
  },
  // fast vehicle starts g behind a convoy of length L: time to clear it, its distance, convoy distance, time to reach the convoy's middle
  convoy_overtake: ({ vf, vs, g, L, mid }) => {
    const t = (g + L) / (vf - vs);
    return [t, vf * t, vs * t, (g + mid) / (vf - vs)];
  },
  // slow runner leaves at 0, fast rider t0 later; finish line at D: catch time (after rider's start), catch point, finish-time margin, gap at rider's finish
  head_start_finish: ({ v_slow, v_fast, t0, D }) => {
    const t = (v_slow * t0) / (v_fast - v_slow);
    const rider = t0 + D / v_fast;
    return [t, v_fast * t, D / v_slow - rider, D - v_slow * rider];
  },
  // bike starts at v0 with acceleration a, car ahead by d0 at constant u > v0: time and size of max gap, catch time, bike speed at the catch
  accel_chase_max_gap: ({ v0, a, u, d0 }) => {
    const tm = (u - v0) / a;
    const gap = d0 + (u - v0) * tm - (a * tm * tm) / 2;
    const t = (u - v0 + Math.sqrt((u - v0) ** 2 + 2 * a * d0)) / a;
    return [tm, gap, t, v0 + a * t];
  },
  // train of length L accelerating uniformly: front passes a pole at v1, rear at v2
  train_passes_pole: ({ v1, v2, L, t }) => {
    const a = (v2 * v2 - v1 * v1) / (2 * L);
    return [a, (v2 - v1) / a, Math.sqrt((v1 * v1 + v2 * v2) / 2), v2 * t + (a * t * t) / 2];
  },
  // ball leaves a table of height h at vx; a wall at distance xw: fall time, range, impact speed, height at the wall
  table_wall: ({ h, vx, xw }) => {
    const t = Math.sqrt((2 * h) / G);
    const tw = xw / vx;
    return [t, vx * t, Math.hypot(vx, G * t), h - (G * tw * tw) / 2];
  },
  // two stones thrown horizontally in opposite directions from height h: fall time, landing gap, time the velocities are perpendicular, gap then
  opposite_throws: ({ h, vA, vB }) => {
    const t = Math.sqrt((2 * h) / G);
    const tp = Math.sqrt(vA * vB) / G;
    return [t, (vA + vB) * t, tp, (vA + vB) * tp];
  },
  // greatest speed that stops within D including reaction tr, braking distance and total stopping time at it, reaction allowed at v2
  max_safe_speed: ({ D, a, tr, v2 }) => {
    const v = a * (-tr + Math.sqrt(tr * tr + (2 * D) / a));
    return [v, (v * v) / (2 * a), tr + v / a, (D - (v2 * v2) / (2 * a)) / v2];
  },
  // car from rest, acceleration a up to vmax then constant, over D; a vehicle at constant u from the same line and time
  race_accel_cruise: ({ a, vmax, D, u }) => {
    const t1 = vmax / a;
    const x1 = (vmax * vmax) / (2 * a);
    const tCar = t1 + (D - x1) / vmax;
    const tPass = (x1 - vmax * t1) / (u - vmax);
    if (tPass < t1 || tPass > tCar) throw new Error('the pass must happen in the cruise phase');
    return [tCar, tPass, D / u, D - u * tCar];
  },
  // ball thrown horizontally from a roof of height H onto a lower roof (height h2) spanning x1..x2 from the wall
  roof_landing_range: ({ H, h2, x1, x2 }) => {
    const t = Math.sqrt((2 * (H - h2)) / G);
    return [t, x1 / t, x2 / t, Math.hypot(x2 / t, G * t)];
  },
  // v-t: 0 -> v in t1, constant t2, then linear to -w over t3: last slope, greatest distance from start, final displacement, mean speed
  vt_reverse_graph: ({ t1, v, t2, t3, w }) => {
    const tz = (v * t3) / (v + w);
    const far = (v * t1) / 2 + v * t2 + (v * tz) / 2;
    return [-(v + w) / t3, far, far - (w * (t3 - tz)) / 2, (far + (w * (t3 - tz)) / 2) / (t1 + t2 + t3)];
  },
  // braking on dry (a1) and wet (a2) road with reaction tr; obstacle at D: stopping distances, impact speed and time on the wet road
  dry_wet_braking: ({ v, tr, a1, a2, D }) => {
    const brakeRoom = D - v * tr;
    const vi = Math.sqrt(v * v - 2 * a2 * brakeRoom);
    return [v * tr + (v * v) / (2 * a1), v * tr + (v * v) / (2 * a2), vi, tr + (v - vi) / a2];
  },
  // sin 37 = 0.6, cos 37 = 0.8: range, height over a wall at xw, time spent above height yq
  kick_37_wall: ({ v0, xw, yq }) => {
    const vx = 0.8 * v0;
    const vy = 0.6 * v0;
    const tw = xw / vx;
    return [(2 * vy) / G, vx * ((2 * vy) / G), vy * tw - (G * tw * tw) / 2, (2 * Math.sqrt(vy * vy - 2 * G * yq)) / G];
  },
  // 45 degrees, range R: launch speed, the two horizontal positions at height yq (first, gap), height at xq
  projectile_45_levels: ({ R, yq, xq }) => {
    const s = Math.sqrt(R * R - 4 * R * yq);
    return [Math.sqrt(G * R), (R - s) / 2, s, xq - (xq * xq) / R];
  },
  // sin 37 = 0.6, cos 37 = 0.8, thrown 37 degrees below the horizontal from a tower of height h
  projectile_down_37: ({ v0, h, xq }) => {
    const vx = 0.8 * v0;
    const vy0 = 0.6 * v0;
    const vyEnd = Math.sqrt(vy0 * vy0 + 2 * G * h);
    const t = (vyEnd - vy0) / G;
    const tq = xq / vx;
    return [t, vx * t, Math.hypot(vx, vyEnd), h - (vy0 * tq + (G * tq * tq) / 2)];
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

// Optional multiple-choice walk through the solution path ("guided").
export function checkGuided(g) {
  const errs = [];
  if (!Array.isArray(g) || g.length < 3 || g.length > 6) return ['guided must be an array of 3-6 steps'];
  g.forEach((st, i) => {
    const w = `step ${i + 1}`;
    if (!st || typeof st !== 'object') return errs.push(`${w}: not an object`);
    if (!hebrew(st.q)) errs.push(`${w}: q missing or not Hebrew`);
    if (!Array.isArray(st.options) || st.options.length < 2 || st.options.length > 4) return errs.push(`${w}: options must have 2-4 items`);
    st.options.forEach((o, j) => nonEmpty(o) || errs.push(`${w}: option ${j + 1} empty`));
    if (!Number.isInteger(st.correct) || st.correct < 0 || st.correct >= st.options.length) errs.push(`${w}: correct is not a valid option index`);
    if (!hebrew(st.explain)) errs.push(`${w}: explain missing or not Hebrew`);
    if (st.wrongExplain !== undefined) {
      if (!Array.isArray(st.wrongExplain) || st.wrongExplain.length !== st.options.length) errs.push(`${w}: wrongExplain length must equal options length`);
      else st.wrongExplain.forEach((x, j) => j === st.correct || hebrew(x) || errs.push(`${w}: wrongExplain ${j + 1} empty or not Hebrew`));
    }
    for (const text of [st.q, ...(st.options || []), st.explain, ...(st.wrongExplain || [])]) {
      if (typeof text === 'string' && LATIN_UNIT.test(stripTags(text))) errs.push(`${w}: Latin unit label, use Hebrew units`);
    }
  });
  return errs;
}

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
  if (ex.guided !== undefined) checkGuided(ex.guided).forEach((m) => err(`guided: ${m}`));
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
