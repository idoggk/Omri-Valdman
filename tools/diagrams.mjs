// Generates the inline SVG "diagram" field of every exercise in data/physics.json from the
// exercise's verify.model + verify.params, so the numbers on the figure match the statement.
// Usage: node tools/diagrams.mjs --write    (regenerate the diagram fields, idempotent)
//        node tools/diagrams.mjs --preview  (write preview/diagrams.html, a static gallery)
//        node tools/diagrams.mjs --check    (fail if a diagram is missing, invalid, overlapping or stale)
//
// Layout model: every builder returns SVG primitives. svg() parses them into a geometric scene
// (segments with stroke width, arrow heads, filled rects/circles/ellipses, curve samples, other
// labels) and a placement function moves each label to the nearest candidate position whose text
// box touches nothing. --check re-parses the stored SVG with the SAME scene model and fails on any
// overlap, so a diagram can only ship if the engine that placed the labels also accepts them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------- primitives
// Namespaced vars the site never defines: the diagram panel is always white, so the dark-mode
// site accent (light blue) would be illegible there. The fallbacks are the real colours.
const COL = {
  k: 'currentColor',
  a: 'var(--dg-a, #1f5fae)',
  b: 'var(--dg-b, #c2410c)',
  c: 'var(--dg-c, #1e7a34)',
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

const FS = 14;
const VB_W = 320;

export const svg = (title, h, body) =>
  relayout(
    `<svg viewBox="0 0 ${VB_W} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">` +
      `<title>${esc(title)}</title><defs>${markers}</defs>` +
      `<g direction="ltr" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" font-size="${FS}">${body}</g></svg>`
  );

export const line = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${COL[o.c || 'k']}"` +
  `${o.dash ? ' stroke-dasharray="5 4"' : ''}${o.w ? ` stroke-width="${o.w}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`;

export const arrow = (x1, y1, x2, y2, c = 'k') =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${COL[c]}" stroke-width="2" marker-end="url(#ph-${c})"/>`;

// Label: thin dark/accent text with a white halo (the panel colour, never the theme colour).
// Multi-line labels are one <text> with <tspan>s so the layout moves them as a block.
// fix=true pins the label (axis ticks); it is still checked. own=true says the label belongs to the
// filled rect it sits in (allowed there, must be fully inside with margin).
const LINE_H = 16;

// ---- bidi: a label is a list of separate runs, each with an explicit direction.
// The page paragraph is LTR, so a Hebrew phrase, an LTR expression (symbols, numbers) and the
// separators between them must never be left to the Unicode bidi algorithm to order. A line is
// split into clauses at ":" "," ";" and "·"; every clause becomes one isolated run (a Hebrew clause
// RTL, any other clause LTR, with a Hebrew unit inside an LTR clause as a nested RTL run and a
// Latin expression inside a Hebrew clause as a nested LTR run). The separator stays glued to the end
// of the clause it closes, so a colon is always on the correct side of its phrase. A line whose
// first clause is Hebrew reads right-to-left, so its clauses are emitted in reverse (visual) order.
const HEB_LETTER = /[א-ת]/;
const HEB_UNIT = /^(?:ש['׳]|מ['׳]|מ\/ש[²2]?)$/;
const LRI = '⁦'; // left-to-right isolate
const RLI = '⁧'; // right-to-left isolate
const PDI = '⁩'; // pop directional isolate
const geresh = (s) => s.replace(/([א-ת])'/g, '$1׳');
const run = (dir, inner) => `<tspan direction="${dir}" unicode-bidi="isolate">${dir === 'rtl' ? RLI : LRI}${inner}${PDI}</tspan>`;
const hebRun = (t) => run('rtl', esc(t));

// An LTR clause: Hebrew words are nested RTL runs; a unit right after a number is its own run.
function ltrClause(c) {
  const parts = [];
  const re = /[א-ת][א-ת'׳״\/²]*(?: [א-ת][א-ת'׳״\/²]*)*/g;
  let last = 0;
  let m;
  while ((m = re.exec(c))) {
    parts.push(esc(c.slice(last, m.index)));
    const words = m[0].split(' ');
    const afterNumber = /[\d)]\s*$/.test(c.slice(0, m.index));
    if (afterNumber && HEB_UNIT.test(words[0]) && words.length > 1) {
      parts.push(hebRun(words[0]), ' ', hebRun(words.slice(1).join(' ')));
    } else parts.push(hebRun(m[0]));
    last = m.index + m[0].length;
  }
  parts.push(esc(c.slice(last)));
  return run('ltr', parts.join(''));
}

// A Hebrew clause: a Latin expression (from its first Latin letter to the next Hebrew letter) is a nested LTR run.
function rtlClause(c) {
  const parts = [];
  const re = /[A-Za-zΑ-ωₐ-ₜ][^א-ת]*/g;
  let last = 0;
  let m;
  while ((m = re.exec(c))) {
    parts.push(esc(c.slice(last, m.index)));
    const expr = m[0].replace(/\s+$/, '');
    parts.push(run('ltr', esc(expr)) + (m[0].length > expr.length ? ' ' : ''));
    last = m.index + m[0].length;
  }
  parts.push(esc(c.slice(last)));
  return run('rtl', parts.join(''));
}

export function bidiRuns(line) {
  const text = geresh(String(line)).trim();
  if (!HEB_LETTER.test(text)) return esc(text);
  const clauses = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '·') {
      if (cur.trim()) clauses.push(cur.trim());
      clauses.push('·');
      cur = '';
    } else {
      cur += ch;
      if ((ch === ':' || ch === ';' || ch === ',') && (text[i + 1] === ' ' || i === text.length - 1)) {
        clauses.push(cur.trim());
        cur = '';
      }
    }
  }
  if (cur.trim()) clauses.push(cur.trim());
  const dirOf = (c) => (HEB_LETTER.test(c[0]) ? 'rtl' : 'ltr');
  const first = clauses.find((c) => c !== '·');
  const rtlLine = first && dirOf(first) === 'rtl';
  const rendered = clauses.map((c) => (c === '·' ? esc('·') : dirOf(c) === 'rtl' ? rtlClause(c) : ltrClause(c)));
  return (rtlLine ? rendered.reverse() : rendered).join(' ');
}

export const txt = (x, y, s, c = 'k', anc = 'middle', fix = false, own = false) => {
  const lines = String(s).split('\n');
  // A text chunk that holds an RTL run flips the meaning of start/end in the browser. Such labels are
  // therefore always anchored in the middle (symmetric in both directions), at the centre of the box
  // that the start/end anchor would have produced.
  if (anc !== 'middle' && lines.some((l) => HEB_LETTER.test(l))) {
    const w = Math.max(...lines.map((l) => textW(geresh(l))));
    x += anc === 'start' ? w / 2 : -w / 2;
    anc = 'middle';
  }
  const attrs =
    `x="${r1(x)}" y="${r1(y)}" text-anchor="${anc}" fill="${COL[c]}" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round" stroke-linecap="round" font-weight="400"` +
    (fix ? ' data-f="1"' : '') +
    (own ? ' data-in="1"' : '');
  if (lines.length === 1) return `<text ${attrs}>${bidiRuns(lines[0])}</text>`;
  return `<text ${attrs}>${lines.map((ln, i) => `<tspan x="${r1(x)}" dy="${i ? LINE_H : 0}">${bidiRuns(ln)}</tspan>`).join('')}</text>`;
};
export const txtIn = (x, y, s, c = 'k', anc = 'middle') => txt(x, y, s, c, anc, false, true);

// ---------------------------------------------------------------- scene model
const HEB = /[֐-׿]/;
const textW = (s) => {
  let w = 0;
  for (const ch of s) w += HEB.test(ch) ? FS * 0.6 : ch === ' ' ? FS * 0.3 : FS * 0.62;
  return w;
};
const attr = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
const stripEnt = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

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
    else if (cmd === 'Q' || cmd === 'q' || cmd === 't') {
      const rel = cmd !== 'Q';
      const x0 = cx, y0 = cy;
      let qx, qy;
      if (cmd === 't') { qx = x0; qy = y0; } else { qx = n() + (rel ? x0 : 0); qy = n() + (rel ? y0 : 0); }
      const ex = n() + (rel ? x0 : 0), ey = n() + (rel ? y0 : 0);
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        to(u * u * x0 + 2 * u * t * qx + t * t * ex, u * u * y0 + 2 * u * t * qy + t * t * ey);
      }
    } else if (cmd === 'A') { i += 5; to(n(), n()); }
    else if (cmd === 'z' || cmd === 'Z') to(sx, sy);
    else break;
  }
  return segs;
}

// Arrow head of a marker line: the 10x10 triangle scaled by markerWidth(7)/10 * stroke-width.
function headTriangle(x1, y1, x2, y2, sw) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, s = 0.7 * sw;
  const bx = x2 - ux * 9 * s, by = y2 - uy * 9 * s;
  return [[x2 + ux * s, y2 + uy * s], [bx - uy * 5 * s, by + ux * 5 * s], [bx + uy * 5 * s, by - ux * 5 * s]];
}

export function parseScene(s) {
  const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(s);
  const W = vb ? Number(vb[1]) : VB_W;
  const H = vb ? Number(vb[2]) : 200;
  const body = s.replace(/<defs>[\s\S]*?<\/defs>/, '').replace(/<title>[\s\S]*?<\/title>/, '');
  const segs = []; // {p:[x1,y1,x2,y2], w, what}
  const polys = []; // arrow heads
  const rects = []; // filled rects [x0,y0,x1,y1]
  const rounds = []; // filled circles / ellipses {cx,cy,rx,ry}
  const solid = (tag) => {
    const op = attr(tag, 'opacity');
    return !(op !== null && Number(op) < 0.3);
  };
  const filled = (tag) => {
    const f = attr(tag, 'fill');
    return f !== null && f !== 'none';
  };
  for (const m of body.replace(TEXT_RE, '').matchAll(/<(line|polyline|path|rect|circle|ellipse)\b([^>]*?)\/?>/g)) {
    const [, kind, tag] = m;
    if (!solid(tag)) continue;
    const f = (k) => Number(attr(tag, k));
    const sw = attr(tag, 'stroke-width') !== null ? f('stroke-width') : 1.5;
    if (kind === 'line') {
      const [x1, y1, x2, y2] = [f('x1'), f('y1'), f('x2'), f('y2')];
      segs.push({ p: [x1, y1, x2, y2], w: sw, what: attr(tag, 'marker-end') || attr(tag, 'marker-start') ? 'arrow/dimension line' : 'line' });
      if (attr(tag, 'marker-end')) polys.push({ pts: headTriangle(x1, y1, x2, y2, sw), what: 'arrow head' });
      if (attr(tag, 'marker-start')) polys.push({ pts: headTriangle(x2, y2, x1, y1, sw), what: 'arrow head' });
    } else if (kind === 'polyline') {
      const p = attr(tag, 'points').trim().split(/\s+/).map((q) => q.split(',').map(Number));
      for (let i = 1; i < p.length; i++) segs.push({ p: [...p[i - 1], ...p[i]], w: sw, what: 'graph line' });
    } else if (kind === 'path') {
      const what = /[QqAa]/.test(attr(tag, 'd')) || (attr(tag, 'd').match(/L/g) || []).length > 4 ? 'trajectory' : 'path';
      for (const p of pathSegs(attr(tag, 'd'))) segs.push({ p, w: sw, what });
    } else if (kind === 'rect') {
      const x = f('x'), y = f('y'), w = f('width'), h = f('height');
      for (const p of [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]]) segs.push({ p, w: sw, what: 'rect edge' });
      if (filled(tag)) rects.push({ b: [x, y, x + w, y + h], what: `filled rect (${r1(x)},${r1(y)} ${r1(w)}x${r1(h)})` });
    } else if (kind === 'circle') {
      rounds.push({ cx: f('cx'), cy: f('cy'), rx: f('r') + 1, ry: f('r') + 1, what: `circle (${r1(f('cx'))},${r1(f('cy'))})` });
    } else {
      rounds.push({ cx: f('cx'), cy: f('cy'), rx: f('rx') + sw / 2, ry: f('ry') + sw / 2, what: `ellipse (${r1(f('cx'))},${r1(f('cy'))})` });
    }
  }
  const texts = [];
  for (const m of s.matchAll(TEXT_RE)) {
    const tag = m[1];
    const inner = m[2];
    // Measurement follows the rendered runs: tags and isolate marks have no width, run gaps are the spaces between runs.
    const plain = (x) => stripEnt(x.replace(/<[^>]*>/g, '').replace(/[⁦-⁩]/g, ''));
    const lines = inner.includes('<tspan x=') ? inner.split(/(?=<tspan x=)/).map(plain) : [plain(inner)];
    const x = Number(attr(tag, 'x'));
    const y = Number(attr(tag, 'y'));
    const anc = attr(tag, 'text-anchor') || 'start';
    const w = Math.max(...lines.map(textW));
    const x0 = anc === 'start' ? x : anc === 'end' ? x - w : x - w / 2;
    const top = y - FS * 0.95;
    texts.push({
      lines,
      fix: /data-f="1"/.test(tag),
      own: /data-in="1"/.test(tag),
      box: [x0, top, x0 + w, top + FS * 1.25 + LINE_H * (lines.length - 1)],
      label: lines.join(' '),
    });
  }
  return { W, H, segs, polys, rects, rounds, texts };
}

// ---------------------------------------------------------------- geometry
const inflate = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
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
function inTriangle([px, py], t) {
  const sgn = (a, b) => (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d1 = sgn(t[0], t[1]), d2 = sgn(t[1], t[2]), d3 = sgn(t[2], t[0]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
function roundHitsBox(r, b, m) {
  const px = Math.max(b[0], Math.min(r.cx, b[2]));
  const py = Math.max(b[1], Math.min(r.cy, b[3]));
  return ((px - r.cx) / (r.rx + m)) ** 2 + ((py - r.cy) / (r.ry + m)) ** 2 < 1;
}

const VIEW_MARGIN = 6; // text box to viewBox edge
const LINE_GAP = 3; // text box to a stroke, measured from the stroke edge
const TEXT_GAP = 4; // text box to another text box
const INSIDE_MARGIN = 4; // an owned label must clear its rect edge by this much

// Returns a description of the first thing the text box (core metrics box) touches, or null.
function conflict(t, box, sc, others, H) {
  if (box[0] < VIEW_MARGIN || box[1] < VIEW_MARGIN || box[2] > sc.W - VIEW_MARGIN || box[3] > H - VIEW_MARGIN) return 'the viewBox border';
  for (const sg of sc.segs) {
    if (segHitsBox(sg.p, inflate(box, LINE_GAP + sg.w / 2))) return `${sg.what} (${sg.p.map(r1).join(',')})`;
  }
  for (const pl of sc.polys) {
    if (inTriangle([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], pl.pts) || pl.pts.some((q) => q[0] > box[0] - 2 && q[0] < box[2] + 2 && q[1] > box[1] - 2 && q[1] < box[3] + 2)) return `${pl.what} (${pl.pts.map((q) => q.map(r1).join(',')).join(' ')})`;
    for (let i = 0; i < 3; i++) {
      const a = pl.pts[i], b = pl.pts[(i + 1) % 3];
      if (segHitsBox([a[0], a[1], b[0], b[1]], inflate(box, 2))) return `${pl.what} (${pl.pts.map((q) => q.map(r1).join(',')).join(' ')})`;
    }
  }
  for (const r of sc.rounds) if (roundHitsBox(r, box, LINE_GAP)) return r.what;
  for (const r of sc.rects) {
    if (!boxHit(box, inflate(r.b, 0))) continue;
    const inside = box[0] >= r.b[0] + INSIDE_MARGIN && box[1] >= r.b[1] + INSIDE_MARGIN && box[2] <= r.b[2] - INSIDE_MARGIN && box[3] <= r.b[3] - INSIDE_MARGIN;
    if (!(t.own && inside)) return `${r.what}${inside ? ' (label inside a rect it does not own)' : ''}`;
  }
  for (const o of others) if (boxHit(inflate(box, TEXT_GAP / 2), inflate(o.box, TEXT_GAP / 2))) return `text "${o.label}"`;
  return null;
}

const OFFSETS = [];
for (let dx = -150; dx <= 150; dx += 3) for (let dy = -110; dy <= 110; dy += 3) OFFSETS.push([dx, dy, dx * dx + dy * dy * 1.5]);
OFFSETS.sort((a, b) => a[2] - b[2]);

// Moves every label to the nearest candidate position (any side, increasing offsets) where it
// touches nothing; grows the canvas downwards when nothing fits. Never emits an overlap: throws.
export function relayout(s) {
  const sc = parseScene(s);
  let ext = 0;
  let shift;
  let fail = '';
  for (; ext <= 160; ext += 20) {
    const H = sc.H + ext;
    const placed = sc.texts.filter((t) => t.fix);
    shift = new Map();
    let ok = true;
    for (let idx = 0; idx < sc.texts.length && ok; idx++) {
      const t = sc.texts[idx];
      if (t.fix) {
        const why = conflict(t, t.box, sc, placed.filter((o) => o !== t), H);
        if (why) { ok = false; fail = `pinned label "${t.label}" overlaps ${why}`; }
        continue;
      }
      let found = false;
      for (const [dx, dy] of OFFSETS) {
        const box = [t.box[0] + dx, t.box[1] + dy, t.box[2] + dx, t.box[3] + dy];
        if (!conflict(t, box, sc, placed, H)) {
          shift.set(idx, [dx, dy]);
          placed.push({ box, label: t.label });
          found = true;
          break;
        }
      }
      if (!found) { ok = false; fail = `no free position for label "${t.label}"`; }
    }
    if (ok) break;
    shift = null;
  }
  if (!shift) throw new Error(`cannot lay out labels without overlap: ${fail}`);
  let idx = -1;
  let out = s.replace(TEXT_RE, (all, tag, inner) => {
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
  if (ext) out = out.replace(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/, (q, w, h) => `viewBox="0 0 ${w} ${Number(h) + ext}"`);
  return out;
}

// Same engine as relayout(): every label must touch nothing and stay inside the viewBox.
export function layoutIssues(s) {
  const sc = parseScene(s);
  const out = [];
  sc.texts.forEach((t, i) => {
    const why = conflict(t, t.box, sc, sc.texts.filter((o, j) => j !== i), sc.H);
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
  const every = Math.max(1, Math.ceil(26 / (xs * sx))); // label every n-th tick so numbers never touch
  for (let i = 0, t = 0; t <= xmax + 1e-9; i++, t = i * xs) {
    g += line(X(t), top, X(t), bot, { op: 0.18 });
    if (i % every === 0) g += txt(X(t), bot + 24, num(t), 'k', 'middle', true);
  }
  for (let v = vmin; v <= vmax + 1e-9; v += vs) {
    g += line(ox, Y(v), oxEnd, Y(v), { op: 0.18 });
    g += txt(ox - 10, Y(v) + 5, num(v), 'k', 'end', true);
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
  return svg(title, 234, g);
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

// stone released from rest, falls for t seconds; q is the unknown shown on the right
function ffTime(p, q) {
  let s = ground(10, 310, GY) + line(100, 40, 100, GY, { dash: true, op: 0.6 });
  s += ball(100, 40, 'a') + txt(112, 44, 't = 0, v₀ = 0', 'k', 'start');
  s += ball(100, 108, 'a') + txt(112, 112, '...', 'k', 'start');
  s += ball(100, GY - 6, 'a') + txt(112, GY - 14, `t = ${num(p.t)} ש'`, 'b', 'start');
  s += (q.startsWith('h') ? dim(240, 40, 240, GY, q) : txt(240, 120, q, 'c')) + arrow(70, 70, 70, 120, 'b') + txt(60, 100, 'g', 'b', 'end');
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

  // ---- level-1 scenes (one unknown each)
  l1_ff_time: (p) => svg('כדור נשמט ממנוחה מגובה h', 215, tower(p, { extra: txt(120, 36, 'v₀ = 0', 'k', 'start') + arrow(112, 70, 112, 110, 'b') + txt(122, 98, 'g', 'b', 'start') + txt(122, 150, 't = ?', 'c', 'start') })),
  l1_ff_speed_h: (p) => svg('כדור נשמט ממנוחה מגובה h', 215, tower(p, { extra: txt(120, 36, 'v₀ = 0', 'k', 'start') + arrow(112, 70, 112, 110, 'b') + txt(122, 98, 'g', 'b', 'start') + txt(122, 150, 'v = ?', 'c', 'start') })),
  l1_ff_speed_t: (p) => svg('אבן נופלת במשך t שניות', 215, ffTime(p, 'v = ?')),
  l1_ff_height_t: (p) => svg('אבן נופלת במשך t שניות', 215, ffTime(p, 'h = ?')),
  l1_up_time: (p) => svg('כדור נזרק אנכית כלפי מעלה', 215, rise(p, { top: 'שיא\nt = ?' })),
  l1_up_height: (p) => svg('כדור נזרק אנכית כלפי מעלה', 215, rise(p, { extra: dim(250, 40, 250, GY, 'H = ?') })),
  l1_launch_time: (p) => svg('גוף נזרק אופקית משולחן', 180, launchScene(p, { vx: `${num(p.vx)} מ/ש`, h: `h = ${num(p.h)} מ'`, R: 't = ?' })),
  l1_launch_range: (p) => svg('גוף נזרק אופקית משולחן', 180, launchScene(p, { vx: `${num(p.vx)} מ/ש`, h: `h = ${num(p.h)} מ'`, R: 'x = ?' })),
  l1_launch_vx: (p) => svg('כדור נזרק אופקית מגג', 180, launchScene(p, { vx: 'vₓ = ?', h: `h = ${num(p.h)} מ'`, R: `R = ${num(p.R)} מ'` })),
  l1_accel_speed: (p) => {
    let s = road(RY) + car(20, RY, 'a') + txt(42, RY - 40, 'v₀ = 0', 'k') + arrow(30, RY - 62, 80, RY - 62, 'b') + txt(55, RY - 68, `a = ${num(p.a)} מ/ש²`, 'b');
    s += `<g opacity="0.55">${car(220, RY, 'a')}</g>` + txt(242, RY - 40, `t = ${num(p.t)} ש'`, 'k') + txt(242, RY - 60, 'v = ?', 'c');
    return svg('מכונית מאיצה מהמנוחה', 185, s);
  },
  l1_brake_dist: (p) => diagrams.braking_only(p),
  l1_meet_time: (p) => diagrams.const_velocity_meet(p),

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
    s += txt(160, 22, `מהשחרור עד ההתזה:
T = ${num(p.T)} ש'`, 'k');
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
    s += dim(58, RY + 24, 250, RY + 24, 'D = ?', { below: true }) + txt(147, RY + 62, `פער ${num(p.g1)} מ' · משאית ${num(p.Lt)} מ'
מכונית ${num(p.Lc)} מ' · פער ${num(p.g2)} מ'`, 'k');
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

  // ---- upgraded vertical (multi-part)
  two_drops_same_landing: (p) => {
    const sc = 155 / p.H1, y1 = GY - p.H1 * sc, y2 = GY - p.H2 * sc;
    let s = ground(10, 310, GY) + building(20, y1, 46, GY) + building(150, y2, 46, GY);
    s += ball(80, y1, 'a') + arrow(80, y1 + 12, 80, y1 + 50, 'a') + txt(90, y1 + 4, 'כדור א׳', 'a', 'start');
    s += ball(210, y2, 'b') + arrow(210, y2 + 12, 210, y2 + 50, 'b') + txt(220, y2 - 8, 'כדור ב׳', 'b', 'start');
    s += line(66, y1, 130, y1, { dash: true, op: 0.6 }) + dim(130, y1, 130, GY, `H₁ = ${num(p.H1)} מ'`, { left: true });
    s += dim(290, y2, 290, GY, `H₂ = ${num(p.H2)} מ'`, { left: true }) + txt(230, y2 + 70, 'ב׳ משוחרר אחרי\nΔt = ?', 'b', 'start');
    return svg('שני כדורים נשמטים מגבהים שונים', 225, s);
  },
  free_fall_time_parts: (p) => {
    const roof = 36, sc = 160 / ((10 * p.T * p.T) / 2), H = (10 * p.T * p.T) / 2, yq = roof + (H / 4) * sc, yl = roof + (H - (10 * (p.T - 2) ** 2) / 2) * sc;
    let s = building(20, roof, 56, GY) + ground(10, 310, GY) + ball(100, roof, 'a') + txt(110, roof - 6, 'v₀ = 0', 'k', 'start');
    s += path(`M100 ${roof}L100 ${GY - 6}`, 'k') + line(100, yq, 250, yq, { dash: true, op: 0.6 }) + txt(106, yq - 6, 'רבע מהגובה', 'b', 'start');
    s += line(100, yl, 250, yl, { dash: true, op: 0.6 }) + `<line x1="100" y1="${r1(yl)}" x2="100" y2="${GY - 6}" stroke="${COL.b}" stroke-width="4"/>`;
    s += dim(236, yl, 236, GY, 'd = ?', { c: 'b' }) + txt(228, (yl + GY) / 2 + 4, '2 ש׳ אחרונות', 'b', 'end');
    s += dim(290, roof, 290, GY, 'H = ?', { left: true }) + txt(112, GY - 14, `T = ${num(p.T)} ש'`, 'k', 'start');
    return svg('אבן נופלת במשך T שניות', 215, s);
  },
  throw_flight_time_levels: (p) => {
    const hmax = (10 * (5 * p.T) ** 2) / 20, ly = GY - 6 - ((GY - 46) * p.hq) / hmax;
    const extra = line(80, ly, 250, ly, { dash: true, op: 0.6 }) + ball(100, ly, 'c', 5) + txt(112, ly + 16, 'v = ?', 'c', 'start') + dim(250, ly, 250, GY, `h = ${num(p.hq)} מ'`) + txt(150, 100, `זמן באוויר T = ${num(p.T)} ש'`, 'b', 'start') + dim(222, 40, 222, ly, 'Δt = ?', { c: 'b' });
    return svg('זריקה אנכית וזמן באוויר', 215, rise(p, { v0: 'v₀ = ?', top: 'שיא\nH = ?', extra }));
  },
  nth_second_given: (p) => {
    const y0 = 36, y1 = 100, y2 = 160;
    let s = ground(10, 310, GY) + path(`M100 ${y0}L100 ${GY - 6}`, 'k') + ball(100, y0, 'a') + txt(112, y0 + 4, 'v₀ = 0', 'k', 'start');
    s += line(80, y1, 220, y1, { dash: true, op: 0.6 }) + ball(100, y1, 'a') + txt(112, y1 - 6, 't = n − 1', 'k', 'start');
    s += line(80, y2, 220, y2, { dash: true, op: 0.6 }) + ball(100, y2, 'a') + txt(112, y2 + 16, 't = n', 'k', 'start');
    s += dim(232, y1, 232, y2, `d = ${num(p.d)} מ'`, { c: 'b' }) + txt(240, (y1 + y2) / 2 - 12, 'בשנייה\nה־n', 'b', 'start') + arrow(60, 60, 60, 110, 'b') + txt(50, 90, 'g', 'b', 'end');
    return svg('אבן נופלת: מרחק בשנייה מסוימת', 215, s);
  },
  half_speed_height: (p) => {
    const ly = GY - 100;
    const extra = line(80, ly, 250, ly, { dash: true, op: 0.6 }) + ball(100, ly, 'c', 5) + txt(112, ly + 16, 'v = v₀ / 2', 'c', 'start') + dim(250, ly, 250, GY, `h = ${num(p.h)} מ'`) + dim(250, 40, 250, ly, 'עוד עלייה', { c: 'b', left: true });
    return svg('כדור בעלייה: מהירות חצי מהמהירות ההתחלתית', 215, rise(p, { v0: 'v₀ = ?', top: 'שיא', extra }));
  },
  roof_throw_averages: (p) => {
    const apex = (p.v0 * p.v0) / 20, sc = 150 / (p.h + apex), roof = 24 + apex * sc;
    let s = building(20, roof, 56, GY) + ground(10, 310, GY) + ball(100, roof, 'a') + arrow(100, roof - 8, 100, roof - 8 - apex * sc * 0.6, 'a') + txt(110, roof - 22, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M100 ${r1(roof)}L100 24`, 'k') + path(`M122 24L122 ${GY - 6}`, 'b') + ball(100, 24, 'b', 4) + txt(110, 30, 'שיא', 'b', 'start') + ball(122, GY - 6, 'a');
    s += line(76, roof, 130, roof, { dash: true, op: 0.6 }) + dim(290, roof, 290, GY, `h = ${num(p.h)} מ'`, { left: true }) + txt(240, 110, 'מסלול כולל\nזמן T = ?', 'b', 'start');
    return svg('כדור נזרק מגג: מסלול ותזוזה', 215, s);
  },
  down_throw_beats_drop: (p) => {
    const extra = ball(150, 45, 'b') + arrow(150, 56, 150, 100, 'b') + txt(160, 90, 'v₀ = ?', 'b', 'start') + txt(122, 36, 'א׳', 'a', 'end') + txt(162, 36, 'ב׳', 'b', 'start') + path(`M150 45L150 ${GY - 6}`, 'b');
    return svg('שתי אבנים נזרקות מאותו גובה', 215, tower(p, { extra: extra + txt(170, 150, `ב׳ נוחתת אחרי\ntB = ${num(p.tB)} ש'`, 'b', 'start') }));
  },
  thrown_then_dropped: (p) => {
    const apex = (p.v0 * p.v0) / 20, sc = 150 / (p.h + apex), roof = 24 + apex * sc;
    let s = building(20, roof, 56, GY) + ground(10, 310, GY) + ball(100, roof, 'a') + arrow(100, roof - 8, 100, Math.max(roof - 24, 14), 'a') + txt(108, roof - 16, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M100 ${r1(roof)}L100 24`, 'k') + path(`M120 24L120 ${GY - 6}`, 'k') + ball(120, GY - 6, 'a');
    s += ball(160, roof, 'b') + path(`M160 ${r1(roof)}L160 ${GY - 6}`, 'b') + arrow(160, roof + 8, 160, roof + 44, 'b') + txt(170, roof - 8, 'ב׳ נשמטת\nכשא׳ חוזרת לגג', 'b', 'start');
    s += line(76, roof, 170, roof, { dash: true, op: 0.6 }) + dim(290, roof, 290, GY, `h = ${num(p.h)} מ'`, { left: true });
    return svg('אבן נזרקת מגג ואבן שנייה נשמטת אחריה', 215, s);
  },
  meet_vertical_after_apex: (p) => {
    let s = ground(10, 310, GY) + building(190, 40, 40, GY) + ball(110, GY - 6, 'a') + arrow(110, GY - 14, 110, GY - 70, 'a');
    s += txt(120, GY - 40, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start') + txt(100, GY - 90, 'ב׳', 'a', 'end');
    s += ball(176, 40, 'b') + txt(170, 34, 'א׳ נשמט', 'b', 'end') + arrow(176, 52, 176, 92, 'b');
    const my = GY - 6 - 0.3 * (GY - 46);
    s += line(100, my, 180, my, { dash: true, op: 0.6 }) + ball(110, my, 'c', 5) + txt(120, my + 18, 'מפגש\ny = ?', 'c', 'start');
    s += dim(262, 40, 262, GY, `H = ${num(p.H)} מ'`);
    return svg('מפגש של שני כדורים כשאחד כבר יורד', 215, s);
  },
  last_second_then_throw: (p) => {
    let s = ground(10, 310, GY) + path(`M100 36L100 ${GY - 6}`, 'k') + ball(100, 36, 'a') + txt(110, 30, 'א׳ נשמט', 'a', 'start');
    s += `<line x1="100" y1="130" x2="100" y2="${GY - 6}" stroke="${COL.b}" stroke-width="4"/>` + dim(150, 130, 150, GY - 6, `d = ${num(p.d)} מ'`, { c: 'b' }) + txt(165, 150, 'בשנייה האחרונה', 'b', 'start');
    s += ball(190, 36, 'c') + arrow(190, 48, 190, 90, 'c') + path(`M190 36L190 ${GY - 6}`, 'c') + txt(200, 70, `נזרק מטה\nw = ${num(p.w)} מ/ש`, 'c', 'start') + txt(196, 24, 'ב׳', 'c', 'start');
    s += dim(260, 36, 260, GY, 'H = ?', { left: false }) + ball(100, GY - 6, 'a');
    return svg('שני גופים מאותה נקודה: נפילה וזריקה כלפי מטה', 215, s);
  },
  drop_height_ratio: (p) => {
    const hb = 162, ha = hb / p.k;
    let s = ground(10, 310, GY) + line(90, GY - ha, 90, GY, { dash: true, op: 0.6 }) + line(230, GY - hb, 230, GY, { dash: true, op: 0.6 });
    s += ball(90, GY - ha, 'a') + ball(230, GY - hb, 'b') + dim(60, GY - ha, 60, GY, 'h = ?') + dim(262, GY - hb, 262, GY, `${num(p.k)}h`);
    s += txt(100, GY - ha - 8, 'כדור א׳', 'a', 'start') + txt(220, GY - hb - 8, 'כדור ב׳', 'b', 'end') + txt(150, 30, `ההפרש בין הנחיתות: Δt = ${num(p.dt)} ש'`, 'k');
    return svg('שני כדורים נופלים מגבהים שונים', 230, s);
  },
  vt_roof_throw_graph: (p) =>
    vtGraph({ pts: [[0, p.v0], [p.T, p.vEnd]], xmax: p.T, vmin: p.vEnd, vmax: p.v0, xs: 1, vs: 20, labelled: [0, 1], notes: [[(p.v0 * p.T) / (p.v0 - p.vEnd), 0, 'שיא', 'b']], title: 'גרף מהירות-זמן של אבן שנזרקה מגג' }),
  vt_elevator_chase: (p) => {
    const T = p.t1 + p.t2 + p.t3;
    return vtGraph({ pts: [[0, 0], [p.t1, p.v], [p.t1 + p.t2, p.v], [T, 0]], pts2: [[p.t0, 0], [p.t0, p.vB], [T, p.vB]], xmax: T, vmin: 0, vmax: p.vB + 2, xs: 1, vs: 3, labelled: [1, 2, 3], labelled2: [1], notes: [[T - 1, p.vB, 'מעלית ב׳', 'c'], [p.t1 + 1, p.v - 1.2, 'מעלית א׳', 'a']], title: 'גרף מהירות-זמן של שתי מעליות' });
  },

  // ---- upgraded horizontal (multi-part)
  delayed_meet: (p) => {
    let s = road(RY) + car(20, RY, 'a') + car(250, RY, 'b') + arrow(68, RY - 40, 108, RY - 40, 'a') + txt(88, RY - 46, `${num(p.v1)} מ/ש`, 'a');
    s += arrow(246, RY - 40, 206, RY - 40, 'b') + txt(226, RY - 46, `${num(p.v2)} מ/ש`, 'b') + dim(42, RY + 28, 272, RY + 28, `d = ${num(p.d)} מ'`, { below: true });
    s += txt(160, RY - 84, `ב׳ יוצאת אחרי t₀ = ${num(p.t0)} ש'`, 'b') + txt(42, RY + 54, 'עיירה 1', 'a') + txt(272, RY + 54, 'עיירה 2', 'b');
    return svg('שתי מכוניות יוצאות בזמנים שונים', 185, s);
  },
  accel_nth_second: (p) => {
    const xs = [24, 140, 220];
    let s = road(RY) + car(xs[0], RY, 'a') + txt(46, RY - 40, 'v₀ = 0', 'k') + arrow(30, RY - 62, 80, RY - 62, 'b') + txt(55, RY - 68, 'a = ?', 'b');
    s += `<g opacity="0.55">${car(xs[1], RY, 'a')}</g><g opacity="0.55">${car(xs[2], RY, 'a')}</g>` + txt(162, RY - 40, `t = ${num(p.n - 1)} ש'`, 'k') + txt(242, RY - 40, `t = ${num(p.n)} ש'`, 'k');
    s += dim(162, RY + 24, 242, RY + 24, `d = ${num(p.d)} מ'`, { below: true, c: 'b' }) + dim(46, RY + 48, 242, RY + 48, 'x = ?', { below: true });
    return svg('מכונית מאיצה מהמנוחה: מרחק בשנייה מסוימת', 195, s);
  },
  brake_to_line: (p) => {
    const f = 240 / p.D, mx = 30 + p.x * f;
    let s = road(RY) + car(10, RY, 'a') + arrow(58, RY - 40, 98, RY - 40, 'a') + txt(78, RY - 46, `v₀ = ${num(p.v0)} מ/ש`, 'a') + line(278, RY - 40, 278, RY, { c: 'c', w: 3 }) + txt(278, RY - 46, 'קו עצירה', 'c');
    s += line(mx, RY - 24, mx, RY + 36, { dash: true, op: 0.7 }) + ball(mx, RY - 24, 'b', 4) + txt(mx, RY - 32, 'v = ?', 'b');
    s += dim(32, RY + 22, mx, RY + 22, `x = ${num(p.x)} מ'`, { below: true }) + dim(32, RY + 54, 278, RY + 54, `D = ${num(p.D)} מ'`, { below: true });
    return svg('בלימה בדיוק עד קו עצירה', 195, s);
  },
  convoy_overtake: (p) => {
    let s = road(RY) + ball(24, RY - 10, 'a', 6) + arrow(34, RY - 10, 64, RY - 10, 'a') + txt(48, RY - 18, `${num(p.vf)} מ/ש`, 'a') + txt(24, RY + 20, 'אופנוע', 'a');
    for (let i = 0; i < 4; i++) s += rect(110 + i * 50, RY - 26, 42, 22, { c: 'b', fill: 'b', rx: 3 }) + ball(120 + i * 50, RY - 2, 'k', 3) + ball(140 + i * 50, RY - 2, 'k', 3);
    s += arrow(244, RY - 36, 290, RY - 36, 'b') + txt(268, RY - 44, `${num(p.vs)} מ/ש`, 'b') + dim(30, RY + 30, 110, RY + 30, `g = ${num(p.g)} מ'`, { below: true }) + dim(110, RY + 30, 302, RY + 30, `L = ${num(p.L)} מ'`, { below: true });
    s += txt(206, RY - 60, 'שיירת משאיות', 'b');
    return svg('אופנוע עוקף שיירה', 185, s);
  },
  head_start_finish: (p) => {
    let s = road(RY) + ball(30, RY - 12, 'a', 5) + arrow(44, RY - 14, 84, RY - 14, 'a') + txt(64, RY - 24, `${num(p.v_fast)} מ/ש`, 'a');
    s += ball(120, RY - 12, 'b', 5) + arrow(134, RY - 14, 164, RY - 14, 'b') + txt(150, RY - 24, `${num(p.v_slow)} מ/ש`, 'b') + txt(120, RY + 18, 'אצן', 'b') + txt(30, RY + 18, 'רוכב', 'a');
    s += line(290, RY - 44, 290, RY, { c: 'c', w: 3 }) + txt(290, RY - 50, 'קו הסיום', 'c') + dim(30, RY + 36, 290, RY + 36, `D = ${num(p.D)} מ'`, { below: true });
    s += txt(160, RY - 80, `הרוכב יוצא אחרי t₀ = ${num(p.t0)} ש'`, 'a');
    return svg('אצן ורוכב אל קו הסיום', 185, s);
  },
  accel_chase_max_gap: (p) => {
    let s = road(RY) + car(14, RY, 'a') + arrow(62, RY - 40, 102, RY - 40, 'a') + txt(82, RY - 46, `v₀ = ${num(p.v0)} מ/ש`, 'a') + arrow(20, RY - 62, 60, RY - 62, 'a') + txt(40, RY - 68, `a = ${num(p.a)} מ/ש²`, 'a');
    s += car(170, RY, 'b') + arrow(218, RY - 40, 258, RY - 40, 'b') + txt(238, RY - 46, `u = ${num(p.u)} מ/ש`, 'b') + dim(58, RY + 28, 170, RY + 28, `d₀ = ${num(p.d0)} מ'`, { below: true });
    s += txt(36, RY + 54, 'אופנוע', 'a') + txt(192, RY + 54, 'מכונית', 'b');
    return svg('אופנוע מאיץ אחרי מכונית', 185, s);
  },
  train_passes_pole: (p) => {
    let s = road(RY);
    for (let i = 0; i < 3; i++) s += rect(150 + i * 50, RY - 30, 44, 24, { c: 'a', fill: 'a', rx: 3 }) + ball(162 + i * 50, RY - 3, 'k', 3) + ball(182 + i * 50, RY - 3, 'k', 3);
    s += line(140, RY - 64, 140, RY, { c: 'b', w: 3 }) + txt(140, RY - 70, 'עמוד', 'b') + arrow(150, RY - 42, 190, RY - 42, 'a') + txt(228, RY - 52, `a = ?  ·  מהירות הזנב ${num(p.v2)} מ/ש`, 'a');
    s += dim(150, RY + 24, 300, RY + 24, `L = ${num(p.L)} מ'`, { below: true }) + txt(150, RY + 56, `חזית הרכבת עברה את העמוד במהירות ${num(p.v1)} מ/ש`, 'k', 'start');
    return svg('רכבת מאיצה על פני עמוד', 195, s);
  },
  table_wall: (p) => {
    const top = 55, f = (p.xw / (p.vx * Math.sqrt((2 * p.h) / 10))), wx = 104 + 142 * f, wy = top + (RY - 6 - top) * f * f;
    const extra = rect(wx, 28, 8, RY - 28, { fill: 'k' }) + ball(wx, wy, 'c', 4) + dim(wx + 20, wy, wx + 20, RY, 'y = ?', { c: 'c' }) + dim(104, 22, wx, 22, `${num(p.xw)} מ'`, { below: false });
    return svg('כדור מתגלגל מקצה שולחן אל קיר', 180, launchScene(p, { vx: `${num(p.vx)} מ/ש`, h: `h = ${num(p.h)} מ'`, R: 'x = ?', extra }));
  },
  opposite_throws: (p) => {
    const top = 52, gy = 170, x0 = 160, k = 200 / (p.vA + p.vB), xl = x0 - k * p.vA, xr = x0 + k * p.vB;
    let s = building(x0 - 22, top, 44, gy) + ground(10, 310, gy) + ball(x0 - 22, top, 'a', 5) + ball(x0 + 22, top, 'b', 5);
    s += arrow(x0 - 26, top, x0 - 58, top, 'a') + txt(x0 - 42, top - 8, `${num(p.vA)} מ/ש`, 'a') + arrow(x0 + 26, top, x0 + 58, top, 'b') + txt(x0 + 42, top - 8, `${num(p.vB)} מ/ש`, 'b');
    s += qpath(x0 - 22, top, (x0 - 22 + xl) / 2, top, xl, gy - 6, 'a') + qpath(x0 + 22, top, (x0 + 22 + xr) / 2, top, xr, gy - 6, 'b') + ball(xl, gy - 6, 'a', 4) + ball(xr, gy - 6, 'b', 4);
    s += dim(xl, gy + 16, xr, gy + 16, 'D = ?', { below: true }) + dim(x0 + 36, top, x0 + 36, gy, `h = ${num(p.h)} מ'`, { left: false });
    return svg('שתי אבנים נזרקות אופקית לשני הצדדים', 215, s);
  },
  max_safe_speed: (p) => {
    let s = road(RY) + car(10, RY, 'a') + arrow(58, RY - 40, 98, RY - 40, 'a') + txt(78, RY - 46, 'v = ?', 'a');
    s += line(120, RY - 8, 120, RY + 36, { dash: true, op: 0.6 }) + line(290, RY - 40, 290, RY, { c: 'c', w: 3 }) + txt(290, RY - 46, 'הולך רגל', 'c');
    s += dim(32, RY + 20, 120, RY + 20, `tᵣ = ${num(p.tr)} ש'`, { below: true }) + dim(120, RY + 20, 290, RY + 20, `a = ${num(p.a)} מ/ש²`, { below: true }) + dim(32, RY + 52, 290, RY + 52, `D = ${num(p.D)} מ'`, { below: true });
    return svg('המהירות הגבוהה ביותר לעצירה בטוחה', 195, s);
  },
  race_accel_cruise: (p) => {
    let s = road(60) + car(10, 60, 'a') + arrow(58, 20, 88, 20, 'a') + txt(74, 12, `a = ${num(p.a)} מ/ש²`, 'a') + arrow(100, 20, 160, 20, 'a') + txt(130, 12, `עד ${num(p.vmax)} מ/ש`, 'a') + line(290, 24, 290, 60, { c: 'c', w: 3 });
    s += road(150) + ball(30, 140, 'b', 6) + arrow(44, 140, 84, 140, 'b') + txt(64, 126, `u = ${num(p.u)} מ/ש`, 'b') + line(290, 114, 290, 150, { c: 'c', w: 3 });
    s += dim(32, 78, 290, 78, `D = ${num(p.D)} מ'`, { below: true }) + txt(20, 100, 'מכונית', 'a', 'start') + txt(20, 176, 'אופנוע', 'b', 'start');
    return svg('מכונית מאיצה מול אופנוע במהירות קבועה', 195, s);
  },
  roof_landing_range: (p) => {
    const gy = 190, sy = 2.6, sx = 3, yA = gy - p.H * sy, yB = gy - p.h2 * sy, wall = 74;
    const px1 = wall + p.x1 * sx, px2 = wall + p.x2 * sx;
    let s = building(14, yA, 60, gy) + building(px1, yB, px2 - px1, gy) + ground(10, 310, gy) + ball(wall, yA, 'a', 5) + arrow(wall + 4, yA, wall + 34, yA, 'a') + txt(wall + 38, yA - 8, 'v = ?', 'a', 'start');
    s += qpath(wall, yA, (wall + (px1 + px2) / 2) / 2, yA, (px1 + px2) / 2, yB - 6, 'k') + dim(wall, yB - 14, px1, yB - 14, `${num(p.x1)} מ'`, { below: true }) + dim(wall, yB + 40, px2, yB + 40, `${num(p.x2)} מ'`, { below: true });
    s += dim(12, yA, 12, gy, `H = ${num(p.H)} מ'`, { left: false }) + dim(px2 + 24, yB, px2 + 24, gy, `h = ${num(p.h2)} מ'`);
    return svg('כדור נזרק אופקית אל גג נמוך', 225, s);
  },
  vt_reverse_graph: (p) => {
    const T = p.t1 + p.t2 + p.t3;
    return vtGraph({ pts: [[0, 0], [p.t1, p.v], [p.t1 + p.t2, p.v], [T, -p.w]], xmax: T, vmin: -Math.ceil(p.w / 6) * 6, vmax: p.v + 2, xs: 1, vs: 6, labelled: [1, 2, 3], notes: [[p.t1 + p.t2 + (p.v * p.t3) / (p.v + p.w), 0, 'עוצרת', 'b']], title: 'גרף מהירות-זמן של מכונית שנוסעת ונוסעת לאחור' });
  },
  dry_wet_braking: (p) => {
    const f = 230 / p.D;
    let s = road(60) + car(10, 60, 'a') + arrow(58, 20, 98, 20, 'a') + txt(78, 12, `${num(p.v)} מ/ש`, 'a') + line(260, 24, 260, 60, { c: 'c', w: 3 }) + txt(160, 36, `כביש יבש: a₁ = ${num(p.a1)} מ/ש²`, 'a') + dim(32, 80, 260, 80, `D = ${num(p.D)} מ'`, { below: true });
    s += road(160) + car(10, 160, 'b') + arrow(58, 120, 98, 120, 'b') + txt(78, 112, `${num(p.v)} מ/ש`, 'b') + line(260, 124, 260, 160, { c: 'c', w: 3 }) + txt(160, 136, `כביש רטוב: a₂ = ${num(p.a2)} מ/ש²`, 'b') + dim(32, 180, 260, 180, `לפני הבלימה: tᵣ = ${num(p.tr)} ש'`, { below: true });
    return svg('בלימה על כביש יבש וכביש רטוב', 215, s);
  },
  kick_37_wall: (p) => {
    const g0 = GY - 40, x0 = 30, xe = 280, ap = 70, sw = (p.xw / ((2 * 0.6 * p.v0 * 0.8 * p.v0) / 10)), wx = x0 + (xe - x0) * sw, wy = g0 - 6 - 4 * ap * sw * (1 - sw);
    const hq = (ap * p.yq) / ((0.6 * p.v0) ** 2 / 20);
    let s = ground(10, 310, g0) + ball(x0, g0 - 6, 'a', 5) + arrow(x0, g0 - 6, x0 + 28, g0 - 28, 'a') + txt(x0 + 32, g0 - 30, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start');
    s += path(`M${x0} ${g0 - 6}Q155 ${g0 - 6 - 2 * ap} ${xe} ${g0 - 6}`, 'k') + rect(wx, g0 - 70, 8, 70, { fill: 'k' }) + ball(wx, wy, 'c', 4) + txt(wx - 8, wy - 12, 'y = ?', 'c', 'end');
    s += line(10, g0 - 6 - hq, 310, g0 - 6 - hq, { dash: true, op: 0.5 }) + dim(296, g0 - 6 - hq, 296, g0 - 6, `${num(p.yq)} מ'`, { left: true }) + txt(14, g0 - 6 - hq - 6, 'זמן מעל הקו: Δt = ?', 'b', 'start');
    s += dim(x0, g0 + 16, wx, g0 + 16, `${num(p.xw)} מ'`, { below: true }) + txt(40, g0 - 40, '37°', 'b', 'start');
    return svg('כדור נבעט מעל קיר בזווית 37°', 225, s);
  },
  projectile_45_levels: (p) => {
    const g0 = GY - 40, x0 = 30, xe = 280, ap = 62, hq = ((ap * p.yq) / (p.R / 4));
    const fx = (x) => x0 + ((xe - x0) * x) / p.R;
    const xs = (p.R - Math.sqrt(p.R * p.R - 4 * p.R * p.yq)) / 2, xt = (p.R + Math.sqrt(p.R * p.R - 4 * p.R * p.yq)) / 2;
    let s = ground(10, 310, g0) + ball(x0, g0 - 6, 'a', 5) + arrow(x0, g0 - 6, x0 + 26, g0 - 32, 'a') + txt(x0 + 30, g0 - 32, 'v₀ = ?', 'a', 'start') + txt(46, g0 - 14, '45°', 'b', 'start');
    s += path(`M${x0} ${g0 - 6}Q155 ${g0 - 6 - 2 * ap} ${xe} ${g0 - 6}`, 'k') + line(10, g0 - 6 - hq, 310, g0 - 6 - hq, { dash: true, op: 0.5 }) + ball(fx(xs), g0 - 6 - hq, 'b', 4) + ball(fx(xt), g0 - 6 - hq, 'b', 4);
    s += dim(fx(xs), g0 - 6 - hq - 16, fx(xt), g0 - 6 - hq - 16, 'Δx = ?', { c: 'b' }) + dim(296, g0 - 6 - hq, 296, g0 - 6, `${num(p.yq)} מ'`, { left: true });
    const qx = fx(p.xq), qs = p.xq / p.R;
    s += line(qx, g0 - 6, qx, g0 - 6 - 4 * ap * qs * (1 - qs), { dash: true, c: 'c' }) + ball(qx, g0 - 6 - 4 * ap * qs * (1 - qs), 'c', 4) + txt(qx + 6, g0 - 14, 'y = ?', 'c', 'start');
    s += dim(x0, g0 + 16, xe, g0 + 16, `R = ${num(p.R)} מ'`, { below: true });
    return svg('זריקה בזווית 45° דרך שתי נקודות באותו גובה', 225, s);
  },
  projectile_down_37: (p) => {
    const top = 40, gy = 190, x0 = 84, x1 = 282, R = 0.8 * p.v0 * ((Math.sqrt((0.6 * p.v0) ** 2 + 20 * p.h) - 0.6 * p.v0) / 10);
    const yc = top + 0.75 * ((x1 - x0) / 2), s0 = p.xq / R, qy = (1 - s0) ** 2 * top + 2 * s0 * (1 - s0) * yc + s0 * s0 * (gy - 6), qx = x0 + (x1 - x0) * s0;
    let s = building(14, top, 70, gy) + ground(10, 310, gy) + ball(x0, top, 'a', 5) + arrow(x0, top, x0 + 28, top + 21, 'a') + txt(x0 + 34, top + 14, `v₀ = ${num(p.v0)} מ/ש`, 'a', 'start') + txt(x0 + 6, top - 10, '37° מתחת לאופק', 'b', 'start');
    s += qpath(x0, top, (x0 + x1) / 2, yc, x1, gy - 6, 'k') + line(qx, qy, qx, gy, { dash: true, c: 'c' }) + ball(qx, qy, 'c', 4) + txt(qx + 6, (qy + gy) / 2, 'y = ?', 'c', 'start');
    s += dim(40, top, 40, gy, `h = ${num(p.h)} מ'`) + dim(x0, gy + 16, qx, gy + 16, `${num(p.xq)} מ'`, { below: true });
    return svg('זריקה בזווית 37° מתחת לאופק ממגדל', 230, s);
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
  const noText = s.replace(/<text\b[^>]*>/g, '<text>'); // label halos are deliberately white
  if (/fill="(#000|#fff|black|white)/i.test(noText) || /stroke="(#000|#fff|black|white)/i.test(noText)) errs.push('fixed black/white color');
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

// ------------------------------------------------------------ preview gallery
// Line endings never matter for freshness: git autocrlf may turn LF into CRLF on Windows.
export const lf = (s) => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n') : s);
export const sameText = (a, b) => lf(a) === lf(b);

export function previewHtml(list) {
  const card = (ex, cls) =>
    `<figure class="card ${cls}"><div class="fig" role="img" aria-label="${esc(ex.title || ex.id)}">${ex.diagram}</div><figcaption><code>${esc(ex.id)}</code> ${esc(ex.title || '')}</figcaption></figure>`;
  return (
    `<!doctype html>\n<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>תצוגת תרשימים – Brain Gains</title><style>` +
    `body{margin:0;padding:16px;background:#eef1f5;color:#1d2733;font-family:system-ui,Arial,sans-serif;line-height:1.5}` +
    `h1,h2{margin:.4em 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}` +
    `.card{margin:0;background:#fff;color:#1d2733;border:1px solid #d5dde6;border-radius:12px;padding:10px;text-align:center}` +
    `.fig{direction:ltr}.fig svg{display:block;width:100%;height:auto}` +
    `figcaption{margin-top:6px;font-size:.95rem}code{direction:ltr;unicode-bidi:isolate;background:#eef1f5;padding:1px 6px;border-radius:6px}` +
    `.phone{display:flex;flex-wrap:wrap;gap:14px}.phone .card{width:320px;box-sizing:content-box;padding:0;border-radius:0}.phone .fig svg{width:320px}` +
    `.phone figcaption{padding:6px 8px}@media(max-width:700px){.grid{grid-template-columns:minmax(0,1fr)}}` +
    `</style></head><body><h1>כל התרשימים (${list.length})</h1><p>נוצר אוטומטית על ידי tools/diagrams.mjs --preview</p>` +
    `<h2>תצוגת רשת</h2><div class="grid">${list.map((e) => card(e, 'g')).join('')}</div>` +
    `<h2>בגודל טלפון (320px)</h2><div class="phone">${list.map((e) => card(e, 'p')).join('')}</div></body></html>\n`
  );
}

// ------------------------------------------------------------ CLI
const here = dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const mode = process.argv[2];
  const custom = process.argv[3];
  const file = custom || join(here, '..', 'data', 'physics.json');
  const previewFile = join(here, '..', 'preview', 'diagrams.html');
  if (!['--write', '--check', '--preview'].includes(mode)) {
    console.error('Usage: node tools/diagrams.mjs --write|--check|--preview [physics.json]');
    process.exit(2);
  }
  const raw = readFileSync(file, 'utf8');
  const eol = '\n'; // generated files are always LF (see .gitattributes)
  const list = JSON.parse(raw);
  const problems = [];
  const gen = [];
  const out = list.map((ex) => {
    let d;
    try {
      d = diagramFor(ex);
    } catch (e) {
      problems.push(`${ex.id}: ${e.message}`);
      return ex;
    }
    gen.push({ ...ex, diagram: d });
    validateSvg(d).forEach((m) => problems.push(`${ex.id}: generated diagram invalid: ${m}`));
    layoutIssues(d).forEach((m) => problems.push(`${ex.id}: layout: ${m}`));
    if (mode === '--check') {
      if (typeof ex.diagram !== 'string' || !ex.diagram) problems.push(`${ex.id}: diagram missing`);
      else {
        layoutIssues(ex.diagram).forEach((m) => problems.push(`${ex.id}: stored diagram layout: ${m}`));
        if (!sameText(ex.diagram, d)) problems.push(`${ex.id}: stored diagram differs from generated (run --write)`);
      }
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
  if (mode === '--check' && !custom) {
    let cur = null;
    try { cur = readFileSync(previewFile, 'utf8'); } catch { /* missing */ }
    if (cur === null || !sameText(cur, previewHtml(list.map((ex) => ({ ...ex, diagram: diagramFor(ex) }))))) problems.push('preview/diagrams.html is missing or stale (run --preview)');
  }
  if (problems.length) {
    console.error(`FAILED: ${problems.length} problem(s)`);
    problems.forEach((m) => console.error(' - ' + m));
    process.exit(1);
  }
  if (mode === '--write') {
    const text = JSON.stringify(out, null, 2).replace(/\n/g, eol) + eol;
    if (text !== raw) writeFileSync(file, text);
    console.log(`wrote diagrams for ${out.length} exercises`);
  } else if (mode === '--preview') {
    mkdirSync(dirname(previewFile), { recursive: true });
    writeFileSync(previewFile, lf(previewHtml(gen)));
    console.log(`wrote ${previewFile} (${gen.length} diagrams)`);
  } else console.log(`OK: ${list.length} diagrams present, valid, overlap-free, up to date; preview current`);
}
