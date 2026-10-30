// Generates the inline SVG "diagram" field of every exercise in data/physics.json from the
// exercise's verify.model + verify.params, so the numbers on the figure match the statement.
// Usage: node tools/diagrams.mjs --write   (regenerate the diagram fields, idempotent)
//        node tools/diagrams.mjs --check   (fail if a diagram is missing, invalid or stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------- primitives
const COL = {
  k: 'currentColor',
  a: 'var(--accent, #4c8bf5)',
  b: 'var(--accent2, #e8590c)',
  c: 'var(--accent3, #2f9e44)',
};
const r1 = (x) => String(Math.round(x * 10) / 10);
export const num = (x) => String(Math.round(x * 100) / 100);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const markers = ['k', 'a', 'b', 'c']
  .map(
    (c) =>
      `<marker id="ph-${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${COL[c]}"/></marker>`
  )
  .join('');

export const svg = (title, h, body) =>
  relayout(
    `<svg viewBox="0 0 320 ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">` +
      `<title>${esc(title)}</title><defs>${markers}</defs>` +
      `<g direction="ltr" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" font-size="12">${body}</g></svg>`
  );

export const line = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${COL[o.c || 'k']}"` +
  `${o.dash ? ' stroke-dasharray="5 4"' : ''}${o.w ? ` stroke-width="${o.w}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`;

export const arrow = (x1, y1, x2, y2, c = 'k') =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${COL[c]}" stroke-width="2" marker-end="url(#ph-${c})"/>`;

// Label with a halo in the panel colour. Multi-line labels are one <text> with <tspan>s so the
// layout pass moves them as a block. fix=true pins the label (axis ticks); it is still checked.
const HALO = 'var(--card, #fff)';
export const txt = (x, y, s, c = 'k', anc = 'middle', fix = false) => {
  const lines = String(s).split('\n');
  const attrs =
    `x="${r1(x)}" y="${r1(y)}" text-anchor="${anc}" fill="${COL[c]}" stroke="${HALO}" stroke-width="4" paint-order="stroke" stroke-linejoin="round"` +
    (fix ? ' data-f="1"' : '');
  if (lines.length === 1) return `<text ${attrs}>${esc(lines[0])}</text>`;
  return `<text ${attrs}>${lines.map((ln, i) => `<tspan x="${r1(x)}" dy="${i ? 14 : 0}">${esc(ln)}</tspan>`).join('')}</text>`;
};

// ---------------------------------------------------------------- automatic label layout
const FS = 12;
const HEB = /[֐-׿]/;
const textW = (s) => {
  let w = 0;
  for (const ch of s) w += HEB.test(ch) ? FS * 0.55 : ch === ' ' ? FS * 0.3 : FS * 0.6;
  return w;
};
const attr = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
const stripEnt = (s) => s.replace(/&amp;|&lt;|&gt;/g, '_');

function pathSegs(d) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) || [];
  const segs = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
  const n = () => Number(tok[i++]);
  const to = (x, y) => {
    segs.push([cx, cy, x, y]);
    cx = x;
    cy = y;
  };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    if (cmd === 'M') { cx = sx = n(); cy = sy = n(); }
    else if (cmd === 'm') { cx = sx = cx + n(); cy = sy = cy + n(); }
    else if (cmd === 'L') to(n(), n());
    else if (cmd === 'l') { const dx = n(); const dy = n(); to(cx + dx, cy + dy); }
    else if (cmd === 'h') to(cx + n(), cy);
    else if (cmd === 'H') to(n(), cy);
    else if (cmd === 'v') to(cx, cy + n());
    else if (cmd === 'V') to(cx, n());
    else if (cmd === 'Q') {
      const qx = n(), qy = n(), ex = n(), ey = n();
      const x0 = cx, y0 = cy;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, u = 1 - t;
        to(u * u * x0 + 2 * u * t * qx + t * t * ex, u * u * y0 + 2 * u * t * qy + t * t * ey);
      }
    } else if (cmd === 'A') { i += 5; to(n(), n()); }
    else if (cmd === 'z' || cmd === 'Z') to(sx, sy);
    else break;
  }
  return segs;
}

function parseLayout(s) {
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(s);
  const W = vb ? Number(vb[1]) : 320;
  const H = vb ? Number(vb[2]) : 200;
  const body = s.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<title>[\s\S]*?<\/title>/, '');
  const segs = [];
  const boxes = [];
  const solid = (tag) => {
    const op = attr(tag, 'opacity');
    return !(op !== null && Number(op) < 0.3);
  };
  for (const m of body.replace(TEXT_RE, '').matchAll(/<(line|polyline|path|rect|circle|ellipse)\b([^>]*?)\/?>/g)) {
    const [, kind, tag] = m;
    if (!solid(tag)) continue;
    const f = (k) => Number(attr(tag, k));
    if (kind === 'line') segs.push([f('x1'), f('y1'), f('x2'), f('y2')]);
    else if (kind === 'polyline') {
      const p = attr(tag, 'points').trim().split(/\s+/).map((q) => q.split(',').map(Number));
      for (let i = 1; i < p.length; i++) segs.push([...p[i - 1], ...p[i]]);
    } else if (kind === 'path') segs.push(...pathSegs(attr(tag, 'd')));
    else if (kind === 'rect') {
      const x = f('x'), y = f('y'), w = f('width'), h = f('height');
      segs.push([x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]);
    } else if (kind === 'circle') boxes.push([f('cx') - f('r'), f('cy') - f('r'), f('cx') + f('r'), f('cy') + f('r')]);
    else boxes.push([f('cx') - f('rx'), f('cy') - f('ry'), f('cx') + f('rx'), f('cy') + f('ry')]);
  }
  const texts = [];
  for (const m of s.matchAll(TEXT_RE)) {
    const tag = m[1];
    const inner = m[2];
    const lines = inner.includes('<tspan') ? [...inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map((q) => stripEnt(q[1])) : [stripEnt(inner)];
    const x = Number(attr(tag, 'x'));
    const y = Number(attr(tag, 'y'));
    const anc = attr(tag, 'text-anchor') || 'start';
    const w = Math.max(...lines.map(textW));
    const x0 = anc === 'start' ? x : anc === 'end' ? x - w : x - w / 2;
    texts.push({ lines, fix: /data-f="1"/.test(tag), box: [x0, y - FS * 0.85, x0 + w, y + 14 * (lines.length - 1) + FS * 0.25], label: lines.join(' ') });
  }
  return { W, H, segs, boxes, texts };
}

const shrink = (b) => [b[0] + 1, b[1] + 1, b[2] - 1, b[3] - 1];
const boxHit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function segHitsBox([x1, y1, x2, y2], b) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - b[0]], [dx, b[2] - x1], [-dy, y1 - b[1]], [dy, b[3] - y1]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
const MARGIN = 3;
const inView = (b, W, H) => b[0] >= MARGIN && b[1] >= MARGIN && b[2] <= W - MARGIN && b[3] <= H - MARGIN;
function blocked(box, lay, others) {
  const b = shrink(box);
  if (!inView(box, lay.W, lay.H)) return 'viewBox';
  for (const g of lay.boxes) if (boxHit(b, g)) return 'shape';
  for (const sg of lay.segs) if (segHitsBox(sg, b)) return 'line';
  for (const o of others) if (boxHit(b, shrink(o.box))) return `text "${o.label}"`;
  return null;
}

export const layoutStats = [];
const OFFSETS = [];
for (let dx = -90; dx <= 90; dx += 4) for (let dy = -60; dy <= 60; dy += 4) OFFSETS.push([dx, dy, dx * dx + dy * dy * 1.5]);
OFFSETS.sort((a, b) => a[2] - b[2]);

// Moves every label to the nearest position where it touches no line, shape, other label or the border.
export function relayout(s) {
  const lay = parseLayout(s);
  const placed = lay.texts.filter((t) => t.fix);
  const shift = new Map();
  lay.texts.forEach((t, idx) => {
    if (t.fix) return;
    for (const [dx, dy] of OFFSETS) {
      const box = [t.box[0] + dx, t.box[1] + dy, t.box[2] + dx, t.box[3] + dy];
      if (!blocked(box, lay, placed)) {
        shift.set(idx, [dx, dy]);
        if (dx || dy) layoutStats.push([t.label, dx, dy]);
        placed.push({ box, label: t.label });
        return;
      }
    }
    placed.push(t);
  });
  let idx = -1;
  return s.replace(TEXT_RE, (all, tag, inner) => {
    idx++;
    const sh = shift.get(idx);
    if (!sh || (sh[0] === 0 && sh[1] === 0)) return all;
    const [dx, dy] = sh;
    const tag2 = tag
      .replace(/(^|\s)x="([^"]*)"/, (q, a, v) => `${a}x="${r1(Number(v) + dx)}"`)
      .replace(/(^|\s)y="([^"]*)"/, (q, a, v) => `${a}y="${r1(Number(v) + dy)}"`);
    const inner2 = inner.replace(/<tspan x="([^"]*)"/g, (q, v) => `<tspan x="${r1(Number(v) + dx)}"`);
    return `<text${tag2}>${inner2}</text>`;
  });
}

// Reports labels that overlap a line, shape, another label or leave the viewBox.
export function layoutIssues(s) {
  const lay = parseLayout(s);
  const out = [];
  lay.texts.forEach((t, i) => {
    const why = blocked(t.box, lay, lay.texts.slice(0, i));
    if (why) out.push(`label "${t.label}" overlaps ${why}`);
  });
  return out;
}

export const ball = (x, y, c = 'a', r = 6) =>
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${COL[c]}" stroke="none"/>`;

export const ground = (x1, x2, y) => {
  let d = '';
  for (let x = x1 + 8; x <= x2; x += 10) d += `M${r1(x)} ${r1(y)}l-6 8`;
  return line(x1, y, x2, y, { w: 2 }) + `<path d="${d}" opacity="0.5"/>`;
};

// dimension line with arrowheads at both ends; label placed beside the middle
export const dim = (x1, y1, x2, y2, label, o = {}) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const body =
    `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${COL[o.c || 'k']}" marker-start="url(#ph-${o.c || 'k'})" marker-end="url(#ph-${o.c || 'k'})"/>`;
  const vertical = Math.abs(x1 - x2) < 1;
  return body + (vertical ? (o.left ? txt(mx - 6, my + 4, label, o.c || 'k', 'end') : txt(mx + 6, my + 4, label, o.c || 'k', 'start')) : txt(mx, my + (o.below ? 16 : -6), label, o.c || 'k'));
};

export const rect = (x, y, w, h, o = {}) =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${o.rx ? ` rx="${o.rx}"` : ''} stroke="${COL[o.c || 'k']}"${o.fill ? ` fill="${COL[o.fill]}" fill-opacity="0.18"` : ''}/>`;

export const car = (x, y, c = 'a') =>
  rect(x, y - 22, 44, 14, { c, fill: c, rx: 3 }) +
  rect(x + 10, y - 31, 22, 9, { c, rx: 2 }) +
  ball(x + 11, y - 6, 'k', 5) +
  ball(x + 33, y - 6, 'k', 5);

export const building = (x, top, w, gy) => rect(x, top, w, gy - top, { fill: 'k' });

const path = (d, c = 'k', dash = true) => `<path d="${d}" stroke="${COL[c]}"${dash ? ' stroke-dasharray="5 4"' : ''}/>`;

// parametric curve in pixel space: x = x0 + ux t, y = y0 - uy t + gp t^2 / 2
export const curve = (x0, y0, ux, uy, gp, t1, c = 'k', n = 28) => {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = (t1 * i) / n;
    d += `${i ? 'L' : 'M'}${r1(x0 + ux * t)} ${r1(y0 - uy * t + (gp * t * t) / 2)}`;
  }
  return path(d, c);
};

// parabola segment given start, tangent-intersection control point and end
export const qpath = (x0, y0, cx, cy, x1, y1, c = 'k') => path(`M${r1(x0)} ${r1(y0)}Q${r1(cx)} ${r1(cy)} ${r1(x1)} ${r1(y1)}`, c);

export const axes = (ox, oy, w, h, xl, yl) =>
  arrow(ox, oy, ox + w, oy, 'k') + arrow(ox, oy, ox, oy - h, 'k') + txt(ox + w, oy + 14, xl, 'k', 'end') + txt(ox + 4, oy - h - 4, yl, 'k', 'start');

// velocity-time graph with grid. pts: [[t, v]]; labelled: indices whose (t, v) are written.
export function vtGraph({ pts, pts2, labelled2 = [], notes = [], xmax, vmin, vmax, xs, vs, labelled = [], title }) {
  const ox = 52, oxEnd = 292, top = 40, bot = 190;
  const sx = (oxEnd - ox) / xmax;
  const sy = (bot - top) / (vmax - vmin);
  const X = (t) => ox + t * sx;
  const Y = (v) => bot - (v - vmin) * sy;
  let g = '';
  for (let t = 0; t <= xmax + 1e-9; t += xs) {
    g += line(X(t), top, X(t), bot, { op: 0.18 }) + txt(X(t), bot + 14, num(t), 'k', 'middle', true);
  }
  for (let v = vmin; v <= vmax + 1e-9; v += vs) {
    g += line(ox, Y(v), oxEnd, Y(v), { op: 0.18 });
    g += txt(ox - 8, Y(v) + 4, num(v), 'k', 'end', true);
  }
  g += arrow(ox, Y(0), oxEnd + 8, Y(0)) + arrow(ox, bot, ox, top - 10);
  g += txt(oxEnd + 10, Y(0) - 8, 't (ש\')', 'k', 'end') + txt(ox + 8, 16, 'v (מ/ש)', 'k', 'start');
  const series = [[pts, labelled, 'a'], ...(pts2 ? [[pts2, labelled2, 'c']] : [])];
  for (const [P, lab, col] of series) {
    g += `<polyline points="${P.map(([t, v]) => `${r1(X(t))},${r1(Y(v))}`).join(' ')}" stroke="${COL[col]}" stroke-width="2.5"/>`;
    P.forEach(([t, v], i) => {
      g += ball(X(t), Y(v), 'b', 3.5);
      if (lab.includes(i)) g += txt(X(t) + (t === 0 ? 6 : 0), Y(v) + (v >= 0 ? -8 : 16), `(${num(t)}, ${num(v)})`, 'k', t === 0 ? 'start' : 'middle');
    });
  }
  for (const [t, v, label, col] of notes) g += txt(X(t), Y(v), label, col || 'k');
  return svg(title, 216, g);
}

// ------------------------------------------------------------ shared scenes
const G10 = 10;
const GY = 205; // ground level of vertical scenes

// tall building; ball released at the roof level; height dimension on the right
function tower(p, o = {}) {
  const roof = 45;
  let s = building(24, roof, 72, GY) + ground(10, 310, GY);
  s += line(96, roof, 250, roof, { dash: true, op: 0.6 }) + dim(250, roof, 250, GY, `h = ${num(p.h)} מ'`);
  s += o.fall !== false ? path(`M112 ${roof}L112 ${GY - 6}`, 'k') : '';
  s += ball(112, roof, 'a');
  s += o.extra || '';
  return s;
}

function rise(p, o = {}) {
  // ball thrown from the ground, vertical dashed path up to the top
  const top = 40;
  let s = ground(10, 310, GY) + path(`M100 ${GY - 6}L100 ${top}`, 'k');
  s += ball(100, GY - 6, 'a') + arrow(100, GY - 14, 100, GY - 62, 'a');
  s += txt(110, GY - 36, o.v0 || `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
  s += line(80, top, 250, top, { dash: true, op: 0.6 }) + ball(100, top, 'b', 4) + txt(110, top - 22, o.top || 'שיא\nv = 0', 'b', 'start');
  s += o.extra || '';
  return s;
}

const road = (y, x1 = 10, x2 = 310) => ground(x1, x2, y);
const RY = 118; // road level

function launchScene(p, o) {
  // table / cliff on the left, ball launched horizontally, parabola to the ground
  const top = 55;
  let s = building(14, top, 90, RY) + ground(10, 310, RY);
  s += ball(104, top, 'a') + arrow(108, top, 150, top, 'a') + txt(152, top - 6, o.vx, 'a', 'start');
  s += qpath(104, top, 175, top, 246, RY - 6);
  s += dim(60, top, 60, RY, o.h, {}) ;
  s += dim(104, RY + 16, 246, RY + 16, o.R, { below: true });
  s += ball(246, RY - 6, 'b', 4);
  s += o.extra || '';
  return s;
}

// ------------------------------------------------------------ diagram builders by model
export const diagrams = {
  // ---- vertical (existing)
  free_fall_from_height: (p) =>
    svg('כדור נשמט ממנוחה מגובה h', 215, tower(p, { extra: txt(120, 36, 'v₀ = 0', 'k', 'start') + arrow(112, 70, 112, 110, 'b') + txt(122, 98, 'g', 'b', 'start') })),
  free_fall_for_time: (p) => {
    let s = ground(10, 310, GY) + line(100, 40, 100, GY, { dash: true, op: 0.6 });
    s += ball(100, 40, 'a') + txt(112, 44, 't = 0, v₀ = 0', 'k', 'start');
    s += ball(100, 108, 'a') + txt(112, 112, '...', 'k', 'start');
    s += ball(100, GY - 6, 'a') + txt(112, GY - 14, `t = ${num(p.t)} ש'`, 'b', 'start');
    s += dim(240, 40, 240, GY, 'h = ?') + arrow(70, 70, 70, 120, 'b') + txt(60, 100, 'g', 'b', 'end');
    return svg('אבן נופלת במשך t שניות', 215, s);
  },
  vertical_throw_up: (p) => svg('כדור נזרק אנכית כלפי מעלה', 215, rise(p, { extra: dim(250, 40, 250, GY, 'H = ?') })),
  distance_in_nth_second: (p) => {
    const y0 = 36, y1 = 108, y2 = 168;
    let s = ground(10, 310, GY) + path(`M100 ${y0}L100 ${GY - 6}`, 'k');
    s += ball(100, y0, 'a') + txt(112, y0 + 4, 't = 0', 'k', 'start');
    s += line(80, y1, 220, y1, { dash: true, op: 0.6 }) + ball(100, y1, 'a') + txt(112, y1 - 6, `t = ${num(p.n - 1)} ש'`, 'k', 'start');
    s += line(80, y2, 220, y2, { dash: true, op: 0.6 }) + ball(100, y2, 'a') + txt(112, y2 + 16, `t = ${num(p.n)} ש'`, 'k', 'start');
    s += dim(230, y1, 230, y2, 'Δy = ?', { c: 'b' }) + arrow(60, 60, 60, 110, 'b') + txt(50, 90, 'g', 'b', 'end');
    return svg('מרחק שעובר גוף נופל בשנייה אחת', 215, s);
  },
  speed_at_height: (p) => {
    const ly = GY - 100;
    const extra = line(80, ly, 250, ly, { dash: true, op: 0.6 }) + ball(100, ly, 'c', 5) + txt(112, ly + 16, 'v = ?', 'c', 'start') + dim(250, ly, 250, GY, `h = ${num(p.h)} מ'`);
    return svg('כדור בעלייה עובר בגובה נתון', 215, rise(p, { top: 'שיא', extra }));
  },
  vertical_height_times: (p) => {
    const ly = GY - 100;
    const extra = line(80, ly, 250, ly, { dash: true, op: 0.6 }) + ball(100, ly, 'c', 5) + txt(112, ly + 16, 't₁ , v = ?', 'c', 'start') + ball(150, ly, 'b', 5) + txt(160, ly - 8, 't₂', 'b', 'start') + arrow(150, 60, 150, 90, 'b') + dim(250, ly, 250, GY, `h = ${num(p.h)} מ'`);
    return svg('כדור עובר באותו גובה בעלייה ובירידה', 215, rise(p, { top: 'שיא', extra }));
  },
  vertical_throw_by_flight_time: (p) => {
    let s = ground(10, 310, GY) + path(`M100 ${GY - 6}L100 40`, 'a') + path(`M130 40L130 ${GY - 6}`, 'b');
    s += ball(100, GY - 6, 'a') + arrow(100, GY - 14, 100, GY - 60, 'a') + txt(70, GY - 36, 'v₀ = ?', 'a', 'end');
    s += arrow(130, 60, 130, 100, 'b') + ball(115, 40, 'k', 4);
    s += dim(100, GY - 22, 130, GY - 22, '') + txt(150, GY - 26, `T = ${num(p.T)} ש'`, 'b', 'start');
    s += dim(280, 40, 280, GY, 'H = ?');
    s += txt(140, 100, 'עלייה וירידה', 'k', 'start');
    return svg('כדור עולה ויורד לאותה נקודה', 215, s);
  },
  vertical_throw_down_from_height: (p) => {
    const extra = arrow(112, 50, 112, 100, 'a') + txt(122, 80, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    return svg('אבן נזרקת כלפי מטה מגשר', 215, tower(p, { extra }));
  },
  vertical_throw_from_height: (p) => {
    const extra = arrow(112, 38, 112, 8, 'a') + txt(122, 18, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    return svg('כדור נזרק כלפי מעלה מגג בניין', 215, tower(p, { extra, fall: true }));
  },
  two_body_meet_vertical: (p) => {
    let s = ground(10, 310, GY) + building(190, 40, 40, GY) + ball(110, GY - 6, 'a') + arrow(110, GY - 14, 110, GY - 70, 'a');
    s += txt(120, GY - 40, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start') + txt(100, GY - 90, 'ב׳', 'a', 'end');
    s += ball(176, 40, 'b') + txt(170, 34, 'א׳ נשמט', 'b', 'end') + arrow(176, 52, 176, 92, 'b');
    s += dim(248, 40, 248, GY, `H = ${num(p.H)} מ'`);
    return svg('שני כדורים הנעים זה לקראת זה', 215, s);
  },
  last_second_distance: (p) => {
    let s = ground(10, 310, GY) + path(`M100 36L100 ${GY - 6}`, 'k');
    s += ball(100, 36, 'a') + txt(112, 40, 'v₀ = 0', 'k', 'start');
    s += `<line x1="100" y1="130" x2="100" y2="${GY - 6}" stroke="${COL.b}" stroke-width="4"/>`;
    s += dim(150, 130, 150, GY - 6, `d = ${num(p.d)} מ'`, { c: 'b' }) + txt(165, 150, 'בשנייה האחרונה', 'b', 'start');
    s += dim(248, 36, 248, GY, 'h = ?') + ball(100, GY - 6, 'a');
    return svg('מרחק בשנייה האחרונה של נפילה חופשית', 215, s);
  },
  free_fall_ratio: (p) => {
    const hb = Math.min(160, 40 * p.k);
    let s = ground(10, 310, GY) + line(90, GY - 40, 90, GY, { dash: true, op: 0.6 }) + line(230, GY - hb, 230, GY, { dash: true, op: 0.6 });
    s += ball(90, GY - 40, 'a') + ball(230, GY - hb, 'b');
    s += dim(60, GY - 40, 60, GY, 'h') + dim(260, GY - hb, 260, GY, `h_B = ${num(p.k)}h`);
    s += txt(100, GY - 44, `t_A = ${num(p.tA)} ש'`, 'a', 'start') + txt(220, GY - hb - 8, 't_B = ?', 'b', 'end') + txt(90, GY + 22, 'כדור א׳', 'a') + txt(230, GY + 22, 'כדור ב׳', 'b');
    return svg('שני כדורים נופלים מגבהים שונים', 230, s);
  },
  vt_vertical_graph: (p) =>
    vtGraph({ pts: [[0, p.v0], [p.T, p.vEnd]], xmax: p.T, vmin: p.vEnd, vmax: p.v0, xs: 1, vs: 10, labelled: [0, 1], title: 'גרף מהירות-זמן של כדור שנזרק מגג' }),
  vt_elevator_graph: (p) =>
    vtGraph({ pts: [[0, 0], [p.t1, p.v], [p.t1 + p.t2, p.v], [p.t1 + p.t2 + p.t3, 0]], xmax: p.t1 + p.t2 + p.t3, vmin: 0, vmax: p.v + 2, xs: 1, vs: 2, labelled: [1, 2, 3], title: 'גרף מהירות-זמן של מעלית' }),

  // ---- vertical (new)
  rocket_cutoff: (p) => {
    let s = ground(10, 310, GY) + path(`M100 ${GY - 6}L100 30`, 'k');
    s += rect(94, GY - 26, 12, 20, { c: 'a', fill: 'a', rx: 3 }) + arrow(100, GY - 30, 100, GY - 66, 'a') + txt(112, GY - 44, `a = ${num(p.a)} מ/ש²`, 'a', 'start');
    s += line(80, 110, 250, 110, { dash: true, op: 0.6 }) + ball(100, 110, 'b', 5) + txt(112, 86, `כיבוי מנוע\nt₁ = ${num(p.t1)} ש'`, 'b', 'start');
    s += line(80, 30, 250, 30, { dash: true, op: 0.6 }) + ball(100, 30, 'c', 4) + txt(112, 26, 'שיא', 'c', 'start');
    s += dim(280, 30, 280, GY, 'H = ?');
    return svg('רקטה עם כיבוי מנוע', 215, s);
  },
  two_stones_different_times: (p) => {
    const extra = ball(150, 45, 'b') + arrow(150, 56, 150, 100, 'b') + txt(160, 84, 'v₀ = ?', 'b', 'start') + txt(150, 20, `ב׳ יוצאת מאוחר יותר\nΔt = ${num(p.dt)} ש'`, 'b', 'middle') + txt(112, 32, 'א׳', 'a', 'end');
    return svg('שתי אבנים שיוצאות בזמנים שונים', 215, tower(p, { extra }));
  },
  meet_different_start: (p) => {
    let s = ground(10, 310, GY) + ball(80, GY - 6, 'a') + arrow(80, GY - 14, 80, GY - 66, 'a') + txt(90, GY - 40, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += txt(60, GY - 80, 'א׳', 'a', 'end') + building(190, 40, 40, GY) + ball(176, 40, 'b') + arrow(176, 52, 176, 92, 'b');
    s += txt(170, 20, `ב׳ נשמט אחרי\nΔt = ${num(p.dt)} ש'`, 'b', 'end') + dim(248, 40, 248, GY, `H = ${num(p.H)} מ'`);
    return svg('שני כדורים נפגשים כשזמני היציאה שונים', 215, s);
  },
  bolt_in_elevator: (p) => {
    let s = ground(10, 310, GY) + line(80, 30, 80, GY, { op: 0.4 }) + line(200, 30, 200, GY, { op: 0.4 });
    s += rect(96, 100, 88, 62, { c: 'a', fill: 'a' }) + ball(140, 108, 'b', 4) + txt(150, 112, 'בורג', 'b', 'start');
    s += arrow(140, 94, 140, 52, 'a') + txt(150, 70, `v = ${num(p.v)} מ/ש`, 'a', 'start');
    s += dim(216, 100, 216, 162, `h = ${num(p.hc)} מ'`) + txt(140, 182, 'רצפת המעלית', 'a');
    return svg('בורג נופל מתקרת מעלית עולה', 215, s);
  },
  balloon_release: (p) => {
    let s = ground(10, 310, GY) + `<ellipse cx="110" cy="70" rx="22" ry="28" stroke="${COL.a}" fill="${COL.a}" fill-opacity="0.18"/>`;
    s += line(110, 98, 110, 108, {}) + ball(110, 112, 'b', 4);
    s += arrow(150, 70, 150, 30, 'a') + txt(160, 56, `v = ${num(p.v)} מ/ש`, 'a', 'start');
    s += path(`M110 116L110 ${GY - 6}`, 'b') + txt(120, 160, 'אבן', 'b', 'start');
    s += line(80, 112, 250, 112, { dash: true, op: 0.6 }) + dim(250, 112, 250, GY, `h = ${num(p.h)} מ'`);
    return svg('אבן נשמטת מבלון עולה', 215, s);
  },
  last_k_seconds: (p) => {
    let s = ground(10, 310, GY) + path(`M100 36L100 ${GY - 6}`, 'k') + ball(100, 36, 'a') + txt(112, 40, 'v₀ = 0', 'k', 'start');
    s += `<line x1="100" y1="120" x2="100" y2="${GY - 6}" stroke="${COL.b}" stroke-width="4"/>`;
    s += dim(150, 120, 150, GY - 6, `${num(p.d)} מ'`, { c: 'b' }) + txt(165, 124, `בשניות האחרונות\nk = ${num(p.k)} ש'`, 'b', 'start');
    s += dim(248, 36, 248, GY, 'h = ?');
    return svg('מרחק בשניות האחרונות של נפילה', 215, s);
  },
  compare_two_throws: (p) => {
    const extra = ball(150, 45, 'b') + arrow(112, 38, 112, 8, 'a') + txt(122, 18, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start') + arrow(150, 56, 150, 96, 'b') + txt(160, 84, `v₀ = ${num(p.v0)} מ/ש`, 'b', 'start') + txt(112, 60, 'א׳', 'a', 'end') + txt(150, 40, 'ב׳', 'b', 'middle');
    return svg('שתי זריקות מאותו גג: למעלה ולמטה', 215, tower(p, { extra }));
  },
  known_pass_speed: (p) => {
    const ly = GY - 100;
    const extra = line(80, ly, 250, ly, { dash: true, op: 0.6 }) + ball(100, ly, 'c', 5) + arrow(130, ly + 6, 130, ly - 26, 'c') + txt(140, ly - 6, `v = ${num(p.v1)} מ/ש`, 'c', 'start') + dim(250, ly, 250, GY, `h = ${num(p.h)} מ'`);
    return svg('כדור בעלייה: נתונה מהירותו בגובה מסוים', 215, rise(p, { v0: 'v₀ = ?', top: 'שיא', extra }));
  },
  window_pass: (p) => {
    let s = building(150, 30, 90, GY) + ground(10, 310, GY) + rect(168, 90, 40, 60, { c: 'b' });
    s += ball(100, 30, 'a') + txt(110, 34, 'v₀ = 0', 'k', 'start') + path(`M100 30L100 ${GY - 6}`, 'k');
    s += line(100, 90, 168, 90, { dash: true, op: 0.6 }) + line(100, 150, 168, 150, { dash: true, op: 0.6 });
    s += dim(262, 90, 262, 150, `${num(p.w)} מ'`, { c: 'b' }) + txt(262, 82, 'חלון', 'b') + txt(86, 124, `Δt = ${num(p.dt)} ש'`, 'b', 'end');
    s += dim(40, 30, 40, 90, 'x = ?');
    return svg('אבן נופלת ועוברת ליד חלון', 215, s);
  },
  parachute_fall: (p) => {
    let s = ground(10, 310, GY) + path(`M100 30L100 ${GY - 6}`, 'k') + ball(100, 30, 'a');
    s += txt(112, 34, 'v₀ = 0', 'k', 'start') + dim(60, 30, 60, 100, 'נפילה חופשית', { c: 'b' }) + txt(66, 118, `t₁ = ${num(p.t1)} ש'`, 'b', 'start');
    s += line(80, 100, 250, 100, { dash: true, op: 0.6 }) + ball(100, 100, 'b', 5) + txt(112, 96, 'פתיחת מצנח', 'b', 'start');
    s += arrow(160, 160, 160, 120, 'c') + txt(170, 140, `a = ${num(p.a)} מ/ש²`, 'c', 'start');
    s += ball(100, GY - 6, 'a') + txt(112, GY - 14, `v = ${num(p.vland)} מ/ש`, 'k', 'start');
    s += dim(280, 30, 280, GY, 'H = ?');
    return svg('צניחה עם מצנח', 215, s);
  },

  // ---- horizontal (existing)
  const_velocity_meet: (p) => {
    let s = road(RY) + car(20, RY, 'a') + car(250, RY, 'b') + arrow(68, RY - 40, 108, RY - 40, 'a') + txt(88, RY - 46, `${num(p.v1)} מ/ש`, 'a');
    s += arrow(246, RY - 40, 206, RY - 40, 'b') + txt(226, RY - 46, `${num(p.v2)} מ/ש`, 'b') + dim(42, RY + 28, 272, RY + 28, `d = ${num(p.d)} מ'`, { below: true });
    s += line(42, RY + 4, 42, RY + 34, { dash: true, op: 0.5 }) + line(272, RY + 4, 272, RY + 34, { dash: true, op: 0.5 });
    return svg('שתי מכוניות נוסעות זו לקראת זו', 185, s);
  },
  const_accel_from_rest: (p) => {
    let s = road(RY) + car(20, RY, 'a') + txt(42, RY - 40, 'v₀ = 0', 'k') + arrow(30, RY - 62, 80, RY - 62, 'b') + txt(55, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b');
    s += `<g opacity="0.55">${car(220, RY, 'a')}</g>` + txt(242, RY - 40, `t = ${num(p.t)} ש'`, 'k') + dim(42, RY + 28, 242, RY + 28, 'x = ?', { below: true });
    s += txt(242, RY - 60, 'v = ?', 'c');
    return svg('מכונית מאיצה מהמנוחה', 185, s);
  },
  braking_only: (p) => {
    let s = road(RY) + car(20, RY, 'a') + arrow(70, RY - 40, 110, RY - 40, 'a') + txt(90, RY - 46, `v = ${num(p.v)} מ/ש`, 'a');
    s += arrow(70, RY - 62, 30, RY - 62, 'b') + txt(50, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b');
    s += line(262, RY - 40, 262, RY, { c: 'c', w: 3 }) + txt(262, RY - 62, 'עצירה\nv = 0', 'c') + dim(42, RY + 28, 262, RY + 28, 'x = ?', { below: true });
    return svg('מכונית בולמת עד לעצירה', 185, s);
  },
  const_velocity_overtake: (p) => {
    let s = road(RY) + car(20, RY, 'a') + car(200, RY, 'b') + arrow(68, RY - 40, 108, RY - 40, 'a') + txt(88, RY - 46, `${num(p.v_fast)} מ/ש`, 'a');
    s += arrow(246, RY - 40, 286, RY - 40, 'b') + txt(266, RY - 46, `${num(p.v_slow)} מ/ש`, 'b') + dim(64, RY + 28, 200, RY + 28, `${num(p.gap)} מ'`, { below: true });
    s += txt(42, RY + 48, 'מכונית', 'a') + txt(222, RY + 48, 'משאית', 'b');
    return svg('מכונית מגיעה למשאית', 185, s);
  },
  head_start_catch: (p) => {
    let s = road(RY) + ball(30, RY - 12, 'k', 5) + `<line x1="30" y1="${RY - 7}" x2="30" y2="${RY - 1}"/>`;
    s += ball(190, RY - 12, 'b', 5) + arrow(204, RY - 14, 244, RY - 14, 'b') + txt(224, RY - 22, `${num(p.v_slow)} מ/ש`, 'b');
    s += txt(100, RY - 52, `יצא ראשון\nt₀ = ${num(p.t0)} ש'`, 'b', 'start') + arrow(44, RY - 14, 84, RY - 14, 'a') + txt(64, RY - 22, `${num(p.v_fast)} מ/ש`, 'a');
    s += dim(30, RY + 28, 190, RY + 28, 'הפער ברגע היציאה', { below: true }) + txt(30, RY + 48, 'רוכב', 'a') + txt(190, RY + 48, 'אצן', 'b');
    return svg('רוכב משיג אצן שיצא קודם', 185, s);
  },
  accel_with_initial_speed_dist: (p) => {
    let s = road(RY) + car(20, RY, 'a') + arrow(70, RY - 40, 110, RY - 40, 'a') + txt(90, RY - 46, `v₀ = ${num(p.v0)} מ/ש`, 'a');
    s += arrow(30, RY - 62, 80, RY - 62, 'b') + txt(55, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b') + `<g opacity="0.55">${car(230, RY, 'a')}</g>` + txt(252, RY - 40, 'v = ?', 'c');
    s += dim(42, RY + 28, 252, RY + 28, `x = ${num(p.x)} מ'`, { below: true });
    return svg('אופנוע מאיץ לאורך דרך נתונה', 185, s);
  },
  accel_from_speeds_time: (p) => {
    let s = road(RY) + car(20, RY, 'a') + txt(42, RY - 40, `v₀ = ${num(p.v0)} מ/ש`, 'a') + `<g opacity="0.55">${car(230, RY, 'a')}</g>` + txt(252, RY - 40, `v = ${num(p.v)} מ/ש`, 'a');
    s += dim(42, RY + 28, 252, RY + 28, 'x = ?', { below: true }) + txt(147, RY - 70, `t = ${num(p.t)} ש'  ·  a = ?`, 'b');
    return svg('רכבת שמהירותה גדלה בהדרגה', 185, s);
  },
  horizontal_launch: (p) =>
    svg('גוף נזרק אופקית מגובה', 180, launchScene(p, { vx: `${num(p.vx)} מ/ש`, h: `h = ${num(p.h)} מ'`, R: 'x = ?' })),
  braking_with_reaction: (p) => {
    let s = road(RY) + car(10, RY, 'a') + arrow(58, RY - 40, 98, RY - 40, 'a') + txt(78, RY - 46, `v = ${num(p.v)} מ/ש`, 'a');
    s += line(120, RY - 8, 120, RY + 36, { dash: true, op: 0.6 }) + line(215, RY - 8, 215, RY + 36, { dash: true, op: 0.6 }) + line(300, RY - 40, 300, RY, { c: 'c', w: 3 });
    s += dim(32, RY + 20, 120, RY + 20, `t = ${num(p.tr)} ש'`, { below: true }) + txt(76, RY + 52, 'תגובה', 'b') + dim(120, RY + 20, 300, RY + 20, `a = ${num(p.a)} מ/ש²`, { below: true }) + txt(210, RY + 52, 'בלימה', 'c');
    return svg('זמן תגובה ובלימה עד עצירה', 185, s);
  },
  accel_then_cruise: (p) => {
    let s = road(RY) + car(12, RY, 'a') + txt(34, RY - 40, 'v₀ = 0', 'k') + line(120, RY - 8, 120, RY + 30, { dash: true, op: 0.6 }) + `<g opacity="0.55">${car(120, RY, 'a')}</g>`;
    s += arrow(120, RY - 62, 150, RY - 62, 'a') + txt(135, RY - 68, `v = ${num(p.vmax)} מ/ש`, 'a') + arrow(20, RY - 62, 60, RY - 62, 'b') + txt(42, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b');
    s += dim(34, RY + 24, 300, RY + 24, `D = ${num(p.D)} מ'`, { below: true }) + line(300, RY - 8, 300, RY + 30, { dash: true, op: 0.6 }) + txt(76, RY + 52, 'האצה', 'b') + txt(210, RY + 52, 'מהירות קבועה', 'a');
    return svg('מכונית מאיצה ואחר כך נוסעת במהירות קבועה', 185, s);
  },
  horizontal_launch_from_range: (p) =>
    svg('כדור נזרק אופקית מגג', 180, launchScene(p, { vx: 'vₓ = ?', h: `h = ${num(p.h)} מ'`, R: `R = ${num(p.R)} מ'` })),

  // ---- horizontal (new)
  three_stage_trip: (p) => {
    let s = road(RY) + car(12, RY, 'a') + txt(34, RY - 40, 'v₀ = 0', 'k') + arrow(14, RY - 62, 54, RY - 62, 'b') + txt(34, RY - 68, `a = ${num(p.a1)} מ/ש²`, 'b');
    s += line(100, RY - 8, 100, RY + 30, { dash: true, op: 0.6 }) + line(220, RY - 8, 220, RY + 30, { dash: true, op: 0.6 });
    s += arrow(120, RY - 40, 200, RY - 40, 'a') + txt(160, RY - 46, `v = ${num(p.v)} מ/ש  ·  t = ${num(p.tc)} ש'`, 'a');
    s += arrow(284, RY - 62, 244, RY - 62, 'c') + txt(264, RY - 68, `a = −${num(p.a3)} מ/ש²`, 'c') + line(300, RY - 40, 300, RY, { c: 'c', w: 3 });
    s += txt(60, RY + 24, 'האצה', 'b') + txt(160, RY + 24, 'מהירות קבועה', 'a') + txt(262, RY + 24, 'בלימה', 'c') + dim(14, RY + 40, 300, RY + 40, 'D = ?', { below: true });
    return svg('נסיעה בשלושה שלבים', 185, s);
  },
  vt_graph_car: (p) =>
    vtGraph({ pts: [[0, 0], [p.t1, p.v], [p.t1 + p.t2, p.v], [p.t1 + p.t2 + p.t3, 0]], xmax: p.t1 + p.t2 + p.t3, vmin: 0, vmax: p.v + 2, xs: 1, vs: 2, labelled: [1, 2, 3], title: 'גרף מהירות-זמן של מכונית' }),
  chase_reaction: (p) => {
    let s = road(RY) + car(14, RY, 'a') + arrow(62, RY - 40, 102, RY - 40, 'a') + txt(82, RY - 46, `v = ${num(p.v)} מ/ש`, 'a') + txt(36, RY + 24, 'עוקף', 'a');
    s += `<g opacity="0.7">${car(150, RY, 'b')}</g>` + txt(172, RY - 40, 'v₀ = 0', 'k') + arrow(160, RY - 62, 210, RY - 62, 'b') + txt(185, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b') + txt(172, RY + 24, 'ניידת', 'b');
    s += txt(172, RY + 44, `מתחילה לנסוע\ntᵣ = ${num(p.tr)} ש'`, 'b') + txt(160, RY - 90, 'בנקודת המפגש הם במקום אחד', 'k');
    return svg('ניידת רודפת אחרי מכונית', 185, s);
  },
  braking_ratio: (p) => {
    let s = road(60) + car(10, 60, 'a') + arrow(58, 20, 98, 20, 'a') + txt(78, 14, `${num(p.v1)} מ/ש`, 'a') + line(250, 24, 250, 60, { c: 'c', w: 3 }) + dim(32, 80, 250, 80, `${num(p.d1)} מ'`, { below: true });
    s += road(160) + car(10, 160, 'b') + arrow(58, 120, 118, 120, 'b') + txt(88, 114, `${num(p.v2)} מ/ש`, 'b') + line(250, 124, 250, 160, { c: 'c', w: 3 }) + dim(32, 180, 250, 180, 'x = ?', { below: true });
    return svg('מרחק בלימה בשתי מהירויות', 210, s);
  },
  projectile_37: (p) => {
    let s = ground(10, 310, GY - 40) + ball(30, GY - 46, 'a', 5) + arrow(30, GY - 46, 66, GY - 74, 'a') + txt(70, GY - 78, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M30 ${GY - 46}Q155 ${GY - 46 - 140} 280 ${GY - 46}`, 'k') + `<path d="M52 ${GY - 46}A22 22 0 0 0 49.6 ${GY - 59.2}" stroke="${COL.b}"/>` + txt(58, GY - 52, '37°', 'b', 'start');
    s += line(155, GY - 46, 155, GY - 116, { dash: true, op: 0.6 }) + dim(155, GY - 46, 155, GY - 116, 'H = ?') + dim(30, GY - 28, 280, GY - 28, 'R = ?', { below: true });
    return svg('זריקה בזווית 37° מהקרקע', 225, s);
  },
  projectile_cliff_53: (p) => {
    const top = 82, gy = 190;
    let s = building(10, top, 70, gy) + ground(10, 310, gy) + ball(80, top, 'a', 5) + arrow(80, top, 108, top - 38, 'a') + txt(112, top - 42, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += `<path d="M96 ${top}A16 16 0 0 0 ${80 + 9.6} ${top - 12.8}" stroke="${COL.b}"/>` + txt(100, top + 4, '53°', 'b', 'start');
    const k = 2.4, vy = 0.8 * p.v0, tt = (vy + Math.sqrt(vy * vy + 20 * p.h)) / 10;
    s += curve(80, top, 0.6 * p.v0 * k, vy * k, 10 * k, tt, 'k') + dim(40, top, 40, gy, `h = ${num(p.h)} מ'`) + dim(80, gy + 14, 270, gy + 14, 'x = ?', { below: true });
    return svg('זריקה בזווית 53° ממצוק', 235, s);
  },
  projectile_45: (p) => {
    const g0 = GY - 30;
    let s = ground(10, 310, g0) + ball(30, g0 - 6, 'a', 5) + arrow(30, g0 - 6, 62, g0 - 38, 'a') + txt(68, g0 - 40, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M30 ${g0 - 6}Q155 ${g0 - 6 - 180} 280 ${g0 - 6}`, 'k') + `<path d="M50 ${g0 - 6}A20 20 0 0 0 44.1 ${g0 - 20.1}" stroke="${COL.b}"/>` + txt(54, g0 - 10, '45°', 'b', 'start');
    const xm = 30 + (250 * p.x) / (p.v0 * p.v0 / 10);
    const ym = g0 - 6 - (180 / 2) * (1 - Math.pow(1 - (2 * (xm - 30)) / 250, 2));
    s += line(xm, ym, xm, g0 - 6, { dash: true, c: 'b' }) + ball(xm, ym, 'b', 4) + txt(xm + 6, (ym + g0) / 2, 'y = ?', 'b', 'start');
    s += dim(30, g0 + 8, xm, g0 + 8, `x = ${num(p.x)} מ'`, { below: true }) + dim(30, g0 + 28, 280, g0 + 28, 'R = ?', { below: true });
    return svg('זריקה בזווית 45° מהקרקע', 235, s);
  },
  projectile_60: (p) => {
    const g0 = GY - 30;
    let s = ground(10, 310, g0) + ball(30, g0 - 6, 'a', 5) + arrow(30, g0 - 6, 50, g0 - 41, 'a') + txt(56, g0 - 40, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M30 ${g0 - 6}Q135 ${g0 - 6 - 250} 240 ${g0 - 6}`, 'k') + `<path d="M46 ${g0 - 6}A16 16 0 0 0 38 ${g0 - 19.9}" stroke="${COL.b}"/>` + txt(48, g0 - 14, '60°', 'b', 'start');
    s += line(135, g0 - 6 - 125, 135, g0 - 6, { dash: true, op: 0.6 }) + ball(135, g0 - 6 - 125, 'c', 4) + txt(145, g0 - 6 - 125, 'שיא\nv = ?', 'c', 'start') + dim(120, g0 - 6 - 125, 120, g0 - 6, 'H = ?');
    const f = (0.75 * p.v0 * p.v0 - (p.v1 * p.v1 - (p.v0 / 2) ** 2)) / (0.75 * p.v0 * p.v0);
    const yl = g0 - 6 - 125 * f;
    s += line(40, yl, 230, yl, { dash: true, c: 'b' }) + txt(222, yl - 6, `v = ${num(p.v1)} מ/ש`, 'b', 'start') + dim(272, yl, 272, g0 - 6, 'h = ?', { c: 'b' });
    return svg('זריקה בזווית 60° מהקרקע', 185, s);
  },
  projectile_30_down: (p) => {
    let s = building(24, 45, 72, GY) + ground(10, 310, GY) + ball(96, 45, 'a', 5) + arrow(96, 45, 128, 62, 'a') + txt(134, 60, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += qpath(96, 45, 181, 94, 230, GY - 6) + `<path d="M118 45A22 22 0 0 1 115 55.5" stroke="${COL.b}"/>` + txt(122, 46, '30°', 'b', 'start');
    s += dim(262, 45, 262, GY, `h = ${num(p.h)} מ'`) + line(96, 45, 262, 45, { dash: true, op: 0.6 }) + ball(230, GY - 6, 'c', 4) + txt(224, GY - 34, 'פגיעה\nt = ?', 'c', 'end');
    return svg('זריקה בזווית 30° כלפי מטה ממגדל', 215, s);
  },
  moving_target: (p) => {
    const top = 50;
    let s = building(10, top, 60, RY) + ground(10, 310, RY) + ball(70, top, 'a') + arrow(74, top, 116, top, 'a') + txt(120, top - 6, 'vₓ = ?', 'a', 'start');
    s += qpath(70, top, 166, top, 262, RY - 14) + dim(36, top, 36, RY, `h = ${num(p.h)} מ'`) + dim(70, RY + 16, 248, RY + 16, `d = ${num(p.d0)} מ'`, { below: true });
    s += rect(248, RY - 14, 34, 10, { c: 'b', fill: 'b', rx: 3 }) + arrow(284, RY - 24, 308, RY - 24, 'b') + txt(268, RY - 30, `${num(p.u)} מ/ש`, 'b') + txt(266, RY + 36, 'סירה', 'b');
    return svg('אבן נזרקת מצוק אל סירה נעה', 185, s);
  },
  plane_drop: (p) => {
    const py = 40, sy = 190;
    let s = ground(10, 310, sy) + `<path d="M24 ${py}h36l-6 -8h-8l-4 8M24 ${py}l-6 -8" stroke="${COL.a}" fill="${COL.a}" fill-opacity="0.18"/>` + arrow(66, py, 108, py, 'a') + txt(112, py - 6, `${num(p.vp)} מ/ש`, 'a', 'start');
    s += ball(60, py + 4, 'b', 4) + qpath(60, py + 4, 162, py + 4, 265, sy - 12, 'b') + dim(20, py, 20, sy, `h = ${num(p.h)} מ'`);
    s += rect(246, sy - 12, 38, 10, { c: 'c', fill: 'c', rx: 3 }) + arrow(286, sy - 24, 308, sy - 24, 'c') + txt(266, sy - 30, `${num(p.vs)} מ/ש`, 'c') + dim(60, sy - 40, 265, sy - 40, 'd = ?');
    return svg('מטוס משחרר חבילה על אונייה נעה', 215, s);
  },
  catch_up_accel: (p) => {
    let s = road(RY) + car(14, RY, 'a') + arrow(62, RY - 40, 102, RY - 40, 'a') + txt(82, RY - 46, `v = ${num(p.v)} מ/ש`, 'a') + txt(36, RY + 24, 'משאית', 'a');
    s += car(14, RY + 75, 'b') + road(RY + 75, 10, 310) + txt(36, RY + 99, 'אופנוע', 'b') + txt(100, RY + 55, 'v₀ = 0', 'k', 'start');
    s += arrow(130, RY + 52, 186, RY + 52, 'b') + txt(190, RY + 56, `a = ${num(p.a)} מ/ש²`, 'b', 'start');
    return svg('אופנוע יוצא מהמנוחה ורודף אחרי משאית', 225, s);
  },
  braking_obstacle: (p) => {
    let s = road(RY) + car(10, RY, 'a') + arrow(58, RY - 40, 98, RY - 40, 'a') + txt(78, RY - 46, `v = ${num(p.v)} מ/ש`, 'a');
    s += rect(278, RY - 40, 26, 40, { c: 'c', fill: 'c' }) + txt(291, RY - 46, 'מכשול', 'c') + dim(32, RY + 22, 278, RY + 22, `D = ${num(p.D)} מ'`, { below: true });
    s += dim(32, RY + 52, 120, RY + 52, `tᵣ = ${num(p.tr)} ש'`, { below: true, c: 'b' }) + arrow(206, RY - 62, 166, RY - 62, 'b') + txt(186, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b');
    return svg('נהג בולם לפני מכשול', 200, s);
  },
  table_roll: (p) => {
    const top = 55;
    let s = building(14, top, 140, RY) + ground(10, 310, RY) + ball(24, top - 6, 'a', 5) + arrow(32, top - 6, 72, top - 6, 'a') + txt(52, top - 14, `v₀ = ${num(p.v0)} מ/ש`, 'a');
    s += arrow(140, top - 22, 100, top - 22, 'b') + txt(120, top - 28, `a = ${num(p.a)} מ/ש²`, 'b') + dim(24, top + 14, 154, top + 14, `L = ${num(p.L)} מ'`, { below: true });
    s += qpath(154, top - 6, 205, top - 6, 256, RY - 6) + dim(306, top, 306, RY, `h = ${num(p.h)} מ'`, { left: true }) + dim(154, RY + 16, 256, RY + 16, 'x = ?', { below: true });
    return svg('כדור מתגלגל על שולחן ונופל', 180, s);
  },

  // ---- vertical (exam level)
  elevator_throw_relative: (p) => {
    let s = ground(10, 310, GY) + line(70, 30, 70, GY, { op: 0.4 }) + line(190, 30, 190, GY, { op: 0.4 });
    s += line(86, 150, 174, 150, { w: 3, c: 'a' }) + line(86, 110, 86, 150) + line(174, 110, 174, 150);
    s += ball(130, 142, 'b', 5) + arrow(130, 132, 130, 66, 'b') + txt(140, 80, `w = ${num(p.w)} מ/ש\nביחס למעלית`, 'b', 'start');
    s += arrow(212, 144, 212, 104, 'a') + txt(220, 126, `u = ${num(p.u)} מ/ש`, 'a', 'start');
    s += line(174, 150, 250, 150, { dash: true, op: 0.6 }) + dim(250, 150, 250, GY, `h = ${num(p.h)} מ'`);
    return svg('כדור נזרק מתוך מעלית עולה', 215, s);
  },
  overtake_fall: (p) => {
    const ym = 140;
    let s = building(24, 45, 72, GY) + ground(10, 310, GY) + line(96, 45, 260, 45, { dash: true, op: 0.6 });
    s += ball(112, 45, 'a') + path(`M112 45L112 ${ym}`, 'a') + txt(112, 32, 'א׳', 'a');
    s += ball(150, 45, 'b') + arrow(150, 56, 150, 96, 'b') + path(`M150 96L150 ${ym}`, 'b') + txt(150, 32, 'ב׳', 'b');
    s += line(100, ym, 250, ym, { dash: true, op: 0.6 }) + ball(112, ym, 'c', 4) + ball(150, ym, 'c', 4);
    s += dim(270, 45, 270, ym, `d = ${num(p.d)} מ'`) + txt(176, 70, `v₀ = ?\nנזרקת אחרי\nΔt = ${num(p.dt)} ש'`, 'b', 'start');
    return svg('שתי אבנים מראש מגדל: ההשגה בעומק נתון', 215, s);
  },
  vt_free_fall_graph: (p) =>
    vtGraph({ pts: [[0, 0], [p.t1, G10 * p.t1], [p.t2, p.vland], [p.t3, p.vland]], xmax: p.t3, vmin: 0, vmax: G10 * p.t1 + 5, xs: 1, vs: 10, labelled: [2, 3], title: 'גרף מהירות-זמן של צנחן' }),
  balloon_two_packages: (p) => {
    let s = ground(10, 310, GY) + `<ellipse cx="90" cy="60" rx="22" ry="28" stroke="${COL.a}" fill="${COL.a}" fill-opacity="0.18"/>`;
    s += line(90, 88, 90, 100) + ball(90, 104, 'a', 4) + path(`M90 108L90 ${GY - 6}`, 'a') + arrow(130, 60, 130, 28, 'k') + txt(138, 48, `u = ${num(p.u)} מ/ש`, 'k', 'start');
    s += `<ellipse cx="200" cy="40" rx="22" ry="28" stroke="${COL.b}" fill="${COL.b}" fill-opacity="0.12"/>` + line(200, 68, 200, 78) + ball(200, 82, 'b', 4);
    s += arrow(200, 90, 200, 130, 'b') + path(`M200 134L200 ${GY - 6}`, 'b') + txt(210, 112, `נזרקת אחרי\nΔt = ${num(p.dt)} ש'\nw = ${num(p.w)} מ/ש`, 'b', 'start');
    s += txt(90, 124, 'א׳ נשמטת', 'a') + line(40, 104, 70, 104, { dash: true, op: 0.6 }) + dim(40, 104, 40, GY, `h = ${num(p.h)} מ'`);
    return svg('שתי חבילות מבלון עולה', 215, s);
  },
  same_throw_delay: (p) => {
    const ly = GY - 110;
    let s = ground(10, 310, GY) + ball(90, GY - 6, 'a') + arrow(90, GY - 14, 90, GY - 60, 'a') + txt(80, GY - 36, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'end');
    s += ball(170, GY - 6, 'b') + arrow(170, GY - 14, 170, GY - 60, 'b') + txt(180, GY - 36, `v₀ = ${num(p.v0)} מ/ש\nנזרקת אחרי Δt`, 'b', 'start');
    s += line(70, ly, 260, ly, { dash: true, op: 0.6 }) + ball(90, ly, 'a', 5) + arrow(90, ly + 8, 90, ly + 36, 'a') + ball(170, ly, 'b', 5) + arrow(170, ly + 36, 170, ly + 8, 'b');
    s += dim(290, ly, 290, GY, `y = ${num(p.y)} מ'`, { left: true }) + txt(130, ly - 12, 'נפגשות', 'c');
    return svg('שני כדורים באותה מהירות, זריקה מאוחרת', 215, s);
  },
  well_sound: (p) => {
    let s = ground(10, 130, 60) + ground(190, 310, 60) + line(130, 60, 130, 190) + line(190, 60, 190, 190);
    s += `<path d="M130 190q15 -8 30 0t30 0" stroke="${COL.a}"/>` + ball(160, 70, 'b') + txt(170, 76, 'v₀ = 0', 'k', 'start') + arrow(160, 80, 160, 130, 'b');
    s += dim(110, 60, 110, 190, 'h = ?', { left: true }) + arrow(176, 180, 176, 100, 'c') + txt(204, 130, `קול\nc = ${num(p.c)} מ/ש`, 'c', 'start');
    s += txt(160, 22, `T = ${num(p.T)} ש' מהשחרור עד ההתזה`, 'k');
    return svg('אבן נופלת לבאר והקול חוזר', 215, s);
  },
  two_stage_rocket: (p) => {
    const v1 = p.a1 * p.t1, h1 = (p.a1 * p.t1 * p.t1) / 2, v2 = v1 + p.a2 * p.t2, h2 = h1 + v1 * p.t2 + (p.a2 * p.t2 * p.t2) / 2;
    const Hm = h2 + (v2 * v2) / 20, k = 150 / Hm, base = GY - 6;
    let s = ground(10, 310, GY) + path(`M100 ${base}L100 ${base - Hm * k}`, 'k') + rect(94, base - 14, 12, 18, { c: 'a', fill: 'a', rx: 3 });
    s += line(70, base - h1 * k, 250, base - h1 * k, { dash: true, op: 0.6 }) + ball(100, base - h1 * k, 'b', 4) + txt(110, base - h1 * k + 16, `סוף שלב 1: t₁ = ${num(p.t1)} ש'`, 'b', 'start');
    s += line(70, base - h2 * k, 250, base - h2 * k, { dash: true, op: 0.6 }) + ball(100, base - h2 * k, 'b', 4) + txt(110, base - h2 * k - 6, `סוף שלב 2: t₂ = ${num(p.t2)} ש'`, 'b', 'start');
    s += ball(100, base - Hm * k, 'c', 4) + txt(110, base - Hm * k + 4, 'שיא', 'c', 'start');
    s += arrow(60, base - 30, 60, base - 70, 'a') + txt(52, base - 50, `a₁ = ${num(p.a1)} מ/ש²`, 'a', 'end');
    s += arrow(60, base - 80, 60, base - 120, 'a') + txt(52, base - 100, `a₂ = ${num(p.a2)} מ/ש²`, 'a', 'end') + dim(290, base - Hm * k, 290, base, 'H = ?', { left: true });
    return svg('רקטה בשני שלבי הנעה', 215, s);
  },
  diver_plunge: (p) => {
    const ty = 70, wy = 140, sc = 7;
    let s = building(24, ty, 80, 205) + rect(10, wy, 300, 65, { c: 'a', fill: 'a' }) + line(10, wy, 310, wy, { c: 'a', w: 2 });
    s += ball(104, ty - 6, 'b') + arrow(104, ty - 14, 104, ty - 14 - 5 * 3, 'b') + path(`M120 ${ty - 6 - (p.v0 * p.v0 * sc) / 20}L120 ${wy + p.d * sc}`, 'k');
    s += ball(120, ty - 6 - (p.v0 * p.v0 * sc) / 20, 'c', 4) + txt(132, ty - 12 - (p.v0 * p.v0 * sc) / 20, 'שיא', 'c', 'start') + txt(96, ty - 40, `v₀ = ${num(p.v0)} מ/ש`, 'b', 'end');
    s += dim(250, ty, 250, wy, `h = ${num(p.h)} מ'`) + dim(250, wy, 250, wy + p.d * sc, `d = ${num(p.d)} מ'`, { c: 'b' }) + ball(120, wy + p.d * sc, 'c', 4) + txt(130, wy + p.d * sc + 14, 'עצירה', 'c', 'start');
    return svg('צולל קופץ למים', 215, s);
  },
  meet_at_apex: (p) => {
    const k = 150 / p.H, base = GY - 6, top = base - p.H * k;
    const t = (-p.w + Math.sqrt(p.w * p.w + 40 * p.H)) / 20;
    const ym = base - 5 * t * t * k;
    let s = building(24, top, 72, GY) + ground(10, 310, GY) + ball(112, top, 'a') + arrow(112, top + 8, 112, top + 44, 'a') + txt(122, top + 30, `w = ${num(p.w)} מ/ש`, 'a', 'start') + txt(112, top - 10, 'א׳', 'a');
    s += ball(190, base, 'b') + arrow(190, base - 8, 190, base - 50, 'b') + txt(180, base - 30, 'v₀ = ?', 'b', 'end');
    s += line(100, ym, 230, ym, { dash: true, op: 0.6 }) + ball(190, ym, 'c', 5) + txt(200, ym - 8, 'שיא של ב׳\nנפגשות כאן', 'c', 'start');
    s += dim(290, top, 290, base, `H = ${num(p.H)} מ'`, { left: true });
    return svg('מפגש בשיא התנועה של אבן עולה', 215, s);
  },
  tower_last_second: (p) => {
    const roof = 70, base = GY - 6;
    let s = building(24, roof, 72, GY) + ground(10, 310, GY) + ball(112, roof, 'a') + arrow(112, roof - 6, 112, roof - 40, 'a') + txt(122, roof - 22, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M112 ${roof - 40}L112 ${roof - 20}`, 'k') + path(`M130 ${roof - 20}L130 ${base}`, 'k');
    s += `<line x1="130" y1="140" x2="130" y2="${base}" stroke="${COL.b}" stroke-width="4"/>` + dim(170, 140, 170, base, `${num(p.d)} מ'`, { c: 'b' }) + txt(186, 120, 'בשנייה האחרונה', 'b', 'start');
    s += dim(280, roof, 280, GY, 'h = ?', { left: true }) + line(96, roof, 280, roof, { dash: true, op: 0.4 });
    return svg('אבן נזרקת כלפי מעלה מראש מגדל', 215, s);
  },

  // ---- horizontal (exam level)
  projectile_wall: (p) => {
    const g0 = 175, sc = 3.2, x0 = 30, y0 = g0 - 6, t = p.x / p.vx;
    const hx = x0 + p.x * sc, hy = y0 - (p.vy * t - 5 * t * t) * sc;
    let s = ground(10, 310, g0) + ball(x0, y0, 'a', 5) + arrow(x0, y0, x0 + p.vx * 2, y0 - p.vy * 2, 'a') + txt(x0 + 4, y0 - p.vy * 2 - 10, `vₓ = ${num(p.vx)} מ/ש , vᵧ = ${num(p.vy)} מ/ש`, 'a', 'start');
    s += curve(x0, y0, p.vx * sc, p.vy * sc, 10 * sc, t, 'k') + rect(hx, g0 - 120, 12, 120, { fill: 'k' }) + ball(hx, hy, 'b', 5);
    s += line(hx, hy, 270, hy, { dash: true, c: 'b' }) + dim(286, hy, 286, y0, 'y = ?', { c: 'b', left: true }) + dim(x0, g0 + 16, hx, g0 + 16, `x = ${num(p.x)} מ'`, { below: true });
    return svg('כדור בדרכו אל קיר', 215, s);
  },
  platform_landing_53: (p) => {
    const g0 = 185, sc = 3.4, x0 = 30, y0 = g0 - 6, vx = 0.6 * p.v0, vy = 0.8 * p.v0, t2 = (vy + Math.sqrt(vy * vy - 2 * 10 * p.hp)) / 10;
    const top = y0 - p.hp * sc, px = x0 + vx * t2 * sc;
    let s = building(px - 36, top, 320 - px, g0 - top) + ground(10, 310, g0) + ball(x0, y0, 'a', 5) + arrow(x0, y0, x0 + 0.6 * 44, y0 - 0.8 * 44, 'a') + txt(x0 + 34, y0 - 44, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += curve(x0, y0, vx * sc, vy * sc, 10 * sc, t2, 'k') + ball(px, top, 'b', 5) + txt(x0 + 44, y0 - 14, '53°', 'b', 'start');
    s += dim(24, top, 24, y0, `hₚ = ${num(p.hp)} מ'`, { c: 'b' }) + line(24, top, px - 36, top, { dash: true, op: 0.6 }) + dim(x0, g0 + 16, px, g0 + 16, 'x = ?', { below: true });
    return svg('כדור נוחת על גג נמוך', 215, s);
  },
  two_car_graph: (p) =>
    vtGraph({ pts: [[0, p.vA], [p.tEnd, p.vA]], pts2: [[0, 0], [p.tB, p.vB], [p.tEnd, p.vB]], xmax: p.tEnd, vmin: 0, vmax: p.vB + 5, xs: 2, vs: 5, labelled: [0], labelled2: [1], notes: [[p.tEnd, p.vA, 'א׳', 'a'], [p.tEnd, p.vB, 'ב׳', 'c']], title: 'גרף מהירות-זמן של שתי מכוניות' }),
  train_accel_platform: (p) => {
    let s = road(RY);
    for (let i = 0; i < 3; i++) s += rect(20 + i * 40, RY - 30, 36, 24, { c: 'a', fill: 'a', rx: 3 }) + ball(32 + i * 40, RY - 3, 'k', 3) + ball(48 + i * 40, RY - 3, 'k', 3);
    s += arrow(14, RY - 46, 54, RY - 46, 'a') + txt(70, RY - 52, `v₀ = ${num(p.v0)} מ/ש  ·  a = ?`, 'a', 'start');
    s += rect(170, RY - 12, 130, 12, { c: 'c', fill: 'c' }) + line(170, RY - 60, 170, RY, { c: 'b', w: 3 }) + txt(170, RY - 66, 'עמוד', 'b');
    s += dim(20, RY + 22, 140, RY + 22, 'L = ?', { below: true }) + dim(170, RY + 22, 300, RY + 22, `P = ${num(p.P)} מ'`, { below: true });
    s += txt(160, RY + 66, `הזנב עובר את העמוד אחרי ${num(p.t1)} ש'\nהזנב יוצא מהרציף אחרי ${num(p.t2)} ש'`, 'k');
    return svg('רכבת מאיצה על פני עמוד ורציף', 195, s);
  },
  overtake_oncoming_stop: (p) => {
    let s = road(RY) + car(14, RY, 'a') + arrow(62, RY - 40, 102, RY - 40, 'a') + txt(82, RY - 46, `${num(p.vc)} מ/ש`, 'a');
    s += rect(110, RY - 34, 70, 34, { c: 'b', fill: 'b' }) + ball(122, RY - 2, 'k', 5) + ball(168, RY - 2, 'k', 5) + arrow(184, RY - 20, 214, RY - 20, 'b') + txt(200, RY - 26, `${num(p.vt)} מ/ש`, 'b');
    s += `<g opacity="0.8">${car(250, RY, 'c')}</g>` + arrow(246, RY - 40, 206, RY - 40, 'c') + txt(226, RY - 66, `${num(p.vo)} מ/ש, בולם\na = ${num(p.ao)} מ/ש²`, 'c');
    s += dim(58, RY + 24, 250, RY + 24, 'D = ?', { below: true }) + txt(147, RY + 62, `פער ${num(p.g1)} מ' · משאית ${num(p.Lt)} מ' · מכונית ${num(p.Lc)} מ' · פער ${num(p.g2)} מ'`, 'k');
    return svg('עקיפה כשרכב מתקרב בולם', 200, s);
  },
  dog_between_walkers: (p) => {
    const man = (x, c) => ball(x, RY - 32, c, 5) + line(x, RY - 27, x, RY - 10, { c }) + line(x, RY - 10, x - 5, RY) + line(x, RY - 10, x + 5, RY) + line(x - 6, RY - 22, x + 6, RY - 22, { c });
    let s = road(RY) + man(30, 'a') + man(290, 'b') + arrow(44, RY - 50, 84, RY - 50, 'a') + txt(64, RY - 56, `${num(p.vA)} מ/ש`, 'a') + arrow(276, RY - 50, 236, RY - 50, 'b') + txt(256, RY - 56, `${num(p.vB)} מ/ש`, 'b');
    s += `<ellipse cx="60" cy="${RY - 6}" rx="9" ry="5" stroke="${COL.c}" fill="${COL.c}" fill-opacity="0.2"/>` + arrow(76, RY - 18, 126, RY - 18, 'c') + txt(100, RY - 26, `כלב ${num(p.vd)} מ/ש`, 'c');
    s += dim(30, RY + 24, 290, RY + 24, `d = ${num(p.d)} מ'`, { below: true });
    return svg('כלב רץ בין שני הולכים', 175, s);
  },
  rear_end: (p) => {
    let s = road(RY) + car(14, RY, 'b') + arrow(62, RY - 40, 102, RY - 40, 'b') + txt(82, RY - 46, `${num(p.v)} מ/ש`, 'b') + txt(36, RY + 22, 'ב׳', 'b');
    s += car(170, RY, 'a') + arrow(218, RY - 40, 258, RY - 40, 'a') + txt(238, RY - 46, `${num(p.v)} מ/ש`, 'a') + txt(192, RY + 22, 'א׳', 'a');
    s += dim(58, RY + 36, 170, RY + 36, `g = ${num(p.g)} מ'`, { below: true });
    s += txt(60, RY - 80, `בולמת אחרי tᵣ = ${num(p.tr)} ש'\na₂ = ${num(p.a2)} מ/ש²`, 'b') + txt(240, RY - 80, `בולמת מיד\na₁ = ${num(p.a1)} מ/ש²`, 'a');
    return svg('התנגשות מאחור: זמן תגובה ובלימה', 185, s);
  },
  river_two_ways: (p) => {
    const x0 = 100, drift = (p.vc / p.vb) * p.w * 0.8;
    let s = rect(10, 40, 300, 120, { c: 'a', fill: 'a' }) + line(10, 40, 310, 40, { w: 2 }) + line(10, 160, 310, 160, { w: 2 });
    s += rect(x0 - 8, 148, 16, 8, { c: 'b', fill: 'b', rx: 3 }) + arrow(x0, 146, x0, 96, 'b') + txt(x0 + 8, 120, `v = ${num(p.vb)} מ/ש\nביחס למים`, 'b', 'start');
    s += arrow(190, 100, 250, 100, 'c') + txt(220, 90, `זרם ${num(p.vc)} מ/ש`, 'c') + path(`M${x0} 148L${x0 + drift} 44`, 'k') + dim(24, 40, 24, 160, `w = ${num(p.w)} מ'`, {});
    s += dim(x0, 28, x0 + drift, 28, 'x = ?', {});
    return svg('סירה חוצה נהר עם זרם', 175, s);
  },
  cliff_moving_boat: (p) => {
    const sc = 0.9, top = 70, gy = top + p.H * sc, x0 = 94, t = (p.vy + Math.sqrt(p.vy * p.vy + 20 * p.H)) / 10, vx = (p.D + p.u * t) / t;
    const bx0 = x0 + p.D * sc, bx1 = x0 + vx * t * sc;
    let s = building(14, top, 80, gy - top) + ground(10, 310, gy) + ball(x0, top, 'a', 5) + arrow(x0, top, x0 + 14, top - 34, 'a') + txt(x0 + 22, top - 26, `vᵧ = ${num(p.vy)} מ/ש`, 'a', 'start');
    s += curve(x0, top, vx * sc, p.vy * sc, 10 * sc, t, 'k') + `<g opacity="0.5">${rect(bx0 - 14, gy - 10, 28, 8, { c: 'b', fill: 'b', rx: 3 })}</g>` + rect(bx1 - 14, gy - 10, 28, 8, { c: 'b', fill: 'b', rx: 3 });
    s += arrow(bx0 + 18, gy - 14, bx0 + 38, gy - 14, 'b') + txt(bx0 + 24, gy - 22, `${num(p.u)} מ/ש`, 'b', 'start') + dim(54, top, 54, gy, `H = ${num(p.H)} מ'`, {});
    s += dim(14, gy + 18, bx0, gy + 18, `D = ${num(p.D)} מ'`, { below: true });
    return svg('אבן נזרקת בזווית ממצוק אל סירה נעה', 185, s);
  },
  double_catch: (p) => {
    let s = road(RY) + car(14, RY, 'b') + arrow(62, RY - 40, 102, RY - 40, 'b') + txt(82, RY - 46, `${num(p.v)} מ/ש`, 'b') + txt(36, RY + 22, 'ב׳', 'b');
    s += car(200, RY, 'a') + txt(222, RY - 40, 'v₀ = 0', 'k') + arrow(210, RY - 62, 260, RY - 62, 'a') + txt(235, RY - 68, `a = ${num(p.a)} מ/ש²`, 'a') + txt(222, RY + 22, 'א׳', 'a');
    s += dim(58, RY + 36, 200, RY + 36, `d₀ = ${num(p.d0)} מ'`, { below: true });
    return svg('מכונית נוסעת מאחורי מכונית שיוצאת מהמנוחה', 175, s);
  },
};

// ------------------------------------------------------------ validation
const FORBIDDEN = /<\s*(script|foreignObject|iframe|image|use|style)\b|\son[a-z]+\s*=|javascript:|data:|\bhref\s*=|xlink:|@import|url\(\s*['"]?(?!#)/i;
export function validateSvg(s) {
  const errs = [];
  if (typeof s !== 'string' || !s.trim()) return ['empty'];
  if (!/^<svg [^>]*viewBox="[^"]+"[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s) || !s.endsWith('</svg>')) errs.push('must be one <svg viewBox xmlns> element');
  if (FORBIDDEN.test(s)) errs.push('contains forbidden content (script, event handler, external ref)');
  if ((s.match(/https?:\/\//g) || []).length !== 1) errs.push('external URL other than the xmlns');
  if (!/<title>[^<]*[֐-׿][^<]*<\/title>/.test(s)) errs.push('missing Hebrew <title>');
  if (/fill="(#000|#fff|black|white)/i.test(s) || /stroke="(#000|#fff|black|white)/i.test(s)) errs.push('fixed black/white color');
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) {
        errs.push(`unbalanced tag </${name}>`);
        break;
      }
    } else stack.push(name);
  }
  if (stack.length) errs.push(`unclosed tag <${stack[stack.length - 1]}>`);
  return errs;
}

export function diagramFor(ex) {
  const fn = diagrams[ex.verify && ex.verify.model];
  if (!fn) throw new Error(`no diagram builder for model "${ex.verify && ex.verify.model}"`);
  return fn(ex.verify.params);
}

// ------------------------------------------------------------ CLI
const here = dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2];
  const file = process.argv[3] || join(here, '..', 'data', 'physics.json');
  if (mode !== '--write' && mode !== '--check') {
    console.error('Usage: node tools/diagrams.mjs --write|--check [physics.json]');
    process.exit(2);
  }
  const raw = readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const list = JSON.parse(raw);
  const problems = [];
  const out = list.map((ex) => {
    let d;
    try {
      d = diagramFor(ex);
    } catch (e) {
      problems.push(`${ex.id}: ${e.message}`);
      return ex;
    }
    validateSvg(d).forEach((m) => problems.push(`${ex.id}: generated diagram invalid: ${m}`));
    layoutIssues(d).forEach((m) => problems.push(`${ex.id}: layout: ${m}`));
    if (mode === '--check') {
      if (typeof ex.diagram !== 'string' || !ex.diagram) problems.push(`${ex.id}: diagram missing`);
      else if (ex.diagram !== d) problems.push(`${ex.id}: stored diagram differs from generated (run --write)`);
      return ex;
    }
    const res = {};
    for (const k of Object.keys(ex)) {
      if (k === 'diagram') continue;
      res[k] = ex[k];
      if (k === 'statement') res.diagram = d;
    }
    if (!('statement' in res)) res.diagram = d;
    return res;
  });
  if (problems.length) {
    console.error(`FAILED: ${problems.length} problem(s)`);
    problems.forEach((m) => console.error(' - ' + m));
    process.exit(1);
  }
  if (mode === '--write') {
    const text = JSON.stringify(out, null, 2).replace(/\n/g, eol) + eol;
    if (text !== raw) writeFileSync(file, text);
    console.log(`wrote diagrams for ${out.length} exercises`);
  } else console.log(`OK: ${list.length} diagrams present, valid and up to date`);
}
