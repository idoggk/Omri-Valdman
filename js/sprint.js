// Algebra fluency sprints (#/sprint). Pure logic: seeded item generators for nine families, the answer checker, per-family
// adaptive difficulty, scoring, personal bests and saved state. js/sprint-ui.js draws it.
//
// Every item is generated from a verified template with a seeded random generator, so makeItem(family, level, seed) is
// deterministic. Typed answers are checked by value, never by string: expressions are compared with the reference at
// several random points (equivalent forms pass), numbers by numeric equality, root sets as sets, inequalities by operator
// and boundary. Some kinds add a structural rule so that the question itself cannot be typed back (a factored form must be
// a product, a simplified fraction must be in lowest terms, a surd must have a squarefree radicand).
// tools/verify-sprint.mjs re-checks thousands of generated items with an independent evaluator.
import { safeSetItem } from './storage.js';
import { parseFormula, samplePoints, equivalent, FUNCS } from './fbuilder.js';

export const KEY = 'omri-study-sprint-v1';
export const TOPIC_PREFIX = 'sprint-';
export const sprintTopic = (fam) => `${TOPIC_PREFIX}${fam}`;
export const DURATIONS = [120, 300];
export const MAX_LEVEL = 3;
export const HISTORY_CAP = 30;
export const ADAPT_WINDOW = 6;
export const UP_MIN = 5; // results in the window before a level-up
export const UP_ACC = 0.85;
export const DOWN_MIN = 4;
export const DOWN_ACC = 0.5;
export const BEST_MIN_ACCURACY = 0.7; // a "best" needs this accuracy so that blind guessing cannot set a record

export const FAMILIES = [
  { id: 'factor', title: 'פירוק טרינום לגורמים' },
  { id: 'fracsimp', title: 'צמצום שברים' },
  { id: 'fracadd', title: 'חיבור וחיסור שברים' },
  { id: 'exprad', title: 'חזקות ושורשים' },
  { id: 'lineq', title: 'משוואות לינאריות' },
  { id: 'quadeq', title: 'משוואות ריבועיות פשוטות' },
  { id: 'rearrange', title: 'בידוד משתנה בנוסחה' },
  { id: 'ineq', title: 'אי־שוויונות וסימן' },
  { id: 'loglaw', title: 'חוקי לוגריתמים' },
];
export const familyTitle = (id) => (FAMILIES.find((f) => f.id === id) || { title: id }).title;
export const famOfTopic = (t) => (String(t).startsWith(TOPIC_PREFIX) ? String(t).slice(TOPIC_PREFIX.length) : null);

const isRec = (x) => x && typeof x === 'object' && !Array.isArray(x);

/* ---------- seeded randomness ---------- */
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const mkRand = (seed) => {
  const r = mulberry32(seed >>> 0);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const nz = (a, b) => { let v = 0; while (v === 0) v = ri(a, b); return v; };
  return { r, ri, pick, nz };
};

/* ---------- small number helpers ---------- */
export const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const lcm = (a, b) => (a / gcd(a, b)) * b;
const reduce = (n, d) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return [n / g, d / g]; };
const fracStr = ([n, d]) => (d === 1 ? String(n) : `${n}/${d}`);
const SQUAREFREE = [2, 3, 5, 6, 7, 10, 11];
const isSquarefree = (n) => { for (let k = 2; k * k <= n; k++) if (n % (k * k) === 0) return false; return n > 1; };

/** Strict ("2*x") expression to what a student sees ("2x", "x - 3", "<=" as "≤"). */
export function show(s) {
  return String(s)
    .replace(/(\d)\*(?=[a-z(])/g, '$1')
    .replace(/([a-z)])\*(?=\()/g, '$1')
    .replace(/<=/g, ' ≤ ').replace(/>=/g, ' ≥ ')
    .replace(/(?<![<>≤≥])([=<>])/g, ' $1 ')
    .replace(/([\w)])([+-])(?=[\w(])/g, '$1 $2 ')
    .replace(/ {2,}/g, ' ').trim();
}
/** Strict linear term a*x+b (omitting 1 and 0). */
const lin = (a, b, v = 'x') => {
  const ax = a === 1 ? v : a === -1 ? `-${v}` : `${a}*${v}`;
  return b === 0 ? ax : `${ax}${b > 0 ? '+' : '-'}${Math.abs(b)}`;
};
/** Strict polynomial from coefficients (highest power first). */
const polyStr = (cs, v = 'x') => {
  let out = '';
  cs.forEach((c, i) => {
    const p = cs.length - 1 - i;
    if (!c) return;
    const a = Math.abs(c);
    const body = p === 0 ? String(a) : `${a === 1 ? '' : `${a}*`}${v}${p > 1 ? `^${p}` : ''}`;
    out += out ? (c < 0 ? '-' : '+') + body : (c < 0 ? '-' : '') + body;
  });
  return out || '0';
};

/* ---------- generators: (rand, level) -> item fields ---------- */
function genFactor({ ri, nz, pick, r }, L) {
  let f1; let f2;
  if (L === 1) { f1 = [1, nz(-9, 9)]; f2 = [1, nz(-9, 9)]; }
  else if (L === 2) {
    do { f1 = [pick([2, 3]), nz(-6, 6)]; } while (gcd(f1[0], f1[1]) !== 1);
    f2 = [1, nz(-6, 6)];
  } else if (r() < 0.3) { let k; let m; do { k = ri(2, 5); m = ri(1, 9); } while (gcd(k, m) !== 1); f1 = [k, m]; f2 = [k, -m]; }
  else {
    do { f1 = [ri(2, 4), nz(-7, 7)]; } while (gcd(f1[0], f1[1]) !== 1);
    do { f2 = [ri(2, 4), nz(-7, 7)]; } while (gcd(f2[0], f2[1]) !== 1);
  }
  const [a, p] = f1; const [c, q] = f2;
  const poly = [a * c, a * q + c * p, p * q];
  const strict = (x, y) => `(${lin(x[0], x[1])})*(${lin(y[0], y[1])})`;
  const polyS = polyStr(poly);
  return {
    prompt: 'פרקו לגורמים:', math: show(polyS), kind: 'factored', answer: strict(f1, f2), ref: strict(f1, f2), vars: { x: [-6, 6] },
    equiv: [strict(f2, f1), strict(f1, f2).replace(/\*/g, '')], wrong: wrongFactored(f1, f2, poly, polyS, strict),
    spec: { poly, f1, f2 },
  };
}
const expandPair = (f1, f2) => [f1[0] * f2[0], f1[0] * f2[1] + f2[0] * f1[1], f1[1] * f2[1]];
const sameCoefs = (u, v) => u.length === v.length && u.every((x, i) => x === v[i]);
function wrongFactored(f1, f2, poly, polyS, strict) {
  const out = [polyS];
  for (const [g1, g2] of [[[f1[0], -f1[1]], f2], [[f1[0], f2[1]], [f2[0], f1[1]]], [f1, [f2[0], -f2[1]]]]) {
    if (!sameCoefs(expandPair(g1, g2), poly)) out.push(strict(g1, g2));
  }
  return out;
}

function genFracSimp({ ri, pick, r }, L) {
  if (L === 1) {
    let p; let q;
    do { p = ri(1, 9); q = ri(2, 9); } while (gcd(p, q) !== 1 || p === q);
    const g = ri(2, 9); const sg = r() < 0.25 ? -1 : 1;
    const ans = fracStr([sg * p, q]);
    return {
      prompt: 'צמצמו עד כמה שאפשר:', math: `${sg < 0 ? '-' : ''}${g * p}/${g * q}`, kind: 'frac', answer: ans, expr: `${sg * g * p}/${g * q}`,
      equiv: [], wrong: [`${sg * g * p}/${g * q}`, fracStr([sg * p * 2, q * 2]), String(sg * p), fracStr([sg * p + 1, q])],
      spec: { n: sg * g * p, d: g * q },
    };
  }
  let m; let num; let den; let ans;
  if (L === 2) {
    if (r() < 0.5) { m = ri(2, 9); num = `x^2-${m * m}`; den = `x-${m}`; ans = `x+${m}`; }
    else { const p = ri(1, 8); const q = ri(1, 8); num = `x^2+${p + q}*x+${p * q}`; den = `x+${p}`; ans = `x+${q}`; }
  } else {
    const a = ri(2, 4); let p; do { p = pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]); } while (gcd(a, p) !== 1); const q = pick([-5, -4, -3, -2, 2, 3, 4, 5]);
    num = polyStr([a, a * q + p, p * q]); den = lin(a, p); ans = lin(1, q);
  }
  return {
    prompt: 'צמצמו את השבר (כתבו ביטוי בלי שבר):', math: `(${show(num)})/(${show(den)})`, kind: 'poly', answer: ans, ref: ans, vars: { x: [-6, 6] },
    equiv: [ans.replace(/\*/g, ''), `(${ans})`], wrong: [`(${num})/(${den})`, ans.replace(/x([+-])(\d+)/, (s, sg, n) => `x${sg === '+' ? '-' : '+'}${n}`)],
    spec: { num, den, ans },
  };
}

function genFracAdd({ ri, nz, pick }, L) {
  if (L < 3) {
    let b = ri(2, 8); let d = ri(2, 8); while (d === b) d = ri(2, 8);
    const a = ri(1, 7); const c = ri(1, 7);
    let expr = `${a}/${b}+${c}/${d}`;
    let val = reduce(a * d + c * b, b * d);
    let e; let f;
    if (L === 2) {
      const sub = pick([true, false]);
      e = ri(1, 5); f = ri(2, 6);
      expr = `${a}/${b}${sub ? '-' : '+'}${c}/${d}+${e}/${f}`;
      const den = lcm(lcm(b, d), f);
      val = reduce((a * den) / b + (sub ? -1 : 1) * ((c * den) / d) + (e * den) / f, den);
    }
    const ans = fracStr(val);
    const [vn, vd] = val;
    return {
      prompt: 'חשבו וכתבו כשבר מצומצם:', math: expr.replace(/\+/g, ' + ').replace(/-/g, ' - '), kind: 'frac', answer: ans, expr,
      equiv: [], wrong: [fracStr([vn + 1, vd]), String(vn / vd + 0.01), `${vn * 2}/${vd * 2}`, fracStr([-vn, vd])].filter((w) => w !== ans),
      spec: { expr },
    };
  }
  let p = nz(-5, 5); let q = nz(-5, 5);
  while (q === p) q = nz(-5, 5);
  const a = ri(1, 4); const b = ri(1, 4);
  const numC = [a + b, a * q + b * p];
  const ans = `(${lin(numC[0], numC[1])})/((${lin(1, p)})*(${lin(1, q)}))`;
  return {
    prompt: 'חברו לשבר אחד (בצורת שבר יחיד):', math: show(`${a}/(${lin(1, p)})+${b}/(${lin(1, q)})`), kind: 'singlefrac', answer: ans, ref: ans, vars: { x: [-9, 9] },
    equiv: [], wrong: [`${a}/(${lin(1, p)})+${b}/(${lin(1, q)})`, `${a + b}/((${lin(1, p)})*(${lin(1, q)}))`, `(${lin(numC[0], a * p + b * q)})/((${lin(1, p)})*(${lin(1, q)}))`].filter((w, i) => i < 2 || a * p + b * q !== numC[1]),
    spec: { a, b, p, q },
  };
}

function genExpRad({ ri, pick, r }, L) {
  if (L === 1) {
    const base = pick([2, 3, 5, 10]);
    let a; let b; let c;
    do { a = ri(1, 6); b = ri(-3, 5); c = ri(1, 5); } while (a + b - c < -3 || a + b - c > 5 || b === 0);
    const e = a + b - c;
    const bs = (k) => (k < 0 ? `${base}^(${k})` : `${base}^${k}`);
    const expr = `${bs(a)}*${bs(b)}/${bs(c)}`;
    const val = e >= 0 ? [base ** e, 1] : [1, base ** -e];
    return {
      prompt: 'חשבו את הערך:', math: expr.replace(/\*/g, ' · ').replace(/\//g, ' / '), kind: 'num', answer: fracStr(val), expr,
      equiv: [], wrong: [fracStr([val[0] * base, val[1]]), fracStr([val[1], val[0]]), fracStr([val[0] * (a + 1 === c ? 1 : base) + 1, val[1]])].filter((w) => w !== fracStr(val)),
      spec: { expr },
    };
  }
  if (L === 2 && r() < 0.5) {
    const a = ri(2, 4); const b = ri(2, 3); const c = ri(1, 4); let d = ri(2, 12);
    const n = a * b + c - d;
    if (n === 0) d += 1;
    const nn = a * b + c - d;
    const expr = `(x^${a})^${b}*x^${c}/x^${d}`;
    const ans = nn === 1 ? 'x' : `x^${nn}`;
    return {
      prompt: 'פשטו לחזקה אחת של x:', math: `(x^${a})^${b} · x^${c} / x^${d}`, kind: 'mono', answer: ans, ref: ans, vars: { x: [1.2, 4] },
      equiv: [ans, `1*${ans}`.replace('1*', '')], wrong: [`x^${a + b + c - d}`, `x^${a * b + c + d}`, `x^${nn + 1}`, expr].filter((w) => w !== ans),
      spec: { expr, exp: nn },
    };
  }
  if (L === 2) {
    const k = pick([2, 3, 4]); const rt = pick([2, 3, 4, 5]); const m = pick([1, 2, 3]); const sg = pick([1, 1, -1]);
    const n = rt ** k;
    if (gcd(m, k) !== 1) return genExpRad({ ri, pick, r }, 2);
    const expr = `${n}^(${sg < 0 ? '-' : ''}${m}/${k})`;
    const val = sg > 0 ? [rt ** m, 1] : [1, rt ** m];
    return {
      prompt: 'חשבו את הערך:', math: `${n}^(${sg < 0 ? '-' : ''}${m}/${k})`, kind: 'num', answer: fracStr(val), expr,
      equiv: [], wrong: [fracStr([val[1], val[0]]), String(n * m), fracStr([rt * m, 1]), fracStr(sg > 0 ? [rt ** m + 1, 1] : [1, rt ** m + 1])].filter((w) => w !== fracStr(val)),
      spec: { expr },
    };
  }
  const m = pick(SQUAREFREE);
  if (r() < 0.5) {
    const k = ri(2, 7);
    const ans = `${k}*sqrt(${m})`;
    return {
      prompt: 'פשטו עד כמה שאפשר (בצורה a·√b):', math: `sqrt(${k * k * m})`, kind: 'surd', answer: ans, expr: `sqrt(${k * k * m})`,
      equiv: [`${k}sqrt(${m})`, `sqrt(${m})*${k}`], wrong: [`sqrt(${k * k * m})`, `${k + 1}*sqrt(${m})`, `${k * k}*sqrt(${m})`, `${k}*sqrt(${m * k})`],
      spec: { expr: `sqrt(${k * k * m})` },
    };
  }
  const a = ri(1, 5); const b = ri(1, 5); const sub = a > b && r() < 0.5;
  const k = sub ? a - b : a + b;
  const ans = k === 1 ? `sqrt(${m})` : `${k}*sqrt(${m})`;
  const expr = `sqrt(${a * a * m})${sub ? '-' : '+'}sqrt(${b * b * m})`;
  return {
    prompt: 'פשטו עד כמה שאפשר (בצורה a·√b):', math: expr.replace(/\+/g, ' + ').replace(/-/g, ' - '), kind: 'surd', answer: ans, expr,
    equiv: [ans.replace('*', '')], wrong: [`sqrt(${(a * a + b * b) * m})`, `${sub ? a + b : Math.abs(a - b) || 5}*sqrt(${m})`, expr].filter((w) => w !== ans),
    spec: { expr },
  };
}

function genLinEq({ ri, nz, pick }, L) {
  let lhs; let rhs; let x0;
  if (L === 1) {
    const a = pick([-1, 1]) * ri(2, 9); x0 = nz(-9, 9); const b = nz(-12, 12);
    lhs = lin(a, b); rhs = String(a * x0 + b);
  } else if (L === 2) {
    let a; let c;
    do { a = nz(-7, 9); c = nz(-7, 9); } while (a === c);
    x0 = nz(-9, 9); const b = nz(-12, 12);
    lhs = lin(a, b); rhs = lin(c, (a - c) * x0 + b);
  } else {
    const p = pick([2, 3, 4, 5]); let q = pick([2, 3, 4, 6]); while (q === p) q = pick([2, 3, 4, 6]);
    x0 = lcm(p, q) * nz(-3, 3);
    const a = nz(-6, 6);
    const [n, d] = reduce(x0 * q + (x0 + a) * p, p * q);
    lhs = `x/${p}+(x${a > 0 ? '+' : '-'}${Math.abs(a)})/${q}`; rhs = fracStr([n, d]);
  }
  return {
    prompt: 'פתרו את המשוואה (x = ?):', math: show(`${lhs}=${rhs}`), kind: 'num', answer: String(x0), expr: String(x0),
    equiv: [`x=${x0}`], wrong: [String(-x0), String(x0 + 1), String(x0 - 1)], spec: { lhs, rhs, roots: [[x0, 1]] },
  };
}

const setOf = (s) => [...new Set(s.split(', ').map((x) => Number(eval1(x))))].sort((a, b) => a - b).join(',');
const eval1 = (x) => { const m = ratOf(x); return m[0] / m[1]; };
const ratOf = (s) => { const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s); return [Number(m[1]), m[2] ? Number(m[2]) : 1]; };
const sameSet = (a, b) => setOf(a) === setOf(b);
function genQuad({ ri, nz, pick, r }, L) {
  let lhs; let rhs; let roots;
  if (L === 1) {
    const k = ri(2, 12);
    if (r() < 0.5) { lhs = 'x^2'; rhs = String(k * k); } else { lhs = `x^2-${k * k}`; rhs = '0'; }
    roots = [[-k, 1], [k, 1]];
  } else if (L === 2) {
    let p = nz(-9, 9); let q = nz(-9, 9);
    if (r() < 0.2) q = p;
    lhs = polyStr([1, -(p + q), p * q]); rhs = '0'; roots = [[p, 1], [q, 1]];
  } else if (r() < 0.5) {
    let p = nz(-8, 8); let q = nz(-8, 8);
    while (q === p) q = nz(-8, 8);
    const m = -(p + q);
    lhs = `x*(x${m < 0 ? '-' : '+'}${Math.abs(m)})`; rhs = String(-p * q);
    if (m === 0) { lhs = 'x^2'; }
    roots = [[p, 1], [q, 1]];
  } else {
    const a = pick([2, 3]); let p; do { p = nz(-6, 6); } while (gcd(a, p) !== 1);
    const q = nz(-6, 6);
    lhs = polyStr([a, a * q + p, p * q]); rhs = '0'; roots = [reduce(-p, a), [-q, 1]];
  }
  const uniq = []; for (const rt of roots) if (!uniq.some((u) => u[0] === rt[0] && u[1] === rt[1])) uniq.push(rt);
  uniq.sort((u, v) => u[0] / u[1] - v[0] / v[1]);
  const fmt = (list) => list.map(fracStr).join(', ');
  const wrong = [fmt(uniq.map(([n, d]) => [-n, d])), fmt(uniq.slice(0, 1)), fmt(uniq.map(([n, d]) => [n + d, d]))];
  if (uniq.length > 1) wrong.push(fmt([uniq[1], uniq[1]]));
  return {
    prompt: 'פתרו (כתבו את כל הפתרונות, מופרדים בפסיק):', math: show(`${lhs}=${rhs}`), kind: 'roots', answer: fmt(uniq), expr: fmt(uniq),
    equiv: [uniq.slice().reverse().map(fracStr).join(' ; ')], wrong: wrong.filter((w) => !sameSet(w, fmt(uniq))), spec: { lhs, rhs, roots: uniq },
  };
}

/** Formula templates: strict equation, and for each target variable the strict answer. */
export const REARRANGE = [
  { lv: 1, eq: 'v=v0+a*t', t: { v0: 'v-a*t', a: '(v-v0)/t', t: '(v-v0)/a' } },
  { lv: 1, eq: 'F=m*a', t: { a: 'F/m', m: 'F/a' } },
  { lv: 1, eq: 'P=F*v', t: { F: 'P/v', v: 'P/F' } },
  { lv: 1, eq: 'E=m*g*h', t: { h: 'E/(m*g)', m: 'E/(g*h)' } },
  { lv: 2, eq: 'v^2=v0^2+2*a*x', t: { x: '(v^2-v0^2)/(2*a)', a: '(v^2-v0^2)/(2*x)' } },
  { lv: 2, eq: 'x=v0*t+a*t^2/2', t: { a: '2*(x-v0*t)/t^2', v0: '(x-a*t^2/2)/t' } },
  { lv: 2, eq: 'Ek=m*v^2/2', t: { m: '2*Ek/v^2' } },
  { lv: 2, eq: 'R=rho*L/A', t: { A: 'rho*L/R', L: 'R*A/rho', rho: 'R*A/L' } },
  { lv: 3, eq: 'S=(a+b)*h/2', t: { h: '2*S/(a+b)', b: '2*S/h-a' } },
  { lv: 3, eq: 'x=x0+v0*t+a*t^2/2', t: { a: '2*(x-x0-v0*t)/t^2', x0: 'x-v0*t-a*t^2/2' } },
  { lv: 3, eq: 'v^2=v0^2+2*a*(x-x0)', t: { x: 'x0+(v^2-v0^2)/(2*a)', a: '(v^2-v0^2)/(2*(x-x0))' } },
  { lv: 3, eq: '1/f=1/u+1/v', t: { v: '1/(1/f-1/u)', f: '1/(1/u+1/v)' } },
  { lv: 3, eq: 'a/b=c/d', t: { d: 'b*c/a', a: 'b*c/d' } },
];
export const varsOf = (eq) => [...new Set(String(eq).replace(/sqrt|sin|cos|tan|log/g, '').match(/[A-Za-z][A-Za-z0-9]*/g) || [])];

function genRearrange({ pick }, L) {
  const tpl = pick(REARRANGE.filter((t) => t.lv === L));
  const target = pick(Object.keys(tpl.t));
  const ans = tpl.t[target];
  const others = varsOf(tpl.eq).filter((v) => v !== target);
  const vars = Object.fromEntries(others.map((v) => [v, [1.5, 9]]));
  const shown = tpl.eq.replace(/\*/g, '·').replace('=', ' = ').replace(/([\w)])([+-])(?=[\w(])/g, '$1 $2 ');
  return {
    prompt: `בטאו את ${target} באמצעות שאר המשתנים:`, math: shown, kind: 'expr', answer: ans, ref: ans, vars, target,
    equiv: [ans.replace(/\*/g, '').replace(/(\d)([a-z])/g, '$1$2')], wrong: [`-(${ans})`, `1/(${ans})`, `${ans}+1`],
    spec: { eq: tpl.eq, target, tpl: tpl.eq },
  };
}

const OPS = ['<', '>', '<=', '>='];
const flipOp = (o) => ({ '<': '>', '>': '<', '<=': '>=', '>=': '<=' }[o]);
function genIneq({ ri, nz, pick }, L) {
  const op = pick(OPS);
  let lhs; let rhs; let x0; let sol;
  if (L === 1) {
    const a = ri(2, 9); x0 = nz(-8, 8); const b = nz(-12, 12);
    lhs = lin(a, b); rhs = String(a * x0 + b); sol = op;
  } else if (L === 2) {
    const a = -ri(2, 9); x0 = nz(-8, 8); const b = nz(-12, 12);
    lhs = lin(a, b); rhs = String(a * x0 + b); sol = flipOp(op);
  } else {
    let a; let c;
    do { a = nz(-7, 8); c = nz(-7, 8); } while (a === c);
    x0 = nz(-8, 8); const b = nz(-10, 10);
    lhs = lin(a, b); rhs = lin(c, (a - c) * x0 + b); sol = a - c > 0 ? op : flipOp(op);
  }
  return {
    prompt: 'פתרו וכתבו את הפתרון בצורה x > ... או x < ... :', math: show(`${lhs}${op}${rhs}`), kind: 'ineq', answer: `x${sol}${x0}`, expr: `${x0}`, op: sol,
    equiv: [`${x0}${flipOp(sol)}x`, `x${sol.replace('<=', '≤').replace('>=', '≥')}${x0}`],
    wrong: [`x${flipOp(sol)}${x0}`, `x${sol.length === 1 ? `${sol}=` : sol[0]}${x0}`, `x${sol}${-x0}`, `x${sol}${x0 + 1}`],
    spec: { lhs, rhs, op, sol, x0 },
  };
}

function genLog({ ri, pick, r }, L) {
  const b = pick([2, 3, 5, 10]);
  const lg = (arg, base = b) => `log_${base}(${arg})`;
  if (L === 1) {
    const i = ri(1, 4); const j = ri(1, 4); const sub = r() < 0.4 && i > j;
    const val = sub ? i - j : i + j;
    return {
      prompt: 'חשבו את הערך:', math: `${lg(b ** i)} ${sub ? '-' : '+'} ${lg(b ** j)}`, kind: 'num', answer: String(val), expr: String(val),
      equiv: [], wrong: [String(val + 1), String(val - 1 || 7), String(i * j)].filter((w) => w !== String(val)),
      spec: { terms: [[1, b ** i, b], [sub ? -1 : 1, b ** j, b]], val: [val, 1] },
    };
  }
  if (L === 2) {
    const k = ri(2, 4); const m = pick([2, 3, 4, 5, 6, 7]);
    const prodRule = r() < 0.5;
    if (prodRule) {
      const n = b ** k;
      if (n % m !== 0 || n / m === 1) return genLog({ ri, pick, r }, 2);
      return {
        prompt: 'חשבו את הערך:', math: `${lg(m)} + ${lg(n / m)}`, kind: 'num', answer: String(k), expr: String(k), equiv: [],
        wrong: [String(k + 1), String(k - 1 || 7), String(m + n / m)], spec: { terms: [[1, m, b], [1, n / m, b]], val: [k, 1] },
      };
    }
    const n = b ** k * m;
    return {
      prompt: 'חשבו את הערך:', math: `${lg(n)} - ${lg(m)}`, kind: 'num', answer: String(k), expr: String(k), equiv: [],
      wrong: [String(k + 1), String(n - m), String(k * 2)], spec: { terms: [[1, n, b], [-1, m, b]], val: [k, 1] },
    };
  }
  const b0 = pick([2, 3, 5]); let rr = ri(2, 4); let s = ri(1, 5);
  while (gcd(rr, s) === rr || s === rr) { s = ri(1, 5); rr = ri(2, 4); }
  const val = reduce(s, rr);
  return {
    prompt: 'חשבו את הערך (כתבו כשבר מצומצם):', math: lg(b0 ** s, b0 ** rr), kind: 'num', answer: fracStr(val), expr: fracStr(val), equiv: [],
    wrong: [fracStr([rr, s]), String(s - rr), fracStr([s * 2, rr]), fracStr([val[0] + 1, val[1]])].filter((w) => w !== fracStr(val)),
    spec: { terms: [[1, b0 ** s, b0 ** rr]], val },
  };
}

const GENS = { factor: genFactor, fracsimp: genFracSimp, fracadd: genFracAdd, exprad: genExpRad, lineq: genLinEq, quadeq: genQuad, rearrange: genRearrange, ineq: genIneq, loglaw: genLog };

/** One deterministic item: same (family, level, seed) always gives the same item. */
export function makeItem(family, level, seed) {
  const gen = GENS[family];
  if (!gen) throw new Error(`unknown family ${family}`);
  const L = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level) || 1));
  const item = gen(mkRand(hashStr(`${family}|${L}|${seed}`)), L);
  item.wrong = (item.wrong || []).filter((w) => w !== item.answer);
  return { id: `sp-${family}-${L}-${(seed >>> 0).toString(36)}`, fam: family, level: L, seed: seed >>> 0, ...item };
}

/* ---------- answer checking ---------- */
const SUP = { '²': '^2', '³': '^3' };
/** Typed text -> strict expression: normalises signs, splits "2ax" into 2*a*x, adds * for implicit multiplication. */
export function prepare(text, vars = []) {
  let s = String(text == null ? '' : text)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/[−–—‒־﹣－]/g, '-').replace(/[×·⋅∙]/g, '*').replace(/[÷∕⁄]/g, '/')
    .replace(/[²³]/g, (c) => SUP[c]).replace(/√/g, 'sqrt').replace(/,(?=\d)/g, '.');
  const names = [...vars].sort((a, b) => b.length - a.length);
  s = s.replace(/[A-Za-z][A-Za-z0-9]*/g, (id, off, str) => {
    if (Object.hasOwn(FUNCS, id) || vars.includes(id)) {
      return vars.includes(id) && /^\s*\(/.test(str.slice(off + id.length)) ? `${id}*` : id;
    }
    // "2av" -> "a*v": only when the whole word is made of known variables
    const parts = [];
    let rest = id;
    while (rest) {
      const hit = names.find((n) => rest.startsWith(n));
      if (!hit) return id;
      parts.push(hit); rest = rest.slice(hit.length);
    }
    return parts.length > 1 ? parts.join('*') : id;
  });
  return s
    .replace(/(\d|\.)\s*(?=[A-Za-z(])/g, '$1*')
    .replace(/\)\s*(?=[A-Za-z0-9(])/g, ')*')
    .replace(/([A-Za-z0-9])\s+(?=\d)/g, '$1*');
}
const NO_VARS = [];
/** Evaluates a number typed by the student ("3/2", "-4", "x=5", "2*sqrt(3)"), or null. */
export function parseNumber(text) {
  const s = prepare(String(text).replace(/^\s*[A-Za-z]\w*\s*=\s*/, ''), NO_VARS);
  const p = parseFormula(s, NO_VARS);
  if (!p.ok) return null;
  const v = p.fn({});
  return Number.isFinite(v) ? v : null;
}
const numClose = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
const ratRe = /^([+-]?\d+)(?:\/(\d+))?$/;
const ASCII_OP = { '≤': '<=', '≥': '>=', '=>': '>=', '=<': '<=' };

/** Parses "x>3", "x <= -2", "3<x", "x≥3" -> { op, value } with the variable on the left, or null. */
export function parseIneq(text) {
  const s = String(text).replace(/[‎‏⁦-⁩\s]/g, '').replace(/[−–]/g, '-').replace(/[≤≥]/g, (c) => ASCII_OP[c]).replace(/=>|=</g, (c) => ASCII_OP[c]);
  const m = /^(.+?)(<=|>=|<|>)(.+)$/.exec(s);
  if (!m) return null;
  const [, l, op, r] = m;
  if (/^[A-Za-z]\w*$/.test(l)) { const v = parseNumber(r); return v === null ? null : { op, value: v, v: l }; }
  if (/^[A-Za-z]\w*$/.test(r)) { const v = parseNumber(l); return v === null ? null : { op: flipOp(op), value: v, v: r }; }
  return null;
}

/**
 * checkSprintAnswer(item, text) -> { valid:false, error } | { valid:true, correct, note? }.
 * valid:false means "could not read it" (it is not counted as a wrong answer).
 */
export function checkSprintAnswer(item, text) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return { valid: false, error: 'כתבו תשובה.' };
  if (raw.length > 120) return { valid: false, error: 'התשובה ארוכה מדי.' };
  const bad = (error) => ({ valid: false, error });
  const kind = item.kind;
  if (kind === 'ineq') {
    const g = parseIneq(raw);
    if (!g) return bad('כתבו אי־שוויון בצורה x > 3 או x <= -2.');
    const want = parseIneq(item.answer);
    return { valid: true, correct: g.op === want.op && numClose(g.value, want.value) };
  }
  if (kind === 'roots') {
    const parts = raw.split(/[,;،\s]+|ו(?=-?\d)/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length || parts.length > 6) return bad('כתבו את הפתרונות מופרדים בפסיק, למשל 2, -3.');
    const got = [];
    for (const p of parts) { const v = parseNumber(p); if (v === null) return bad('לא הצלחתי לקרוא את התשובה. כתבו מספרים או שברים, מופרדים בפסיק.'); got.push(v); }
    const want = item.answer.split(', ').map(parseNumber);
    const uniq = (list) => list.filter((v, i) => list.findIndex((w) => numClose(v, w)) === i);
    const gu = uniq(got);
    return { valid: true, correct: gu.length === want.length && want.every((w) => gu.some((g) => numClose(g, w))) };
  }
  if (kind === 'num' || kind === 'frac' || kind === 'surd') {
    const prepared = prepare(raw.replace(/^\s*[A-Za-z]\w*\s*=\s*/, ''), NO_VARS);
    const v = parseNumber(raw);
    if (v === null) return bad('לא הצלחתי לקרוא את התשובה. כתבו מספר, שבר (3/4) או שורש (2*sqrt(3)).');
    const want = parseNumber(item.answer);
    if (!numClose(v, want)) return { valid: true, correct: false };
    if (kind === 'frac') {
      const m = ratRe.exec(prepared.replace(/\s/g, ''));
      if (!m) return { valid: true, correct: false, note: 'כתבו כשבר מצומצם, למשל 3/4.' };
      if (m[2] && (Number(m[2]) === 0 || gcd(Number(m[1]), Number(m[2])) !== 1)) return { valid: true, correct: false, note: 'הערך נכון, אבל השבר לא מצומצם.' };
      return { valid: true, correct: true };
    }
    if (kind === 'surd') {
      const flat = prepared.replace(/\s/g, '');
      const s1 = /^[+-]?(?:\d+\*)?sqrt\((\d+)\)$/.exec(flat);
      const s2 = /^sqrt\((\d+)\)\*\d+$/.exec(flat);
      const sm = s1 || s2;
      if (!sm) return { valid: true, correct: false, note: 'כתבו בצורה a*sqrt(b).' };
      if (!isSquarefree(Number(sm[1])))return { valid: true, correct: false, note: 'הערך נכון, אבל אפשר עוד להוציא גורם מתחת לשורש.' };
    }
    return { valid: true, correct: true };
  }
  // expression kinds
  const names = Object.keys(item.vars || {});
  let src = raw;
  if (item.target) src = src.replace(new RegExp(`^\\s*${item.target}\\s*=\\s*`), '');
  else src = src.replace(/^\s*[A-Za-z]\w*\s*=\s*/, '');
  const prepared = prepare(src, names);
  const p = parseFormula(prepared, names);
  if (!p.ok) return bad(p.error.msg);
  const ref = parseFormula(item.ref, names).fn;
  const pts = samplePoints({ id: item.id, vars: item.vars }, ref);
  if (!equivalent(p.fn, ref, pts)) return { valid: true, correct: false };
  const flat = prepared.replace(/\s/g, '');
  if (kind === 'factored' && !/\)\*\(|\)\^2/.test(flat)) return { valid: true, correct: false, note: 'כתבו כמכפלה של גורמים, למשל (x+2)(x+3).' };
  if (kind === 'poly' && flat.includes('/')) return { valid: true, correct: false, note: 'צמצמו עד הסוף, כך שלא יישאר שבר.' };
  if (kind === 'singlefrac' && (flat.match(/\//g) || []).length !== 1) return { valid: true, correct: false, note: 'כתבו שבר אחד: מונה על מכנה.' };
  if (kind === 'mono' && !/^[+-]?(\d+\*)?x(\^-?\d+|\^\(-?\d+\))?$|^1\/x(\^\d+)?$/.test(flat)) return { valid: true, correct: false, note: 'כתבו חזקה אחת של x, למשל x^5.' };
  return { valid: true, correct: true };
}

/* ---------- saved state ---------- */
export const emptySaved = () => ({ v: 1, levels: {}, recent: {}, history: [], best: {} });
const nn = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

export function sanitizeSaved(raw) {
  const out = emptySaved();
  if (!isRec(raw)) return out;
  for (const f of FAMILIES) {
    const l = raw.levels && raw.levels[f.id];
    if (Number.isInteger(l) && l >= 1 && l <= MAX_LEVEL) out.levels[f.id] = l;
    const rc = raw.recent && raw.recent[f.id];
    if (Array.isArray(rc)) out.recent[f.id] = rc.filter((x) => x === 0 || x === 1).slice(-ADAPT_WINDOW);
  }
  if (Array.isArray(raw.history)) {
    out.history = raw.history.filter(isRec).map((h) => ({
      ts: nn(h.ts), dur: DURATIONS.includes(h.dur) ? h.dur : 120, mode: typeof h.mode === 'string' && h.mode.length < 20 ? h.mode : 'mixed',
      correct: Math.floor(nn(h.correct)), wrong: Math.floor(nn(h.wrong)), skipped: Math.floor(nn(h.skipped)), cpm: nn(h.cpm), acc: Math.min(1, nn(h.acc)),
    })).slice(-HISTORY_CAP);
  }
  if (isRec(raw.best)) {
    for (const d of DURATIONS) {
      const b = raw.best[d];
      if (isRec(b) && nn(b.cpm) > 0) out.best[d] = { cpm: nn(b.cpm), acc: Math.min(1, nn(b.acc)), ts: nn(b.ts) };
    }
  }
  return out;
}
export function loadSaved(storage = globalThis.localStorage) {
  try { return sanitizeSaved(JSON.parse(storage.getItem(KEY))); } catch (e) { return emptySaved(); }
}
export function saveSaved(s, storage = globalThis.localStorage) {
  safeSetItem(KEY, JSON.stringify(sanitizeSaved(s)), storage);
}
export const levelOf = (saved, fam) => (saved.levels && saved.levels[fam]) || 1;

/** Adaptivity: records one result for the family and moves its level. Returns 'up' | 'down' | null. */
export function adapt(saved, fam, correct) {
  const rec = [...(saved.recent[fam] || []), correct ? 1 : 0].slice(-ADAPT_WINDOW);
  saved.recent[fam] = rec;
  const lvl = levelOf(saved, fam);
  const acc = rec.reduce((s, x) => s + x, 0) / rec.length;
  if (rec.length >= UP_MIN && acc >= UP_ACC && lvl < MAX_LEVEL) { saved.levels[fam] = lvl + 1; saved.recent[fam] = []; return 'up'; }
  if (rec.length >= DOWN_MIN && acc <= DOWN_ACC && lvl > 1) { saved.levels[fam] = lvl - 1; saved.recent[fam] = []; return 'down'; }
  return null;
}

/* ---------- scoring ---------- */
const round1 = (n) => Math.round(n * 10) / 10;
/** correct per minute (over the full set length) and accuracy (correct / typed answers; skips are not typed answers). */
export function scoreSet({ correct = 0, wrong = 0, skipped = 0, dur = 120 }) {
  const typed = correct + wrong;
  return { correct, wrong, skipped, dur, cpm: round1(correct / (dur / 60)), acc: typed ? Math.round((correct / typed) * 100) / 100 : 0 };
}

/* ---------- session ---------- */
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** A session: family order is seeded; levels come from `saved` (and move while it runs). Time is handled by the caller. */
export function newSession({ seed = 1, dur = 120, family = 'mixed', saved = emptySaved() } = {}) {
  const fams = family === 'mixed' || !GENS[family] ? FAMILIES.map((f) => f.id) : [family];
  return { seed: seed >>> 0, dur, mode: fams.length > 1 ? 'mixed' : fams[0], order: shuffled(fams, mulberry32(seed >>> 0)), index: 0, saved, results: [], moves: [], cur: null };
}
export function currentItem(sess) {
  if (!sess.cur) {
    const fam = sess.order[sess.index % sess.order.length];
    sess.cur = makeItem(fam, levelOf(sess.saved, fam), hashStr(`${sess.seed}:${sess.index}`));
  }
  return sess.cur;
}
const settle = (sess, correct, skipped, text, seconds) => {
  const item = currentItem(sess);
  const mv = adapt(sess.saved, item.fam, correct);
  if (mv) sess.moves.push({ fam: item.fam, move: mv, level: levelOf(sess.saved, item.fam) });
  const res = { id: item.id, fam: item.fam, level: item.level, math: item.math, prompt: item.prompt, expected: item.answer, given: String(text || ''), correct, skipped, seconds: Math.max(0, Math.round(seconds || 0)) };
  sess.results.push(res);
  sess.index += 1;
  sess.cur = null;
  return res;
};
/** Submits a typed answer. Unreadable input returns { valid:false } and changes nothing. */
export function submitAnswer(sess, text, seconds = 0) {
  const item = currentItem(sess);
  const r = checkSprintAnswer(item, text);
  if (!r.valid) return r;
  const res = settle(sess, r.correct, false, text, seconds);
  return { valid: true, correct: r.correct, note: r.note, result: res, expected: item.answer };
}
export function skipItem(sess, seconds = 0) {
  const item = currentItem(sess);
  return { valid: true, correct: false, skipped: true, result: settle(sess, false, true, '', seconds), expected: item.answer };
}
/** Closes a session: score, history entry, personal best. Mutates and returns { score, isBest, byFamily }. */
export function finishSession(sess, now = Date.now()) {
  const c = sess.results.filter((r) => r.correct).length;
  const sk = sess.results.filter((r) => r.skipped).length;
  const score = scoreSet({ correct: c, wrong: sess.results.length - c - sk, skipped: sk, dur: sess.dur });
  const saved = sess.saved;
  const prev = saved.best[sess.dur];
  const isBest = score.acc >= BEST_MIN_ACCURACY && score.correct > 0 && (!prev || score.cpm > prev.cpm);
  if (isBest) saved.best[sess.dur] = { cpm: score.cpm, acc: score.acc, ts: now };
  saved.history = [...saved.history, { ts: now, dur: sess.dur, mode: sess.mode, correct: score.correct, wrong: score.wrong, skipped: score.skipped, cpm: score.cpm, acc: score.acc }].slice(-HISTORY_CAP);
  const byFamily = {};
  for (const r of sess.results) {
    const f = byFamily[r.fam] || (byFamily[r.fam] = { correct: 0, total: 0 });
    f.total += 1; if (r.correct) f.correct += 1;
  }
  return { score, isBest, byFamily, previousBest: prev || null };
}
